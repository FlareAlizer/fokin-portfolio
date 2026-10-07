/*
 * UI: the site is a route of eight stops. One section is shown at a time,
 * and every switch sends the background camera to the next phenomenon.
 * Navigation: menu, route dots, arrows, wheel, keyboard, swipe, #hash.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const phone = () => innerWidth <= 760;

  /* ---------- curtain ---------- */
  let isReady = false;
  const setReady = () => { if (!isReady) { isReady = true; root.classList.add('is-ready'); } };
  addEventListener('space:ready', setReady, { once: true });
  if (root.classList.contains('no-webgl')) setReady();
  setTimeout(setReady, 2500); // slow GPUs starve requestAnimationFrame, so a plain timer is the safety net

  /* ---------- slides ---------- */
  const panel = $('#panel');
  const slides = $$('.slide');
  const ids = slides.map((s) => s.id);
  const goLinks = $$('[data-go]');
  const dots = $$('.route__dots a');
  const [prevBtn, nextBtn] = $$('.route__arrow');
  let current = -1, swapTimer = 0;

  const indexFromHash = () => Math.max(0, ids.indexOf(decodeURIComponent(location.hash.slice(1))));

  function mark(i) {
    goLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${ids[i]}` && !a.classList.contains('top__logo')));
    dots.forEach((a, k) => a.classList.toggle('is-past', k < i));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === slides.length - 1;
  }

  function reveal(slide) {
    slides.forEach((s) => s.classList.toggle('is-active', s === slide));
    root.dataset.slide = slide.id;
    panel.scrollTop = 0;
    slide.classList.remove('is-in');
    void slide.offsetWidth; // restart the entrance animation
    slide.classList.add('is-in');
    document.title = slide.id === 'top' ? 'Владислав Фокин — бэкенд-разработчик' : `${slide.dataset.title} — Владислав Фокин`;
  }

  function show(i, push = true) {
    i = clamp(i, 0, slides.length - 1);
    if (i === current) return;
    const first = current === -1;
    current = i;
    if (window.Space) window.Space.goTo(i);
    mark(i);
    root.classList.remove('sheet-full', 'menu-open');
    handle.setAttribute('aria-expanded', 'false');
    if (push) history.pushState(null, '', `#${ids[i]}`);
    if (first) { reveal(slides[i]); return; }
    // fade the text out while the camera jumps, bring the new text in on arrival
    panel.classList.add('is-leaving');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => { reveal(slides[i]); panel.classList.remove('is-leaving'); }, 360);
  }
  const step = (d) => show(current + d);

  goLinks.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    show(ids.indexOf(a.getAttribute('href').slice(1)));
  }));
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  addEventListener('popstate', () => show(indexFromHash(), false));

  /* ---------- wheel: scroll the text first, then move to the next stop ---------- */
  let wheelAcc = 0, wheelReset = 0, lockUntil = 0, innerScrollAt = 0;
  panel.addEventListener('scroll', () => { innerScrollAt = performance.now(); }, { passive: true });
  addEventListener('wheel', (e) => {
    if (root.classList.contains('menu-open')) return;
    const inPanel = panel.contains(e.target);
    if (inPanel && panel.scrollHeight > panel.clientHeight + 2) {
      const atTop = panel.scrollTop <= 0;
      const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
      if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) return; // let the text scroll
    }
    e.preventDefault();
    const now = performance.now();
    if (now < lockUntil || now - innerScrollAt < 450) return; // ignore inertia right after inner scrolling
    wheelAcc += e.deltaY;
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => { wheelAcc = 0; }, 220);
    if (Math.abs(wheelAcc) > 70) {
      step(Math.sign(wheelAcc));
      wheelAcc = 0;
      lockUntil = now + 1100;
    }
  }, { passive: false });

  /* ---------- keyboard ---------- */
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { root.classList.remove('menu-open'); return; }
    if (e.target.closest('[role="tablist"]') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
  });

  /* ---------- touch: sideways swipe on the text ---------- */
  let touch = null;
  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || root.classList.contains('menu-open')) { touch = null; return; }
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, inPanel: panel.contains(e.target), onTabs: !!e.target.closest('.tabs') };
  }, { passive: true });
  addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.6;
    // the scene itself is for orbiting (interact.js); sideways swipes on the text move between stops
    if (touch.inPanel && horizontal && Math.abs(dx) > 70 && !touch.onTabs) step(dx < 0 ? 1 : -1);
    touch = null;
  }, { passive: true });

  /* ---------- phone sheet, text toggle, menu ---------- */
  const handle = $('.panel__handle');
  handle.addEventListener('click', () => {
    if (root.classList.contains('text-off')) { setTextOff(false); return; }
    const full = root.classList.toggle('sheet-full');
    handle.setAttribute('aria-expanded', String(full));
    handle.setAttribute('aria-label', full ? 'Свернуть текст' : 'Развернуть текст');
  });

  const eye = $('.eye'), eyeLabel = $('.eye__label');
  function setTextOff(off) {
    root.classList.toggle('text-off', off);
    root.classList.remove('sheet-full');
    eye.setAttribute('aria-pressed', String(off));
    eye.setAttribute('aria-label', off ? 'Показать текст' : 'Скрыть текст');
    eyeLabel.textContent = off ? 'Показать текст' : 'Скрыть текст';
  }
  eye.addEventListener('click', () => setTextOff(!root.classList.contains('text-off')));

  const burger = $('.burger');
  burger.addEventListener('click', () => {
    const open = root.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });

  /* ---------- project tabs ---------- */
  const tabs = $$('[role="tab"]');
  function selectTab(tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (!phone()) panel.scrollTop = 0;
  }
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });

  /* ---------- start ---------- */
  const start = indexFromHash();
  if (window.Space) { window.Space.setJourney(start); window.Space.snap(); }
  show(start, false);
  // the browser jumps to #fragment on load and would scroll the text; undo that
  addEventListener('load', () => { panel.scrollTop = 0; });

  console.log('%cПривет! Если читаете консоль, нам точно есть о чём поговорить: t.me/FlareAliZZZZe', 'color:#c6a17c');
})();
