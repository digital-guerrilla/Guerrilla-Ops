const _workspacePanelIds = ['svg-floor-panel', 'viewer-3d-panel', 'results-main', 'qa-graph-panel'];
let _workspaceDock = null;

function _workspaceRemovePanel(node, id) {
  if (typeof node === 'string') return node === id ? null : node;
  const first = _workspaceRemovePanel(node.first, id);
  const second = _workspaceRemovePanel(node.second, id);
  return first && second ? { ...node, first, second } : first || second;
}

function _workspaceInsertPanel(node, id, target, edge) {
  if (typeof node === 'string') {
    if (node !== target) return node;
    const before = edge === 'left' || edge === 'top';
    return { axis:edge === 'left' || edge === 'right' ? 'row' : 'column', ratio:.5,
      first:before ? id : target, second:before ? target : id };
  }
  return { ...node, first:_workspaceInsertPanel(node.first, id, target, edge),
    second:_workspaceInsertPanel(node.second, id, target, edge) };
}

function dockWorkspacePanel(id, target, edge) {
  if (!_workspaceDock || id === target || !_workspacePanelIds.includes(id)
    || !_workspacePanelIds.includes(target) || !['left', 'right', 'top', 'bottom'].includes(edge)) return;
  _workspaceDock.tree = _workspaceInsertPanel(_workspaceRemovePanel(_workspaceDock.tree, id), id, target, edge);
  _workspaceDock.render();
  _workspaceDock.save();
}

function resizeWorkspacePanel(id, size, edge = 'right') {
  if (!_workspaceDock) return false;
  const split = _workspaceDock.resizeSplits.get(id)?.[edge];
  if (!split) return false;
  const rect = document.getElementById(id).getBoundingClientRect();
  const direction = edge === 'left' ? -1 : 1;
  const currentSize = edge === 'bottom' ? rect.height : rect.width;
  split.node.ratio = Math.max(.15, Math.min(.85, split.node.ratio + direction * (size - currentSize) / split.size));
  _workspaceDock.render();
  _workspaceDock.save();
  return true;
}

