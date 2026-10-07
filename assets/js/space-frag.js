/*
 * Fragment shader for the background journey. Six scenes share one program:
 *   0 black hole · 1 spiral galaxy · 2 binary black hole · 3 quasar · 4 nebula · 5 event horizon
 *   6 pulsar · 7 supernova remnant
 * Black holes are traced as photons in Schwarzschild spacetime (rs = 1):
 *   d²x/dt² = -1.5 · rs · h² · x / r⁵,  h = |x × v|
 */
window.SPACE_FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform int   uScene;
uniform vec3  uCam;      // distance, azimuth, inclination
uniform vec3  uView;     // screen shift x, y, roll
uniform float uWarp;
uniform float uFade;
uniform float uExposure;
uniform int   uSteps;
uniform float uHold;     // 0..1 while the visitor presses and holds
out vec4 outColor;

#define FOCAL 1.6
#define TAU 6.2831853

float PIX;

float hash13(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm5(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(3.1, 1.7, 7.3); a *= .5; } return s; }
float fbm4(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(3.1, 1.7, 7.3); a *= .5; } return s; }
float fbm3(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(3.1, 1.7, 7.3); a *= .5; } return s; }

// ---------- sky: faint nebula, milky band, distant galaxies, stars ----------
vec3 sky(vec3 d) {
  vec3 col = vec3(0.);
  float n = fbm3(d * 2.2 + 1.7);
  col += vec3(.030, .016, .052) * n * n * n * 2.2;
  float band = exp(-abs(dot(d, normalize(vec3(.28, 1., -.36)))) * 6.);
  col += vec3(.026, .022, .034) * band * fbm3(d * 7.5 + 3.) * 1.5;

  vec3 gp = d * 7.;
  vec3 gid = floor(gp);
  vec3 gh = hash33(gid + 91.);
  if (gh.x > .88) {
    vec3 q = fract(gp) - .5 - (hash33(gid * 3.1) - .5) * .5;
    vec3 ax = normalize(hash33(gid * 7.7) - .5);
    float a = dot(q, ax), b2 = max(dot(q, q) - a * a, 0.);
    float g = exp(-(a * a * 260. + b2 * 1500.) / (.5 + gh.y));
    col += mix(vec3(.50, .46, .42), vec3(.40, .45, .56), gh.z) * g * .22;
  }

  for (int i = 0; i < 3; i++) {
    float sc = 60. + float(i) * 85.;
    vec3 p = d * sc;
    vec3 id = floor(p);
    vec3 h = hash33(id + float(i) * 41.7);
    if (h.x < .86 + float(i) * .03) continue;
    vec3 o = (hash33(id * 1.37 + 5.) - .5) * .7;
    float dd = length(fract(p) - .5 - o);
    float big = step(.985, h.y);
    float sig = max(.8 * PIX * sc, .02) * (1. + big * .5);
    float b = exp(-dd * dd / (2. * sig * sig));
    float tw = .75 + .25 * sin(uTime * (.6 + h.z * 2.4) + h.y * 60.);
    col += mix(vec3(.66, .74, .95), vec3(.95, .84, .70), h.z) * b * tw * (.3 + .75 * big) * (1.05 - float(i) * .32);
  }
  return col;
}

// ---------- disks ----------
vec3 palette(int pal, float t) {
  vec3 a, b, c, e;
  if (pal == 0)      { a = vec3(.20, .06, .03); b = vec3(.74, .39, .17); c = vec3(.90, .74, .54); e = vec3(.94, .90, .83); }
  else if (pal == 1) { a = vec3(.05, .05, .18); b = vec3(.30, .34, .76); c = vec3(.64, .78, .96); e = vec3(.88, .92, 1.0); }
  else if (pal == 2) { a = vec3(.18, .03, .03); b = vec3(.70, .22, .15); c = vec3(.92, .60, .45); e = vec3(.96, .87, .80); }
  else               { a = vec3(.03, .06, .18); b = vec3(.20, .40, .80); c = vec3(.58, .80, .98); e = vec3(.88, .94, 1.0); }
  vec3 col = mix(a, b, smoothstep(0., .42, t));
  col = mix(col, c, smoothstep(.36, .85, t));
  return mix(col, e, smoothstep(.85, 1.35, t));
}

