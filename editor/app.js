(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // tiny DOM helper
  // ---------------------------------------------------------------------
  function h(tag, props, children) {
    const el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach((key) => {
      const val = props[key];
      if (val === null || val === undefined) return;
      if (key === 'class') {
        el.className = val;
      } else if (key === 'style') {
        el.setAttribute('style', val);
      } else if (key.slice(0, 2) === 'on' && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'html') {
        el.innerHTML = val;
      } else if (key in el) {
        try { el[key] = val; } catch (e) { el.setAttribute(key, val); }
      } else {
        el.setAttribute(key, val);
      }
    });
    (children || []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  const state = {
    dirHandle: null,
    content: null,
    knownFiles: new Set(),   // files SiteRender produced as of last load/save — used to clean up orphans
    dirty: false,
    view: { type: 'welcome' },
    thumbCache: new Map(),   // path -> object URL
  };

  const undoStack = [];
  const redoStack = [];
  const UNDO_LIMIT = 100;
  // true while the crop modal is open — undo/redo are blocked during this
  // window because a modal confirm swaps in a stale array reference from
  // before the swap, silently dropping the newly-imported photo
  let modalOpen = false;

  function pushUndo() {
    if (!state.content) return;
    undoStack.push(JSON.stringify(state.content));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    renderTopbar();
  }

  // wrap any content mutation in this: snapshots for undo, applies the
  // change, marks the doc dirty. Widgets that need to batch many live
  // updates into a single undo step (colour-picker dragging) call
  // pushUndo() once up front and mutate state.content directly instead.
  function mutate(fn) {
    pushUndo();
    fn();
    markDirty();
  }

  function undo() {
    if (modalOpen || !undoStack.length || !state.content) return;
    redoStack.push(JSON.stringify(state.content));
    state.content = JSON.parse(undoStack.pop());
    state.dirty = true;
    ensureViewValid();
    renderAll();
  }

  function redo() {
    if (modalOpen || !redoStack.length || !state.content) return;
    undoStack.push(JSON.stringify(state.content));
    state.content = JSON.parse(redoStack.pop());
    state.dirty = true;
    ensureViewValid();
    renderAll();
  }

  function ensureViewValid() {
    const v = state.view;
    const c = state.content;
    let ok = true;
    if (v.type === 'simple') ok = !!findById(c.simplePages, v.id);
    else if (v.type === 'category') ok = !!findById(c.categories, v.id);
    else if (v.type === 'project') ok = !!findById(c.projects, v.id);
    if (!ok) state.view = { type: 'landing' };
  }

  function markDirty() {
    state.dirty = true;
    renderTopbar();
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';
  }

  function uniqueId(base, existingIds) {
    let id = base;
    let n = 2;
    while (existingIds.includes(id)) {
      id = base + '-' + n;
      n += 1;
    }
    return id;
  }

  function allEntityIds() {
    const c = state.content;
    return []
      .concat(c.simplePages.map((p) => p.id))
      .concat(c.categories.map((p) => p.id))
      .concat(c.projects.map((p) => p.id))
      .concat(['index', 'contact']);
  }

  // ---------------------------------------------------------------------
  // colour helpers (hex <-> rgb <-> hsv) + saved favourites
  // ---------------------------------------------------------------------
  function hexToRgb(hex) {
    let hstr = String(hex || '').replace('#', '').trim();
    if (hstr.length === 3) hstr = hstr.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hstr)) hstr = 'e8e5cc';
    const num = parseInt(hstr, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d !== 0) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h: hue, s: s, v: max };
  }

  function hsvToRgb(hue, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v - c;
    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  function normalizeHex(v) {
    let hstr = String(v || '').trim();
    if (!hstr.startsWith('#')) hstr = '#' + hstr;
    if (hstr.length === 4) hstr = '#' + hstr.slice(1).split('').map((c) => c + c).join('');
    return /^#[0-9a-fA-F]{6}$/.test(hstr) ? hstr.toLowerCase() : null;
  }

  const FAVORITES_KEY = 'site-editor-favourite-colours-v1';
  function loadFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; } catch (e) { return []; }
  }
  function addFavorite(hex) {
    const list = loadFavorites().filter((x) => x !== hex);
    list.unshift(hex);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list.slice(0, 24)));
  }
  function removeFavorite(hex) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(loadFavorites().filter((x) => x !== hex)));
  }

  // ---------------------------------------------------------------------
  // drag-and-drop reordering — shared by image lists, link lists, category
  // project lists, and the sidebar's project order
  // ---------------------------------------------------------------------
  let dragCtx = null;

  function enableDrag(el, arr, index, onDone) {
    el.draggable = true;
    el.classList.add('is-draggable');
    el.addEventListener('dragstart', (e) => {
      // let elements like the compact colour popover (which has its own
      // pointerdown-based drag gesture) opt out of the row's native drag
      if (e.target.closest && e.target.closest('.no-drag')) { e.preventDefault(); return; }
      dragCtx = { arr, from: index };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) { /* ignore */ }
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragCtx = null;
    });
    el.addEventListener('dragover', (e) => {
      if (!dragCtx || dragCtx.arr !== arr) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!dragCtx || dragCtx.arr !== arr) return;
      const from = dragCtx.from;
      const to = index;
      dragCtx = null;
      if (from === to) return;
      mutate(() => {
        const item = arr.splice(from, 1)[0];
        arr.splice(to, 0, item);
      });
      (onDone || refreshPanel)();
    });
  }

  function dragHandle() {
    return h('span', { class: 'drag-handle', title: 'drag to reorder' }, ['⠿']);
  }

  // ---------------------------------------------------------------------
  // filesystem helpers
  // ---------------------------------------------------------------------
  async function getDirForPath(rootHandle, path, create) {
    const parts = path.split('/');
    parts.pop(); // drop filename
    let dir = rootHandle;
    for (const part of parts) {
      if (!part) continue;
      dir = await dir.getDirectoryHandle(part, { create: !!create });
    }
    return dir;
  }

  function baseName(path) {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  async function writeTextFile(rootHandle, path, text) {
    const dir = await getDirForPath(rootHandle, path, true);
    const fh = await dir.getFileHandle(baseName(path), { create: true });
    const writable = await fh.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function writeBlobFile(rootHandle, path, blob) {
    const dir = await getDirForPath(rootHandle, path, true);
    const fh = await dir.getFileHandle(baseName(path), { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function deleteFileAtPath(rootHandle, path) {
    try {
      const dir = await getDirForPath(rootHandle, path, false);
      await dir.removeEntry(baseName(path));
    } catch (e) {
      // already gone, or directory missing — fine, nothing to clean up
    }
  }

  async function readFileHandleAtPath(rootHandle, path) {
    const dir = await getDirForPath(rootHandle, path, false);
    return dir.getFileHandle(baseName(path), { create: false });
  }

  async function getThumbUrl(path) {
    if (!path) return null;
    if (state.thumbCache.has(path)) return state.thumbCache.get(path);
    try {
      const fh = await readFileHandleAtPath(state.dirHandle, path);
      const file = await fh.getFile();
      const url = URL.createObjectURL(file);
      state.thumbCache.set(path, url);
      return url;
    } catch (e) {
      state.thumbCache.set(path, null);
      return null;
    }
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  }

  function baseNameNoExt(name) {
    const base = baseName(name);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  }

  // ---------------------------------------------------------------------
  // image import: crop-to-aspect-ratio + re-encode as an optimized JPEG,
  // matched to whichever slot on the site the photo is going into
  // ---------------------------------------------------------------------
  const CROP_KINDS = {
    // landing / about / contact / tabbed-category hero photo (.frame-img)
    frame: { ratio: 16 / 10, outW: 1440, outH: 900, label: '16:10' },
    // project page 3×3 grid cell (.rice-grid .cell)
    grid: { ratio: 16 / 9, outW: 1440, outH: 810, label: '16:9' },
  };

  // shows a pan/zoom crop modal for one file, fixed to the given kind's
  // aspect ratio, and resolves an optimized JPEG blob (or null if cancelled)
  function openCropModal(file, kind) {
    const spec = CROP_KINDS[kind];
    const stageW = 480;
    const stageH = Math.round(stageW / spec.ratio);

    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      let baseScale = 1;
      let zoom = 1;
      let tx = 0;
      let ty = 0;

      function scale() { return baseScale * zoom; }

      function clamp() {
        const dispW = img.naturalWidth * scale();
        const dispH = img.naturalHeight * scale();
        tx = Math.min(0, Math.max(stageW - dispW, tx));
        ty = Math.min(0, Math.max(stageH - dispH, ty));
      }

      function paint() {
        imgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale() + ')';
      }

      function finish(blob) {
        URL.revokeObjectURL(objectUrl);
        overlay.remove();
        modalOpen = false;
        resolve(blob);
      }

      function confirmCrop() {
        const canvas = document.createElement('canvas');
        canvas.width = spec.outW;
        canvas.height = spec.outH;
        const ctx = canvas.getContext('2d');
        const sx = -tx / scale();
        const sy = -ty / scale();
        const sw = stageW / scale();
        const sh = stageH / scale();
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, spec.outW, spec.outH);
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.85);
      }

      const imgEl = h('img', { class: 'crop-img', src: objectUrl, draggable: false }, []);
      const stage = h('div', { class: 'crop-stage', style: 'width:' + stageW + 'px; height:' + stageH + 'px;' }, [imgEl]);
      const zoomSlider = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: '1', class: 'crop-zoom' }, []);
      const cancelBtn = h('button', { type: 'button', class: 'small', onclick: () => finish(null) }, ['Cancel']);
      const useBtn = h('button', { type: 'button', class: 'primary small', onclick: confirmCrop }, ['Use photo']);
      const modal = h('div', { class: 'crop-modal' }, [
        h('div', { class: 'crop-title' }, ['Crop photo — ' + spec.label]),
        stage,
        h('div', { class: 'row', style: 'margin-top:12px;' }, [h('span', { class: 'hint', style: 'margin:0;' }, ['zoom']), zoomSlider]),
        h('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end;' }, [cancelBtn, useBtn]),
      ]);
      const overlay = h('div', { class: 'crop-overlay' }, [modal]);
      document.body.appendChild(overlay);
      modalOpen = true;

      let dragging = false;
      let last = null;
      stage.addEventListener('pointerdown', (e) => {
        dragging = true;
        last = { x: e.clientX, y: e.clientY };
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        tx += e.clientX - last.x;
        ty += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        clamp();
        paint();
      });
      stage.addEventListener('pointerup', () => { dragging = false; });
      zoomSlider.addEventListener('input', () => {
        zoom = parseFloat(zoomSlider.value);
        clamp();
        paint();
      });

      img.onload = () => {
        baseScale = Math.max(stageW / img.naturalWidth, stageH / img.naturalHeight);
        tx = (stageW - img.naturalWidth * baseScale) / 2;
        ty = (stageH - img.naturalHeight * baseScale) / 2;
        paint();
      };
      img.src = objectUrl;
    });
  }

  async function fileExistsAtPath(rootHandle, path) {
    try {
      await readFileHandleAtPath(rootHandle, path);
      return true;
    } catch (e) {
      return false;
    }
  }

  // finds a free filename under assets/images/<entityId>/ — two source
  // photos can share a name (camera/scanner exports are often numbered
  // sequentially), and writing straight to a colliding name would silently
  // overwrite an unrelated, already-placed photo
  async function findUniqueImagePath(entityId, base) {
    let candidate = 'assets/images/' + entityId + '/' + base + '.jpg';
    let n = 1;
    while (await fileExistsAtPath(state.dirHandle, candidate)) {
      n += 1;
      candidate = 'assets/images/' + entityId + '/' + base + '-' + n + '.jpg';
    }
    return candidate;
  }

  // shows the crop modal for a single file, then writes the optimized
  // result into assets/images/<entityId>/ and returns its site-relative path
  async function importAndCropImage(file, entityId, kind) {
    if (!file || file.type.indexOf('image/') !== 0) return null;
    const blob = await openCropModal(file, kind);
    if (!blob) return null;
    const base = sanitizeFilename(baseNameNoExt(file.name)) || 'photo';
    const path = await findUniqueImagePath(entityId, base);
    await writeBlobFile(state.dirHandle, path, blob);
    state.thumbCache.delete(path);
    return path;
  }

  // ---------------------------------------------------------------------
  // load / save
  // ---------------------------------------------------------------------
  async function openFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      return; // user cancelled
    }
    setStatus('Loading…', '');
    try {
      const fh = await handle.getFileHandle('content.json', { create: false });
      const file = await fh.getFile();
      const content = JSON.parse(await file.text());
      state.dirHandle = handle;
      state.content = content;
      state.thumbCache = new Map();
      undoStack.length = 0;
      redoStack.length = 0;
      const files = SiteRender.renderSite(content);
      state.knownFiles = new Set(Object.keys(files));
      state.dirty = false;
      state.view = { type: 'landing' };
      setStatus('Loaded', 'saved');
      renderAll();
    } catch (e) {
      alert('Could not find content.json in that folder.\n\nPick the folder that directly contains index.html and content.json.\n\n(' + e.message + ')');
    }
  }

  async function saveAndRebuild() {
    if (!state.dirHandle || !state.content) return;
    setStatus('Saving…', '');
    try {
      const files = SiteRender.renderSite(state.content);
      const newFileSet = new Set(Object.keys(files));

      // remove pages that no longer exist
      for (const oldPath of state.knownFiles) {
        if (!newFileSet.has(oldPath)) {
          await deleteFileAtPath(state.dirHandle, oldPath);
        }
      }

      for (const [path, text] of Object.entries(files)) {
        await writeTextFile(state.dirHandle, path, text);
      }

      await writeTextFile(state.dirHandle, 'content.json', JSON.stringify(state.content, null, 2));

      state.knownFiles = newFileSet;
      state.dirty = false;
      setStatus('Saved ✓', 'saved');
    } catch (e) {
      console.error(e);
      setStatus('Save failed', 'error');
      alert('Save failed: ' + e.message);
    }
  }

  // ---------------------------------------------------------------------
  // top-level render
  // ---------------------------------------------------------------------
  const app = document.getElementById('app');
  const topbarEl = h('div', { class: 'topbar' }, []);
  const bodyEl = h('div', { class: 'body' }, []);
  const sidebarEl = h('div', { class: 'sidebar' }, []);
  const mainEl = h('div', { class: 'main' }, []);
  bodyEl.appendChild(sidebarEl);
  bodyEl.appendChild(mainEl);
  app.appendChild(topbarEl);
  app.appendChild(bodyEl);

  let statusText = '';
  let statusClass = '';
  function setStatus(text, cls) {
    statusText = text;
    statusClass = cls;
    renderTopbar();
  }

  function renderTopbar() {
    clear(topbarEl);
    topbarEl.appendChild(h('div', { class: 'title' }, ['Site Editor']));
    if (state.dirHandle) {
      topbarEl.appendChild(h('span', { class: 'folder-name' }, [state.dirHandle.name]));
      topbarEl.appendChild(h('button', { title: 'Undo (⌘Z)', disabled: undoStack.length === 0, onclick: undo }, ['↺ Undo']));
      topbarEl.appendChild(h('button', { title: 'Redo (⌘⇧Z)', disabled: redoStack.length === 0, onclick: redo }, ['↻ Redo']));
      topbarEl.appendChild(h('button', { onclick: openFolder }, ['Switch folder']));
      topbarEl.appendChild(h('button', {
        class: 'primary',
        onclick: saveAndRebuild,
      }, [state.dirty ? 'Save & Rebuild' : 'Saved']));
    } else {
      topbarEl.appendChild(h('button', { class: 'primary', onclick: openFolder }, ['Open website folder…']));
    }
    const cls = 'status' + (statusClass ? ' ' + statusClass : '') + (state.dirty ? ' dirty' : '');
    topbarEl.appendChild(h('div', { class: cls }, [state.dirty ? 'Unsaved changes' : statusText]));
  }

  function renderAll() {
    renderTopbar();
    renderSidebar();
    renderMain();
  }

  function setView(view) {
    state.view = view;
    renderSidebar();
    renderMain();
  }

  // ---------------------------------------------------------------------
  // sidebar
  // ---------------------------------------------------------------------
  function sidebarItem(label, view, isActive) {
    return h('button', {
      class: 'item' + (isActive ? ' active' : ''),
      onclick: () => setView(view),
    }, [label]);
  }

  function renderSidebar() {
    clear(sidebarEl);
    if (!state.content) return;
    const c = state.content;
    const v = state.view;

    sidebarEl.appendChild(h('h3', {}, ['Home']));
    sidebarEl.appendChild(sidebarItem('Landing page', { type: 'landing' }, v.type === 'landing'));

    sidebarEl.appendChild(h('h3', {}, ['Pages']));
    c.simplePages.forEach((p) => {
      sidebarEl.appendChild(sidebarItem(p.title || p.id, { type: 'simple', id: p.id }, v.type === 'simple' && v.id === p.id));
    });
    sidebarEl.appendChild(sidebarItem('Contact page', { type: 'contact' }, v.type === 'contact'));
    sidebarEl.appendChild(h('button', { class: 'add-item', onclick: addSimplePage }, ['+ add page']));

    sidebarEl.appendChild(h('h3', {}, ['Categories']));
    c.categories.forEach((cat) => {
      sidebarEl.appendChild(sidebarItem(cat.label || cat.id, { type: 'category', id: cat.id }, v.type === 'category' && v.id === cat.id));
    });
    sidebarEl.appendChild(h('button', { class: 'add-item', onclick: addCategory }, ['+ add category']));

    sidebarEl.appendChild(h('h3', {}, ['Projects']));
    sidebarEl.appendChild(h('div', { class: 'hint', style: 'margin: 0 16px 6px;' }, ['drag to reorder — this is also the order "next" cycles through']));
    c.projects.forEach((proj, i) => {
      const item = sidebarItem(proj.title || proj.id, { type: 'project', id: proj.id }, v.type === 'project' && v.id === proj.id);
      enableDrag(item, c.projects, i, renderSidebar);
      sidebarEl.appendChild(item);
    });
    sidebarEl.appendChild(h('button', { class: 'add-item', onclick: () => addProject(null) }, ['+ add project']));
  }

  // ---------------------------------------------------------------------
  // main panel dispatch
  // ---------------------------------------------------------------------
  function renderMain() {
    clear(mainEl);
    if (!state.content) {
      mainEl.appendChild(welcomePanel());
      return;
    }
    const v = state.view;
    if (v.type === 'landing') return mainEl.appendChild(landingPanel());
    if (v.type === 'simple') return mainEl.appendChild(simplePagePanel(findById(state.content.simplePages, v.id)));
    if (v.type === 'contact') return mainEl.appendChild(contactPanel());
    if (v.type === 'category') return mainEl.appendChild(categoryPanel(findById(state.content.categories, v.id)));
    if (v.type === 'project') return mainEl.appendChild(projectPanel(findById(state.content.projects, v.id)));
    mainEl.appendChild(welcomePanel());
  }

  function findById(list, id) { return list.find((x) => x.id === id); }

  function refreshPanel() { renderSidebar(); renderMain(); }

  function welcomePanel() {
    return h('div', { class: 'gate' }, [
      h('h2', {}, ['Open your website folder to start editing']),
      h('p', {}, ['Pick the folder on your Mac that contains index.html, css/, assets/ and content.json. This app reads and writes those files directly — nothing leaves your computer.']),
      h('button', { class: 'primary', onclick: openFolder }, ['Open website folder…']),
    ]);
  }

  // ---------------------------------------------------------------------
  // reusable field widgets
  // ---------------------------------------------------------------------
  function panelHeader(title, sub) {
    const wrap = h('div', {}, [h('h2', { class: 'panel-title' }, [title])]);
    if (sub) wrap.appendChild(h('p', { class: 'panel-sub' }, [sub]));
    return wrap;
  }

  function textField(label, value, onChange, opts) {
    opts = opts || {};
    const input = h(opts.multiline ? 'textarea' : 'input', {
      type: opts.multiline ? undefined : 'text',
      onchange: (e) => { mutate(() => onChange(e.target.value)); },
    }, []);
    input.value = value || '';
    const wrap = h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [label]),
      input,
    ]);
    if (opts.hint) wrap.appendChild(h('div', { class: 'hint' }, [opts.hint]));
    return wrap;
  }

  function checkboxField(label, checked, onChange) {
    const input = h('input', {
      type: 'checkbox',
      checked: checked,
      onchange: (e) => { mutate(() => onChange(e.target.checked)); refreshPanel(); },
    }, []);
    return h('label', { class: 'field', style: 'display:flex; align-items:center; gap:8px;' }, [
      input,
      h('span', { class: 'field-label', style: 'margin:0;' }, [label]),
    ]);
  }

  function selectField(label, value, options, onChange) {
    const select = h('select', {
      onchange: (e) => { mutate(() => onChange(e.target.value)); refreshPanel(); },
    }, options.map((opt) => h('option', { value: opt.value, selected: opt.value === value }, [opt.label])));
    return h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [label]),
      select,
    ]);
  }

  // ---- advanced colour field: big swatch + hex + hue/sv picker + favourites ----
  // opts.compact: no field-label, small swatch, hex input lives in the popover
  // instead of the row — for inline use in tight spaces like a list row
  function colorField(label, value, onChange, opts) {
    opts = opts || {};
    const safeValue = normalizeHex(value) || '#4a4e42';
    const startRgb = hexToRgb(safeValue);
    let hsv = rgbToHsv(startRgb.r, startRgb.g, startRgb.b);

    // div, not label — this field has several clickable descendants
    // (swatch, hex input, eyedropper, favourites), and a bare label with no
    // `for` implicitly re-fires a click on the first labelable descendant
    // on every click anywhere in it
    const wrap = h('div', { class: 'field color-field' + (opts.compact ? ' color-field-compact no-drag' : '') }, []);
    if (!opts.compact) wrap.appendChild(h('span', { class: 'field-label' }, [label]));

    const swatchBtn = h('button', { type: 'button', class: 'color-swatch-btn' + (opts.compact ? ' small' : ''), title: opts.title || label }, []);
    const hexInput = h('input', { type: 'text', class: 'color-hex-input' }, []);
    if (opts.compact) {
      wrap.appendChild(swatchBtn);
    } else {
      wrap.appendChild(h('div', { class: 'color-row' }, [swatchBtn, hexInput]));
    }

    const popover = h('div', { class: 'color-popover' }, []);
    popover.style.display = 'none';
    wrap.appendChild(popover);

    if (opts.compact) popover.appendChild(hexInput);

    const svSquare = h('div', { class: 'sv-square' }, []);
    const svCursor = h('div', { class: 'sv-cursor' }, []);
    svSquare.appendChild(svCursor);

    const hueSlider = h('div', { class: 'hue-slider' }, []);
    const hueHandle = h('div', { class: 'hue-handle' }, []);
    hueSlider.appendChild(hueHandle);

    const favRow = h('div', { class: 'color-favorites' }, []);

    popover.appendChild(svSquare);
    popover.appendChild(hueSlider);

    if (window.EyeDropper) {
      const dropBtn = h('button', {
        type: 'button', class: 'small eyedropper-btn', title: 'Pick a colour from anywhere on screen',
        onclick: async () => {
          try {
            const result = await new window.EyeDropper().open();
            const rgb = hexToRgb(result.sRGBHex);
            hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            paint();
            pushUndo();
            onChange(currentHex());
            markDirty();
          } catch (e) { /* user cancelled the eyedropper */ }
        },
      }, ['◉ pick colour from screen']);
      popover.appendChild(dropBtn);
    }

    popover.appendChild(favRow);

    function currentHex() {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      return rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    function paint() {
      const hexNow = currentHex();
      svSquare.style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(' + hsv.h.toFixed(0) + ',100%,50%))';
      svCursor.style.left = (hsv.s * 100) + '%';
      svCursor.style.top = ((1 - hsv.v) * 100) + '%';
      hueHandle.style.left = (hsv.h / 360 * 100) + '%';
      swatchBtn.style.background = hexNow;
      hexInput.value = hexNow;
    }
    paint();

    function renderFavorites() {
      clear(favRow);
      loadFavorites().forEach((fav) => {
        favRow.appendChild(h('button', {
          type: 'button', class: 'fav-swatch', style: 'background:' + fav + ';', title: fav + ' (right-click to remove)',
          onclick: () => {
            const rgb = hexToRgb(fav);
            hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            paint();
            mutate(() => onChange(currentHex()));
          },
          oncontextmenu: (e) => { e.preventDefault(); removeFavorite(fav); renderFavorites(); },
        }, []));
      });
      favRow.appendChild(h('button', {
        type: 'button', class: 'fav-add', title: 'Save current colour as a favourite',
        onclick: () => { addFavorite(currentHex()); renderFavorites(); },
      }, ['+']));
    }
    renderFavorites();

    function setFromEventSv(e) {
      const rect = svSquare.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
      hsv.s = rect.width ? x / rect.width : 0;
      hsv.v = rect.height ? 1 - y / rect.height : 0;
    }
    function setFromEventHue(e) {
      const rect = hueSlider.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      hsv.h = rect.width ? (x / rect.width) * 360 : 0;
    }

    let dragTarget = null;
    function onPointerMove(e) {
      if (!dragTarget) return;
      if (dragTarget === 'sv') setFromEventSv(e); else setFromEventHue(e);
      paint();
      onChange(currentHex());
      markDirty();
    }
    function onPointerUp() {
      dragTarget = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }
    function beginDrag(target, e) {
      pushUndo(); // one undo step for the whole drag gesture, however many pixels it covers
      dragTarget = target;
      onPointerMove(e);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }
    svSquare.addEventListener('pointerdown', (e) => beginDrag('sv', e));
    hueSlider.addEventListener('pointerdown', (e) => beginDrag('hue', e));

    hexInput.addEventListener('change', () => {
      const norm = normalizeHex(hexInput.value);
      if (!norm) { hexInput.value = currentHex(); return; }
      const rgb = hexToRgb(norm);
      hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      paint();
      mutate(() => onChange(currentHex()));
    });

    swatchBtn.addEventListener('click', () => {
      const willOpen = popover.style.display === 'none';
      document.querySelectorAll('.color-popover').forEach((p) => { p.style.display = 'none'; });
      popover.style.display = willOpen ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) popover.style.display = 'none';
    });

    return wrap;
  }

  // ---- single image field (drop-to-replace) ----
  function singleImageField(label, currentPath, entityId, onChange) {
    const wrap = h('div', { class: 'field' }, [h('span', { class: 'field-label' }, [label])]);
    const thumb = h('div', { class: 'thumb', style: 'width:160px; height:100px;' }, [currentPath ? '' : 'no image']);
    const dz = h('div', { class: 'dropzone', style: 'width:160px;' }, ['drop image here, or click to choose']);
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none;' }, []);

    getThumbUrl(currentPath).then((url) => {
      if (url) thumb.style.backgroundImage = "url('" + url + "')";
    });

    async function handleFiles(files) {
      const file = Array.from(files).find((f) => f.type.indexOf('image/') === 0);
      if (!file) return;
      const path = await importAndCropImage(file, entityId, 'frame');
      if (path) {
        mutate(() => onChange(path));
        refreshPanel();
      }
    }

    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    wrap.appendChild(h('div', { class: 'row' }, [thumb, dz]));
    wrap.appendChild(fileInput);
    if (currentPath) wrap.appendChild(h('div', { class: 'hint' }, [currentPath]));
    return wrap;
  }

  // ---- ordered multi-image field (rotation sets) — drag to reorder ----
  function imageListField(label, arr, entityId, opts) {
    opts = opts || {};
    const max = opts.max || 999;
    const wrap = h('div', { class: 'field' }, [h('span', { class: 'field-label' }, [label + ' (' + arr.filter(Boolean).length + (opts.max ? '/' + opts.max : '') + ')'])]);

    const list = h('div', { class: 'image-list' }, []);
    wrap.appendChild(list);

    arr.forEach((path, i) => {
      if (!path) return;
      const thumb = h('div', { class: 'thumb' }, []);
      getThumbUrl(path).then((url) => { if (url) thumb.style.backgroundImage = "url('" + url + "')"; });

      const tile = h('div', { class: 'image-tile' }, [
        h('div', { class: 'tile-top' }, [dragHandle(), h('button', { class: 'small danger', title: 'remove', onclick: () => { mutate(() => arr.splice(i, 1)); refreshPanel(); } }, ['×'])]),
        thumb,
        h('div', { class: 'path' }, [baseName(path)]),
      ]);
      enableDrag(tile, arr, i);
      list.appendChild(tile);
    });

    const dz = h('div', { class: 'dropzone' }, ['drop images here, or click to choose']);
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none;' }, []);

    async function handleFiles(files) {
      const room = max - arr.filter(Boolean).length;
      const toImport = Array.from(files).filter((f) => f.type.indexOf('image/') === 0).slice(0, Math.max(room, 0));
      // cropped one at a time — each photo gets its own pan/zoom pass
      for (const file of toImport) {
        const path = await importAndCropImage(file, entityId, 'frame');
        if (path) {
          mutate(() => {
            const emptySlot = arr.indexOf('');
            if (emptySlot !== -1) arr[emptySlot] = path; else arr.push(path);
          });
        }
      }
      refreshPanel();
    }

    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    wrap.appendChild(dz);
    wrap.appendChild(fileInput);
    return wrap;
  }

  // ---- project 3×3 grid field — laid out like the real .rice-grid so you can
  // see how it'll actually look, drag cells to reorder, click/drop to fill ----
  function gridImageField(label, arr, entityId) {
    // div, not label — a bare <label> with no `for` implicitly re-fires a
    // click on the first labelable descendant (here, cell 1's remove
    // button) on every click anywhere inside it, which silently deleted an
    // unrelated photo on almost any interaction with the grid
    const wrap = h('div', { class: 'field' }, [h('span', { class: 'field-label' }, [label])]);
    const grid = h('div', { class: 'grid3x3' }, []);

    async function fillSlot(file, slot) {
      if (!file || file.type.indexOf('image/') !== 0) return;
      const path = await importAndCropImage(file, entityId, 'grid');
      if (path) {
        mutate(() => { arr[slot] = path; });
        refreshPanel();
      }
    }

    // one-off input per click, with the slot captured directly in its own
    // closure — a single shared input+slot pair would race if two clicks
    // land before the first file dialog resolves, silently overwriting
    // whichever cell's slot got clicked last
    function pickFileForSlot(slot) {
      const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none;' }, []);
      input.addEventListener('change', () => {
        if (input.files[0]) fillSlot(input.files[0], slot);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    }

    for (let i = 0; i < 9; i++) {
      const path = arr[i] || '';
      const cell = h('div', { class: 'grid3x3-cell' + (path ? '' : ' empty') }, []);

      if (path) {
        const thumb = h('div', { class: 'grid3x3-thumb' }, []);
        getThumbUrl(path).then((url) => { if (url) thumb.style.backgroundImage = "url('" + url + "')"; });
        cell.appendChild(thumb);
        cell.appendChild(h('div', { class: 'grid3x3-top no-drag' }, [
          dragHandle(),
          h('button', {
            class: 'small danger', title: 'remove',
            onclick: (e) => { e.stopPropagation(); mutate(() => { arr[i] = ''; }); refreshPanel(); },
          }, ['×']),
        ]));
        enableDrag(cell, arr, i);
      } else {
        // click-to-fill only applies to empty cells — a filled cell is
        // draggable, and binding a click handler there too raced against
        // drag gestures (a short drag can still fire a click), sometimes
        // popping the file picker for the wrong cell mid-reorder
        cell.addEventListener('click', () => pickFileForSlot(i));
      }

      // external file drop (from Finder) — separate from the internal
      // reorder drag above, which only engages when dragCtx is set
      cell.addEventListener('dragover', (e) => {
        if (dragCtx) return;
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault();
          cell.classList.add('drag-over');
        }
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        if (dragCtx) return;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          e.preventDefault();
          cell.classList.remove('drag-over');
          fillSlot(e.dataTransfer.files[0], i);
        }
      });

      grid.appendChild(cell);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  // ---- watch popup videos (one card per video) — drag to reorder ----
  function watchLinksField(links) {
    const wrap = h('div', {}, []);
    const list = h('div', {}, []);
    links.forEach((link, i) => {
      const row = h('div', { class: 'card', style: 'margin-bottom:8px;' }, []);
      const labelInput = h('input', {
        type: 'text', placeholder: 'tab label', style: 'width:140px;',
        onchange: (e) => { mutate(() => { link.label = e.target.value; }); },
      }, []);
      labelInput.value = link.label || '';
      const headerRow = h('div', { class: 'list-row no-drag', style: 'margin-bottom:8px;' }, [
        dragHandle(), labelInput,
        h('button', {
          class: 'small danger', style: 'margin-left:auto;',
          onclick: () => { mutate(() => links.splice(i, 1)); refreshPanel(); },
        }, ['×']),
      ]);
      enableDrag(row, links, i);
      row.appendChild(headerRow);

      row.appendChild(selectField('Video source', link.provider || 'youtube', [
        { value: 'youtube', label: 'YouTube' },
        { value: 'bunny', label: 'Bunny Stream' },
        { value: 'instagram', label: 'Instagram' },
      ], (v) => { link.provider = v; }));
      const provider = link.provider || 'youtube';
      if (provider === 'youtube') {
        row.appendChild(textField('YouTube video ID', link.youtubeId || '', (v) => { link.youtubeId = v; }, { hint: 'Paste the video ID, a normal youtube.com/watch or youtu.be link, or even the whole "embed" code from Share — any of them work.' }));
      } else if (provider === 'bunny') {
        row.appendChild(textField('Bunny Stream embed URL', link.bunnyEmbedUrl || '', (v) => { link.bunnyEmbedUrl = v; }, { hint: 'Paste the embed link from Bunny Stream\'s share panel (e.g. https://iframe.mediadelivery.net/embed/...).' }));
      } else {
        row.appendChild(textField('Instagram post/reel URL', link.instagramUrl || '', (v) => { link.instagramUrl = v; }, { hint: 'Paste the normal instagram.com/p/... or instagram.com/reel/... link — no need to find an embed link yourself.' }));
      }
      row.appendChild(selectField('Video shape', link.aspectRatio || '16:9', [
        { value: '16:9', label: '16:9 — horizontal' },
        { value: '4:3', label: '4:3 — classic' },
        { value: '9:16', label: '9:16 — vertical / reels' },
        { value: '4:5', label: '4:5 — portrait' },
        { value: '1:1', label: '1:1 — square' },
      ], (v) => { link.aspectRatio = v; }));

      list.appendChild(row);
    });
    wrap.appendChild(list);
    wrap.appendChild(h('button', {
      class: 'small',
      style: 'margin-top:6px;',
      onclick: () => {
        mutate(() => links.push({ label: 'watch', provider: 'youtube', youtubeId: '', bunnyEmbedUrl: '', instagramUrl: '', aspectRatio: '16:9' }));
        refreshPanel();
      },
    }, ['+ add video']));
    return wrap;
  }

  // ---- links list (label/href pairs) — drag to reorder ----
  function linksListField(label, arr) {
    const wrap = h('div', { class: 'field' }, [h('span', { class: 'field-label' }, [label])]);
    const list = h('div', {}, []);
    arr.forEach((link, i) => {
      const labelInput = h('input', { type: 'text', placeholder: 'label', style: 'width:110px;', onchange: (e) => { mutate(() => { link.label = e.target.value; }); } }, []);
      labelInput.value = link.label;
      const hrefInput = h('input', { type: 'text', placeholder: 'href', class: 'grow-input', onchange: (e) => { mutate(() => { link.href = e.target.value; }); } }, []);
      hrefInput.value = link.href;
      const extLabel = h('label', { style: 'font-size:11px; color:var(--fg-dim); display:flex; align-items:center; gap:4px; white-space:nowrap;' }, [
        h('input', { type: 'checkbox', checked: !!link.external, onchange: (e) => { mutate(() => { link.external = e.target.checked; }); } }, []),
        'external',
      ]);
      const row = h('div', { class: 'list-row' }, [
        dragHandle(), labelInput, hrefInput, extLabel,
        h('button', { class: 'small danger', onclick: () => { mutate(() => arr.splice(i, 1)); refreshPanel(); } }, ['×']),
      ]);
      enableDrag(row, arr, i);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    wrap.appendChild(h('button', {
      class: 'small',
      style: 'margin-top:6px;',
      onclick: () => { mutate(() => arr.push({ label: 'link', href: '#' })); refreshPanel(); },
    }, ['+ add link']));
    return wrap;
  }

  // -----------------------------------------------------------------
  // panels
  // -----------------------------------------------------------------
  function landingPanel() {
    const c = state.content;
    const d = c.landing;
    const wrap = h('div', {}, [panelHeader('Landing page', 'This is index.html — the first thing visitors see.')]);
    const card = h('div', { class: 'card' }, []);
    card.appendChild(textField('Displayed name (large heading)', d.title, (v) => { d.title = v; }));
    card.appendChild(textField('Browser tab title', d.browserTitle || '', (v) => { d.browserTitle = v; }));
    card.appendChild(colorField('Background colour', d.bg, (v) => { d.bg = v; }));
    card.appendChild(colorField('Element colour (font + border)', d.fg, (v) => { d.fg = v; }));
    wrap.appendChild(card);

    const imgCard = h('div', { class: 'card' }, []);
    imgCard.appendChild(h('div', { class: 'field-label', style: 'margin-bottom:8px;' }, ['A random one of these shows every time the page loads']));
    imgCard.appendChild(imageListField('Rotating photos', d.images, 'landing'));
    wrap.appendChild(imgCard);

    const navCard = h('div', { class: 'card' }, []);
    navCard.appendChild(linksListField('Navigation links shown under the photo', d.links));
    wrap.appendChild(navCard);

    return wrap;
  }

  function simplePagePanel(page) {
    if (!page) return welcomePanel();
    const wrap = h('div', {}, [panelHeader(page.title || page.id, page.file)]);
    const card = h('div', { class: 'card' }, []);
    card.appendChild(textField('Browser tab title', page.title, (v) => { page.title = v; }));
    card.appendChild(colorField('Background colour', page.bg, (v) => { page.bg = v; }));
    card.appendChild(colorField('Element colour (font + border)', page.fg, (v) => { page.fg = v; }));
    card.appendChild(textField('Body text', page.text, (v) => { page.text = v; }, { multiline: true }));
    wrap.appendChild(card);

    const imgCard = h('div', { class: 'card' }, []);
    imgCard.appendChild(singleImageField('Photo', page.image, page.id, (v) => { page.image = v; }));
    wrap.appendChild(imgCard);

    const linksCard = h('div', { class: 'card' }, []);
    linksCard.appendChild(linksListField('Links', page.links));
    wrap.appendChild(linksCard);

    wrap.appendChild(deleteButton('Delete this page', () => deleteSimplePage(page)));
    return wrap;
  }

  function contactPanel() {
    const d = state.content.contactPage;
    const wrap = h('div', {}, [panelHeader('Contact page', d.file)]);
    const card = h('div', { class: 'card' }, []);
    card.appendChild(textField('Intro line', d.intro, (v) => { d.intro = v; }));
    card.appendChild(colorField('Background colour', d.bg, (v) => { d.bg = v; }));
    card.appendChild(colorField('Element colour (font + border)', d.fg, (v) => { d.fg = v; }));
    card.appendChild(textField('Email address', d.email, (v) => { d.email = v; }));
    card.appendChild(textField('Phone number', d.phone, (v) => { d.phone = v; }));
    wrap.appendChild(card);

    const imgCard = h('div', { class: 'card' }, []);
    imgCard.appendChild(h('div', { class: 'field-label', style: 'margin-bottom:8px;' }, ['A random one of these shows every time the page loads']));
    imgCard.appendChild(imageListField('Rotating photos', d.images, 'contact'));
    wrap.appendChild(imgCard);

    const linksCard = h('div', { class: 'card' }, []);
    linksCard.appendChild(h('div', { class: 'hint', style: 'margin-top:0;' }, ['"email" and "number" are always shown first and open the details above in a popup — add any extra links (like instagram) below.']));
    linksCard.appendChild(linksListField('Extra links', d.links));
    wrap.appendChild(linksCard);

    return wrap;
  }

  function categoryPanel(cat) {
    if (!cat) return welcomePanel();
    const c = state.content;
    const wrap = h('div', {}, [panelHeader(cat.label || cat.id, cat.file + ' — a tabbed hub page linking to its projects')]);

    const card = h('div', { class: 'card' }, []);
    card.appendChild(checkboxField('Shown in site navigation', cat.enabled !== false, (v) => { cat.enabled = v; }));
    card.appendChild(h('div', { class: 'hint', style: 'margin-top:0;' }, ['Turn off while you\'re still filling this category out — the page stays put, it just won\'t be linked to from anywhere. Turn it back on when it\'s ready.']));
    card.appendChild(textField('Name (shown in the home page nav)', cat.label, (v) => { cat.label = v; }));
    card.appendChild(textField('Browser tab title', cat.browserTitle || '', (v) => { cat.browserTitle = v; }));
    wrap.appendChild(card);

    const listCard = h('div', { class: 'card' }, []);
    listCard.appendChild(h('div', { class: 'field-label', style: 'margin-bottom:8px;' }, ['Projects in this category, in tab order — drag to reorder. Tab 1 sets the page\'s photo, title and colours']));
    const list = h('div', {}, []);
    cat.projects.forEach((pid, i) => {
      const proj = findById(c.projects, pid);
      const rowChildren = [dragHandle()];
      if (proj) {
        rowChildren.push(colorField('', proj.bg, (v) => { proj.bg = v; }, { compact: true, title: 'Background colour' }));
        rowChildren.push(colorField('', proj.fg || '#e8e5cc', (v) => { proj.fg = v; }, { compact: true, title: 'Element colour (font + border)' }));
      }
      rowChildren.push(h('span', { class: 'grow-input' }, [proj ? proj.title : pid + ' (missing)']));
      rowChildren.push(h('button', { class: 'small danger', onclick: () => removeProjectFromCategory(cat, pid) }, ['remove']));
      const row = h('div', { class: 'list-row' }, rowChildren);
      enableDrag(row, cat.projects, i);
      list.appendChild(row);
    });
    listCard.appendChild(list);

    const unassigned = c.projects.filter((p) => !cat.projects.includes(p.id));
    if (unassigned.length) {
      const select = h('select', {}, [h('option', { value: '' }, ['add existing project…'])].concat(
        unassigned.map((p) => h('option', { value: p.id }, [p.title]))
      ));
      select.addEventListener('change', () => {
        if (select.value) { mutate(() => cat.projects.push(select.value)); refreshPanel(); }
      });
      listCard.appendChild(h('div', { style: 'margin-top:10px;' }, [select]));
    }
    listCard.appendChild(h('button', { class: 'small', style: 'margin-top:10px;', onclick: () => addProject(cat) }, ['+ new project in this category']));
    wrap.appendChild(listCard);

    wrap.appendChild(deleteButton('Delete this category (projects are kept, just unlinked)', () => deleteCategory(cat)));
    return wrap;
  }

  function projectPanel(proj) {
    if (!proj) return welcomePanel();
    const c = state.content;
    const wrap = h('div', {}, [panelHeader(proj.title || proj.id, proj.file)]);

    const card = h('div', { class: 'card' }, []);
    card.appendChild(textField('Title', proj.title, (v) => { proj.title = v; }));
    card.appendChild(textField('Role', proj.role, (v) => { proj.role = v; }));
    card.appendChild(colorField('Background colour', proj.bg, (v) => { proj.bg = v; }));
    card.appendChild(colorField('Element colour (font + border)', proj.fg, (v) => { proj.fg = v; }));
    wrap.appendChild(card);

    const gridCard = h('div', { class: 'card' }, []);
    gridCard.appendChild(gridImageField('Grid photos (3×3) — click a cell to fill it, drag to reorder', proj.grid, proj.id));
    wrap.appendChild(gridCard);

    const coverCard = h('div', { class: 'card' }, []);
    // its own crop, not one borrowed from the grid — the category page
    // shows this at 16:10 (.frame-img) while grid cells are 16:9, so a
    // grid photo dropped in here unmodified would get a second, uncontrolled
    // crop from the browser's own background-size:cover
    coverCard.appendChild(singleImageField('Tab thumbnail (used on the category page)', proj.coverImage, proj.id, (v) => { proj.coverImage = v; }));
    wrap.appendChild(coverCard);

    const catCard = h('div', { class: 'card' }, []);
    const currentCat = c.categories.find((cat) => cat.projects.includes(proj.id));
    const catOptions = [{ value: '', label: '(not linked from any category)' }].concat(
      c.categories.map((cat) => ({ value: cat.id, label: cat.label }))
    );
    catCard.appendChild(selectField('Shown in category', currentCat ? currentCat.id : '', catOptions, (v) => {
      c.categories.forEach((cat) => { cat.projects = cat.projects.filter((id) => id !== proj.id); });
      if (v) findById(c.categories, v).projects.push(proj.id);
    }));
    wrap.appendChild(catCard);

    const watchCard = h('div', { class: 'card' }, []);
    watchCard.appendChild(checkboxField('Has a "watch" video popup', proj.watch.enabled, (v) => { proj.watch.enabled = v; }));
    if (proj.watch.enabled) {
      if (!proj.watch.links || !proj.watch.links.length) {
        proj.watch.links = [{ label: 'watch', provider: 'youtube', youtubeId: '', bunnyEmbedUrl: '', instagramUrl: '', aspectRatio: '16:9' }];
      }
      watchCard.appendChild(h('div', { class: 'hint', style: 'margin-top:0;' }, [
        'One video: the popup shows it directly, same as always. More than one: the popup gets a row of tabs in the order below, each its own source and shape.',
      ]));
      watchCard.appendChild(watchLinksField(proj.watch.links));
    }
    wrap.appendChild(watchCard);

    const textCard = h('div', { class: 'card' }, []);
    textCard.appendChild(textField('About text', proj.about, (v) => { proj.about = v; }, {
      multiline: true,
      hint: 'Plain text — a blank line starts a new paragraph.',
    }));
    textCard.appendChild(textField('Credits', proj.credits, (v) => { proj.credits = v; }, {
      multiline: true,
      hint: 'Plain text — a blank line starts a new paragraph, and web addresses (www... or https://...) automatically become clickable links.',
    }));
    wrap.appendChild(textCard);

    wrap.appendChild(deleteButton('Delete this project', () => deleteProject(proj)));
    return wrap;
  }

  function deleteButton(label, onConfirm) {
    return h('button', {
      class: 'danger',
      style: 'margin-top: 6px;',
      onclick: () => {
        if (confirm(label + '?')) onConfirm();
      },
    }, [label]);
  }

  // -----------------------------------------------------------------
  // add / remove actions
  // -----------------------------------------------------------------
  function addSimplePage() {
    const name = prompt('Page name (e.g. "faq")?');
    if (!name) return;
    const addNav = confirm('Add a link to "' + name + '" in the home page navigation?');
    const id = uniqueId(slugify(name), allEntityIds());
    const page = {
      id,
      file: id + '.html',
      title: name,
      bg: '#3a4238',
      fg: '#e8e5cc',
      image: '',
      text: '',
      links: [{ label: 'home', href: 'index.html' }],
    };
    mutate(() => {
      state.content.simplePages.push(page);
      if (addNav) state.content.landing.links.push({ label: name, href: page.file });
    });
    setView({ type: 'simple', id });
  }

  function deleteSimplePage(page) {
    mutate(() => {
      state.content.simplePages = state.content.simplePages.filter((p) => p.id !== page.id);
      state.content.landing.links = state.content.landing.links.filter((l) => l.href !== page.file);
    });
    setView({ type: 'landing' });
  }

  function makeProjectDefaults(title) {
    const id = uniqueId(slugify(title), allEntityIds());
    return {
      id,
      file: id + '.html',
      title,
      role: 'Role',
      bg: '#3a424c',
      fg: '#e8e5cc',
      coverImage: '',
      grid: ['', '', '', '', '', '', '', '', ''],
      watch: { enabled: false, links: [{ label: 'watch', provider: 'youtube', youtubeId: '', bunnyEmbedUrl: '', instagramUrl: '', aspectRatio: '16:9' }] },
      about: 'About text placeholder — replace with the real project description.',
      credits: 'Credits placeholder — replace with the real crew/cast list.',
    };
  }

  function addProject(category) {
    const name = prompt('Project title?');
    if (!name) return;
    const proj = makeProjectDefaults(name);
    mutate(() => {
      state.content.projects.push(proj);
      if (category) category.projects.push(proj.id);
    });
    setView({ type: 'project', id: proj.id });
  }

  function removeProjectFromCategory(cat, pid) {
    let removed = false;
    mutate(() => {
      cat.projects = cat.projects.filter((id) => id !== pid);
      if (cat.projects.length === 0) {
        state.content.categories = state.content.categories.filter((c) => c.id !== cat.id);
        state.content.landing.links = state.content.landing.links.filter((l) => l.href !== cat.file);
        removed = true;
      }
    });
    if (removed) {
      alert('"' + cat.label + '" has no projects left, so it has been removed. The project itself was kept.');
      setView({ type: 'landing' });
    } else {
      refreshPanel();
    }
  }

  function deleteProject(proj) {
    let emptyLabels = [];
    mutate(() => {
      state.content.projects = state.content.projects.filter((p) => p.id !== proj.id);
      state.content.categories.forEach((cat) => { cat.projects = cat.projects.filter((id) => id !== proj.id); });
      const empties = state.content.categories.filter((cat) => cat.projects.length === 0);
      emptyLabels = empties.map((c) => c.label);
      state.content.categories = state.content.categories.filter((cat) => cat.projects.length > 0);
    });
    if (emptyLabels.length) {
      alert('Removed empty categor' + (emptyLabels.length > 1 ? 'ies' : 'y') + ': ' + emptyLabels.join(', '));
    }
    setView({ type: 'landing' });
  }

  function addCategory() {
    const name = prompt('Category name (e.g. "music videos")?');
    if (!name) return;
    const firstProjectName = prompt('Title of its first project?', name);
    if (!firstProjectName) return;
    const addNav = confirm('Add "' + name + '" to the home page navigation?');
    const id = uniqueId(slugify(name), allEntityIds());
    const proj = makeProjectDefaults(firstProjectName);
    const cat = { id, file: id + '.html', label: name, browserTitle: name, enabled: true, projects: [proj.id] };
    mutate(() => {
      state.content.projects.push(proj);
      state.content.categories.push(cat);
      if (addNav) state.content.landing.links.push({ label: name, href: cat.file });
    });
    setView({ type: 'category', id });
  }

  function deleteCategory(cat) {
    mutate(() => {
      state.content.categories = state.content.categories.filter((c) => c.id !== cat.id);
      state.content.landing.links = state.content.landing.links.filter((l) => l.href !== cat.file);
    });
    setView({ type: 'landing' });
  }

  // -----------------------------------------------------------------
  // keyboard shortcuts — Cmd/Ctrl+Z undo, +Shift redo; yields to native
  // undo while actively typing in a text field
  // -----------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.key.toLowerCase() !== 'z') return;
    const active = document.activeElement;
    const isTextEditable = active && (active.tagName === 'TEXTAREA'
      || (active.tagName === 'INPUT' && ['text', 'email', 'url'].indexOf(active.type) !== -1));
    if (isTextEditable) return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  renderAll();
})();