function initWorkspacePanels() {
  const layout = document.getElementById('results-layout');
  const panelIds = _workspacePanelIds;
  const headers = ['.svgp-edge-toggle', '.viewer3d-edge-toggle', '#active-bar', '.qa-graph-head'];
  const defaultTree = ids => ids.length === 1 ? ids[0] : {
    axis:'row', ratio:1 / ids.length, first:ids[0], second:defaultTree(ids.slice(1)),
  };
  _workspaceDock = { tree:defaultTree(panelIds), resizeSplits:new Map() };
  const save = () => {
    try {
      localStorage.setItem('go:panelLayout', JSON.stringify({ version:2, tree:_workspaceDock.tree }));
    } catch (error) {
      console.warn('Panel layout could not be saved.', error);
    }
  };
  const validate = (node, ids = []) => {
    if (typeof node === 'string' && panelIds.includes(node) && !ids.includes(node)) {
      ids.push(node);
      return ids;
    }
    if (!node || typeof node !== 'object' || !['row', 'column'].includes(node.axis)
      || !Number.isFinite(node.ratio) || node.ratio < .15 || node.ratio > .85
      || ids.length >= panelIds.length) throw new Error('Invalid saved panel layout');
    validate(node.first, ids);
    validate(node.second, ids);
    return ids;
  };
  try {
    const saved = JSON.parse(localStorage.getItem('go:panelLayout') || 'null');
    if (saved) {
      if (saved.version === 2) {
        if (validate(saved.tree).length !== panelIds.length) throw new Error('Incomplete saved panel layout');
        _workspaceDock.tree = saved.tree;
      } else {
        if (!Array.isArray(saved.order) || saved.order.length !== panelIds.length
          || new Set(saved.order).size !== panelIds.length || !saved.order.every(id => panelIds.includes(id))
          || !['row', 'stack'].includes(saved.layout)) throw new Error('Invalid saved panel layout');
        const migrate = ids => ids.length === 1 ? ids[0] : {
          axis:saved.layout === 'stack' ? 'column' : 'row', ratio:1 / ids.length,
          first:ids[0], second:migrate(ids.slice(1)),
        };
        _workspaceDock.tree = migrate(saved.order);
      }
    }
  } catch (error) {
    console.warn('Saved panel layout could not be restored.', error);
  }
  const available = id => {
    const panel = document.getElementById(id);
    return !panel.classList.contains('d-none')
      && !panel.classList.contains('svg-panel-collapsed') && !panel.classList.contains('viewer3d-collapsed')
      && !panel.classList.contains('qa-graph-collapsed');
  };
  const render = () => {
    [['restore-plan-btn', 'svg-floor-panel', 'Plan'], ['restore-3d-btn', 'viewer-3d-panel', '3D']].forEach(([buttonId, panelId, label]) => {
      const button = document.getElementById(buttonId);
      const visible = available(panelId);
      button.classList.toggle('d-none', document.getElementById(panelId).classList.contains('d-none'));
      button.classList.toggle('active', visible);
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('title', `${visible ? 'Hide' : 'Show'} ${label} panel`);
    });
    const boxes = new Map();
    const visibleTree = node => {
      if (typeof node === 'string') return available(node) ? node : null;
      const first = visibleTree(node.first);
      const second = visibleTree(node.second);
      return first && second ? { ...node, first, second, source:node } : first || second;
    };
    const round = value => Math.round(value * 1e6) / 1e6;
    const measure = (node, x, y, w, h, rightSplit = null, leftSplit = null, bottomSplit = null) => {
      if (!node) return;
      if (typeof node === 'string') {
        boxes.set(node, { x:round(x), y:round(y), right:round(x + w), bottom:round(y + h) });
        _workspaceDock.resizeSplits.set(node, { right:rightSplit, left:leftSplit, bottom:bottomSplit });
        return;
      }
      if (node.axis === 'row') {
        measure(node.first, x, y, w * node.ratio, h,
          { node:node.source, size:w * layout.clientWidth }, leftSplit, bottomSplit);
        measure(node.second, x + w * node.ratio, y, w * (1 - node.ratio), h, rightSplit,
          { node:node.source, size:w * layout.clientWidth }, bottomSplit);
      } else {
        measure(node.first, x, y, w, h * node.ratio, rightSplit, leftSplit,
          { node:node.source, size:h * layout.clientHeight });
        measure(node.second, x, y + h * node.ratio, w, h * (1 - node.ratio), rightSplit, leftSplit, bottomSplit);
      }
    };
    _workspaceDock.resizeSplits.clear();
    measure(visibleTree(_workspaceDock.tree), 0, 0, 1, 1);
    const xs = [...new Set([0, 1, ...[...boxes.values()].flatMap(box => [box.x, box.right])])].sort((a,b) => a-b);
    const ys = [...new Set([0, 1, ...[...boxes.values()].flatMap(box => [box.y, box.bottom])])].sort((a,b) => a-b);
    const tracks = edges => edges.slice(1).map((edge, index) => `minmax(0, ${edge - edges[index]}fr)`).join(' ');
    layout.style.gridTemplateColumns = tracks(xs);
    layout.style.gridTemplateRows = tracks(ys);
    boxes.forEach((box, id) => {
      const panel = document.getElementById(id);
      panel.style.gridColumn = `${xs.indexOf(box.x) + 1} / ${xs.indexOf(box.right) + 1}`;
      panel.style.gridRow = `${ys.indexOf(box.y) + 1} / ${ys.indexOf(box.bottom) + 1}`;
      panel.dataset.dockResize = String(!!_workspaceDock.resizeSplits.get(id)?.right);
    });
    panelIds.forEach(id => {
      document.getElementById(id).querySelectorAll('.workspace-resize-handle').forEach(handle => {
        const split = _workspaceDock.resizeSplits.get(id)?.[handle.dataset.edge];
        handle.hidden = !split;
        if (split) handle.setAttribute('aria-valuenow', String(Math.round(split.node.ratio * 100)));
      });
    });
    if (typeof _renderThreeDViewer === 'function') _renderThreeDViewer();
  };
  _workspaceDock.render = render;
  _workspaceDock.save = save;
  panelIds.forEach((id, index) => {
    const panel = document.getElementById(id);
    const label = ['Plan', '3D', 'Results', 'QA'][index];
    ['right', 'bottom'].forEach(edge => {
      const vertical = edge === 'bottom';
      const handle = document.createElement('div');
      handle.className = 'workspace-resize-handle';
      handle.dataset.edge = edge;
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', `Resize ${label} panel ${edge} border`);
      handle.setAttribute('aria-controls', id);
      handle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
      handle.setAttribute('aria-valuemin', '15');
      handle.setAttribute('aria-valuemax', '85');
      handle.title = `Drag to resize; use ${vertical ? 'Up/Down' : 'Left/Right'} arrows`;
      panel.appendChild(handle);
      handle.addEventListener('keydown', event => {
        const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        resizeWorkspacePanel(id, (vertical ? rect.height : rect.width) + (event.key === keys[0] ? -20 : 20), edge);
      });
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const split = _workspaceDock.resizeSplits.get(id)?.[edge];
        if (!split) return;
        event.preventDefault();
        event.stopPropagation();
        const start = vertical ? event.clientY : event.clientX;
        const ratio = split.node.ratio;
        handle.classList.add('workspace-resizing');
        const move = moveEvent => {
          if (moveEvent.pointerId !== event.pointerId) return;
          const delta = (vertical ? moveEvent.clientY : moveEvent.clientX) - start;
          split.node.ratio = Math.max(.15, Math.min(.85, ratio + delta / split.size));
          render();
        };
        const finish = endEvent => {
          if (endEvent.pointerId !== event.pointerId) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          handle.removeEventListener('lostpointercapture', finish);
          handle.classList.remove('workspace-resizing');
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          if (endEvent.type === 'pointerup') save();
          else {
            split.node.ratio = ratio;
            render();
          }
        };
        handle.setPointerCapture(event.pointerId);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
      });
    });
  });
  layout.classList.add('workspace-docked');
  render();
  let visibility = panelIds.map(available).join();
  const observer = new MutationObserver(() => {
    const next = panelIds.map(available).join();
    if (next === visibility) return;
    visibility = next;
    render();
  });
  panelIds.forEach(id => observer.observe(document.getElementById(id), { attributes:true, attributeFilter:['class'] }));
  if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe(layout);
  window.addEventListener('resize', render);
  const preview = document.createElement('div');
  preview.className = 'workspace-dock-preview';
  preview.hidden = true;
  document.body.appendChild(preview);
  panelIds.forEach((id, index) => {
    const panel = document.getElementById(id);
    const header = panel.querySelector(headers[index]);
    header.draggable = false;
    header.tabIndex = 0;
    header.classList.add('workspace-panel-header');
    header.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
    let suppressClick = false;
    header.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    header.addEventListener('pointerdown', event => {
      const control = event.target.closest('button,input,select,a');
      if (event.button !== 0 || (control && control !== header)) return;
      suppressClick = false;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let target = null;
      let edge = 'left';
      const move = moveEvent => {
        if (moveEvent.pointerId !== event.pointerId) return;
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
        moved = true;
        panel.classList.add('workspace-panel-dragging');
        preview.hidden = true;
        const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        target = panelIds.map(id => document.getElementById(id)).find(item => item !== panel && item.contains(hit)) || null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const x = (moveEvent.clientX - rect.left) / rect.width;
        const y = (moveEvent.clientY - rect.top) / rect.height;
        const distances = { left:x, right:1-x, top:y, bottom:1-y };
        edge = Object.keys(distances).reduce((a,b) => distances[a] < distances[b] ? a : b);
        const horizontal = edge === 'left' || edge === 'right';
        preview.style.left = `${rect.left + (edge === 'right' ? rect.width / 2 : 0)}px`;
        preview.style.top = `${rect.top + (edge === 'bottom' ? rect.height / 2 : 0)}px`;
        preview.style.width = `${horizontal ? rect.width / 2 : rect.width}px`;
        preview.style.height = `${horizontal ? rect.height : rect.height / 2}px`;
        preview.dataset.edge = edge;
        preview.hidden = false;
      };
      const finish = endEvent => {
        if (endEvent.pointerId !== event.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        header.removeEventListener('lostpointercapture', finish);
        panel.classList.remove('workspace-panel-dragging');
        preview.hidden = true;
        suppressClick = moved;
        if (moved && target && endEvent.type === 'pointerup') {
          dockWorkspacePanel(id, target.id, edge);
        }
        setTimeout(() => { suppressClick = false; }, 0);
      };
      header.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      header.addEventListener('lostpointercapture', finish);
    });
    header.addEventListener('keydown', event => {
      if (event.target !== header || !event.altKey
        || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const visible = [];
      const collect = node => {
        if (typeof node === 'string') { if (available(node)) visible.push(node); }
        else { collect(node.first); collect(node.second); }
      };
      collect(_workspaceDock.tree);
      const backwards = ['ArrowLeft', 'ArrowUp'].includes(event.key);
      const sibling = visible[visible.indexOf(id) + (backwards ? -1 : 1)];
      if (!sibling) return;
      const edges = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'top', ArrowDown:'bottom' };
      dockWorkspacePanel(id, sibling, edges[event.key]);
      header.focus();
    });
  });
}