vec4 diskShade(vec3 p, vec3 c, float rs, float din, float dout, vec3 rd, int pal) {
  vec3 lp = (p - c) / rs;
  float r = length(lp.xz);
  if (r < din * .92 || r > dout) return vec4(0.);
  float a = 2.4 * pow(r, -1.5) * uTime;
  float ca = cos(a), sa = sin(a);
  vec2 q = mat2(ca, -sa, sa, ca) * lp.xz;
  float phi = atan(q.y, q.x);
  float seed = float(pal) * 13.1;
  float streaks = fbm5(vec3(r * 2.6, cos(phi) * 1.7 + seed, sin(phi) * 1.7));
  float clouds = fbm3(vec3(q * .85, r * .3 + 4. + seed));
  float rings = .65 + .35 * sin(r * 7. + streaks * 6.);
  float edge = smoothstep(din * .92, din * 1.18, r) * (1. - smoothstep(dout * .45, dout, r));
  float dens = edge * (.15 + 1.2 * streaks * clouds * rings + .28 * streaks);

  vec3 v = normalize(vec3(-lp.z, 0., lp.x));
  float beta = sqrt(.5 / r);
  float gam = inversesqrt(1. - beta * beta);
  float D = 1. / (gam * (1. - beta * dot(v, -rd)));
  float g = D * sqrt(max(1. - 1. / r, 0.));
  vec3 col = palette(pal, pow(din / r, .85) * g);
  float I = mix(1., pow(g, 2.4), .8) * pow(din / r, 1.6) * dens;
  return vec4(col * I * 1.6, clamp(dens * .85, 0., 1.));
}

// ---------- single black hole (optionally with jets) ----------
vec3 traceBH(vec3 ro, vec3 rd, int pal, float jets, float dout) {
  vec3 pos = ro, vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.);
  float T = 1., glow = 0., haze = 0., jet = 0.;
  bool captured = false;

  for (int i = 0; i < 220; i++) {
    if (i >= uSteps) break;
    float r2 = dot(pos, pos);
    float dt = clamp(.028 * r2, .012, .95);
    vec3 prev = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * sqrt(r2)) * (dt * .5);
    pos += vel * dt;
    r2 = dot(pos, pos);
    float r = sqrt(r2);
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * (dt * .5);

    float pr = length(pos.xz);
    glow += exp(-abs(r - 1.5) * 7.) * dt * T;
    haze += exp(-abs(pos.y) * 2.6) * smoothstep(dout + 3., 2.6, pr) * smoothstep(1.8, 3.2, pr) * dt * T;
    if (jets > 0.) {
      float ay = abs(pos.y);
      float w = .3 + ay * .1;
      float jd = exp(-pr * pr / (w * w)) * smoothstep(1.4, 3.5, ay) * exp(-ay * .035);
      jet += jd * (.55 + .45 * sin(ay * 1.1 - uTime * 2.2)) * dt * T;
    }
    if (prev.y * pos.y < 0.) {
      vec3 hp = mix(prev, pos, prev.y / (prev.y - pos.y));
      vec4 dc = diskShade(hp, vec3(0.), 1., 2.6, dout, normalize(vel), pal);
      col += T * dc.rgb;
      T *= 1. - dc.a;
      if (T < .02) break;
    }
    if (r2 < 1.) { captured = true; break; }
    if (r > 36. && dot(pos, vel) > 0.) break;
  }
  vec3 gc = pal == 1 ? vec3(.55, .65, 1.) : vec3(1., .66, .40);
  col += gc * (glow * .011 + haze * .006);
  col += vec3(.45, .56, 1.) * jet * (.2 + .3 * uHold) * jets;
  if (!captured) col += T * sky(normalize(vel));
  return col;
}

// ---------- binary black hole (after NASA's red/blue visualisation) ----------
vec3 accel2(vec3 p, vec3 v, vec3 c1, vec3 c2, float m1, float m2) {
  vec3 d1 = p - c1, d2 = p - c2;
  vec3 h1 = cross(d1, v), h2 = cross(d2, v);
  float q1 = dot(d1, d1), q2 = dot(d2, d2);
  return -1.5 * m1 * dot(h1, h1) * d1 / (q1 * q1 * sqrt(q1)) - 1.5 * m2 * dot(h2, h2) * d2 / (q2 * q2 * sqrt(q2));
}

