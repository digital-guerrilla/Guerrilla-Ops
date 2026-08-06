// ── Filter bar resize controls ────────────────────────────────
(function() {
  const handle = document.getElementById('filter-resize');
  const bar    = document.getElementById('filter-bar');
  const filterHeader = document.getElementById('filter-section-header');
  if (!handle || !bar || !filterHeader) return;
  let dragging = false, startY = 0, startH = 0;
  let rafPending = false;
  const _minH = 0, _maxH = 1000;

  const _notifyVerticalLayoutResize = () => {
    if (typeof handleThreeDViewerResize === 'function') handleThreeDViewerResize();
    if (typeof handleFloorSvgPanelResize === 'function') handleFloorSvgPanelResize();
  };

  const _scheduleVerticalResizeNotify = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      _notifyVerticalLayoutResize();
    });
  };

  const _defaultFilterBarHeightPx = () => {
    const app = document.getElementById('app');
    const stats = document.getElementById('stats');
    const summaryHeader = document.getElementById('summary-section-header');
    const appHeight = app && app.offsetParent !== null ? app.getBoundingClientRect().height : window.innerHeight;
    const chromeHeight = (summaryHeader?.offsetHeight || 0) + (stats?.offsetHeight || 0) + (handle?.offsetHeight || 0);
    const available = Math.max(120, appHeight - chromeHeight);
    return Math.round(Math.max(_minH, Math.min(_maxH, available * 0.4)));
  };

  const _applyInitialVerticalSplit = (force = false) => {
    if (!force && bar.style.height) return;
    bar.style.height = _defaultFilterBarHeightPx() + 'px';
    _scheduleVerticalResizeNotify();
  };

  globalThis.applyInitialVerticalFilterSplit = _applyInitialVerticalSplit;

  // Default vertical split on first load: filter pane at 40% viewport height.
  _applyInitialVerticalSplit(false);

  handle.addEventListener('mousedown', e => {
    dragging = true; startY = e.clientY; startH = bar.offsetHeight;
    handle.classList.add('resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    bar.style.height = Math.max(0, Math.min(1000, startH + e.clientY - startY)) + 'px';
    _scheduleVerticalResizeNotify();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  });
  handle.addEventListener('touchstart', e => {
    const t = e.touches[0];
    dragging = true; startY = t.clientY; startH = bar.offsetHeight;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    bar.style.height = Math.max(0, Math.min(1000, startH + t.clientY - startY)) + 'px';
    _scheduleVerticalResizeNotify();
  }, { passive: false });
  document.addEventListener('touchend', () => { dragging = false; });

  // Minimise / Maximise buttons
  let _prevHMin = null, _prevHMax = null;
  const frbMin = document.getElementById('frb-min');
  const frbMax = document.getElementById('frb-max');
  const _restoreHeight = () => {
    bar.style.height = (_prevHMin !== null ? _prevHMin : 215) + 'px';
    _prevHMin = null;
  };

  const _setMinimised = () => {
    const cur = bar.offsetHeight;
    if (cur > _minH) _prevHMin = cur;
    bar.style.height = _minH + 'px';
  };

  const _syncFilterHeaderButtons = () => {
    const cur = bar.offsetHeight;
    frbMin.classList.toggle('frb-active', cur <= _minH + 1);
    frbMax.classList.toggle('frb-active', cur >= _maxH - 1);
  };

  const _toggleMinimised = () => {
    if (bar.offsetHeight <= _minH + 1) {
      _restoreHeight();
    } else {
      _setMinimised();
    }
    _syncFilterHeaderButtons();
    _scheduleVerticalResizeNotify();
  };

  filterHeader.addEventListener('click', e => {
    if (e.target.closest('.frb')) return;
    _toggleMinimised();
  });

  frbMin.addEventListener('click', e => {
    e.stopPropagation();
    _toggleMinimised();
  });
  frbMax.addEventListener('click', e => {
    e.stopPropagation();
    const cur = bar.offsetHeight;
    if (cur >= _maxH) {
      bar.style.height = (_prevHMax !== null ? _prevHMax : 215) + 'px';
      _prevHMax = null;
    } else {
      _prevHMax = cur;
      bar.style.height = _maxH + 'px';
    }
    _syncFilterHeaderButtons();
    _scheduleVerticalResizeNotify();
  });
  _syncFilterHeaderButtons();
})();