function hydrateFilterControls() {
  const filterBar = document.getElementById('filter-bar');
  const groupList = document.getElementById('group-sortable');
  const documentCategoryDimension = _cobieDocumentCategoryDimension();
  const labelFor = filter => filter.dimension === documentCategoryDimension
    ? 'Document Category'
    : (filter.label || filter.dimension);

  if (filterBar) filterBar.innerHTML = COBIE_FILTER_DIMENSIONS.map(filter => {
    const label = labelFor(filter);
    const treeActions = filter.category
      ? `<span class="fp-hd-actions"><button class="fp-tree-step" data-filter-tree-step="collapse" data-dim="${esc(filter.dimension)}" title="Collapse one classification level"><i class="bi bi-chevron-up"></i></button><button class="fp-tree-step" data-filter-tree-step="expand" data-dim="${esc(filter.dimension)}" title="Expand one classification level"><i class="bi bi-chevron-down"></i></button><span class="fp-badge d-none" id="fb-${esc(filter.dimension)}"></span></span>`
      : `<span class="fp-badge d-none" id="fb-${esc(filter.dimension)}"></span>`;
    return `<section class="fp fp-${esc(filter.dimension)} d-none" id="filter-drawer-${esc(filter.dimension)}" aria-labelledby="filter-title-${esc(filter.dimension)}">
      <div class="fp-inner">
        <div class="fp-hd-top"><span id="filter-title-${esc(filter.dimension)}">${esc(label)}</span><span class="fp-hd-actions">${treeActions}<button class="filter-drawer-close" type="button" data-filter-close title="Close filter" aria-label="Close ${esc(label)} filter"><i class="bi bi-x-lg"></i></button></span></div>
        <div class="fp-search-wrap"><input type="search" class="fp-search" placeholder="Search…" aria-label="Search ${esc(label)} filter" autocomplete="off"></div>
        <div class="fp-body" id="fpl-${esc(filter.dimension)}"></div>
      </div>
    </section>`;
  }).join('');

  if (groupList) groupList.innerHTML = COBIE_FILTER_DIMENSIONS.map(filter => {
    const label = filter.dimension === documentCategoryDimension ? 'Doc Category' : labelFor(filter);
    const id = filter.dimension === documentCategoryDimension ? ' id="chip-doccat"' : '';
    const colorSuffix = _cobieColorVariableSuffix(filter.colorToken);
    return `<li class="group-chip filter-tab" data-dim="${esc(filter.dimension)}" data-label="${esc(label)}"${id} style="--tab-bg:var(--pill-${esc(colorSuffix)}-bg);--tab-text:var(--pill-${esc(colorSuffix)}-text)">
      <button class="filter-tab-grip" type="button" title="Drag to reorder ${esc(label)}; Alt + Up/Down to reorder with keyboard" aria-label="Reorder ${esc(label)}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">${esc(label)}</button>
      <button class="filter-tab-trigger" type="button" data-filter-open="${esc(filter.dimension)}" aria-expanded="false" aria-controls="filter-drawer-${esc(filter.dimension)}" aria-label="Open ${esc(label)} filter" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="${esc(label)}"><i class="bi ${esc(filter.icon)} filter-tab-icon" aria-hidden="true"></i></button>
      <div class="filter-tab-controls">
        <span class="filter-tab-count d-none" id="ftb-${esc(filter.dimension)}"></span>
        <label class="filter-tab-group" title="Group by ${esc(label)}"><input type="checkbox" data-filter-group="${esc(filter.dimension)}" aria-label="Group by ${esc(label)}"></label>
      </div>
    </li>`;
  }).join('');
}