vec3 traceBinary(vec3 ro, vec3 rd) {
  float ph = uTime * .09;
  float m1 = 1., m2 = .6, sep = 13. - 6.5 * uHold;
  vec3 axis = vec3(cos(ph), 0., sin(ph));
  vec3 c1 = axis * sep * m2 / (m1 + m2);
  vec3 c2 = -axis * sep * m1 / (m1 + m2);
  vec3 pos = ro, vel = rd;
  vec3 col = vec3(0.);
  float T = 1., glow = 0.;
  bool captured = false;

  for (int i = 0; i < 250; i++) {
    if (i >= uSteps + 40) break;
    vec3 d1 = pos - c1, d2 = pos - c2;
    float dt = clamp(.028 * min(dot(d1, d1) / m1, dot(d2, d2) / m2), .01, .9);
    vec3 prev = pos;
    vel += accel2(pos, vel, c1, c2, m1, m2) * (dt * .5);
    pos += vel * dt;
    vel += accel2(pos, vel, c1, c2, m1, m2) * (dt * .5);
    d1 = pos - c1; d2 = pos - c2;
    float q1 = dot(d1, d1), q2 = dot(d2, d2);
    glow += (exp(-abs(sqrt(q1) - 1.5 * m1) * 7. / m1) + exp(-abs(sqrt(q2) - 1.5 * m2) * 7. / m2)) * dt * T;

    if (prev.y * pos.y < 0.) {
      vec3 hp = mix(prev, pos, prev.y / (prev.y - pos.y));
      vec3 nv = normalize(vel);
      vec4 dc = diskShade(hp, c1, m1, 2.6, 6., nv, 2) + diskShade(hp, c2, m2, 2.6, 5., nv, 3);
      col += T * dc.rgb;
      T *= 1. - clamp(dc.a, 0., 1.);
      if (T < .02) break;
    }
    if (q1 < m1 * m1 || q2 < m2 * m2) { captured = true; break; }
    if (dot(pos, pos) > 3600. && dot(pos, vel) > 0.) break;
  }
  col += vec3(.85, .72, .85) * glow * .009;
  if (!captured) col += T * sky(normalize(vel));
  return col;
}

// ---------- spiral galaxy ----------
vec3 galaxy(vec3 ro, vec3 rd) {
  vec3 col = sky(rd);
  if (abs(rd.y) > 1e-3) {
    float t = -ro.y / rd.y;
    if (t > 0.) {
      vec3 p = ro + rd * t;
      float r = length(p.xz);
      float arm = atan(p.z, p.x) - uTime * .015 - log(max(r, .2)) * 2.2;
      float n = fbm5(vec3(p.xz * .6, 1.3));
      float n2 = fbm3(vec3(p.xz * 1.7, 7.));
      float armS = pow(.5 + .5 * cos(2. * arm + n2 * .8), 3.);
      float disk = exp(-r / 3.4) * (1. - smoothstep(9., 14., r));
      float light = disk * (.14 + armS * (.6 + 1.1 * n));
      float dust = pow(.5 + .5 * cos(2. * arm + .6), 5.) * smoothstep(.8, 3., r) * n2 * exp(-r / 6.);
      float slab = min(1. / max(abs(rd.y), .1), 6.);
      vec3 armCol = mix(vec3(.42, .54, .92), vec3(.92, .78, .60), exp(-r / 2.));
      float hii = smoothstep(.62, .78, n2) * armS * disk;
      vec3 gal = (armCol * light + vec3(.90, .36, .52) * hii * .8) * slab * .45;
      col *= 1. - clamp(light * slab * .25 + dust * 1.5, 0., .92);
      col += gal * (1. - clamp(dust * 1.6, 0., .8));
      vec2 g = p.xz * 5.;
      vec3 h = hash33(vec3(floor(g), 3.));
      float dd = length(fract(g) - .5 - (h.yz - .5) * .7);
      col += vec3(.85, .88, 1.) * exp(-dd * dd * 120.) * step(.82, h.x) * disk * (.3 + armS) * .9;
    }
  }
  float tc = max(-dot(ro, rd), 0.);
  float b = length((ro + rd * tc) * vec3(1., 1.7, 1.));
  col += vec3(.95, .80, .62) * (exp(-b * b * 1.1) * .7 + exp(-b * 1.1) * .1);
  return col;
}

// ---------- emission nebula, lit by a young star at the origin ----------
vec3 nebula(vec3 ro, vec3 rd) {
  vec3 acc = vec3(0.);
  float T = 1., t = .5;
  for (int i = 0; i < 30; i++) {
    float stp = .8 + t * .08;
    vec3 p = ro + rd * t;
    float n = fbm4(p * .16 + vec3(0., 0., uTime * .006));
    float d = smoothstep(.5, .9, n);
    if (d > .002) {
      float m = fbm3(p * .45 + 11.);
      vec3 gas = mix(vec3(.10, .30, .36), vec3(.48, .20, .30), smoothstep(.35, .65, m));
      gas = mix(gas, vec3(.70, .52, .34), smoothstep(.7, .95, n) * .6);
      float li = 1. / (1. + dot(p, p) * .025);
      acc += T * gas * d * (.2 + li * 1.6) * .16 * stp;
      T *= exp(-d * .22 * stp);
      if (T < .03) break;
    }
    t += stp;
  }
  float tc = max(-dot(ro, rd), 0.);
  float b = length(ro + rd * tc);
  vec3 star = vec3(1., .9, .8) * (exp(-b * b * 40.) * .8 + exp(-b * 2.2) * .06);
  return (sky(rd) * .7 + star) * T + acc;
}

