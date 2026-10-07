/*
 * Background journey renderer. Each site section is a stop on a route through
 * space (0…7). Between stops the camera pulls away, jumps through hyperspace
 * and arrives at the next phenomenon.
 * Two passes: the ray-traced scene goes into a texture, then a post pass adds
 * click ripples, the cursor lens and chromatic aberration.
 * Public API: window.Space.goTo(i), setJourney(s), snap(), input, view, setLite(on)
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const canvas = document.getElementById('space');
  const ready = () => window.dispatchEvent(new Event('space:ready'));
  const fail = () => { root.classList.add('no-webgl'); ready(); };
  if (!canvas || !window.SPACE_FRAG || !window.SPACE_POST) { fail(); return; }

  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  if (!gl) { fail(); return; }

  const VERT = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[space] shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function program(fragSrc) {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[space] link error:', gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  const sceneProg = program(window.SPACE_FRAG);
  const postProg = program(window.SPACE_POST);
  if (!sceneProg || !postProg) { fail(); return; }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uniforms = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const US = uniforms(sceneProg, ['uRes', 'uTime', 'uScene', 'uCam', 'uView', 'uWarp', 'uFade', 'uExposure', 'uSteps', 'uHold']);
  const UP = uniforms(postProg, ['uTex', 'uRes', 'uTime', 'uCursor', 'uWaves', 'uAberr']);

  // offscreen target for the scene pass
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  function allocTarget(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Camera "home" pose per stop. sx/sy place the object on screen (desktop: right of the text,
  // phones: above the text sheet). swing = sway while arriving/leaving, orbit = slow drift,
  // holdZoom = how close the camera dives while the visitor presses and holds.
  const SCENES = [
    { kind: 0, dist: 19,   az: .35, inc: .10, sx: .36, sy: .04, roll: -.12, exposure: .78, swing: 1.0, orbit: .004, holdZoom: .5 },  // home: black hole
    { kind: 1, dist: 21,   az: .60, inc: .62, sx: .38, sy: .02, roll: .30,  exposure: .95, swing: .9,  orbit: .010, holdZoom: .35 }, // about: spiral galaxy
    { kind: 2, dist: 31,   az: 1.2, inc: .24, sx: .38, sy: .05, roll: -.08, exposure: .85, swing: .7,  orbit: .006, holdZoom: .3 },  // projects: binary
    { kind: 3, dist: 20,   az: .90, inc: .38, sx: .42, sy: .02, roll: .18,  exposure: .85, swing: .8,  orbit: .005, holdZoom: .4 },  // case: quasar
    { kind: 6, dist: 22,   az: .40, inc: .25, sx: .40, sy: 0,   roll: .10,  exposure: .90, swing: .8,  orbit: .004, holdZoom: .35 }, // experience: pulsar
    { kind: 7, dist: 28,   az: .20, inc: .20, sx: .38, sy: 0,   roll: 0,    exposure: .95, swing: .6,  orbit: .006, holdZoom: .2 },  // awards: supernova remnant
    { kind: 4, dist: 12,   az: 0,   inc: .10, sx: .34, sy: 0,   roll: 0,    exposure: .95, swing: 1.4, orbit: .012, holdZoom: .55 }, // stack: nebula
    { kind: 5, dist: 10.5, az: 5.3, inc: 1.18, sx: 0,  sy: .01, roll: 0,    exposure: .80, swing: .6,  orbit: .004, holdZoom: .45, phoneDist: 2.1 }, // contact: event horizon
  ];
  const LAST = SCENES.length - 1;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let lite = false;
  try { lite = localStorage.getItem('fokin-lite') === '1'; } catch (e) { /* storage may be blocked */ }
  let scale, maxScale, minScale, steps;
  function applyQuality() {
    maxScale = lite ? .5 : (coarse ? .6 * dpr : Math.min(1, .85 * dpr));
    minScale = lite ? .22 : .28;
    steps = lite ? (coarse ? 80 : 110) : (coarse ? 120 : 190);
    scale = Math.min(scale || (coarse ? .42 * dpr : .6 * dpr), maxScale);
  }
  applyQuality();

  let targetS = 0, curS = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  // shared with interact.js: orbit offsets, hold amount, cursor lens, click waves, aberration
  const input = { orbAz: 0, orbInc: 0, hold: 0, dragging: false, cursor: [0, 0, 0], waves: [], aberr: 0 };
  const view = {};
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function resize() {
    const w = Math.max(1, Math.round(innerWidth * scale));
    const h = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; allocTarget(w, h); }
  }
  // Resizing a canvas clears it, so never do it between drawing and presenting a frame:
  // requests are queued and applied at the start of the next frame, right before drawing.
  let resizePending = false;
  const requestResize = () => { resizePending = true; };
  allocTarget(1, 1);
  resize();
  addEventListener('resize', requestResize, { passive: true });
  if (!coarse && !reduced) {
    addEventListener('pointermove', (e) => {
      mouse.tx = (e.clientX / innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  function pose(s, time) {
    let k, u;
    if (s <= 0) { k = 0; u = s; }
    else if (s >= LAST) { k = LAST; u = Math.min(s - LAST, .12); }
    else {
      const i = Math.floor(s), f = s - i;
      if (f < .5) { k = i; u = f; } else { k = i + 1; u = f - 1; }
    }
    const S = SCENES[k];
    const au = Math.abs(u);
    const far = Math.exp(Math.max(au - .12, 0) * 9);
    return {
      k,
      scene: S.kind,
      dist: S.dist * far * (1 + .035 * Math.sin(time * .11 + k * 2)),
      az: S.az + u * S.swing + time * S.orbit,
      inc: S.inc + u * .25 + Math.sin(time * .07 + k) * .015,
      sx: S.sx, sy: S.sy, roll: S.roll + u * .5,
      exposure: S.exposure,
      phoneDist: S.phoneDist || 1.35,
      holdZoom: S.holdZoom,
      fade: 1 - .92 * smooth(.3, .5, au),
      warp: smooth(.18, .46, au),
    };
  }

  const waveData = new Float32Array(16);
  let running = true, frame = 0, last = performance.now(), start = last, simTime = 0;
  let acc = 0, accN = 0, slowCount = 0, slowFired = false;

  function render(now) {
    if (!running) return;
    const dtMs = Math.min(now - last, 100);
    const dt = dtMs / 1000;
    last = now;
    if (resizePending) { resizePending = false; resize(); }
    const timeScale = (reduced ? .15 : 1) * (1 + 4 * input.hold);
    simTime += dt * timeScale;

    const k = 1 - Math.exp(-dt * 3.2);
    curS += (targetS - curS) * k;
    if (!input.dragging) { mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k; }

    // intro: the page opens with an arrival out of hyperspace
    const introT = reduced ? 1 : Math.min(1, (now - start) / 3000);
    const p = pose(curS - .5 * Math.pow(1 - introT, 3), simTime);

    const aspect = innerWidth / innerHeight;
    const phone = innerWidth <= 760 || aspect < .85;
    const dist = p.dist * (phone ? p.phoneDist : 1) * (1 - p.holdZoom * input.hold);
    const az = p.az + mouse.x * .05 + input.orbAz;
    const inc = Math.min(1.35, Math.max(.03, p.inc - mouse.y * .03 + input.orbInc));
    const sx = phone ? 0 : p.sx * Math.min(1, aspect / 1.5);
    const sy = phone ? p.sy + .16 : p.sy;

    // pass 1: the scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(sceneProg);
    gl.uniform2f(US.uRes, canvas.width, canvas.height);
    gl.uniform1f(US.uTime, simTime);
    gl.uniform1i(US.uScene, p.scene);
    gl.uniform3f(US.uCam, dist, az, inc);
    gl.uniform3f(US.uView, sx, sy, p.roll);
    gl.uniform1f(US.uWarp, p.warp);
    gl.uniform1f(US.uFade, p.fade);
    gl.uniform1f(US.uExposure, p.exposure);
    gl.uniform1i(US.uSteps, steps);
    gl.uniform1f(US.uHold, input.hold);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: ripples, cursor lens, aberration
    input.waves = input.waves.filter((w) => (w.age += dt) < 3.5);
    waveData.fill(0);
    input.waves.slice(-4).forEach((w, i) => { waveData.set([w.x, w.y, w.age, w.amp], i * 4); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(postProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(UP.uTex, 0);
    gl.uniform2f(UP.uRes, canvas.width, canvas.height);
    gl.uniform1f(UP.uTime, now / 1000);
    gl.uniform3f(UP.uCursor, input.cursor[0], input.cursor[1], input.cursor[2]);
    gl.uniform4fv(UP.uWaves, waveData);
    gl.uniform1f(UP.uAberr, Math.min(1.2, input.aberr + p.warp * .8));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    Object.assign(view, { k: p.k, dist, az, inc, sx, sy, phone, timeScale, hold: input.hold, simTime });

    if (frame === 0) ready();
    frame++;

    // adaptive resolution: hold the frame budget near 60 fps; offer a lighter mode if even the floor is slow
    if (frame > 20) {
      acc += dtMs; accN++;
      if (accN >= 40) {
        const avg = acc / accN;
        if (avg > 21 && scale > minScale) { scale = Math.max(minScale, scale * .85); requestResize(); }
        else if (avg < 14.5 && scale < maxScale) { scale = Math.min(maxScale, scale * 1.06); requestResize(); }
        slowCount = scale <= minScale + 1e-3 && avg > 34 ? slowCount + 1 : 0;
        if (slowCount >= 2 && !slowFired && !lite) { slowFired = true; window.dispatchEvent(new Event('space:slow')); }
        acc = 0; accN = 0;
      }
    }
    requestAnimationFrame(render);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(render); }
  });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; root.classList.add('no-webgl'); });

  window.Space = {
    // jump straight to a stop: long jumps skip the stops in between
    goTo(i) {
      const k = Math.max(0, Math.min(LAST, i));
      if (Math.abs(k - curS) > 1.05) curS = k - .55 * Math.sign(k - curS);
      targetS = k;
    },
    setJourney(s) { targetS = Math.max(0, Math.min(LAST, s)); },
    snap() { curS = targetS; },
    get journey() { return curS; },
    input,
    view,
    get lite() { return lite; },
    setLite(on) {
      lite = !!on;
      try { localStorage.setItem('fokin-lite', lite ? '1' : '0'); } catch (e) { /* ignore */ }
      applyQuality();
      requestResize();
    },
  };
  requestAnimationFrame(render);
})();