function renderPanels(counts) {
  COBIE_FILTER_DIMENSIONS.forEach(filter => {
    const args = [`fpl-${filter.dimension}`, `fb-${filter.dimension}`, filter.dimension, counts[filter.dimension] || {}];
    if (filter.category) renderPanelCat(...args);
    else renderPanel(args[0], args[1], idx[filter.listIndex] || [], args[2], args[3]);
  });
  if (typeof syncFilterTabs === 'function') syncFilterTabs();
}

function renderPanel(listId, badgeId, names, dim, counts) {
  const badge = document.getElementById(badgeId);
  const n = sel[dim].size;
  badge.textContent = n; badge.classList.toggle('d-none', n===0);

  document.getElementById(listId).innerHTML = names.map(name => {
    const k    = name.toLowerCase();
    const act  = sel[dim].has(k);
    const cnt  = counts[k] || 0;
    const nw   = _justCreated.has(dim+'::'+k);
    const z    = !act && cnt === 0 && !nw;
    const disp = withDesc(name, dim);
    const newTag = (nw && !act && !cnt) ? '<small style="color:var(--accent);font-size:.62rem;margin-left:.25rem">new</small>' : '';
    return `<div class="fp-item${act?' fp-sel':''}${z?' fp-zero':''}${nw&&!act&&!cnt?' fp-new':''}" data-dim="${dim}" data-key="${esc(k)}">
      <span class="fp-name" title="${esc(disp)}">${esc(disp)}${newTag}</span>
      <span class="fp-cnt">${cnt||''}</span>
    </div>`;
  }).join('');
}