// ---------- pulsar: spinning neutron star, lighthouse beams, dipole field, wind torus ----------
vec3 pulsar(vec3 ro, vec3 rd) {
  vec3 col = sky(rd);
  vec3 axis = normalize(vec3(.2, 1., .15));
  vec3 e1 = normalize(cross(axis, vec3(1., 0., 0.)));
  vec3 e2 = cross(axis, e1);
  float spin = uTime * 1.6;
  vec3 beam = normalize(axis * cos(.62) + (e1 * cos(spin) + e2 * sin(spin)) * sin(.62));
  float tc = max(-dot(ro, rd), 0.);
  float t0 = max(tc - 16., 0.), t1 = tc + 16.;
  float dt = (t1 - t0) / 44.;
  vec3 acc = vec3(0.);
  for (int i = 0; i < 44; i++) {
    vec3 p = ro + rd * (t0 + dt * (float(i) + .5));
    float r = length(p);
    float c = abs(dot(p, beam)) / max(r, 1e-3);
    float cone = pow(c, 70.) * smoothstep(15., .6, r) / (1. + r * .25);
    float pr = length(cross(p, axis));
    float L = r * r * r / max(pr * pr, 1e-3);
    float lines = pow(.5 + .5 * cos(L * 2.4), 18.) * smoothstep(7., 1.2, L) * exp(-r * .5);
    float lat = dot(p, axis);
    float torus = exp(-pow(length(vec2(pr - 3.4, lat * 1.8)) * 1.1, 2.));
    if (torus > .02) torus *= .4 + fbm3(p * .9 + vec3(uTime * .03, 0., 0.));
    acc += (vec3(.55, .70, 1.) * cone * (1.3 + 1.2 * uHold) + vec3(.45, .55, .95) * lines * .3 + vec3(.85, .55, .75) * torus * .07) * dt;
  }
  float b = length(ro + rd * tc);
  float face = pow(abs(dot(beam, normalize(ro))), 30.);
  col += acc;
  col += vec3(.85, .9, 1.) * (exp(-b * b * 40.) * 1.1 + exp(-b * 1.6) * .06 + face * exp(-b * b * 1.5) * .5);
  return col;
}

// ---------- supernova remnant: expanding filamentary shell ----------
vec3 remnant(vec3 ro, vec3 rd) {
  vec3 col = sky(rd);
  float R = 6. * (1. - .55 * uHold);
  float bq = dot(ro, rd), cq = dot(ro, ro) - 64.;
  float hq = bq * bq - cq;
  if (hq > 0.) {
    hq = sqrt(hq);
    float t0 = max(-bq - hq, 0.), t1 = -bq + hq;
    float dt = (t1 - t0) / 60.;
    vec3 axisV = normalize(ro);
    float T = 1.;
    vec3 acc = vec3(0.);
    for (int i = 0; i < 60; i++) {
      vec3 p = ro + rd * (t0 + dt * (float(i) + .5));
      float r = length(p);
      float n = fbm3(p * .45 + vec3(0., uTime * .008, 0.));
      float shell = exp(-pow((r - R * (.93 + .12 * n)) * 2.2, 2.));
      if (shell < .01) continue;
      float fil = fbm3(p * 1.7 + 5.);
      float d = shell * (.06 + 4.2 * pow(fil, 3.5));
      // colour by projected radius: teal oxygen inside, red hydrogen on the rim
      float edge = smoothstep(R * .5, R * .95, length(cross(p, axisV)));
      vec3 gas = mix(vec3(.22, .52, .66), vec3(.72, .24, .22), edge);
      gas = mix(gas, vec3(.88, .68, .42), smoothstep(.62, .85, fil) * .55);
      gas = mix(gas, vec3(.80, .90, 1.), uHold * .45);
      acc += T * gas * d * dt * (.38 + .5 * uHold);
      T *= exp(-d * dt * .08);
    }
    col = col * T + acc;
  }
  float tc = max(-dot(ro, rd), 0.);
  float b = length(ro + rd * tc);
  col += vec3(.7, .8, 1.) * exp(-b * b * 60.) * .7;
  return col;
}

