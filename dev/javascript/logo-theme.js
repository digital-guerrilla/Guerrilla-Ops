// -- Brand logo injection and CSS-theme color mapping -------------------------
(function () {
  const TARGETS = [
    { id:'go-logo-hdr', lineColor:'--on-dark' },
    { id:'go-logo-upload', lineColor:'--text-dark' },
  ];
  let hasAnimatedLogos = false;

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

  const LOGO_SVG = `<svg viewBox="121.8 43.5 936.5 1106.5" xmlns="http://www.w3.org/2000/svg" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5;--hex-1:#06b6d4;--hex-2:#0ea5e9;--hex-3:#dfdfdf;--hex-4:#f59e0b;--hex-5:#ef4444;--hex-6:#3b82f6;--hex-7:#22c55e;--lines:#ffffff;--sw-major:10;--sw-minor:5">
  <defs>
    <symbol id="node" overflow="visible">
      <g transform="translate(333.42 60.77)"><path d="M145.64 477.22 257.13 412.01 368.61 477.22V610.92L257.13 676.13 145.64 610.92Z" fill="var(--hex-fill)" stroke="var(--lines)" stroke-width="var(--sw-major)"/></g>
      <g transform="matrix(1 0 0 .4488 0 474.16)"><path d="M590.55 291.04V585.44" fill="none" stroke="var(--lines)" stroke-width="var(--sw-minor)"/></g>
      <g transform="matrix(1.0161 .0086 .0087 1.0046 -14.23 52.22)"><path d="M590.55 544.93 481.39 479.83" fill="none" stroke="var(--lines)" stroke-width="var(--sw-minor)"/></g>
      <g transform="matrix(-1.0161 .0086 -.0087 1.0046 1195.33 52.22)"><path d="M590.55 544.93 481.39 479.83" fill="none" stroke="var(--lines)" stroke-width="var(--sw-minor)"/></g>
    </symbol>
    <symbol id="core" overflow="visible">
      <g transform="matrix(1 0 0 .1646 0 598.98)"><path d="M590.55 291.04V585.44" fill="none" stroke="var(--lines)" stroke-width="var(--sw-major)"/></g>
      <g transform="matrix(.3185 0 0 .3185 402.48 415.15)"><path d="M590.55 313.73V463.61M702.04 666.7 829.14 737.29M479.07 248.86 351.97 321.01M702.04 248.86 829.14 321.01M940.62 519.48V671.64M829.14 871.13 702.04 945.58M479.07 945.58 351.94 871.13M240.48 519.48V671.64M479.07 666.7 351.97 737.29" fill="none" stroke="var(--lines)" stroke-width="var(--sw-major)"/></g>
      <g transform="matrix(.6076 -.3979 -.3971 1.0373 412.61 253.41)"><path d="M590.55 544.93 481.39 479.83" fill="none" stroke="var(--lines)" stroke-width="var(--sw-major)"/></g>
      <g transform="matrix(-.5358 -.2772 .2766 .8348 791.71 292.43)"><path d="M590.55 544.93 481.39 479.83" fill="none" stroke="var(--lines)" stroke-width="var(--sw-major)"/></g>
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

  function _themeColor(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  }

  function _applyThemeToLogo(svgEl, colorVars, lineColorVar) {
    if (!svgEl) return;
    colorVars.forEach((cssVar, index) => {
      const value = _themeColor(cssVar, '#00fed8');
      svgEl.style.setProperty('--hex-' + (index + 1), value);
    });
    svgEl.style.setProperty('--lines', _themeColor(lineColorVar, lineColorVar === '--on-dark' ? '#fff' : '#000'));
  }

  function _injectLogo(targetEl, colorVars, lineColorVar) {
    if (!targetEl) return;
    targetEl.innerHTML = LOGO_SVG;
    const svgEl = targetEl.querySelector('svg');
    if (!svgEl) return;
    svgEl.setAttribute('role', 'img');
    svgEl.setAttribute('aria-label', 'Guerrilla Ops logo');
    _applyThemeToLogo(svgEl, colorVars, lineColorVar);
  }

  function applyBrandLogoTheme() {
    if (!hasAnimatedLogos) {
      TARGETS.forEach(target => {
        const targetEl = document.getElementById(target.id);
        if (targetEl && target.id === 'go-logo-upload') {
          const cardEl = targetEl.closest?.('.up-card');
          if (cardEl) {
            const cardRect = cardEl.getBoundingClientRect();
            const logoRect = targetEl.getBoundingClientRect();
            const paddingBottom = parseFloat(getComputedStyle(cardEl).paddingBottom) || 0;
            const dropDistance = Math.max(0, cardRect.bottom - paddingBottom - logoRect.bottom);
            targetEl.style.setProperty('--logo-drop-distance', dropDistance + 'px');
          }
          targetEl.classList.add('go-logo-entrance');
          targetEl.parentElement?.classList.add('go-logo-content-entrance');
        }
      });
      hasAnimatedLogos = true;
    }
    TARGETS.forEach(target => _injectLogo(document.getElementById(target.id), THEME_MAP, target.lineColor));
  }

  window.applyBrandLogoTheme = applyBrandLogoTheme;
  document.addEventListener('DOMContentLoaded', applyBrandLogoTheme);
})();