function renderPanelCat(listId, badgeId, dim, counts) {
  const badge = document.getElementById(badgeId);
  const nSel = sel[dim].size;
  badge.textContent = nSel; badge.classList.toggle('d-none', nSel===0);

  const groups = idx.catGroups[dim] || {};
  const nodes = idx.categoryTrees?.[dim] || [];

  let html = '';
  nodes.forEach(node => {
    const names = groups[node.key] || [];
    let selInCat = 0, visCount = 0;
    names.forEach(name => {
      const k = name.toLowerCase();
      if (sel[dim].has(k) || (counts[k]||0) > 0 || _justCreated.has(dim+'::'+k)) visCount++;
      if (sel[dim].has(k)) selInCat++;
    });
    if (visCount === 0) return;

    const icon = selInCat === 0         ? 'bi-square'
               : selInCat === visCount  ? 'bi-check-square-fill'
               : 'bi-dash-square-fill';
    const collapseKey = dim + '::' + node.key;
    const collapsed = collapsedFilterCategories.has(collapseKey);
    const hiddenByAncestor = nodes.some(parent => parent.depth < node.depth
      && collapsedFilterCategories.has(dim + '::' + parent.key)
      && node.key.startsWith(parent.key + '_'));
    const hasChildren = (dim !== 'doccat' && node.direct.length > 0)
      || nodes.some(child => child.depth > node.depth && child.key.startsWith(node.key + '_'));
    const grade = Math.max(28, 78 - node.depth * 13);

    html += `<div class="fp-cat-hdr fp-cat-depth-${Math.min(4, node.depth)}${hiddenByAncestor?' fp-tree-hidden':''}${collapsed?' fp-cat-collapsed':''}" data-dim="${dim}" data-cat="${esc(node.key)}" data-depth="${node.depth}" style="--cat-depth:${node.depth};--cat-grade:${grade}%">
      ${hasChildren?`<button class="fp-cat-toggle" type="button" title="${collapsed?'Expand':'Collapse'} ${esc(node.label)}" aria-label="${collapsed?'Expand':'Collapse'} ${esc(node.label)}" aria-expanded="${collapsed?'false':'true'}"><i class="bi bi-chevron-down"></i></button>`:'<span class="fp-cat-toggle-spacer"></span>'}
      <i class="bi ${icon} fp-cat-check"></i>
      <span class="fp-cat-name" title="${esc(node.label)}">${esc(node.label)}</span>
      <span class="fp-cat-cnt">${selInCat>0?selInCat+'/':''}${visCount}</span>
    </div>`;

    if (dim === _cobieDocumentCategoryDimension()) return;
    node.direct.forEach(name => {
      const k    = name.toLowerCase();
      const act  = sel[dim].has(k);
      const cnt  = counts[k] || 0;
      const nw   = _justCreated.has(dim+'::'+k);
      const z    = !act && cnt === 0 && !nw;
      const disp = withDesc(name, dim);
      const newTag = (nw && !act && !cnt) ? '<small style="color:var(--accent);font-size:.62rem;margin-left:.25rem">new</small>' : '';
      html += `<div class="fp-item fp-tree-item${act?' fp-sel':''}${z?' fp-zero':''}${nw&&!act&&!cnt?' fp-new':''}${collapsed||hiddenByAncestor?' fp-tree-hidden':''}" data-dim="${dim}" data-key="${esc(k)}" data-depth="${node.depth + 1}" data-cat-path="${esc(node.key)}" style="--cat-depth:${node.depth + 1}">
        <span class="fp-name" title="${esc(disp)}">${esc(disp)}${newTag}</span>
        <span class="fp-cnt">${cnt||''}</span>
      </div>`;
    });
  });

  document.getElementById(listId).innerHTML = html;
}

