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

  // copies dropped/selected image files into assets/images/<entityId>/ and
  // returns the list of site-relative paths written, in the order given
  async function importImages(fileList, entityId) {
    const written = [];
    for (const file of Array.from(fileList)) {
      if (!file.type || file.type.indexOf('image/') !== 0) continue;
      const path = 'assets/images/' + entityId + '/' + sanitizeFilename(file.name);
      await writeBlobFile(state.dirHandle, path, file);
      state.thumbCache.delete(path);
      written.push(path);
    }
    return written;
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
    c.projects.forEach((proj) => {
      sidebarEl.appendChild(sidebarItem(proj.title || proj.id, { type: 'project', id: proj.id }, v.type === 'project' && v.id === proj.id));
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
      value: opts.multiline ? undefined : value,
      onchange: (e) => { onChange(e.target.value); markDirty(); },
      oninput: opts.live ? (e) => { onChange(e.target.value); markDirty(); } : undefined,
    }, []);
    if (opts.multiline) input.value = value || '';
    const wrap = h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [label]),
      input,
    ]);
    if (opts.hint) wrap.appendChild(h('div', { class: 'hint' }, [opts.hint]));
    return wrap;
  }

  function colorField(label, value, onChange) {
    const swatch = h('input', {
      type: 'color',
      value: /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4a4e42',
      onchange: (e) => { textInput.value = e.target.value; onChange(e.target.value); markDirty(); },
    }, []);
    const textInput = h('input', {
      type: 'text',
      value: value,
      style: 'width: 110px; margin-left: 8px;',
      onchange: (e) => { swatch.value = e.target.value; onChange(e.target.value); markDirty(); },
    }, []);
    return h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [label]),
      h('div', { class: 'row' }, [swatch, textInput]),
    ]);
  }

  function checkboxField(label, checked, onChange) {
    const input = h('input', {
      type: 'checkbox',
      checked: checked,
      onchange: (e) => { onChange(e.target.checked); markDirty(); refreshPanel(); },
    }, []);
    return h('label', { class: 'field', style: 'display:flex; align-items:center; gap:8px;' }, [
      input,
      h('span', { class: 'field-label', style: 'margin:0;' }, [label]),
    ]);
  }

  function selectField(label, value, options, onChange) {
    const select = h('select', {
      onchange: (e) => { onChange(e.target.value); markDirty(); refreshPanel(); },
    }, options.map((opt) => h('option', { value: opt.value, selected: opt.value === value }, [opt.label])));
    return h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [label]),
      select,
    ]);
  }

  // ---- single image field (drop-to-replace) ----
  function singleImageField(label, currentPath, entityId, onChange) {
    const wrap = h('label', { class: 'field' }, [h('span', { class: 'field-label' }, [label])]);
    const thumb = h('div', { class: 'thumb', style: 'width:160px; height:100px;' }, [currentPath ? '' : 'no image']);
    const dz = h('div', { class: 'dropzone', style: 'width:160px;' }, ['drop image here, or click to choose']);
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none;' }, []);

    getThumbUrl(currentPath).then((url) => {
      if (url) thumb.style.backgroundImage = "url('" + url + "')";
    });

    async function handleFiles(files) {
      const paths = await importImages(files, entityId);
      if (paths.length) {
        onChange(paths[0]);
        markDirty();
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

  // ---- ordered multi-image field (grid / rotation sets) ----
  function imageListField(label, arr, entityId, opts) {
    opts = opts || {};
    const max = opts.max || 999;
    const wrap = h('label', { class: 'field' }, [h('span', { class: 'field-label' }, [label + ' (' + arr.filter(Boolean).length + (opts.max ? '/' + opts.max : '') + ')'])]);

    const list = h('div', { class: 'image-list' }, []);
    wrap.appendChild(list);

    arr.forEach((path, i) => {
      if (!path) return;
      const thumb = h('div', { class: 'thumb' }, [path ? '' : 'empty']);
      getThumbUrl(path).then((url) => { if (url) thumb.style.backgroundImage = "url('" + url + "')"; });

      const controls = h('div', { class: 'controls' }, [
        h('button', { class: 'small', title: 'move earlier', disabled: i === 0, onclick: () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); markDirty(); refreshPanel(); } }, ['◀']),
        h('button', { class: 'small', title: 'move later', disabled: i === arr.length - 1, onclick: () => { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); markDirty(); refreshPanel(); } }, ['▶']),
        h('button', { class: 'small danger', title: 'remove', onclick: () => { arr.splice(i, 1); markDirty(); refreshPanel(); } }, ['×']),
      ]);

      list.appendChild(h('div', { class: 'image-tile' }, [
        thumb,
        h('div', { class: 'path' }, [baseName(path)]),
        controls,
      ]));
    });

    const dz = h('div', { class: 'dropzone' }, ['drop images here, or click to choose']);
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none;' }, []);

    async function handleFiles(files) {
      const room = max - arr.filter(Boolean).length;
      const toImport = Array.from(files).slice(0, Math.max(room, 0));
      const paths = await importImages(toImport, entityId);
      paths.forEach((p) => {
        const emptySlot = arr.indexOf('');
        if (emptySlot !== -1) arr[emptySlot] = p; else arr.push(p);
      });
      markDirty();
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

  // ---- links list (label/href pairs) ----
  function linksListField(label, arr, opts) {
    opts = opts || {};
    const wrap = h('label', { class: 'field' }, [h('span', { class: 'field-label' }, [label])]);
    const list = h('div', {}, []);
    arr.forEach((link, i) => {
      const labelInput = h('input', { type: 'text', value: link.label, placeholder: 'label', style: 'width:110px;', onchange: (e) => { link.label = e.target.value; markDirty(); } }, []);
      const hrefInput = h('input', { type: 'text', value: link.href, placeholder: 'href', class: 'grow-input', onchange: (e) => { link.href = e.target.value; markDirty(); } }, []);
      const extLabel = h('label', { style: 'font-size:11px; color:var(--fg-dim); display:flex; align-items:center; gap:4px; white-space:nowrap;' }, [
        h('input', { type: 'checkbox', checked: !!link.external, onchange: (e) => { link.external = e.target.checked; markDirty(); } }, []),
        'external',
      ]);
      list.appendChild(h('div', { class: 'list-row' }, [
        labelInput, hrefInput, extLabel,
        h('button', { class: 'small danger', onclick: () => { arr.splice(i, 1); markDirty(); refreshPanel(); } }, ['×']),
      ]));
    });
    wrap.appendChild(list);
    wrap.appendChild(h('button', {
      class: 'small',
      style: 'margin-top:6px;',
      onclick: () => { arr.push({ label: 'link', href: '#' }); markDirty(); refreshPanel(); },
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
    card.appendChild(textField('Email address', d.email, (v) => { d.email = v; }));
    wrap.appendChild(card);

    const imgCard = h('div', { class: 'card' }, []);
    imgCard.appendChild(h('div', { class: 'field-label', style: 'margin-bottom:8px;' }, ['A random one of these shows every time the page loads']));
    imgCard.appendChild(imageListField('Rotating photos', d.images, 'contact'));
    wrap.appendChild(imgCard);

    const linksCard = h('div', { class: 'card' }, []);
    linksCard.appendChild(h('div', { class: 'hint', style: 'margin-top:0;' }, ['"email" is always shown first and opens the address above in a popup — add any extra links (like instagram) below.']));
    linksCard.appendChild(linksListField('Extra links', d.links));
    wrap.appendChild(linksCard);

    return wrap;
  }

  function categoryPanel(cat) {
    if (!cat) return welcomePanel();
    const c = state.content;
    const wrap = h('div', {}, [panelHeader(cat.label || cat.id, cat.file + ' — a tabbed hub page linking to its projects')]);

    const card = h('div', { class: 'card' }, []);
    card.appendChild(textField('Name (shown in the home page nav & browser tab)', cat.label, (v) => { cat.label = v; }));
    wrap.appendChild(card);

    const listCard = h('div', { class: 'card' }, []);
    listCard.appendChild(h('div', { class: 'field-label', style: 'margin-bottom:8px;' }, ['Projects in this category, in tab order — tab 1 sets the page\'s photo, title and colour']));
    const list = h('div', {}, []);
    cat.projects.forEach((pid, i) => {
      const proj = findById(c.projects, pid);
      list.appendChild(h('div', { class: 'list-row' }, [
        h('span', { class: 'swatch', style: 'background:' + (proj ? proj.bg : '#000') }, []),
        h('span', { class: 'grow-input' }, [proj ? proj.title : pid + ' (missing)']),
        h('button', { class: 'small', disabled: i === 0, onclick: () => { cat.projects.splice(i - 1, 0, cat.projects.splice(i, 1)[0]); markDirty(); refreshPanel(); } }, ['◀']),
        h('button', { class: 'small', disabled: i === cat.projects.length - 1, onclick: () => { cat.projects.splice(i + 1, 0, cat.projects.splice(i, 1)[0]); markDirty(); refreshPanel(); } }, ['▶']),
        h('button', { class: 'small danger', onclick: () => removeProjectFromCategory(cat, pid) }, ['remove']),
      ]));
    });
    listCard.appendChild(list);

    const unassigned = c.projects.filter((p) => !cat.projects.includes(p.id));
    if (unassigned.length) {
      const select = h('select', {}, [h('option', { value: '' }, ['add existing project…'])].concat(
        unassigned.map((p) => h('option', { value: p.id }, [p.title]))
      ));
      select.addEventListener('change', () => {
        if (select.value) { cat.projects.push(select.value); markDirty(); refreshPanel(); }
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
    wrap.appendChild(card);

    const gridCard = h('div', { class: 'card' }, []);
    gridCard.appendChild(imageListField('Grid photos (3×3)', proj.grid, proj.id, { max: 9 }));
    const coverOptions = proj.grid.filter(Boolean).map((p) => ({ value: p, label: baseName(p) }));
    if (coverOptions.length) {
      gridCard.appendChild(selectField('Tab thumbnail (used on the category page)', proj.coverImage, coverOptions, (v) => { proj.coverImage = v; }));
    }
    wrap.appendChild(gridCard);

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
      watchCard.appendChild(textField('YouTube video ID', proj.watch.youtubeId, (v) => { proj.watch.youtubeId = v; }, { hint: 'The part after watch?v= in the YouTube URL.' }));
    }
    wrap.appendChild(watchCard);

    const textCard = h('div', { class: 'card' }, []);
    textCard.appendChild(textField('About text', proj.about, (v) => { proj.about = v; }, { multiline: true }));
    textCard.appendChild(textField('Credits', SiteRender.textToHtml ? proj.credits : proj.credits, (v) => { proj.credits = v; }, {
      multiline: true,
      hint: 'This is raw HTML (as in the original site) — use <br> for line breaks and blank lines between blocks.',
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
    const id = uniqueId(slugify(name), allEntityIds());
    const page = {
      id,
      file: id + '.html',
      title: name,
      bg: '#3a4238',
      image: '',
      text: '',
      links: [{ label: 'home', href: 'index.html' }],
    };
    state.content.simplePages.push(page);
    if (confirm('Add a link to "' + name + '" in the home page navigation?')) {
      state.content.landing.links.push({ label: name.toLowerCase(), href: page.file });
    }
    markDirty();
    setView({ type: 'simple', id });
  }

  function deleteSimplePage(page) {
    state.content.simplePages = state.content.simplePages.filter((p) => p.id !== page.id);
    state.content.landing.links = state.content.landing.links.filter((l) => l.href !== page.file);
    markDirty();
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
      coverImage: '',
      grid: ['', '', '', '', '', '', '', '', ''],
      watch: { enabled: false, youtubeId: '' },
      about: 'About text placeholder — replace with the real project description.',
      credits: '<p>Credits placeholder — replace with the real crew/cast list.</p>',
    };
  }

  function addProject(category) {
    const name = prompt('Project title?');
    if (!name) return;
    const proj = makeProjectDefaults(name);
    state.content.projects.push(proj);
    if (category) category.projects.push(proj.id);
    markDirty();
    setView({ type: 'project', id: proj.id });
  }

  function removeProjectFromCategory(cat, pid) {
    cat.projects = cat.projects.filter((id) => id !== pid);
    if (cat.projects.length === 0) {
      alert('"' + cat.label + '" has no projects left, so it has been removed. The project itself was kept.');
      deleteCategory(cat, true);
      return;
    }
    markDirty();
    refreshPanel();
  }

  function deleteProject(proj) {
    state.content.projects = state.content.projects.filter((p) => p.id !== proj.id);
    state.content.categories.forEach((cat) => {
      cat.projects = cat.projects.filter((id) => id !== proj.id);
    });
    const empties = state.content.categories.filter((cat) => cat.projects.length === 0);
    state.content.categories = state.content.categories.filter((cat) => cat.projects.length > 0);
    if (empties.length) {
      alert('Removed empty categor' + (empties.length > 1 ? 'ies' : 'y') + ': ' + empties.map((c) => c.label).join(', '));
    }
    markDirty();
    setView({ type: 'landing' });
  }

  function addCategory() {
    const name = prompt('Category name (e.g. "music videos")?');
    if (!name) return;
    const firstProjectName = prompt('Title of its first project?', name);
    if (!firstProjectName) return;
    const id = uniqueId(slugify(name), allEntityIds());
    const proj = makeProjectDefaults(firstProjectName);
    state.content.projects.push(proj);
    const cat = { id, file: id + '.html', label: name.toLowerCase(), projects: [proj.id] };
    state.content.categories.push(cat);
    if (confirm('Add "' + name + '" to the home page navigation?')) {
      state.content.landing.links.push({ label: name.toLowerCase(), href: cat.file });
    }
    markDirty();
    setView({ type: 'category', id });
  }

  function deleteCategory(cat, skipConfirmMessage) {
    state.content.categories = state.content.categories.filter((c) => c.id !== cat.id);
    state.content.landing.links = state.content.landing.links.filter((l) => l.href !== cat.file);
    markDirty();
    if (!skipConfirmMessage) setView({ type: 'landing' });
    else refreshPanel();
  }

  // -----------------------------------------------------------------
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  renderAll();
})();
