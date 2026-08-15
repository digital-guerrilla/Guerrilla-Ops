function runLogoThemeRegression({ assert, vm,
  devIndexSource, logoSvgSource, logoThemeSource, releaseBuilderSource }) {
  assert(devIndexSource.includes('<span id="go-logo-hdr" class="go-logo go-logo-hdr" aria-hidden="true"></span>'),
    'the header must provide an empty host for inline logo injection');
  assert(devIndexSource.includes('<span id="go-logo-upload" class="go-logo go-logo-upload" aria-hidden="true"></span>'),
    'the upload page must provide an empty host for inline logo injection');
  assert(!logoThemeSource.includes('fetch('), 'logo theming must not fetch the SVG through JavaScript');
  assert(logoThemeSource.includes('const LOGO_SVG = `<svg '), 'logo-theme.js must hardcode the complete SVG markup');
  assert(logoThemeSource.includes('targetEl.innerHTML = LOGO_SVG'), 'logo-theme.js must inject a complete SVG into each host');
  assert(logoThemeSource.includes('--sw-major:10;--sw-minor:5'), 'hardcoded logos must preserve dynamic line-width variables');
  assert(logoThemeSource.includes('stroke-width="var(--sw-major)"'), 'major logo lines must use the dynamic width');
  assert(logoThemeSource.includes('stroke-width="var(--sw-minor)"'), 'minor logo lines must use the dynamic width');
  assert(logoSvgSource.includes('stroke="var(--lines)"'), 'logo line strokes must use the target theme color');
  assert(releaseBuilderSource.includes("'svgs', 'Guerrilla-Ops.svg'"), 'the release build must read the canonical logo SVG');
  assert(devIndexSource.includes('<link rel="icon" type="image/svg+xml" href="svgs/Guerrilla-Ops.svg">'), 'development must use the canonical SVG as its favicon');
  assert(releaseBuilderSource.includes("'data:image/svg+xml;base64,'"), 'the release build must embed the SVG favicon as a data URL');
  assert(!releaseBuilderSource.includes('logo_reference'), 'the release build must not rewrite visible logo references');
  assert(!releaseBuilderSource.includes('svg_sprite'), 'the release build must not replace inline logos with a shared sprite');
  assert(logoThemeSource.includes("{ id:'go-logo-hdr', lineColor:'--on-dark' }"), 'header logo lines must be light on the dark header');
  assert(logoThemeSource.includes("{ id:'go-logo-upload', lineColor:'--text-dark' }"), 'upload logo lines must be dark on the light landing card');

  const logoElements = {};
  ['go-logo-hdr', 'go-logo-upload'].forEach(id => {
    const properties = {};
    const svg = {
      style:{ setProperty:(name, value) => { properties[name] = value; } },
      setAttribute:() => {},
    };
    logoElements[id] = {
      properties,
      element:{
        classList:{ add:() => {} },
        set innerHTML(value) { this.markup = value; },
        querySelector:() => svg,
      },
    };
  });
  const logoContext = {
    console,
    Math,
    window:{},
    document:{
      documentElement:{},
      addEventListener:() => {},
      getElementById:id => logoElements[id]?.element || null,
    },
    getComputedStyle:() => ({
      getPropertyValue:name => ({ '--on-dark':'#fff', '--text-dark':'#292929' }[name] || '#00fed8'),
    }),
  };
  vm.createContext(logoContext);
  vm.runInContext(logoThemeSource, logoContext, { filename:'logo-theme.js' });
  logoContext.window.applyBrandLogoTheme();
  assert.strictEqual(logoElements['go-logo-hdr'].properties['--lines'], '#fff', 'header logo lines must render light');
  assert.strictEqual(logoElements['go-logo-upload'].properties['--lines'], '#292929', 'upload logo lines must render dark');
}

module.exports = { runLogoThemeRegression };
