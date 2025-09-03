// ===== OSD Color Sampler (DOM pointer events; reliable ring) =====
(function(){
  function setupColorSampler({ buttonId, cursorRadius = 10, padding = 0 } = {}){
    const viewer = window.viewer;
    const button = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
    if (!viewer || !button) { console.warn('setupColorSampler: viewer or button missing'); return; }

    // Ensure absolute children position correctly
    if (getComputedStyle(viewer.element).position === 'static'){
      viewer.element.style.position = 'relative';
    }

    let sampling = false;
    let ringRoot = null;
    let ring = null;2

    // --- Overlay root above everything inside the viewer
    function ensureRingRoot(){
      let root = viewer.element.querySelector('.osd-sampler-overlay');
      if (!root){
        root = document.createElement('div');
        root.className = 'osd-sampler-overlay';
        Object.assign(root.style, {
          position: 'absolute',
          inset: '0',
          pointerEvents: 'none',        // doesn't block clicks
          zIndex: '2147483647',
          overflow: 'hidden',
          display: 'none'
        });
        viewer.element.appendChild(root);
      }
      return root;
    }

    function makeRing(){
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute',
        width: `${cursorRadius*2}px`,
        height:`${cursorRadius*2}px`,
        borderRadius: '50%',
        border: '2px solid rgba(0,0,0,0.85)',
        boxShadow: '0 0 0 2px rgba(255,255,255,0.95) inset',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none'
      });
      ringRoot.appendChild(d);
      return d;
    }

    function getCanvas(){
      const c = viewer.drawer && viewer.drawer.canvas;
      if (c && c.getContext) return c;
      const q = viewer.element.querySelector('canvas');
      if (!q) throw new Error('OSD canvas not found');
      return q;
    }

    // --- Event handlers (DOM pointer events)
    function onPointerEnter(){ if (ringRoot) ringRoot.style.display = 'block'; }
    function onPointerLeave(){ if (ringRoot) ringRoot.style.display = 'none'; }
    function onPointerMove(ev){
      if (!ring) return;
      const rect = viewer.element.getBoundingClientRect();
      ring.style.left = `${ev.clientX - rect.left}px`;
      ring.style.top  = `${ev.clientY - rect.top}px`;
    }
    function onPointerDown(ev){
      if (!sampling) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const canvas = getCanvas();
        const rect   = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;

        // Convert to canvas pixel coordinates
        let cx = Math.round((ev.clientX - rect.left) * scaleX);
        let cy = Math.round((ev.clientY - rect.top)  * scaleY);
        cx = Math.max(0, Math.min(canvas.width  - 1, cx));
        cy = Math.max(0, Math.min(canvas.height - 1, cy));

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const d   = ctx.getImageData(cx, cy, 1, 1, { willReadFrequently: true }).data;
        const r = d[0] / 255, g = d[1] / 255, b = d[2] / 255;

        const hsv = rgbToHsv(r,g,b);
        const hsl = rgbToHsl(r,g,b);

        const { h, s, v } = expandRanges(
            window.HSV_THRESHOLDS,
            { h: hsv.h, s: hsv.s, v: hsv.v },
            { h: [0,360], s: [0,1], v: [0,1] }
        );

        // move sliders + update globals in one go:
        setHueRange(h.min, h.max);
        setSatRange(s.min, s.max);
        setValRange(v.min, v.max);

      } catch (err){
        console.error('Sampling failed:', err);
      } finally {
        disable(); // single-pick session
      }
    }

    // --- Enable/disable
    function enable(){
      if (sampling) return;
      sampling = true;

      ringRoot = ensureRingRoot();
      ringRoot.style.display = 'block';
      ring = makeRing();

      // Hide the system cursor; ring is our cursor
      viewer.element.style.cursor = 'none';
      viewer.setMouseNavEnabled(false);
      viewer.element.style.touchAction = 'none'; // prevent touch gestures

      // Use DOM pointer events (reliable across OSD versions)
      viewer.element.addEventListener('pointerenter', onPointerEnter, true);
      viewer.element.addEventListener('pointerleave', onPointerLeave, true);
      viewer.element.addEventListener('pointermove',  onPointerMove,  true);
      viewer.element.addEventListener('pointerdown',  onPointerDown,  true);
    }

    function disable(){
      if (!sampling) return;
      sampling = false;

      viewer.setMouseNavEnabled(true);
      viewer.element.style.cursor = '';

      viewer.element.removeEventListener('pointerenter', onPointerEnter, true);
      viewer.element.removeEventListener('pointerleave', onPointerLeave, true);
      viewer.element.removeEventListener('pointermove',  onPointerMove,  true);
      viewer.element.removeEventListener('pointerdown',  onPointerDown,  true);

      if (ring){ ring.remove(); ring = null; }
      if (ringRoot){ ringRoot.style.display = 'none'; }
    }

    // --- Range expansion logic
    function announce(mode, thresholds){
      window.dispatchEvent(new CustomEvent('color-thresholds-changed', { detail:{ mode, thresholds } }));
      if (typeof window.updateThresholdSliders === 'function'){
        window.updateThresholdSliders(mode, thresholds);
      }
    }

    function expandRanges(current, picked, domains, padding = 0){
        // returns { h:{min,max}, s:{min,max}, v:{min,max} } without mutating `current`
        const out = {};
        for (const k of Object.keys(picked)){
            const [dMin, dMax] = domains[k];
            const v = picked[k];

            // read current, default to full domain
            let min = (current[k] && typeof current[k].min === 'number') ? current[k].min : dMin;
            let max = (current[k] && typeof current[k].max === 'number') ? current[k].max : dMax;

            // full-domain ⇒ treat as uninitialized (snap to picked)
            const atDomain = almost(min, dMin) && almost(max, dMax);

            if (k === 'h'){ // circular degrees 0..360)
            if (atDomain){ min = v; max = v; }
            else {
                let a = normDeg(min), b = normDeg(max), vv = normDeg(v);
                const inRange = (a <= b) ? (vv >= a && vv <= b) : (vv >= a || vv <= b);
                if (!inRange){
                // expand by the shorter arc
                const growMax = (vv - a + 360) % 360; // expand max → vv
                const growMin = (b - vv + 360) % 360; // expand min → vv
                if (growMax <= growMin) b = vv; else a = vv;
                }
                if (padding){ a = normDeg(a - padding); b = normDeg(b + padding); }
                min = normDeg(a); max = normDeg(b);
            }
            } else {        // linear channels (S, V) in [0..1]
            if (atDomain){ min = v; max = v; }
            else {
                if (v < min) min = v;
                if (v > max) max = v;
                if (padding){
                min = Math.max(dMin, min - padding);
                max = Math.min(dMax, max + padding);
                }
            }
            min = clamp(min, dMin, dMax);
            max = clamp(max, dMin, dMax);
            }

            out[k] = { min, max };
        }
        return out;
    }
    
    // helpers
    const clamp  = (x, a, b) => Math.max(a, Math.min(b, x));
    const almost = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
    const normDeg = x => ((x % 360) + 360) % 360;
    // --- Color conversions
    function rgbToHsl(r,g,b){
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      let h=0,s=0; const l=(max+min)/2;
      if (max!==min){
        const d=max-min;
        s = l>0.5 ? d/(2-max-min) : d/(max+min);
        switch(max){
          case r: h=(g-b)/d + (g<b?6:0); break;
          case g: h=(b-r)/d + 2; break;
          case b: h=(r-g)/d + 4; break;
        } h*=60;
      }
      return { h:(h+360)%360, s, l };
    }
    function rgbToHsv(r,g,b){
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      const v=max, d=max-min;
      const s=max===0?0:d/max;
      let h=0;
      if (max!==min){
        switch(max){
          case r: h=(g-b)/d + (g<b?6:0); break;
          case g: h=(b-r)/d + 2; break;
          case b: h=(r-g)/d + 4; break;
        } h*=60;
      }
      return { h:(h+360)%360, s, v };
    }

    // Expose
    button.addEventListener('click', enable);
    return { enable, disable };
  }

  window.setupColorSampler = setupColorSampler;
})();
