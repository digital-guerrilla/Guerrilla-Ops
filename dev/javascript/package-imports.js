// Centralized external package imports (CDN) for easy review.
// This runs in <head> and injects CSS/JS in the same order as before.
(function loadPackageImports() {
  const headMarkup = [
    '<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"><\\/script>',
    '<script>globalThis.XLSX_CORE = globalThis.XLSX;<\\/script>',
    '<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"><\\/script>',
    '<script>globalThis.XLSX_STYLE = globalThis.XLSX; globalThis.XLSX = globalThis.XLSX_CORE;<\\/script>',
    '<script src="https://cdn.jsdelivr.net/npm/xlsx-populate@1.21.0/browser/xlsx-populate.min.js"><\\/script>',
    '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">',
    '<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">',
    '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"><\\/script>',
    '<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"><\\/script>',
  ].join('');

  document.write(headMarkup);
})();
