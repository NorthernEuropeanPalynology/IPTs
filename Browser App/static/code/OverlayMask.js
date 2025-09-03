  // Build mask URL from #file-info
function getMaskUrl() {
  let name = document.getElementById("file-info").innerHTML.trim();
  // Remove ".dzi" if present at the end
  if (name.toLowerCase().endsWith(".dzi")) {
    name = name.slice(0, -4);
  }
  return `/mask/${name}.png`;
}

// 1) Overlay a mask that matches ONLY the current visible area (i.e., you segmented the current view)
//    The mask image should be a crop that corresponds to the current viewport region.
function overlayMaskForCurrentView(opacity = 0.5) {
  const url = getMaskUrl();

  // Remove previous overlay first
  if (window._osdMaskOverlayEl) {
    removeCurrentViewMask();
  }

  const img = document.createElement("img");
  img.src = url;
  img.style.opacity = String(opacity);
  img.style.pointerEvents = "none";

  // Use CURRENT bounds (not target)
  const bounds = window.viewer.viewport.getBounds(true);

  window.viewer.addOverlay({
    element: img,
    location: bounds, // OpenSeadragon.Rect in viewport coords
    rotationMode: OpenSeadragon.OverlayRotationMode?.EXACT // if your OSD version supports it
  });

  window._osdMaskOverlayEl = img;
}

// 2) Overlay a mask for the WHOLE image (i.e., you segmented the full-resolution image)
//    The PNG should align with the base image (same pixel dimensions & orientation).
function overlayMaskForWholeImage(opacity = 0.5) {
  const url = getMaskUrl();
  const viewer = window.viewer;
  const world = viewer.world;
  const base = world.getItemAt(0);
  if (!base) return console.warn('No base image loaded yet.');

  const b = base.getBounds(); // world coords

  // Put the mask on top by default
  const topIndex = world.getItemCount(); // append at the end (top)

  viewer.addTiledImage({
    tileSource: { type: 'image', url },

    // Position exactly over the base image
    x: b.x,
    y: b.y,
    width: b.width,

    opacity,
    index: topIndex, // <-- preferred, works in modern OSD

    success: (evt) => {
      const item = evt.item || evt.tiledImage || evt;
      if (!item) {
        console.warn('No TiledImage in success callback:', evt);
        return;
      }

      // Keep on top, regardless of OSD version
      if (typeof item.setZIndex === 'function') {
        // If base has getZIndex, use it; otherwise, just push to top
        if (typeof base.getZIndex === 'function') {
          item.setZIndex(base.getZIndex() + 1);
        } else {
          // Fallback: ensure it's last (top) in the world
          if (typeof world.setItemIndex === 'function') {
            world.setItemIndex(item, world.getItemCount() - 1);
          }
        }
      } else if (typeof world.setItemIndex === 'function') {
        world.setItemIndex(item, world.getItemCount() - 1);
      }

      if (typeof item.setOpacity === 'function') {
        item.setOpacity(opacity);
      }

      window._osdMaskTiledImage = item; // keep a handle
    }
  });
}

// (Optional) Quick removers
function removeCurrentViewMask() {
    if (window._osdMaskOverlayEl) {
      window.viewer.removeOverlay(window._osdMaskOverlayEl);
      window._osdMaskOverlayEl = null;
    }
}

function removeWholeImageMask() {
    if (window._osdMaskTiledImage) {
      window.viewer.world.removeItem(window._osdMaskTiledImage);
      window._osdMaskTiledImage = null;
    }
}
