// -- Brand logo injection and CSS-theme color mapping -------------------------
(function () {
  const TARGET_IDS = ['go-logo-hdr', 'go-logo-upload'];

  // Map the seven cubes to the master theme palette variables.
  const THEME_MAP = [
    '--brand-accent',
    '--brand-dark',
    '--brand-surface',
    '--brand-warn',
    '--brand-danger',
    '--cat-blue',
    '--cat-green',
  ];

  const EMBEDDED_LOGO_SVG = `<svg viewBox="121.8 43.5 936.5 1106.5" xmlns="http://www.w3.org/2000/svg" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5;--hex-1:#ffffff;--hex-2:#000000;--hex-3:#00fed8;--hex-4:#00fed8;--hex-5:#00fed8;--hex-6:#00fed8;--hex-7:#00fed8;--sw-major:10;--sw-minor:5">
  <defs>
    <symbol id="node" overflow="visible">
      <g transform="translate(333.42 60.77)">
        <path d="M145.64 477.22 257.13 412.01 368.61 477.22V610.92L257.13 676.13 145.64 610.92Z" fill="var(--hex-fill,#00fed8)" stroke="#000" stroke-width="var(--sw-major)"/>
      </g>
      <g transform="matrix(1 0 0 .4488 0 474.16)">
        <path d="M590.55 291.04V585.44" fill="none" stroke="#000" stroke-width="var(--sw-minor)"/>
      </g>
      <g transform="matrix(1.0161 .0086 .0087 1.0046 -14.23 52.22)">
        <path d="M590.55 544.93 481.39 479.83" fill="none" stroke="#000" stroke-width="var(--sw-minor)"/>
      </g>
      <g transform="matrix(-1.0161 .0086 -.0087 1.0046 1195.33 52.22)">
        <path d="M590.55 544.93 481.39 479.83" fill="none" stroke="#000" stroke-width="var(--sw-minor)"/>
      </g>
    </symbol>

    <symbol id="core" overflow="visible">
      <g transform="matrix(1 0 0 .1646 0 598.98)">
        <path d="M590.55 291.04V585.44" fill="none" stroke="#000" stroke-width="var(--sw-major)"/>
      </g>
      <g transform="matrix(.3185 0 0 .3185 402.48 415.15)">
        <path d="M590.55 313.73V463.61M702.04 666.7 829.14 737.29M479.07 248.86 351.97 321.01M702.04 248.86 829.14 321.01M940.62 519.48V671.64M829.14 871.13 702.04 945.58M479.07 945.58 351.94 871.13M240.48 519.48V671.64M479.07 666.7 351.97 737.29" fill="none" stroke="#000" stroke-width="var(--sw-major)"/>
      </g>
      <g transform="matrix(.6076 -.3979 -.3971 1.0373 412.61 253.41)">
        <path d="M590.55 544.93 481.39 479.83" fill="none" stroke="#000" stroke-width="var(--sw-major)"/>
      </g>
      <g transform="matrix(-.5358 -.2772 .2766 .8348 791.71 292.43)">
        <path d="M590.55 544.93 481.39 479.83" fill="none" stroke="#000" stroke-width="var(--sw-major)"/>
      </g>
    </symbol>
  </defs>

  <use href="#node" transform="translate(350.07 198.86)" style="--hex-fill:var(--hex-1)"/>
  <use href="#node" transform="translate(0 406.79)" style="--hex-fill:var(--hex-2)"/>
  <use href="#node" transform="translate(350.07 -218.16)" style="--hex-fill:var(--hex-3)"/>
  <use href="#node" transform="translate(0 -423.03)" style="--hex-fill:var(--hex-4)"/>
  <use href="#node" transform="translate(-351 -218.16)" style="--hex-fill:var(--hex-5)"/>
  <use href="#node" transform="translate(-351 198.86)" style="--hex-fill:var(--hex-6)"/>
  <use href="#node" transform="translate(0 -8.75)" style="--hex-fill:var(--hex-7)"/>

  <use href="#core" transform="matrix(3.1401 0 0 3.1401 -1263.83 -1303.59)"/>
</svg>`;


  let _logoSvgMarkup = EMBEDDED_LOGO_SVG.trim();

  function _themeColor(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  }

  function _shuffle(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function _applyThemeToLogo(svgEl, colorVars) {
    if (!svgEl) return;
    colorVars.forEach((cssVar, index) => {
      const value = _themeColor(cssVar, '#00fed8');
      svgEl.style.setProperty('--hex-' + (index + 1), value);
    });
  }

  function _injectLogo(targetEl, colorVars) {
    if (!targetEl) return;
    targetEl.innerHTML = _logoSvgMarkup;
    const svgEl = targetEl.querySelector('svg');
    if (!svgEl) return;
    svgEl.setAttribute('role', 'img');
    svgEl.setAttribute('aria-label', 'Guerrilla Ops logo');
    _applyThemeToLogo(svgEl, colorVars);
  }

  function applyBrandLogoTheme() {
    if (!_logoSvgMarkup) return;
    const colorVars = _shuffle(THEME_MAP);
    TARGET_IDS.forEach(id => _injectLogo(document.getElementById(id), colorVars));
  }

  async function loadLogoSvg() {
    if (_logoSvgMarkup) return _logoSvgMarkup;
    _logoSvgMarkup = EMBEDDED_LOGO_SVG.trim();
    return _logoSvgMarkup;
  }

  window.applyBrandLogoTheme = applyBrandLogoTheme;
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await loadLogoSvg();
      applyBrandLogoTheme();
    } catch (err) {
      console.warn('Logo SVG load failed:', err.message);
    }
  });
})();
