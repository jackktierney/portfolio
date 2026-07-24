// Pure functions: content.json -> the site's actual .html / .js files.
// No dependencies, runs identically in Node (for the CLI build/verify step)
// and in the browser (loaded by editor.html via <script src>).
(function (root) {
  'use strict';

  // set once per renderSite() call, to the .file of every category with
  // enabled: false — linksRow drops any link pointing at one of these, so
  // a disabled category simply has no way in from site navigation while
  // it's still being filled out. The page itself still renders at its URL.
  let disabledFiles = new Set();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // escapes a block of raw text but turns bare URLs / www.-style addresses
  // and @handles into real links first, so plain pasted text can still
  // carry a working link — @handles link to Instagram, since that's what
  // they mean everywhere on this site (credits, collaborator shout-outs).
  // The @ must not be preceded by a word character or dot, so email
  // addresses like jack@gmail.com are left alone (the "j" before @ blocks it).
  function autoLink(raw) {
    const re = /(?:https?:\/\/|www\.)[^\s<]+|(?<![\w.])@([a-zA-Z0-9._]{1,30})/gi;
    let out = '';
    let lastIndex = 0;
    let m;
    while ((m = re.exec(raw))) {
      let match = m[0];
      let trail = '';
      while (match.length && /[.,;:!?)]$/.test(match)) {
        trail = match.slice(-1) + trail;
        match = match.slice(0, -1);
      }
      out += esc(raw.slice(lastIndex, m.index));
      if (match.charAt(0) === '@') {
        const handle = match.slice(1);
        out += '<a href="https://www.instagram.com/' + esc(handle) + '/" target="_blank" rel="noopener">' + esc(match) + '</a>' + esc(trail);
      } else {
        const href = /^https?:\/\//i.test(match) ? match : 'https://' + match;
        out += '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(match) + '</a>' + esc(trail);
      }
      lastIndex = m.index + m[0].length;
    }
    out += esc(raw.slice(lastIndex));
    return out;
  }

  // plain textarea text -> HTML: blank-line-separated blocks become <p>,
  // single newlines inside a block become <br>, bare URLs become links —
  // paste in ordinary text and it just works, no HTML required
  function textToHtml(text) {
    const blocks = String(text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((b) => '<p>' + autoLink(b).replace(/\n/g, '<br>') + '</p>').join('\n\n      ');
  }

  function folderOf(filePath) {
    const parts = String(filePath || '').split('/');
    parts.pop();
    return parts.join('/');
  }

  function head(title) {
    return '<head>\n'
      + '<meta charset="UTF-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
      + '<title>' + esc(title) + '</title>\n'
      + '<link rel="stylesheet" href="css/style.css">\n'
      + '</head>';
  }

  const FLASH_SCRIPT = [
    '<div class="flash-overlay" id="flashOverlay"></div>',
    '<script>',
    '(function () {',
    "  var el = document.getElementById('flashOverlay');",
    '  function applyFlash() {',
    "    el.classList.remove('is-flashing-full', 'is-flashing-in', 'is-flashing-out');",
    '    void el.offsetWidth; // restart the animation',
    "    if (sessionStorage.getItem('flashPending')) {",
    "      sessionStorage.removeItem('flashPending');",
    "      el.classList.add('is-flashing-out');",
    '    } else {',
    "      el.classList.add('is-flashing-full');",
    '    }',
    '  }',
    '  applyFlash();',
    "  // bfcache restore (browser back/forward) doesn't re-run this script — without",
    '  // this, a flash frozen mid-animation when you navigated away stays stuck',
    '  // frozen on that frame when you come back',
    "  window.addEventListener('pageshow', function (e) {",
    '    if (e.persisted) applyFlash();',
    '  });',
    '})();',
    '</script>',
  ].join('\n');

  function linksRow(links) {
    return links.filter((l) => !disabledFiles.has(l.href)).map((l) => {
      if (l.modalTrigger) return '<a href="#" class="modal-trigger" id="' + l.id + '">' + esc(l.label) + '</a>';
      if (l.external) return '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
      return '<a href="' + esc(l.href) + '">' + esc(l.label) + '</a>';
    }).join('\n    ');
  }

  function textModal(id, bodyHtml, large) {
    return '<div class="modal-overlay" id="' + id + '">\n'
      + '  <div class="modal-box' + (large ? ' is-large' : '') + '">\n'
      + '    <div class="modal-text">\n'
      + '      ' + bodyHtml + '\n'
      + '    </div>\n'
      + '    <button type="button" class="modal-close">close</button>\n'
      + '  </div>\n'
      + '</div>';
  }

  // pulls the /p/, /reel/ or /tv/ shortcode out of any Instagram URL
  // (with or without a leading username, query string, or trailing slash)
  // and turns it into that post's embeddable iframe URL
  function instagramEmbedSrc(url) {
    const match = String(url || '').match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return '';
    return 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/embed';
  }

  // accepts a bare video ID, a youtube.com/watch or youtu.be URL, or a
  // whole pasted <iframe> embed snippet, and pulls out just the 11-char ID
  function youtubeVideoId(input) {
    const raw = String(input || '').trim();
    const patterns = [/embed\/([A-Za-z0-9_-]{11})/, /[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/];
    for (const re of patterns) {
      const match = raw.match(re);
      if (match) return match[1];
    }
    return raw;
  }

  function computeEmbedSrc(watch) {
    if (watch && watch.provider === 'bunny') return watch.bunnyEmbedUrl || '';
    if (watch && watch.provider === 'instagram') return instagramEmbedSrc(watch.instagramUrl);
    return 'https://www.youtube.com/embed/' + youtubeVideoId(watch && watch.youtubeId) + '?autoplay=1';
  }

  // "16:9" -> { w: 16, h: 9 }; falls back to 16:9 for anything missing
  // or malformed
  function parseRatio(ratio) {
    const match = String(ratio || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!match) return { w: 16, h: 9 };
    return { w: parseFloat(match[1]), h: parseFloat(match[2]) };
  }

  // width is normally the modal's full 100%, but for taller-than-wide
  // videos (portrait, reels) that would make the popup absurdly tall —
  // capping the height to 80% of the viewport and deriving width from
  // that instead keeps every shape's popup on-screen and undistorted
  function videoBoxStyle(r) {
    return 'aspect-ratio: ' + r.w + ' / ' + r.h + '; width: min(100%, calc(80vh * ' + r.w + ' / ' + r.h + '));';
  }

  function watchModal(title, watch) {
    const links = (watch && watch.links && watch.links.length) ? watch.links : [{}];
    const first = links[0];
    const firstEmbed = computeEmbedSrc(first);
    const firstRatio = parseRatio(first.aspectRatio);

    // one video: no tabs, renders exactly as a single watch popup always has.
    // more than one: a row of tabs above the video, each swapping the
    // iframe's source and the box's shape — same interaction as the
    // documentary/commercial solo-page tabs, just for videos in a popup
    const tabsHtml = links.length > 1
      ? '    <div class="watch-tabs">\n'
        + links.map((link, i) => {
          const r = parseRatio(link.aspectRatio);
          return '      <button type="button"' + (i === 0 ? ' class="active"' : '')
            + ' data-embed-src="' + esc(computeEmbedSrc(link)) + '"'
            + ' data-w="' + r.w + '" data-h="' + r.h + '">' + esc(link.label || 'watch') + '</button>';
        }).join('\n')
        + '\n    </div>\n\n'
      : '';

    return '<div class="modal-overlay" id="watchModal">\n'
      + '  <div class="modal-box is-large">\n'
      + tabsHtml
      + '    <div class="modal-video" id="watchVideoBox" style="' + videoBoxStyle(firstRatio) + '">\n'
      + '      <iframe id="watchIframe" src="" data-embed-src="' + esc(firstEmbed) + '" title="' + esc(title) + ' — watch" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n'
      + '    </div>\n'
      + '    <button type="button" class="modal-close">close</button>\n'
      + '  </div>\n'
      + '</div>';
  }

  function page(title, bg, fg, bodyInner, extraBodyClass) {
    const style = '--bg: ' + bg + '; --fg: ' + fg + '; --frame: ' + fg + ';';
    return '<!DOCTYPE html>\n'
      + '<html lang="en">\n'
      + head(title) + '\n'
      + '<body' + (extraBodyClass ? ' class="' + extraBodyClass + '"' : '') + ' style="' + style + '">\n\n'
      + FLASH_SCRIPT + '\n\n'
      + bodyInner + '\n\n'
      + '<script src="js/script.js"></script>\n'
      + '</body>\n'
      + '</html>\n';
  }

  function renderLanding(data) {
    const folder = folderOf(data.images[0]) || 'assets/images/landing';
    const inner = '<div class="page">\n'
      + '  <h1 class="project-title" style="margin: 0 0 8px; font-size: clamp(19px, 3.4vw, 29px); text-transform: none;">' + esc(data.title) + '</h1>\n\n'
      + '  <div class="frame">\n'
      + '    <!-- image picked at random from ' + esc(folder) + '/ on every load — see js/script.js -->\n'
      + '    <div class="frame-img" id="landingImg"></div>\n'
      + '  </div>\n\n'
      + '  <p class="tagline">\n'
      + '    ' + linksRow(data.links) + '\n'
      + '  </p>\n'
      + '</div>';
    return page(data.browserTitle || data.title, data.bg, data.fg || '#e8e5cc', inner);
  }

  function renderSimple(data) {
    const inner = '<div class="page">\n'
      + '  <div class="frame">\n'
      + '    <div class="frame-img" style="background-image: url(\'' + esc(data.image) + '\'); background-size: cover;"></div>\n'
      + '  </div>\n\n'
      + '  <p class="tagline">' + esc(data.text) + '</p>\n\n'
      + '  <p class="tagline">' + linksRow(data.links) + '</p>\n'
      + '</div>';
    return page(data.title, data.bg, data.fg || '#e8e5cc', inner);
  }

  function renderContact(data) {
    const homeLink = data.links.find((l) => l.label === 'home');
    const otherLinks = data.links.filter((l) => l.label !== 'home');
    const links = (homeLink ? [homeLink] : [])
      .concat(
        [{ label: 'email', modalTrigger: true, id: 'emailLink' }],
        [{ label: 'phone', modalTrigger: true, id: 'phoneLink' }],
        otherLinks,
      );
    const inner = '<div class="page">\n'
      + '  <p class="intro">' + esc(data.intro) + '</p>\n\n'
      + '  <div class="frame">\n'
      + '    <!-- image picked at random from assets/images/contact/ on every load — see js/script.js -->\n'
      + '    <div class="frame-img" id="contactImg"></div>\n'
      + '  </div>\n\n'
      + '  <p class="tagline">\n'
      + '    ' + linksRow(links) + '\n'
      + '  </p>\n'
      + '</div>\n\n'
      + textModal('emailModal', '<p>' + esc(data.email) + '</p>', false)
      + '\n\n' + textModal('phoneModal', '<p>' + esc(data.phone || '') + '</p>', false);
    return page('contact', data.bg, data.fg || '#e8e5cc', inner);
  }

  function renderCategory(tabsData, project, browserTitle) {
    const tabsHtml = tabsData.map((t, i) => {
      return '<button type="button"' + (t.active ? ' class="active"' : '')
        + ' data-title="' + esc(t.title) + '"'
        + ' data-role="' + esc(t.role) + '"'
        + (t.image ? ' data-image="' + esc(t.image) + '"' : '')
        + ' data-href="' + esc(t.href) + '"'
        + ' data-color="' + esc(t.color) + '"'
        + ' data-fg="' + esc(t.fg) + '">' + (i + 1) + '</button>';
    }).join('\n      <span class="tab-dash">-</span>\n      ');

    const inner = '<div class="page">\n'
      + '  <div class="solo-row">\n'
      + '    <div class="tabs">\n'
      + '      ' + tabsHtml + '\n'
      + '    </div>\n\n'
      + '    <div class="solo-main">\n'
      + '      <div class="solo-header">\n'
      + '        <h1 class="project-title">' + esc(project.title) + '</h1>\n'
      + '        <span class="solo-header-div">│</span>\n'
      + '        <p class="project-role">' + esc(project.role) + '</p>\n'
      + '      </div>\n\n'
      + '      <div class="frame">\n'
      + '        <div class="frame-img is-clickable" style="background-image: url(\'' + esc(project.coverImage) + '\'); background-size: cover;"></div>\n'
      + '      </div>\n\n'
      + '      <p class="tagline"><a href="index.html">home</a> <a href="#" class="enter-link">enter project</a></p>\n'
      + '    </div>\n'
      + '  </div>\n'
      + '</div>';
    return page(browserTitle, project.bg, project.fg || '#e8e5cc', inner);
  }

  function renderProject(data, nextHref) {
    const cells = data.grid.slice(0, 9);
    while (cells.length < 9) cells.push('');
    const gridHtml = cells.map((src) => '<div class="cell"' + (src ? ' style="background-image: url(\'' + esc(src) + '\');"' : '') + '></div>').join('\n      ');

    const rightHtml = [];
    if (data.watch && data.watch.enabled) rightHtml.push('<a href="#" class="modal-trigger" id="watchLink">watch</a>');
    rightHtml.push('<a href="#" class="modal-trigger" id="aboutLink">about</a>');
    rightHtml.push('<a href="#" class="modal-trigger" id="creditsLink">credits</a>');
    rightHtml.push('<a href="' + esc(nextHref) + '">next</a>');
    rightHtml.push('<a href="index.html">home</a>');

    const hasWatch = !!(data.watch && data.watch.enabled);

    const inner = '<div class="project-page">\n'
      + '  <div class="polybar-card">\n'
      + '    <div class="rice-grid">\n'
      + '      ' + gridHtml + '\n'
      + '    </div>\n\n'
      + '    <div class="polybar">\n'
      + '      <div class="polybar-left">\n'
      + '        <span class="polybar-seg title-seg">' + esc(data.title) + '</span>\n'
      + '        <span class="polybar-div">│</span>\n'
      + '        <span class="polybar-seg role-seg">' + esc(data.role) + '</span>\n'
      + '      </div>\n'
      + '      <div class="polybar-right">\n'
      + '        ' + rightHtml.join('\n        <span class="polybar-div">│</span>\n        ') + '\n'
      + '      </div>\n'
      + '    </div>\n'
      + '  </div>\n'
      + '</div>\n\n'
      + textModal('aboutModal', textToHtml(data.about), false)
      + (hasWatch ? '\n\n' + watchModal(data.title, data.watch) : '')
      + '\n\n' + textModal('creditsModal', textToHtml(data.credits), hasWatch);

    return page(data.title, data.bg, data.fg || '#e8e5cc', inner);
  }

  // ---- js/script.js -------------------------------------------------

  function renderScriptJs(content) {
    const pageBg = {};
    pageBg[content.landing.file] = content.landing.bg;
    content.simplePages.forEach((p) => { pageBg[p.file] = p.bg; });
    pageBg[content.contactPage.file] = content.contactPage.bg;
    content.categories.forEach((cat) => {
      const firstProj = content.projects.find((p) => p.id === cat.projects[0]);
      pageBg[cat.file] = firstProj ? firstProj.bg : '#4a4e42';
    });
    content.projects.forEach((p) => { pageBg[p.file] = p.bg; });

    const pageBgEntries = Object.keys(pageBg).map((k) => "    '" + k + "': '" + pageBg[k] + "',").join('\n');
    const landingPhotos = content.landing.images.map((p) => "      '" + p + "',").join('\n');
    const contactPhotos = content.contactPage.images.map((p) => "      '" + p + "',").join('\n');

    const lines = [];
    lines.push("document.addEventListener('DOMContentLoaded', () => {");
    lines.push("  const overlay = document.getElementById('flashOverlay');");
    lines.push('  if (!overlay) return;');
    lines.push('');
    lines.push('  const RAMP_MS = 380; // matches the flash-in animation duration — time to reach peak before navigating/swapping');
    lines.push('');
    lines.push('  function pulse(el, className) {');
    lines.push("    el.classList.remove('is-flashing-full', 'is-flashing-in', 'is-flashing-out');");
    lines.push('    void el.offsetWidth; // restart the animation');
    lines.push('    el.classList.add(className);');
    lines.push('  }');
    lines.push('');
    lines.push('  // self-contained pulse on the full-screen overlay: used for placeholder');
    lines.push("  // popups and any click that doesn't actually leave the page");
    lines.push('  function flash() {');
    lines.push("    pulse(overlay, 'is-flashing-full');");
    lines.push('  }');
    lines.push('');
    lines.push("  // every page's own flash colour is whatever --bg it declares on <body>");
    lines.push('  // (falling back to the shared default below) — this map mirrors those');
    lines.push('  // same values so the outgoing ramp can be set to the destination\'s');
    lines.push('  // colour instantly, with no lag, keeping the two halves of the flash');
    lines.push('  // (ramp up here, ramp down on arrival) an exact, seamless match');
    lines.push('  //');
    lines.push('  // generated from content.json — do not hand-edit, run the editor\'s');
    lines.push('  // Save & Rebuild instead');
    lines.push("  const DEFAULT_BG = getComputedStyle(document.body).getPropertyValue('--bg').trim();");
    lines.push('  const PAGE_BG = {');
    lines.push(pageBgEntries);
    lines.push('  };');
    lines.push('');
    lines.push('  // ramps up to peak here, then navigates — the next page picks up the');
    lines.push('  // peak and ramps back down (see the inline script at the top of <body>),');
    lines.push('  // so the two halves read as one flash straddling the page change');
    lines.push('  function goTo(href) {');
    lines.push('    overlay.style.backgroundColor = PAGE_BG[href] || DEFAULT_BG;');
    lines.push("    pulse(overlay, 'is-flashing-in');");
    lines.push("    sessionStorage.setItem('flashPending', '1');");
    lines.push('    setTimeout(() => { window.location.href = href; }, RAMP_MS);');
    lines.push('  }');
    lines.push('');
    lines.push("  document.addEventListener('click', (e) => {");
    lines.push("    const link = e.target.closest('a[href]');");
    lines.push('    if (!link) return;');
    lines.push('');
    lines.push("    const href = link.getAttribute('href');");
    lines.push("    const isExternal = link.target === '_blank' || href.startsWith('mailto:') || href.startsWith('http');");
    lines.push('');
    lines.push("    if (href === '#') {");
    lines.push("      if (link.classList.contains('modal-trigger') || link.classList.contains('enter-link')) return; // handled elsewhere");
    lines.push('');
    lines.push('      // any other placeholder link — just flash');
    lines.push('      e.preventDefault();');
    lines.push('      flash();');
    lines.push('      return;');
    lines.push('    }');
    lines.push('');
    lines.push('    if (isExternal) {');
    lines.push('      flash();');
    lines.push('      return;');
    lines.push('    }');
    lines.push('');
    lines.push('    e.preventDefault();');
    lines.push('    goTo(href);');
    lines.push('  });');
    lines.push('');
    lines.push('  // landing hero — picks a random image from assets/images/landing/ on every load');
    lines.push("  const landingImg = document.getElementById('landingImg');");
    lines.push('  if (landingImg) {');
    lines.push('    const landingPhotos = [');
    lines.push(landingPhotos);
    lines.push('    ];');
    lines.push('    const pick = landingPhotos[Math.floor(Math.random() * landingPhotos.length)];');
    lines.push("    landingImg.style.backgroundImage = `url('${pick}')`;");
    lines.push("    landingImg.style.backgroundSize = 'cover';");
    lines.push('  }');
    lines.push('');
    lines.push('  // contact photo — picks a random image from assets/images/contact/ on every load');
    lines.push("  const contactImg = document.getElementById('contactImg');");
    lines.push('  if (contactImg) {');
    lines.push('    const contactPhotos = [');
    lines.push(contactPhotos);
    lines.push('    ];');
    lines.push('    const pick = contactPhotos[Math.floor(Math.random() * contactPhotos.length)];');
    lines.push("    contactImg.style.backgroundImage = `url('${pick}')`;");
    lines.push("    contactImg.style.backgroundSize = 'cover';");
    lines.push('  }');
    lines.push('');
    lines.push('  // test page — clicking the image swaps to a different one from the same');
    lines.push("  // set; flashes only the photo box itself (#photoFlash), not the whole screen");
    lines.push("  const testImg = document.getElementById('testImg');");
    lines.push('  if (testImg) {');
    lines.push("    const photoFlash = document.getElementById('photoFlash');");
    lines.push('    const testPhotos = [');
    lines.push("      'assets/images/zephyr-1.jpg',");
    lines.push("      'assets/images/zephyr-2.jpg',");
    lines.push("      'assets/images/zephyr-3.jpg',");
    lines.push("      'assets/images/zephyr-4.jpg',");
    lines.push("      'assets/images/zephyr-5.jpg',");
    lines.push("      'assets/images/zephyr-6.jpg',");
    lines.push("      'assets/images/zephyr-7.jpg',");
    lines.push("      'assets/images/zephyr-8.jpg',");
    lines.push('    ];');
    lines.push('    let currentPhoto = testPhotos[0];');
    lines.push("    testImg.addEventListener('click', () => {");
    lines.push('      let next;');
    lines.push('      do {');
    lines.push('        next = testPhotos[Math.floor(Math.random() * testPhotos.length)];');
    lines.push('      } while (next === currentPhoto);');
    lines.push('      currentPhoto = next;');
    lines.push('      if (photoFlash) {');
    lines.push("        pulse(photoFlash, 'is-flashing-full');");
    lines.push('      }');
    lines.push("      testImg.style.backgroundImage = `url('${next}')`;");
    lines.push('    });');
    lines.push('  }');
    lines.push('');
    lines.push('  // generic popup wiring — used for watch (video) and about/credits (text).');
    lines.push("  // No flash here — that's reserved for actual page changes, not popups.");
    lines.push('  function wireModal(linkId, modalId, { onOpen, onClose } = {}) {');
    lines.push('    const link = document.getElementById(linkId);');
    lines.push('    const modal = document.getElementById(modalId);');
    lines.push('    if (!link || !modal) return;');
    lines.push("    const closeBtn = modal.querySelector('.modal-close');");
    lines.push('');
    lines.push('    function open() {');
    lines.push("      modal.classList.add('is-open');");
    lines.push('      if (onOpen) onOpen();');
    lines.push('    }');
    lines.push('    function close() {');
    lines.push("      modal.classList.remove('is-open');");
    lines.push('      if (onClose) onClose();');
    lines.push('    }');
    lines.push('');
    lines.push("    link.addEventListener('click', (e) => {");
    lines.push('      e.preventDefault();');
    lines.push('      open();');
    lines.push('    });');
    lines.push("    closeBtn.addEventListener('click', close);");
    lines.push("    modal.addEventListener('click', (e) => {");
    lines.push('      if (e.target === modal) close(); // click outside the box');
    lines.push('    });');
    lines.push("    document.addEventListener('keydown', (e) => {");
    lines.push("      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();");
    lines.push('    });');
    lines.push('  }');
    lines.push('');
    lines.push('  // watch popup tabs (only present when a project has more than one');
    lines.push('  // video) — clicking one swaps the iframe source and the box shape to');
    lines.push('  // that tab\'s, same as a single-video popup but picked at will');
    lines.push("  const watchTabButtons = Array.from(document.querySelectorAll('#watchModal .watch-tabs button'));");
    lines.push("  const watchIframeEl = document.getElementById('watchIframe');");
    lines.push("  const watchVideoBox = document.getElementById('watchVideoBox');");
    lines.push('  function selectWatchTab(btn) {');
    lines.push('    if (!btn) return;');
    lines.push("    watchTabButtons.forEach((b) => b.classList.toggle('active', b === btn));");
    lines.push('    if (watchVideoBox) {');
    lines.push('      watchVideoBox.style.aspectRatio = btn.dataset.w + \' / \' + btn.dataset.h;');
    lines.push("      watchVideoBox.style.width = 'min(100%, calc(80vh * ' + btn.dataset.w + ' / ' + btn.dataset.h + '))';");
    lines.push('    }');
    lines.push('    if (watchIframeEl) watchIframeEl.dataset.embedSrc = btn.dataset.embedSrc;');
    lines.push('  }');
    lines.push('  watchTabButtons.forEach((btn) => {');
    lines.push("    btn.addEventListener('click', () => {");
    lines.push('      selectWatchTab(btn);');
    lines.push('      if (watchIframeEl) watchIframeEl.src = btn.dataset.embedSrc; // swap while open = instant switch');
    lines.push('    });');
    lines.push('  });');
    lines.push('');
    lines.push("  wireModal('watchLink', 'watchModal', {");
    lines.push('    onOpen: () => {');
    lines.push('      selectWatchTab(watchTabButtons[0]); // always opens on the first tab');
    lines.push("      const iframe = document.getElementById('watchIframe');");
    lines.push('      if (iframe) iframe.src = iframe.dataset.embedSrc || iframe.src;');
    lines.push('    },');
    lines.push('    onClose: () => {');
    lines.push("      const iframe = document.getElementById('watchIframe');");
    lines.push("      if (iframe) iframe.src = ''; // stops playback");
    lines.push('    },');
    lines.push('  });');
    lines.push('');
    lines.push("  wireModal('aboutLink', 'aboutModal');");
    lines.push("  wireModal('creditsLink', 'creditsModal');");
    lines.push("  wireModal('emailLink', 'emailModal');");
    lines.push("  wireModal('phoneLink', 'phoneModal');");
    lines.push('');
    lines.push('  // project-page grid — clicking any still opens the watch popup (same');
    lines.push('  // action as clicking "watch" in the polybar), for projects that have one');
    lines.push("  const riceCells = document.querySelectorAll('.rice-grid .cell');");
    lines.push('  if (riceCells.length) {');
    lines.push("    const watchLink = document.getElementById('watchLink');");
    lines.push('    if (watchLink) {');
    lines.push('      riceCells.forEach((cell) => {');
    lines.push("        cell.classList.add('is-clickable');");
    lines.push("        cell.addEventListener('click', () => watchLink.click());");
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  // tabbed solo pages (documentary.html / commercial.html) — clicking a tab');
    lines.push('  // swaps the title/role/image to that sub-project');
    lines.push("  const tabsEl = document.querySelector('.tabs');");
    lines.push('  if (tabsEl) {');
    lines.push("    const tabButtons = Array.from(tabsEl.querySelectorAll('button'));");
    lines.push("    const titleEl = document.querySelector('.project-title');");
    lines.push("    const roleEl = document.querySelector('.project-role');");
    lines.push("    const imgEl = document.querySelector('.solo-row .frame-img');");
    lines.push("    const frameEl = document.querySelector('.solo-row .frame');");
    lines.push('');
    lines.push('    function applyTab(btn) {');
    lines.push('      if (titleEl) titleEl.textContent = btn.dataset.title || titleEl.textContent;');
    lines.push('      if (roleEl) roleEl.textContent = btn.dataset.role || roleEl.textContent;');
    lines.push('      if (imgEl) {');
    lines.push("        if (btn.dataset.image) imgEl.style.backgroundImage = `url('${btn.dataset.image}')`;");
    lines.push("        imgEl.dataset.href = btn.dataset.href || '';");
    lines.push('      }');
    lines.push("      if (btn.dataset.color) document.body.style.setProperty('--bg', btn.dataset.color);");
    lines.push('      if (btn.dataset.fg) {');
    lines.push("        document.body.style.setProperty('--fg', btn.dataset.fg);");
    lines.push("        document.body.style.setProperty('--frame', btn.dataset.fg);");
    lines.push('      }');
    lines.push('    }');
    lines.push('');
    lines.push("    const activeBtn = tabButtons.find((b) => b.classList.contains('active'));");
    lines.push('    if (activeBtn) applyTab(activeBtn);');
    lines.push('');
    lines.push('    function switchToTab(btn) {');
    lines.push("      if (btn.classList.contains('active')) return;");
    lines.push("      const fromIndex = tabButtons.findIndex((b) => b.classList.contains('active'));");
    lines.push('      const toIndex = tabButtons.indexOf(btn);');
    lines.push('      const forward = toIndex > fromIndex;');
    lines.push("      tabButtons.forEach((b) => b.classList.remove('active'));");
    lines.push("      btn.classList.add('active');");
    lines.push('');
    lines.push('      // pre-tint the overlay with the incoming tab\'s colour before the ramp');
    lines.push('      // even starts, exactly like cross-page navigation — so the ramp up');
    lines.push('      // and ramp down are one single colour, with no swap mid-fade');
    lines.push('      if (btn.dataset.color) overlay.style.backgroundColor = btn.dataset.color;');
    lines.push("      pulse(overlay, 'is-flashing-in');");
    lines.push('');
    lines.push('      function swap() {');
    lines.push('        applyTab(btn);');
    lines.push("        overlay.style.backgroundColor = ''; // hand back to var(--bg), which now matches");
    lines.push("        pulse(overlay, 'is-flashing-out');");
    lines.push('      }');
    lines.push('');
    lines.push('      if (!frameEl) {');
    lines.push('        setTimeout(swap, RAMP_MS);');
    lines.push('        return;');
    lines.push('      }');
    lines.push('');
    lines.push('      // the whole frame (border + photo, moving as one unit) rises/falls out as');
    lines.push('      // the flash climbs to its peak, hiding the swap; once swapped, it starts a');
    lines.push('      // beat off its slot and eases into place as the flash fades back out —');
    lines.push('      // advancing to a later tab moves upward (mirrors scrolling up), going');
    lines.push('      // back to an earlier tab moves downward (mirrors scrolling down)');
    lines.push("      const outClass = forward ? 'is-rising-out' : 'is-falling-out';");
    lines.push("      const inClass = forward ? 'is-rising-in' : 'is-falling-in';");
    lines.push('      frameEl.classList.add(outClass);');
    lines.push('      setTimeout(() => {');
    lines.push('        swap();');
    lines.push('        frameEl.classList.remove(outClass);');
    lines.push('        frameEl.classList.add(inClass);');
    lines.push('        void frameEl.offsetWidth; // commit the snap before transitioning back to 0');
    lines.push('        frameEl.classList.remove(inClass);');
    lines.push('      }, RAMP_MS);');
    lines.push('    }');
    lines.push('');
    lines.push('    tabButtons.forEach((btn) => {');
    lines.push("      btn.addEventListener('click', () => switchToTab(btn));");
    lines.push('    });');
    lines.push('');
    lines.push('    // two-finger trackpad / mouse-wheel scroll steps through the tabs');
    lines.push('    // instead of scrolling the page — scrolling up advances to the next');
    lines.push('    // tab (image moves up), scrolling down reverses to the previous one');
    lines.push('    // (image moves down), each using the same flash + rise/fall');
    lines.push('    // transition as clicking a tab directly');
    lines.push('    let wheelLocked = false;');
    lines.push('    const WHEEL_LOCK_MS = 830; // covers the full flash+rise transition so one scroll gesture = one tab step');
    lines.push("    window.addEventListener('wheel', (e) => {");
    lines.push('      if (wheelLocked) return;');
    lines.push("      if (document.querySelector('.modal-overlay.is-open')) return; // let modal text scroll normally");
    lines.push('      if (Math.abs(e.deltaY) < 10) return; // ignore trackpad jitter');
    lines.push('');
    lines.push("      const currentIndex = tabButtons.findIndex((b) => b.classList.contains('active'));");
    lines.push('      const nextIndex = currentIndex + (e.deltaY > 0 ? 1 : -1);');
    lines.push('      if (nextIndex < 0 || nextIndex >= tabButtons.length) return;');
    lines.push('');
    lines.push('      wheelLocked = true;');
    lines.push('      switchToTab(tabButtons[nextIndex]);');
    lines.push('      setTimeout(() => { wheelLocked = false; }, WHEEL_LOCK_MS);');
    lines.push("    }, { passive: true });");
    lines.push('');
    lines.push('    // touch swipe steps through tabs the same way, for mobile — touch');
    lines.push('    // scrolling never fires wheel events, and this page has nothing else');
    lines.push('    // to scroll, so a vertical swipe becomes a tab step instead');
    lines.push('    let touchStartY = null;');
    lines.push('    const SWIPE_THRESHOLD = 40;');
    lines.push("    window.addEventListener('touchstart', (e) => {");
    lines.push("      if (document.querySelector('.modal-overlay.is-open')) return;");
    lines.push('      touchStartY = e.touches[0].clientY;');
    lines.push("    }, { passive: true });");
    lines.push('');
    lines.push("    window.addEventListener('touchmove', (e) => {");
    lines.push('      if (touchStartY === null || wheelLocked) return;');
    lines.push("      if (document.querySelector('.modal-overlay.is-open')) return;");
    lines.push('');
    lines.push('      const deltaY = touchStartY - e.touches[0].clientY;');
    lines.push('      if (Math.abs(deltaY) < SWIPE_THRESHOLD) return;');
    lines.push('');
    lines.push("      const currentIndex = tabButtons.findIndex((b) => b.classList.contains('active'));");
    lines.push('      const nextIndex = currentIndex + (deltaY > 0 ? 1 : -1);');
    lines.push('      touchStartY = null; // one swipe = one tab step');
    lines.push('      if (nextIndex < 0 || nextIndex >= tabButtons.length) return;');
    lines.push('');
    lines.push('      wheelLocked = true;');
    lines.push('      switchToTab(tabButtons[nextIndex]);');
    lines.push('      setTimeout(() => { wheelLocked = false; }, WHEEL_LOCK_MS);');
    lines.push("    }, { passive: true });");
    lines.push('');
    lines.push("    window.addEventListener('touchend', () => { touchStartY = null; });");
    lines.push('');
    lines.push('    // continues on to the currently-shown tab\'s project page, if it has');
    lines.push('    // one — doc/commercial tabs don\'t yet, so they just flash. Shared by');
    lines.push('    // clicking the image itself and the "enter project" text link.');
    lines.push('    function enterProject() {');
    lines.push('      if (imgEl && imgEl.dataset.href) {');
    lines.push('        goTo(imgEl.dataset.href);');
    lines.push('      } else {');
    lines.push('        flash();');
    lines.push('      }');
    lines.push('    }');
    lines.push('');
    lines.push("    if (imgEl) imgEl.addEventListener('click', enterProject);");
    lines.push('');
    lines.push("    const enterLink = document.querySelector('.enter-link');");
    lines.push('    if (enterLink) {');
    lines.push("      enterLink.addEventListener('click', (e) => {");
    lines.push('        e.preventDefault();');
    lines.push('        enterProject();');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  // project-page "poster" fit — the page is designed to sit in one');
    lines.push('  // viewport with no scroll, but the exact height available varies by');
    lines.push('  // browser (chrome/toolbar height, font metrics, etc), so 100vh alone');
    lines.push("  // isn't reliable. Measure the card's real height at its natural width,");
    lines.push("  // and if it doesn't fit, shrink the width (which the grid + polybar");
    lines.push('  // scale from) using two sample points to solve for the width that');
    lines.push('  // exactly fits — rather than guessing at a fixed formula. Skipped on');
    lines.push('  // mobile, where this layout stacks and scrolling is expected.');
    lines.push("  const projectPage = document.querySelector('.project-page');");
    lines.push("  const polybarCard = document.querySelector('.polybar-card');");
    lines.push('  if (projectPage && polybarCard) {');
    lines.push('    const isMobile = () => window.innerWidth > 0 && window.innerWidth <= 700;');
    lines.push('');
    lines.push('    function fitProjectPage() {');
    lines.push('      if (isMobile()) {');
    lines.push("        polybarCard.style.width = '';");
    lines.push('        return;');
    lines.push('      }');
    lines.push('');
    lines.push('      const pageStyle = getComputedStyle(projectPage);');
    lines.push('      const budget = window.innerHeight');
    lines.push('        - parseFloat(pageStyle.paddingTop)');
    lines.push('        - parseFloat(pageStyle.paddingBottom);');
    lines.push('');
    lines.push("      polybarCard.style.width = ''; // reset to natural (CSS max-width) before measuring");
    lines.push('      const w0 = polybarCard.getBoundingClientRect().width;');
    lines.push('      const h0 = polybarCard.getBoundingClientRect().height;');
    lines.push('      if (w0 <= 0 || h0 <= 0 || h0 <= budget) return; // not laid out yet, or already fits');
    lines.push('');
    lines.push('      const w1 = w0 * 0.7;');
    lines.push("      polybarCard.style.width = w1 + 'px';");
    lines.push('      const h1 = polybarCard.getBoundingClientRect().height;');
    lines.push('');
    lines.push('      const slope = (h0 - h1) / (w0 - w1);');
    lines.push("      if (slope <= 0) { polybarCard.style.width = ''; return; }");
    lines.push('      const intercept = h0 - slope * w0;');
    lines.push('      const wFit = (budget - intercept) / slope;');
    lines.push('');
    lines.push("      polybarCard.style.width = Math.max(280, Math.min(w0, wFit)) + 'px';");
    lines.push('    }');
    lines.push('');
    lines.push('    // window.innerWidth/innerHeight (and therefore layout) aren\'t reliably');
    lines.push('    // populated yet at the moment this synchronous script runs — wait a');
    lines.push('    // couple of animation frames so a real paint has happened first.');
    lines.push('    requestAnimationFrame(() => requestAnimationFrame(fitProjectPage));');
    lines.push('    if (document.fonts && document.fonts.ready) {');
    lines.push('      document.fonts.ready.then(fitProjectPage);');
    lines.push('    }');
    lines.push("    window.addEventListener('load', fitProjectPage);");
    lines.push('');
    lines.push('    let resizeTimer;');
    lines.push("    window.addEventListener('resize', () => {");
    lines.push('      clearTimeout(resizeTimer);');
    lines.push('      resizeTimer = setTimeout(fitProjectPage, 80);');
    lines.push('    });');
    lines.push('  }');
    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }

  // ---- top-level: content.json -> { filename: contents } -------------

  function renderSite(content) {
    const files = {};

    disabledFiles = new Set(content.categories.filter((c) => c.enabled === false).map((c) => c.file));

    files[content.landing.file] = renderLanding(content.landing);

    content.simplePages.forEach((p) => {
      files[p.file] = renderSimple(p);
    });

    files[content.contactPage.file] = renderContact(content.contactPage);

    content.categories.forEach((cat) => {
      const tabsData = cat.projects.map((pid, i) => {
        const proj = content.projects.find((p) => p.id === pid);
        return {
          title: proj.title,
          role: proj.role,
          image: proj.coverImage || '',
          href: proj.file,
          color: proj.bg,
          fg: proj.fg || '#e8e5cc',
          active: i === 0,
        };
      });
      const firstProj = content.projects.find((p) => p.id === cat.projects[0]);
      files[cat.file] = renderCategory(tabsData, firstProj, cat.browserTitle || cat.label || cat.id);
    });

    content.projects.forEach((proj, i) => {
      const next = content.projects[(i + 1) % content.projects.length];
      files[proj.file] = renderProject(proj, next.file);
    });

    files['js/script.js'] = renderScriptJs(content);

    return files;
  }

  const api = { renderSite, textToHtml };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SiteRender = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
