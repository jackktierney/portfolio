document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('flashOverlay');
  if (!overlay) return;

  const RAMP_MS = 380; // matches the flash-in animation duration — time to reach peak before navigating/swapping

  function pulse(el, className) {
    el.classList.remove('is-flashing-full', 'is-flashing-in', 'is-flashing-out');
    void el.offsetWidth; // restart the animation
    el.classList.add(className);
  }

  // self-contained pulse on the full-screen overlay: used for placeholder
  // popups and any click that doesn't actually leave the page
  function flash() {
    pulse(overlay, 'is-flashing-full');
  }

  // every page's own flash colour is whatever --bg it declares on <body>
  // (falling back to the shared default below) — this map mirrors those
  // same values so the outgoing ramp can be set to the destination's
  // colour instantly, with no lag, keeping the two halves of the flash
  // (ramp up here, ramp down on arrival) an exact, seamless match
  //
  // generated from content.json — do not hand-edit, run the editor's
  // Save & Rebuild instead
  const DEFAULT_BG = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  const PAGE_BG = {
    'index.html': '#4a4e42',
    'about.html': '#423f38',
    'contact.html': '#5a5d61',
    'personal.html': '#2b3440',
    'documentary.html': '#57514a',
    'commercial.html': '#613b0d',
    'zephyr.html': '#2b3440',
    'bayefall.html': '#4a5259',
    'cablestreet.html': '#57514a',
    'documentary-02.html': '#3a424c',
    'documentary-03.html': '#3a424c',
    'childish.html': '#613b0d',
    'chaseandstatus.html': '#232a33',
    'commercial-03.html': '#3a424c',
    'alalake.html': '#9a4d17',
    'bones.html': '#3a424c',
  };

  // ramps up to peak here, then navigates — the next page picks up the
  // peak and ramps back down (see the inline script at the top of <body>),
  // so the two halves read as one flash straddling the page change
  function goTo(href) {
    overlay.style.backgroundColor = PAGE_BG[href] || DEFAULT_BG;
    pulse(overlay, 'is-flashing-in');
    sessionStorage.setItem('flashPending', '1');
    setTimeout(() => { window.location.href = href; }, RAMP_MS);
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    const isExternal = link.target === '_blank' || href.startsWith('mailto:') || href.startsWith('http');

    if (href === '#') {
      if (link.classList.contains('modal-trigger') || link.classList.contains('enter-link')) return; // handled elsewhere

      // any other placeholder link — just flash
      e.preventDefault();
      flash();
      return;
    }

    if (isExternal) {
      flash();
      return;
    }

    e.preventDefault();
    goTo(href);
  });

  // landing hero — picks a random image from assets/images/landing/ on every load
  const landingImg = document.getElementById('landingImg');
  if (landingImg) {
    const landingPhotos = [
      'assets/images/landing/000068780001-3.jpg',
      'assets/images/landing/000065620005.jpg',
      'assets/images/landing/000068780005.jpg',
      'assets/images/landing/000068780003.jpg',
      'assets/images/landing/IMG_3667.jpg',
    ];
    const pick = landingPhotos[Math.floor(Math.random() * landingPhotos.length)];
    landingImg.style.backgroundImage = `url('${pick}')`;
    landingImg.style.backgroundSize = 'cover';
  }

  // contact photo — picks a random image from assets/images/contact/ on every load
  const contactImg = document.getElementById('contactImg');
  if (contactImg) {
    const contactPhotos = [
      'assets/images/contact/000065630001.jpg',
      'assets/images/contact/000065630008.jpg',
      'assets/images/contact/000065630010.jpg',
      'assets/images/contact/000068580001.jpg',
      'assets/images/contact/000068580002.jpg',
      'assets/images/contact/000068580005.jpg',
      'assets/images/contact/000068580006.jpg',
      'assets/images/contact/000068580007.jpg',
      'assets/images/contact/000068580008.jpg',
    ];
    const pick = contactPhotos[Math.floor(Math.random() * contactPhotos.length)];
    contactImg.style.backgroundImage = `url('${pick}')`;
    contactImg.style.backgroundSize = 'cover';
  }

  // test page — clicking the image swaps to a different one from the same
  // set; flashes only the photo box itself (#photoFlash), not the whole screen
  const testImg = document.getElementById('testImg');
  if (testImg) {
    const photoFlash = document.getElementById('photoFlash');
    const testPhotos = [
      'assets/images/zephyr-1.jpg',
      'assets/images/zephyr-2.jpg',
      'assets/images/zephyr-3.jpg',
      'assets/images/zephyr-4.jpg',
      'assets/images/zephyr-5.jpg',
      'assets/images/zephyr-6.jpg',
      'assets/images/zephyr-7.jpg',
      'assets/images/zephyr-8.jpg',
    ];
    let currentPhoto = testPhotos[0];
    testImg.addEventListener('click', () => {
      let next;
      do {
        next = testPhotos[Math.floor(Math.random() * testPhotos.length)];
      } while (next === currentPhoto);
      currentPhoto = next;
      if (photoFlash) {
        pulse(photoFlash, 'is-flashing-full');
      }
      testImg.style.backgroundImage = `url('${next}')`;
    });
  }

  // generic popup wiring — used for watch (video) and about/credits (text).
  // No flash here — that's reserved for actual page changes, not popups.
  function wireModal(linkId, modalId, { onOpen, onClose } = {}) {
    const link = document.getElementById(linkId);
    const modal = document.getElementById(modalId);
    if (!link || !modal) return;
    const closeBtn = modal.querySelector('.modal-close');

    function open() {
      modal.classList.add('is-open');
      if (onOpen) onOpen();
    }
    function close() {
      modal.classList.remove('is-open');
      if (onClose) onClose();
    }

    link.addEventListener('click', (e) => {
      e.preventDefault();
      open();
    });
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close(); // click outside the box
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  }

  wireModal('watchLink', 'watchModal', {
    onOpen: () => {
      const iframe = document.getElementById('watchIframe');
      if (iframe) iframe.src = iframe.dataset.embedSrc || iframe.src;
    },
    onClose: () => {
      const iframe = document.getElementById('watchIframe');
      if (iframe) iframe.src = ''; // stops playback
    },
  });

  wireModal('aboutLink', 'aboutModal');
  wireModal('creditsLink', 'creditsModal');
  wireModal('emailLink', 'emailModal');

  // project-page grid — clicking any still opens the watch popup (same
  // action as clicking "watch" in the polybar), for projects that have one
  const riceCells = document.querySelectorAll('.rice-grid .cell');
  if (riceCells.length) {
    const watchLink = document.getElementById('watchLink');
    if (watchLink) {
      riceCells.forEach((cell) => {
        cell.classList.add('is-clickable');
        cell.addEventListener('click', () => watchLink.click());
      });
    }
  }

  // tabbed solo pages (documentary.html / commercial.html) — clicking a tab
  // swaps the title/role/image to that sub-project
  const tabsEl = document.querySelector('.tabs');
  if (tabsEl) {
    const tabButtons = Array.from(tabsEl.querySelectorAll('button'));
    const titleEl = document.querySelector('.project-title');
    const roleEl = document.querySelector('.project-role');
    const imgEl = document.querySelector('.solo-row .frame-img');
    const frameEl = document.querySelector('.solo-row .frame');

    function applyTab(btn) {
      if (titleEl) titleEl.textContent = btn.dataset.title || titleEl.textContent;
      if (roleEl) roleEl.textContent = btn.dataset.role || roleEl.textContent;
      if (imgEl) {
        if (btn.dataset.image) imgEl.style.backgroundImage = `url('${btn.dataset.image}')`;
        imgEl.dataset.href = btn.dataset.href || '';
      }
      if (btn.dataset.color) document.body.style.setProperty('--bg', btn.dataset.color);
      if (btn.dataset.fg) {
        document.body.style.setProperty('--fg', btn.dataset.fg);
        document.body.style.setProperty('--frame', btn.dataset.fg);
      }
    }

    const activeBtn = tabButtons.find((b) => b.classList.contains('active'));
    if (activeBtn) applyTab(activeBtn);

    function switchToTab(btn) {
      if (btn.classList.contains('active')) return;
      const fromIndex = tabButtons.findIndex((b) => b.classList.contains('active'));
      const toIndex = tabButtons.indexOf(btn);
      const forward = toIndex > fromIndex;
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // pre-tint the overlay with the incoming tab's colour before the ramp
      // even starts, exactly like cross-page navigation — so the ramp up
      // and ramp down are one single colour, with no swap mid-fade
      if (btn.dataset.color) overlay.style.backgroundColor = btn.dataset.color;
      pulse(overlay, 'is-flashing-in');

      function swap() {
        applyTab(btn);
        overlay.style.backgroundColor = ''; // hand back to var(--bg), which now matches
        pulse(overlay, 'is-flashing-out');
      }

      if (!frameEl) {
        setTimeout(swap, RAMP_MS);
        return;
      }

      // the whole frame (border + photo, moving as one unit) rises/falls out as
      // the flash climbs to its peak, hiding the swap; once swapped, it starts a
      // beat off its slot and eases into place as the flash fades back out —
      // advancing to a later tab moves upward (mirrors scrolling up), going
      // back to an earlier tab moves downward (mirrors scrolling down)
      const outClass = forward ? 'is-rising-out' : 'is-falling-out';
      const inClass = forward ? 'is-rising-in' : 'is-falling-in';
      frameEl.classList.add(outClass);
      setTimeout(() => {
        swap();
        frameEl.classList.remove(outClass);
        frameEl.classList.add(inClass);
        void frameEl.offsetWidth; // commit the snap before transitioning back to 0
        frameEl.classList.remove(inClass);
      }, RAMP_MS);
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchToTab(btn));
    });

    // two-finger trackpad / mouse-wheel scroll steps through the tabs
    // instead of scrolling the page — scrolling up advances to the next
    // tab (image moves up), scrolling down reverses to the previous one
    // (image moves down), each using the same flash + rise/fall
    // transition as clicking a tab directly
    let wheelLocked = false;
    const WHEEL_LOCK_MS = 830; // covers the full flash+rise transition so one scroll gesture = one tab step
    window.addEventListener('wheel', (e) => {
      if (wheelLocked) return;
      if (document.querySelector('.modal-overlay.is-open')) return; // let modal text scroll normally
      if (Math.abs(e.deltaY) < 10) return; // ignore trackpad jitter

      const currentIndex = tabButtons.findIndex((b) => b.classList.contains('active'));
      const nextIndex = currentIndex + (e.deltaY > 0 ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= tabButtons.length) return;

      wheelLocked = true;
      switchToTab(tabButtons[nextIndex]);
      setTimeout(() => { wheelLocked = false; }, WHEEL_LOCK_MS);
    }, { passive: true });

    // continues on to the currently-shown tab's project page, if it has
    // one — doc/commercial tabs don't yet, so they just flash. Shared by
    // clicking the image itself and the "enter project" text link.
    function enterProject() {
      if (imgEl && imgEl.dataset.href) {
        goTo(imgEl.dataset.href);
      } else {
        flash();
      }
    }

    if (imgEl) imgEl.addEventListener('click', enterProject);

    const enterLink = document.querySelector('.enter-link');
    if (enterLink) {
      enterLink.addEventListener('click', (e) => {
        e.preventDefault();
        enterProject();
      });
    }
  }

  // project-page "poster" fit — the page is designed to sit in one
  // viewport with no scroll, but the exact height available varies by
  // browser (chrome/toolbar height, font metrics, etc), so 100vh alone
  // isn't reliable. Measure the card's real height at its natural width,
  // and if it doesn't fit, shrink the width (which the grid + polybar
  // scale from) using two sample points to solve for the width that
  // exactly fits — rather than guessing at a fixed formula. Skipped on
  // mobile, where this layout stacks and scrolling is expected.
  const projectPage = document.querySelector('.project-page');
  const polybarCard = document.querySelector('.polybar-card');
  if (projectPage && polybarCard) {
    const isMobile = () => window.innerWidth > 0 && window.innerWidth <= 700;

    function fitProjectPage() {
      if (isMobile()) {
        polybarCard.style.width = '';
        return;
      }

      const pageStyle = getComputedStyle(projectPage);
      const budget = window.innerHeight
        - parseFloat(pageStyle.paddingTop)
        - parseFloat(pageStyle.paddingBottom);

      polybarCard.style.width = ''; // reset to natural (CSS max-width) before measuring
      const w0 = polybarCard.getBoundingClientRect().width;
      const h0 = polybarCard.getBoundingClientRect().height;
      if (w0 <= 0 || h0 <= 0 || h0 <= budget) return; // not laid out yet, or already fits

      const w1 = w0 * 0.7;
      polybarCard.style.width = w1 + 'px';
      const h1 = polybarCard.getBoundingClientRect().height;

      const slope = (h0 - h1) / (w0 - w1);
      if (slope <= 0) { polybarCard.style.width = ''; return; }
      const intercept = h0 - slope * w0;
      const wFit = (budget - intercept) / slope;

      polybarCard.style.width = Math.max(280, Math.min(w0, wFit)) + 'px';
    }

    // window.innerWidth/innerHeight (and therefore layout) aren't reliably
    // populated yet at the moment this synchronous script runs — wait a
    // couple of animation frames so a real paint has happened first.
    requestAnimationFrame(() => requestAnimationFrame(fitProjectPage));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fitProjectPage);
    }
    window.addEventListener('load', fitProjectPage);

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitProjectPage, 80);
    });
  }
});
