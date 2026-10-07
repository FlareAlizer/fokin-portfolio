/*
 * Hands-on space: drag to orbit the phenomenon (with inertia and a slow return
 * home), press and hold to dive in and speed time up, click to send a
 * gravitational wave. The cursor is a tiny black hole that bends the stars.
 * A targeting frame with live readouts appears only while you interact.
 */
(() => {
  'use strict';

  const S = window.Space;
  const canvas = document.getElementById('space');
  if (!S || !canvas) return;

  const root = document.documentElement;
  const input = S.input;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const hud = document.querySelector('.hud');
  const hudRead = document.querySelector('.hud__read');
  const hint = document.querySelector('.cursor-hint');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const toUnits = (x, y) => [(x - innerWidth / 2) / innerHeight, (innerHeight / 2 - y) / innerHeight];

  let played = false;
  try { played = localStorage.getItem('fokin-played') === '1'; } catch (e) { /* storage may be blocked */ }
  function markPlayed() {
    if (played) return;
    played = true;
    try { localStorage.setItem('fokin-played', '1'); } catch (e) { /* ignore */ }
    hint.classList.remove('is-on');
    root.classList.remove('show-touch-hint');
  }

  const st = {
    down: false, id: null, x0: 0, y0: 0, lx: 0, ly: 0, lt: 0, t0: 0, holdTarget: 0, holdTimer: 0,
    vAz: 0, vInc: 0, speed: 0, lens: 0, lensTarget: 0, cx: 0, cy: 0, tcx: 0, tcy: 0, activeUntil: 0,
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const now = performance.now();
    Object.assign(st, { down: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: now, t0: now, vAz: 0, vInc: 0 });
    input.dragging = false;
    clearTimeout(st.holdTimer);
    st.holdTimer = setTimeout(() => {
      if (st.down && !input.dragging) { st.holdTarget = 1; root.classList.add('is-holding'); markPlayed(); }
    }, 200);
    if (e.pointerType !== 'mouse') {
      [st.tcx, st.tcy] = toUnits(e.clientX, e.clientY);
      st.cx = st.tcx; st.cy = st.tcy;
      st.lensTarget = .035;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    [st.tcx, st.tcy] = toUnits(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      st.lensTarget = .04;
      if (!played && !st.down) {
        hint.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 18}px)`;
        hint.classList.add('is-on');
      }
    }
    if (!st.down || e.pointerId !== st.id) return;
    const now = performance.now();
    const dt = Math.max(8, now - st.lt) / 1000;
    const dx = e.clientX - st.lx, dy = e.clientY - st.ly;
    if (!input.dragging && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 6) {
      input.dragging = true;
      st.holdTarget = 0;
      clearTimeout(st.holdTimer);
      root.classList.add('is-dragging');
      root.classList.remove('is-holding');
      markPlayed();
    }
    if (input.dragging) {
      const k = 3 / innerHeight; // radians per pixel
      const dAz = -dx * k, dInc = dy * k * .7;
      input.orbAz += dAz;
      input.orbInc = clamp(input.orbInc + dInc, -1, 1.1);
      st.vAz = st.vAz * .6 + (dAz / dt) * .4;
      st.vInc = st.vInc * .6 + (dInc / dt) * .4;
      st.speed = Math.hypot(dx, dy) / dt;
      st.activeUntil = now + 1400;
    }
    st.lx = e.clientX; st.ly = e.clientY; st.lt = now;
  });

  function release(e) {
    if (!st.down || e.pointerId !== st.id) return;
    const now = performance.now();
    if (!input.dragging && st.holdTarget === 0 && now - st.t0 < 220) {
      const [x, y] = toUnits(e.clientX, e.clientY);
      input.waves.push({ x, y, age: 0, amp: 1 });
      markPlayed();
    }
    st.down = false;
    input.dragging = false;
    st.holdTarget = 0;
    clearTimeout(st.holdTimer);
    root.classList.remove('is-dragging', 'is-holding');
    if (e.pointerType !== 'mouse') st.lensTarget = 0;
    st.activeUntil = now + 1400;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    st.lensTarget = 0;
    hint.classList.remove('is-on');
  });

  /* ---------- targeting frame with live readouts ---------- */
  const NAMES = ['Чёрная дыра', 'Спиральная галактика', 'Двойная чёрная дыра', 'Квазар', 'Пульсар', 'Остаток сверхновой', 'Туманность', 'Горизонт событий'];
  const num = (v, d = 0) => v.toFixed(d).replace('.', ',');
  const deg = (r) => Math.round((((r * 180) / Math.PI) % 360 + 360) % 360);
  function reading(v) {
    switch (v.k) {
      case 1: return `время ×${num(v.timeScale, 1)}`;
      case 2: return `между дырами ${num(13 - 6.5 * v.hold, 1)} rₛ`;
      case 3: return `джеты ${Math.round(100 + 150 * v.hold)}%`;
      case 4: return `${num((1.6 * v.timeScale) / (2 * Math.PI), 2)} об/с`;
      case 5: return `возраст ${Math.round(340 * (1 - .9 * v.hold))} лет`;
      case 6: return `полёт ×${num(v.timeScale, 1)}`;
      default: return `до горизонта ${num(v.dist, 1)} rₛ`;
    }
  }
  let lastText = '';
  function updateHud(now) {
    const v = S.view;
    if (v.k === undefined) return;
    const on = now < st.activeUntil && !root.classList.contains('menu-open');
    hud.classList.toggle('is-on', on);
    if (!on) return;
    const size = v.phone ? innerWidth * .7 : Math.min(innerHeight * .56, innerWidth * .42);
    const px = innerWidth / 2 + v.sx * innerHeight;
    const py = innerHeight / 2 - v.sy * innerHeight;
    hud.style.transform = `translate(${px}px, ${py}px)`;
    hud.style.setProperty('--size', `${size}px`);
    const text = `${NAMES[v.k]} · ${reading(v)} · азимут ${deg(v.az)}° · наклон ${deg(v.inc)}°`;
    if (text !== lastText) { hudRead.textContent = text; lastText = text; }
  }

  /* ---------- per-frame easing ---------- */
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(.1, (now - lastT) / 1000);
    lastT = now;
    input.hold += (st.holdTarget - input.hold) * (1 - Math.exp(-dt * (st.holdTarget ? 1.6 : 3)));
    if (input.hold > .02) st.activeUntil = Math.max(st.activeUntil, now + 1000);
    if (!input.dragging) {
      // inertia first, then a slow return to the composed home pose
      input.orbAz += st.vAz * dt;
      input.orbInc = clamp(input.orbInc + st.vInc * dt, -1, 1.1);
      const f = Math.exp(-dt * 3);
      st.vAz *= f; st.vInc *= f;
      if (Math.abs(st.vAz) + Math.abs(st.vInc) < .05) {
        input.orbAz = ((input.orbAz + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const r = Math.exp(-dt * .45);
        input.orbAz *= r; input.orbInc *= r;
      }
      st.speed *= Math.exp(-dt * 6);
    }
    st.lens += (st.lensTarget - st.lens) * (1 - Math.exp(-dt * 6));
    const c = 1 - Math.exp(-dt * 14);
    st.cx += (st.tcx - st.cx) * c;
    st.cy += (st.tcy - st.cy) * c;
    input.cursor[0] = st.cx;
    input.cursor[1] = st.cy;
    input.cursor[2] = reduced ? 0 : st.lens * (1 + input.hold * .6);
    const targetAb = Math.min(1, st.speed / 2600 + input.hold * .55);
    input.aberr += (targetAb - input.aberr) * (1 - Math.exp(-dt * 8));
    updateHud(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------- first-visit hint on touch screens ---------- */
  // shown on the first touch (works even where the browser misreports its pointer type)
  function touchHint() {
    if (played || root.classList.contains('show-touch-hint')) return;
    root.classList.add('show-touch-hint');
    setTimeout(() => root.classList.remove('show-touch-hint'), 7000);
  }
  if (coarse) setTimeout(touchHint, 1600);
  addEventListener('touchstart', touchHint, { once: true, passive: true });

  /* ---------- lite mode can always be switched back ---------- */
  const liteOff = document.querySelector('.lite-off');
  const syncLite = () => { liteOff.hidden = !S.lite; };
  syncLite();
  liteOff.addEventListener('click', () => { S.setLite(false); syncLite(); });

  /* ---------- "I'm running slow" offer, like a polite machine would ---------- */
  const slow = document.querySelector('.slowbox');
  addEventListener('space:slow', () => { slow.hidden = false; requestAnimationFrame(() => slow.classList.add('is-on')); });
  slow.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lite === '1') { S.setLite(true); syncLite(); }
    slow.classList.remove('is-on');
    setTimeout(() => { slow.hidden = true; }, 500);
  });
})();
