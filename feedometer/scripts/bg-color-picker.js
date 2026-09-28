/**
 * Feedometer — Background Color Picker
 * Live color wheel with hue slider + RGB inputs.
 * Changes body background in real-time and persists via localStorage.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  HSV <-> RGB helpers                                                 */
  /* ------------------------------------------------------------------ */
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 360;
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : (max - min) / max;
    let h = 0;
    if (max !== min) {
      const d = max - min;
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s, v];
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------------------------------ */
  /*  State                                                               */
  /* ------------------------------------------------------------------ */
  // Default: Black background
  let hue = 0, sat = 0, val = 0;
  let dragging = false;
  let pickerOpen = false;

  /* ------------------------------------------------------------------ */
  /*  DOM refs                                                            */
  /* ------------------------------------------------------------------ */
  const trigger  = document.getElementById('bg-color-trigger');
  const popup    = document.getElementById('bg-color-popup');
  const canvas   = document.getElementById('bg-picker-canvas');
  const ctx      = canvas ? canvas.getContext('2d') : null;
  const hueSlider = document.getElementById('bg-hue-slider');
  const rInput   = document.getElementById('bg-r-input');
  const gInput   = document.getElementById('bg-g-input');
  const bInput   = document.getElementById('bg-b-input');
  const swatch   = document.getElementById('bg-color-swatch');
  const preview  = document.getElementById('bg-picker-preview');
  const eyedrop  = document.getElementById('bg-picker-eyedrop');

  if (!trigger || !popup || !canvas || !ctx) return;

  /* ------------------------------------------------------------------ */
  /*  Restore saved color                                                 */
  /* ------------------------------------------------------------------ */
  const saved = localStorage.getItem('feedometer_bg_color');
  if (saved) {
    const parts = saved.split(',').map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) {
      const [h, s, v] = rgbToHsv(...parts);
      hue = h; sat = s; val = v;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Apply background to page                                            */
  /* ------------------------------------------------------------------ */
  function applyBackground(r, g, b) {
    // Lighter radial center variant (+45 clamped)
    const lr = Math.min(255, r + 45);
    const lg = Math.min(255, g + 45);
    const lb = Math.min(255, b + 45);
    document.body.style.backgroundColor = `rgb(${r},${g},${b})`;
    document.body.style.backgroundImage =
      `radial-gradient(circle at 20% 20%, rgb(${lr},${lg},${lb}) 0%, rgb(${r},${g},${b}) 100%)`;
  }

  /* ------------------------------------------------------------------ */
  /*  Draw canvas gradient                                                */
  /* ------------------------------------------------------------------ */
  function drawCanvas() {
    const W = canvas.width, H = canvas.height;
    // Horizontal: white → pure hue
    const gH = ctx.createLinearGradient(0, 0, W, 0);
    gH.addColorStop(0, '#ffffff');
    gH.addColorStop(1, `hsl(${hue}, 100%, 50%)`);
    ctx.fillStyle = gH;
    ctx.fillRect(0, 0, W, H);
    // Vertical: transparent → black (overlay)
    const gV = ctx.createLinearGradient(0, 0, 0, H);
    gV.addColorStop(0, 'rgba(0,0,0,0)');
    gV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gV;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCursor() {
    const W = canvas.width, H = canvas.height;
    const x = Math.round(sat * W);
    const y = Math.round((1 - val) * H);
    // outer dark ring
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // inner white ring
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /*  Full render cycle                                                   */
  /* ------------------------------------------------------------------ */
  function render() {
    drawCanvas();
    drawCursor();

    const [r, g, b] = hsvToRgb(hue, sat, val);
    const hex = toHex(r, g, b);

    if (rInput) rInput.value = r;
    if (gInput) gInput.value = g;
    if (bInput) bInput.value = b;
    if (hueSlider) hueSlider.value = Math.round(hue);
    if (swatch)  swatch.style.background = hex;
    if (preview) preview.style.background = hex;

    applyBackground(r, g, b);
    localStorage.setItem('feedometer_bg_color', `${r},${g},${b}`);
  }

  /* ------------------------------------------------------------------ */
  /*  Initial apply (without opening popup)                              */
  /* ------------------------------------------------------------------ */
  const [initR, initG, initB] = hsvToRgb(hue, sat, val);
  applyBackground(initR, initG, initB);
  const initHex = toHex(initR, initG, initB);
  if (swatch) swatch.style.background = initHex;
  if (hueSlider) hueSlider.value = Math.round(hue);

  /* ------------------------------------------------------------------ */
  /*  Toggle popup & Mutual Exclusivity                                 */
  /* ------------------------------------------------------------------ */
  function closePicker() {
    if (pickerOpen) {
      pickerOpen = false;
      popup.classList.remove('active');
    }
  }

  // Allow other components to request closing the color picker
  document.addEventListener('close-bg-picker', closePicker);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    pickerOpen = !pickerOpen;
    if (pickerOpen) {
      // Close popular feeds flame dropdown if open
      const navDropdown = document.getElementById('feed-navigator-dropdown');
      const navBtn = document.getElementById('btn-feed-navigator');
      if (navDropdown && navDropdown.classList.contains('active')) {
        navDropdown.classList.remove('active');
        if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
        const navSearch = document.getElementById('feed-nav-search');
        if (navSearch) navSearch.blur();
      }
      popup.classList.add('active');
      render();
    } else {
      popup.classList.remove('active');
    }
  });

  document.addEventListener('click', (e) => {
    if (pickerOpen && !popup.contains(e.target) && !trigger.contains(e.target)) {
      closePicker();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Canvas drag (saturation × brightness)                              */
  /* ------------------------------------------------------------------ */
  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return [
      Math.max(0, Math.min(canvas.width,  (clientX - rect.left) * scaleX)),
      Math.max(0, Math.min(canvas.height, (clientY - rect.top)  * scaleY))
    ];
  }

  function handleCanvasPick(e) {
    const [x, y] = getCanvasPos(e);
    sat = x / canvas.width;
    val = 1 - y / canvas.height;
    render();
  }

  canvas.addEventListener('mousedown', (e) => { dragging = true; handleCanvasPick(e); });
  canvas.addEventListener('touchstart', (e) => {
    dragging = true; handleCanvasPick(e); e.preventDefault();
  }, { passive: false });
  document.addEventListener('mousemove',  (e) => { if (dragging) handleCanvasPick(e); });
  document.addEventListener('touchmove',  (e) => { if (dragging) handleCanvasPick(e); }, { passive: false });
  document.addEventListener('mouseup',   () => { dragging = false; });
  document.addEventListener('touchend',  () => { dragging = false; });

  /* ------------------------------------------------------------------ */
  /*  Hue slider                                                          */
  /* ------------------------------------------------------------------ */
  if (hueSlider) {
    hueSlider.addEventListener('input', (e) => {
      hue = parseFloat(e.target.value);
      render();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  RGB inputs                                                          */
  /* ------------------------------------------------------------------ */
  function onRgbChange() {
    const r = Math.max(0, Math.min(255, parseInt(rInput.value) || 0));
    const g = Math.max(0, Math.min(255, parseInt(gInput.value) || 0));
    const b = Math.max(0, Math.min(255, parseInt(bInput.value) || 0));
    [hue, sat, val] = rgbToHsv(r, g, b);
    render();
  }
  if (rInput) rInput.addEventListener('input', onRgbChange);
  if (gInput) gInput.addEventListener('input', onRgbChange);
  if (bInput) bInput.addEventListener('input', onRgbChange);

  /* ------------------------------------------------------------------ */
  /*  Eyedropper (Chrome 95+ / Edge)                                     */
  /* ------------------------------------------------------------------ */
  if (eyedrop) {
    if (!window.EyeDropper) {
      eyedrop.style.display = 'none';
    } else {
      eyedrop.addEventListener('click', async () => {
        try {
          const dropper = new EyeDropper();
          const { sRGBHex } = await dropper.open();
          const r = parseInt(sRGBHex.slice(1, 3), 16);
          const g = parseInt(sRGBHex.slice(3, 5), 16);
          const b = parseInt(sRGBHex.slice(5, 7), 16);
          [hue, sat, val] = rgbToHsv(r, g, b);
          render();
        } catch (_) { /* user cancelled */ }
      });
    }
  }

})();