// ---------- hyperspace streaks between scenes ----------
vec3 warp(vec2 p, float w) {
  float r = length(p);
  float a = atan(p.y, p.x) / TAU + .5;
  vec3 acc = vec3(0.);
  for (int L = 0; L < 2; L++) {
    float sectors = L == 0 ? 150. : 240.;
    float s = a * sectors;
    vec3 h = hash33(vec3(floor(s), float(L) * 17., 3.));
    if (h.z < .62) continue;
    float z = fract(h.y + uTime * (.25 + h.x * .5) * (.5 + w * 2.));
    float head = z * z * 1.3;
    float len = (.03 + .4 * w) * z;
    float pxs = (1. / uRes.y) / max(TAU * r / sectors, 1e-4);
    float line = exp(-pow((fract(s) - .5) / max(pxs * .7, .02), 2.));
    float body = smoothstep(head - len, head, r) * (1. - smoothstep(head, head + .006, r));
    acc += mix(vec3(.62, .70, 1.), vec3(1., .85, .72), h.x) * body * line * z;
  }
  return acc * w * .38;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }

void main() {
  vec2 uv0 = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  vec2 uv = uv0 - uView.xy;
  float cr = cos(uView.z), sr = sin(uView.z);
  uv = mat2(cr, sr, -sr, cr) * uv;

  float dist = uCam.x, az = uCam.y, inc = uCam.z;
  vec3 ro = dist * vec3(cos(inc) * sin(az), sin(inc), cos(inc) * cos(az));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0., 1., 0.)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * FOCAL + uv.x * rt + uv.y * up);
  PIX = 1. / (uRes.y * FOCAL);

  vec3 col;
  if (uScene == 0)      col = traceBH(ro, rd, 0, 0., 10.);
  else if (uScene == 1) col = galaxy(ro, rd);
  else if (uScene == 2) col = traceBinary(ro, rd);
  else if (uScene == 3) col = traceBH(ro, rd, 1, 1., 7.);
  else if (uScene == 4) col = nebula(ro, rd);
  else if (uScene == 6) col = pulsar(ro, rd);
  else if (uScene == 7) col = remnant(ro, rd);
  else                  col = traceBH(ro, rd, 0, 0., 10.);

  col = col * uFade + warp(uv0, uWarp);
  col = aces(col * uExposure);
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, .86);
  col = pow(col, vec3(1. / 2.2));
  col *= 1. - .42 * smoothstep(.4, 1.3, length(uv0));
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - .5) / 255.;
  outColor = vec4(col, 1.);
}`;

/*
 * Post pass: screen-space effects on top of the rendered scene.
 * Gravitational-wave ripples from clicks, a tiny black hole under the cursor
 * (point-lens mapping + shadow), and chromatic aberration while things move fast.
 */
window.SPACE_POST = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCursor;     // x, y in centred screen units (divided by height), lens strength
uniform vec4  uWaves[4];   // x, y, age in seconds, amplitude
uniform float uAberr;
out vec4 outColor;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv0 = (frag - .5 * uRes) / uRes.y;
  vec2 q = uv0;
  float glow = 0.;

  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w <= 0.) continue;
    vec2 d = uv0 - w.xy;
    float r = length(d) + 1e-4;
    float front = w.z * .75;
    float env = exp(-pow((r - front) * 9., 2.)) * exp(-w.z * 1.3) * w.w;
    q += d / r * env * .022 * sin((r - front) * 42.);
    glow += env * .35;
  }

  float shadow = 1.;
  float te = uCursor.z;
  if (te > 0.) {
    vec2 d = q - uCursor.xy;
    float r = max(length(d), 1e-4);
    q -= d / r * (te * te) / max(r, te * .6);
    shadow = mix(1., smoothstep(te * .3, te * .42, r), smoothstep(0., .02, te));
    glow += exp(-pow((r - te * .5) / (te * .07), 2.)) * .5;
  }

  vec2 uv = (q * uRes.y + .5 * uRes) / uRes;
  vec2 dir = uv - .5;
  float ab = uAberr * .014;
  vec3 col = vec3(texture(uTex, uv + dir * ab).r, texture(uTex, uv).g, texture(uTex, uv - dir * ab).b);
  col = col * shadow + vec3(.72, .78, 1.) * glow * .06;
  col += (hash12(frag + fract(uTime) * 91.) - .5) / 255.;
  outColor = vec4(col, 1.);
}`;
