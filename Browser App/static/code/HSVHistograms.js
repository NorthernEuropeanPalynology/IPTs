/*  HSVHistograms.js — clean plots + overlay multi-range sliders
    Requirements (in HTML/CSS):
      - Three containers exist: #hue-hist, #sat-hist, #val-hist
      - Each container has some height (e.g., 120px) and is positioned (relative/overflow hidden)
      - Optional: set background gradients in CSS, e.g.:
          #hue-hist { background: linear-gradient(to right,
              hsl(0,100%,85%), hsl(60,100%,85%), hsl(120,100%,85%),
              hsl(180,100%,85%), hsl(240,100%,85%), hsl(300,100%,85%),
              hsl(360,100%,85%)); }
          #sat-hist { background: linear-gradient(to right,#fff,#000); }
          #val-hist { background: linear-gradient(to right,#000,#fff); }

    Usage:
      viewer.addHandler('open', () => initHSV(viewer));

    Exposes:
      window.HSV_THRESHOLDS = { h:{min,max}, s:{min,max}, v:{min,max} }

*/

window.HSV_THRESHOLDS = {
  h: { min: 0,   max: 360 },
  s: { min: 0.0, max: 1.0  },
  v: { min: 0.0, max: 1.0  }
};

(function () {
  // ------------------------------ Config --------------------------------
  const BIN_H = 360;       // Hue resolution in degrees
  const BIN_SV = 64;       // Bins for S/V (0..1)
  const SMOOTH_SIGMA = 3;  // Gaussian smoothing sigma for hue line
  const SLIDER_HANDLE_WIDTH = 4; // px
  const SLIDER_MIN_GAP = 0.01;   // in fraction of width (prevent overlap)

  // Public thresholds object (used by your segmentation)
  let viewerRef = null;
  let initialized = false;
  let IS_SLIDER_DRAGGING = false;

  // ------------------------------ Utils ---------------------------------
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  function debounce(fn, ms){
    let t=null;
    return function(){ clearTimeout(t); t=setTimeout(fn, ms); };
  }

  function rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const d=max-min;
    let h=0, s=max===0?0:d/max, v=max;
    if(d!==0){
      switch(max){
        case r: h=((g-b)/d + (g<b?6:0)); break;
        case g: h=((b-r)/d + 2); break;
        case b: h=((r-g)/d + 4); break;
      }
      h*=60;
    }
    return [h, s, v];
  }

  function gaussianKernel1D(sig){
    const radius = Math.max(1, Math.floor(sig*3));
    const w = 2*radius + 1;
    const k = new Float32Array(w);
    let sum=0;
    for(let i=0;i<w;i++){
      const x = i - radius;
      const val = Math.exp(-(x*x)/(2*sig*sig));
      k[i]=val; sum+=val;
    }
    for(let i=0;i<w;i++) k[i]/=sum;
    return {k, radius};
  }

  function circularConvolve(arr, kernel, radius){
    const n = arr.length;
    const out = new Float32Array(n);
    for(let i=0;i<n;i++){
      let acc=0;
      for(let j=-radius;j<=radius;j++){
        acc += arr[(i+j+n)%n] * kernel[j+radius];
      }
      out[i]=acc;
    }
    return out;
  }

  function getViewportImageData(){
    // Read the currently rendered OpenSeadragon canvas (CORS must allow)
    const canvas = viewerRef && viewerRef.drawer && viewerRef.drawer.canvas;
    if(!canvas) return null;

    const MAX_SIDE = 1200; // downsample to keep it snappy
    const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
    const w = Math.max(2, Math.floor(canvas.width * scale));
    const h = Math.max(2, Math.floor(canvas.height * scale));

    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);

    try {
      return ctx.getImageData(0, 0, w, h);
    } catch(e){
      console.warn('HSV: Cannot read viewport pixels (CORS?)', e);
      return null;
    }
  }

  function computeHistograms(imgData){
    const {data} = imgData;
    const hHist = new Float32Array(BIN_H);
    const sHist = new Float32Array(BIN_SV);
    const vHist = new Float32Array(BIN_SV);

    for(let i=0;i<data.length;i+=4){
      if(data[i+3]===0) continue; // skip transparent
      const [h,s,v] = rgbToHsv(data[i], data[i+1], data[i+2]);
      const hi = clamp(Math.floor(h), 0, BIN_H-1);
      const si = clamp(Math.floor(s*BIN_SV), 0, BIN_SV-1);
      const vi = clamp(Math.floor(v*BIN_SV), 0, BIN_SV-1);
      hHist[hi]++; sHist[si]++; vHist[vi]++;
    }

    // Smooth hue and normalize all to [0,1]
    const {k, radius} = gaussianKernel1D(SMOOTH_SIGMA);
    let hSmooth = circularConvolve(hHist, k, radius);

    const normalize = (arr) => {
      const max = Math.max(...arr) || 1;
      return Array.from(arr, v => v/max);
    };

    return {
      hSmooth: normalize(hSmooth),
      sNorm: normalize(sHist),
      vNorm: normalize(vHist)
    };
  }

  // ------------------------------ Plotting (no axes) --------------------
  function plotHue(hSmooth){
    const x = Array.from({length: BIN_H}, (_,i)=>i);
    const trace = {
      x, y: hSmooth,
      type: 'scatter',
      mode: 'lines',
      line: { width: 2 }
    };
    const layout = {
      margin: {l:0, r:0, t:0, b:0},
      xaxis: {visible:false, range:[0, BIN_H]},
      yaxis: {visible:false, range:[0,1]},
      showlegend: false,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)'
    };
    Plotly.newPlot('hue-plot', [trace], layout, {
      displayModeBar: false,
      staticPlot: true,
      responsive: true
    });
  }

  function plotBars(divId, bins){
    const n = bins.length;
    const x = Array.from({length: n}, (_,i)=> (i+0.5)/n); // 0..1 centers
    const trace = {
      x, y: bins,
      type: 'bar',
      hoverinfo: 'skip',
      marker: { line: { width: 0 } }
    };
    const layout = {
      margin: {l:0, r:0, t:0, b:0},
      xaxis: {visible:false, range:[0,1]},
      yaxis: {visible:false, range:[0,1]},
      showlegend: false,
      bargap: 0,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)'
    };
    Plotly.newPlot(divId, [trace], layout, {
      displayModeBar: false,
      staticPlot: true,
      responsive: true
    });
  }

    // --- globals ---
  window.HSV_SLIDERS = {}; // { h, s, v } each has .set(min,max) and .get()

  function makeRangeSlider(containerId, thresholdsRef, domainMin, domainMax, onChange){
    const GAP = SLIDER_MIN_GAP;              // you already define this
    const HANDLE_W = SLIDER_HANDLE_WIDTH;    // you already define this
    const container = document.getElementById(containerId);
    if (!container) throw new Error('Container not found: '+containerId);

    // Ensure container is relatively positioned
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    // Root overlay
    let slider = container.querySelector('.hsv-range-slider');
    if (!slider){
      slider = document.createElement('div');
      slider.className = 'hsv-range-slider';
      Object.assign(slider.style, { position:'absolute', inset:'0', zIndex:'10' });
      container.appendChild(slider);
    }

    // Shaded outside bands
    const bandLeft  = slider.querySelector('.hsv-band-left')  || slider.appendChild(Object.assign(document.createElement('div'), {className:'hsv-band-left'}));
    const bandRight = slider.querySelector('.hsv-band-right') || slider.appendChild(Object.assign(document.createElement('div'), {className:'hsv-band-right'}));
    Object.assign(bandLeft.style,  {position:'absolute', top:'0', bottom:'0', left:'0', background:'rgba(200,200,200,0.6)', pointerEvents:'none'});
    Object.assign(bandRight.style, {position:'absolute', top:'0', bottom:'0',      background:'rgba(200,200,200,0.6)', pointerEvents:'none'});

    // Handles
    const leftEl  = slider.querySelector('.hsv-handle.left')  || slider.appendChild(Object.assign(document.createElement('div'), {className:'hsv-handle left'}));
    const rightEl = slider.querySelector('.hsv-handle.right') || slider.appendChild(Object.assign(document.createElement('div'), {className:'hsv-handle right'}));
    [leftEl, rightEl].forEach(el => Object.assign(el.style, {
      position:'absolute', top:'0', bottom:'0', width: HANDLE_W + 'px', background:'#d00', cursor:'ew-resize'
    }));

    // State (fractions 0..1)
    const span = (domainMax - domainMin) || 1;
    let fMin = clamp(( (typeof thresholdsRef.min==='number'?thresholdsRef.min:domainMin) - domainMin)/span, 0, 1);
    let fMax = clamp(( (typeof thresholdsRef.max==='number'?thresholdsRef.max:domainMax) - domainMin)/span, 0, 1);
    if (fMin > fMax) [fMin, fMax] = [fMax, fMin];

    function apply(minVal, maxVal){
      thresholdsRef.min = minVal;
      thresholdsRef.max = maxVal;
      if (typeof onChange === 'function') onChange(minVal, maxVal);
    }

    function render(){
      const w = slider.clientWidth || 1;
      const xMin = Math.round(fMin * w);
      const xMax = Math.round(fMax * w);

      leftEl.style.left  = (xMin - HANDLE_W/2) + 'px';
      rightEl.style.left = (xMax - HANDLE_W/2) + 'px';

      bandLeft.style.width  = Math.max(0, xMin) + 'px';
      bandRight.style.left  = xMax + 'px';
      bandRight.style.width = Math.max(0, w - xMax) + 'px';

      // Write back to thresholds
      const minVal = domainMin + span * fMin;
      const maxVal = domainMin + span * fMax;
      apply(minVal, maxVal);
    }

    function set(minVal, maxVal){
      // public setter: move handles + update thresholds
      fMin = clamp((minVal - domainMin)/span, 0, 1);
      fMax = clamp((maxVal - domainMin)/span, 0, 1);
      if (fMin > fMax) [fMin, fMax] = [fMax, fMin];
      render();
    }

    function get(){
      return { min: domainMin + span*fMin, max: domainMin + span*fMax };
    }

    function startDrag(isLeft, clientX){
      const rect = slider.getBoundingClientRect();
      const move = (x)=>{
        const f = clamp( (x - rect.left) / (rect.width || 1), 0, 1 );
        if (isLeft){
          fMin = Math.min(f, fMax - GAP);
        } else {
          fMax = Math.max(f, fMin + GAP);
        }
        render();
      };
      move(clientX);

      const mm = ev => move(ev.clientX);
      const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    }

    // bind drag
    if (!leftEl._bound){
      leftEl.addEventListener('mousedown', e => { e.preventDefault(); startDrag(true,  e.clientX); });
      leftEl._bound = true;
    }
    if (!rightEl._bound){
      rightEl.addEventListener('mousedown', e => { e.preventDefault(); startDrag(false, e.clientX); });
      rightEl._bound = true;
    }

    // keep layout on resize
    if (!slider._ro){
      slider._ro = new ResizeObserver(render);
      slider._ro.observe(slider);
    }

    // initial paint
    render();

    return { set, get, render };
  }

  // tiny helper
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }


  // ------------------------------ Rendering pipeline --------------------
  function ensurePlotScaffolding(){
    // Build the (plot + overlay slider) scaffolding once per container
    const make = (rootId, plotId)=>{
      const root = document.getElementById(rootId);
      if(!root) return;
      if(!root.querySelector(`#${plotId}`)){
        const plot = document.createElement('div');
        plot.id = plotId;
        Object.assign(plot.style, {
          position: 'absolute',
          inset: '0'
        });
        // ensure container is relatively positioned
        if(getComputedStyle(root).position === 'static'){
          root.style.position = 'relative';
        }
        root.appendChild(plot);
      }
    };
    make('hue-hist', 'hue-plot');
    make('sat-hist', 'sat-plot');
    make('val-hist', 'val-plot');
  }

  function updateFromViewport(){
    if (IS_SLIDER_DRAGGING) return; // <-- don't replot/re-init while dragging

    const img = getViewportImageData();
    if(!img) return;

    const {hSmooth, sNorm, vNorm} = computeHistograms(img);

    plotHue(hSmooth);
    plotBars('sat-plot', sNorm);
    plotBars('val-plot', vNorm);
  }

  // ------------------------------ Public API ----------------------------
  window.initHSV = function(viewer){
    viewerRef = viewer;
    if(initialized) return;

    ensurePlotScaffolding();

    const debounced = debounce(updateFromViewport, 150);
    viewer.addHandler('animation-finish', debounced);
    viewer.addHandler('update-viewport', debounced);
    viewer.addHandler('tile-drawn', debounced);
    viewer.addOnceHandler('open', debounced);

    // First pass
    setTimeout(updateFromViewport, 300);
    initialized = true;

    window.HSV_SLIDERS.h = makeRangeSlider(
      'hue-hist', HSV_THRESHOLDS.h, 0, 360,
      (min,max)=>{ HSV_THRESHOLDS.h.min=min; HSV_THRESHOLDS.h.max=max; }
    );
    window.HSV_SLIDERS.s = makeRangeSlider(
      'sat-hist', HSV_THRESHOLDS.s, 0, 1,
      (min,max)=>{ HSV_THRESHOLDS.s.min=min; HSV_THRESHOLDS.s.max=max; }
    );
    window.HSV_SLIDERS.v = makeRangeSlider(
      'val-hist', HSV_THRESHOLDS.v, 0, 1,
      (min,max)=>{ HSV_THRESHOLDS.v.min=min; HSV_THRESHOLDS.v.max=max; }
    );
  };

  window.setHueRange = (min,max) => window.HSV_SLIDERS.h?.set(min,max);
  window.setSatRange = (min,max) => window.HSV_SLIDERS.s?.set(min,max);
  window.setValRange = (min,max) => window.HSV_SLIDERS.v?.set(min,max);

})();