function _filterPanelItems(body, q) {
  const children = Array.from(body.children);
  if (!q) {
    children.forEach(el => { el.style.display = el.classList.contains('fp-tree-hidden') ? 'none' : ''; });
    return;
  }

  const visible = new Set();
  const canShow = element => !element.classList.contains('fp-zero') || element.classList.contains('fp-sel');
  children.forEach((element, index) => {
    const name = element.querySelector('.fp-cat-name,.fp-name')?.textContent.toLowerCase() || '';
    const path = (element.dataset.catPath || element.dataset.cat || '').toLowerCase();
    if (canShow(element) && (name.includes(q) || path.includes(q) || element.classList.contains('fp-sel'))) visible.add(index);
  });

  children.forEach((header, index) => {
    if (!header.classList.contains('fp-cat-hdr')) return;
    const name = header.querySelector('.fp-cat-name')?.textContent.toLowerCase() || '';
    const key = (header.dataset.cat || '').toLowerCase();
    if (!name.includes(q) && !key.includes(q)) return;
    visible.add(index);
    const depth = Number(header.dataset.depth || 0);
    for (let cursor = index + 1; cursor < children.length; cursor++) {
      const child = children[cursor];
      if (child.classList.contains('fp-cat-hdr') && Number(child.dataset.depth || 0) <= depth) break;
      if (canShow(child)) visible.add(cursor);
    }
  });

  [...visible].forEach(index => {
    const element = children[index];
    const path = (element.dataset.catPath || element.dataset.cat || '').toLowerCase();
    children.forEach((candidate, candidateIndex) => {
      if (!candidate.classList.contains('fp-cat-hdr')) return;
      const category = (candidate.dataset.cat || '').toLowerCase();
      if (path !== category && path.startsWith(category + '_')) visible.add(candidateIndex);
    });
  });
  children.forEach((element, index) => { element.style.display = visible.has(index) ? 'flex' : 'none'; });
}

function _filterTreeParentNodes(dim) {
  const nodes = idx.categoryTrees?.[dim] || [];
  return nodes.filter(node => (dim !== _cobieDocumentCategoryDimension() && node.direct.length > 0)
    || nodes.some(child => child.depth > node.depth && child.key.startsWith(node.key + '_')));
}

function stepFilterTreeDepth(dim, direction, render = true) {
  const nodes = idx.categoryTrees?.[dim] || [];
  const parents = _filterTreeParentNodes(dim);
  const stateKey = node => dim + '::' + node.key;
  if (direction === 'collapse') {
    const visibleExpanded = parents.filter(node => !collapsedFilterCategories.has(stateKey(node))
      && !nodes.some(ancestor => ancestor.depth < node.depth
        && collapsedFilterCategories.has(stateKey(ancestor))
        && node.key.startsWith(ancestor.key + '_')));
    if (visibleExpanded.length) {
      const depth = Math.max(...visibleExpanded.map(node => node.depth));
      visibleExpanded.filter(node => node.depth === depth)
        .forEach(node => collapsedFilterCategories.add(stateKey(node)));
    }
  } else if (direction === 'expand') {
    const collapsed = parents.filter(node => collapsedFilterCategories.has(stateKey(node)));
    if (collapsed.length) {
      const depth = Math.min(...collapsed.map(node => node.depth));
      collapsed.filter(node => node.depth === depth)
        .forEach(node => collapsedFilterCategories.delete(stateKey(node)));
    }
  }
  if (render) {
    renderPanels(lastCounts);
    reapplyPanelSearches();
  }
}

function toggleFilterCategoryCollapse(dim, category) {
  const key = dim + '::' + category;
  if (collapsedFilterCategories.has(key)) collapsedFilterCategories.delete(key);
  else collapsedFilterCategories.add(key);
  renderPanels(lastCounts);
  reapplyPanelSearches();
}

function reapplyPanelSearches() {
  document.querySelectorAll('.fp-search').forEach(inp => {
    const q = inp.value.toLowerCase().trim();
    if (!q) return;
    _filterPanelItems(inp.closest('.fp-inner').querySelector('.fp-body'), q);
  });
}
