function getOsdCanvas(viewer) {
  if (viewer.drawer) {
    if (viewer.drawer.canvas) return viewer.drawer.canvas;                 // common
    if (typeof viewer.drawer.getCanvas === "function") return viewer.drawer.getCanvas(); // some builds
  }
  return null;
}

function getImageViewCorners(viewer, itemIndex = 0) {
  const item = viewer.world.getItemAt(itemIndex);
  if (!item) throw new Error("No TiledImage at index " + itemIndex);

  const vp = viewer.viewport;
  const w = viewer.container.clientWidth;   // CSS px
  const h = viewer.container.clientHeight;  // CSS px

  // Map canvas corners (CSS px) -> viewport -> image coords
  const P = (x, y) => item.viewportToImageCoordinates(
    vp.pointFromPixel(new OpenSeadragon.Point(x, y), true)
  );

  return {
    tl: P(0, 0),
    tr: P(w, 0),
    bl: P(0, h),
    br: P(w, h),
    cssW: w,
    cssH: h
  };
}

// Build orientation-free length and exact area factors from the corners.
function getImageScalers(viewer, itemIndex = 0) {
  const { tl, tr, bl, cssW, cssH } = getImageViewCorners(viewer, itemIndex);

  // Canvas device px per CSS px (HiDPI aware)
  const canvas = viewer.drawer.canvas;
  const devPerCssX = canvas.width  / cssW;
  const devPerCssY = canvas.height / cssH;

  // Image-space vectors along the top and left canvas edges
  const vx = { x: tr.x - tl.x, y: tr.y - tl.y }; // top edge in image px
  const vy = { x: bl.x - tl.x, y: bl.y - tl.y }; // left edge in image px

  // Convert to per-**device-pixel** vectors
  const vxPerDev = { x: vx.x / (cssW * devPerCssX), y: vx.y / (cssW * devPerCssX) };
  const vyPerDev = { x: vy.x / (cssH * devPerCssY), y: vy.y / (cssH * devPerCssY) };

  // Exact area factor: image px² per device px²
  const areaFactor = Math.abs(vxPerDev.x * vyPerDev.y - vxPerDev.y * vyPerDev.x);

  // Orientation-free length factor (RMS stretch over all directions)
  const lenX = Math.hypot(vxPerDev.x, vxPerDev.y);
  const lenY = Math.hypot(vyPerDev.x, vyPerDev.y);
  const lengthFactor = Math.sqrt((lenX * lenX + lenY * lenY) / 2);

  return { lengthFactor, areaFactor };
}


async function runSegmentation(mode) {

  // shared canvas + vars so both branches can set imgData/width/height
  window.viewer.forceRedraw()
  let payload = {};
  var scale = 1;

  if (mode == "PREVIEW") {
    const canvas = getOsdCanvas(window.viewer);
    if (!canvas) {
      console.error("No OSD canvas found. Your build may not expose drawer.canvas.");
      alert("Could not access the viewer canvas.");
      return;
    }
    const ctx = canvas.getContext("2d");
    let { width, height } = canvas;
    let imgData;
    
    var imageWidth = window.viewer.source.dimensions.x;
    var containerWidth = window.viewer.viewport.getContainerSize().x;
    var zoomToZoomLevelRatio = containerWidth / imageWidth;
    var scale = viewer.viewport.getZoom(true) * zoomToZoomLevelRatio;

    // Grab pixels from the OSD canvas
    imgData = ctx.getImageData(0, 0, width, height); // may throw if tainted
    payload = {
      width,
      height,
      data: Array.from(imgData.data), // flattened RGBA
      h_min: window.HSV_THRESHOLDS.h.min/360,
      h_max: window.HSV_THRESHOLDS.h.max/360,
      s_min: window.HSV_THRESHOLDS.s.min,
      s_max: window.HSV_THRESHOLDS.s.max,
      v_min: window.HSV_THRESHOLDS.v.min,
      v_max: window.HSV_THRESHOLDS.v.max,
      do_watershed: document.getElementById("watershed").checked,
      do_morphology: document.getElementById("do_morphology").checked,
      min_distance: parseInt(document.getElementById("min-distance").value || "1", 10),
      dilate: parseInt(document.getElementById("dilate").value || "1", 10),
      smooth_radius: parseInt(document.getElementById("smooth").value || "1", 10),
      filename: document.getElementById("file-info").innerHTML.replace(/\.[^/.]+$/, ""),
      morphfilter: {
        minArea : document.getElementById("minarea").value / (scale**2),
        maxArea : document.getElementById("maxarea").value / (scale**2),
        minCircularity: parseFloat(document.getElementById("mincircularity").value),
        maxCircularity: parseFloat(document.getElementById("maxcircularity").value),
      }
    };
    
  } else if (mode === "COMPLETE") {
      // safer than innerHTML
      const baseName = document.getElementById("file-info").textContent.trim().replace(/\.[^/.]+$/, "");
      const maskUrl  = `/png/${baseName}.png`;

      payload = {
        image_path: maskUrl,
        h_min: window.HSV_THRESHOLDS.h.min/360,
        h_max: window.HSV_THRESHOLDS.h.max/360,
        s_min: window.HSV_THRESHOLDS.s.min,
        s_max: window.HSV_THRESHOLDS.s.max,
        v_min: window.HSV_THRESHOLDS.v.min,
        v_max: window.HSV_THRESHOLDS.v.max,
        do_watershed: document.getElementById("watershed").checked,
        do_morphology: document.getElementById("do_morphology").checked,
        min_dstance: parseInt(document.getElementById("min_distance").value || "40", 99999),
        smooth_radius: parseInt(document.getElementById("smooth").value || "1", 10),
        dilate: parseInt(document.getElementById("dilate").value || "1", 10),
        filename: document.getElementById("file-info").innerHTML.replace(/\.[^/.]+$/, ""),
        morphfilter: {
          minArea : parseFloat(document.getElementById("minarea").value),
          maxArea : parseFloat(document.getElementById("maxarea").value),
          minCircularity: parseFloat(document.getElementById("mincircularity").value),
          maxCircularity: parseFloat(document.getElementById("maxcircularity").value),
        }
      };
  }

  const res = await fetch("/segment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
  });

  let data = await res.json();
    
  const tbody = document.querySelector("#resultsTable tbody");
  tbody.innerHTML = "";


  data.measurements.forEach((row) => {
  const html = `
      <tr>
      <td>${row.label}</td>
      <td>${Math.round((row.area/(scale**2)) * 100)/100}</td>
      <td>${Math.round(row.perimeter * scale * 100)/100}</td>
      <td>${Math.round(row.circularity * 100)/100}</td>
      <td>${Math.round(row.solidity * 100)/100}</td>
      <td>${Math.round(row.equivalent_diameter * scale *100)/100}</td>
      </tr>`;
  tbody.insertAdjacentHTML("beforeend", html);
  });
  
  if(mode == "PREVIEW"){
    overlayMaskForCurrentView(0.8)
  } else if(mode == "COMPLETE"){
    overlayMaskForWholeImage(0.8)
  }
}