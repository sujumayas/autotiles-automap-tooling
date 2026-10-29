// The whole ground in one fragment shader, driven by a material table instead
// of hardcoded terrains. Each map texel holds (material, soft underlay, raised,
// hash). Soft materials blend between the 4 tile centers around a pixel with a
// noisy threshold, as in auto-tiles. Crisp materials (floors, built walls) fill
// their cell exactly. A pixel shows the highest material that passes, so the
// material order in the palette is the stacking order.

export const PATTERNS = ['flat', 'water', 'sand', 'dirt', 'grass', 'field', 'cobble', 'planks', 'flags', 'snow', 'rock',
  'swamp', 'needles', 'gravel', 'stairs', 'hole', 'carpet', 'wall', 'fence', 'hedge', 'air', 'lava', 'metal', 'grate', 'tiles',
  'stars', 'glass'];
const P = Object.fromEntries(PATTERNS.map((n, i) => [n.toUpperCase(), i]));

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uMap, uBelow, uMat;
uniform ivec2 uMapSize;
uniform vec2 uRes, uCenter, uCamPx;
uniform float uTile, uTime, uNoise, uLight;
uniform int uMode, uGrid, uFirstLand, uOob, uHasBelow;
out vec4 outColor;

${Object.entries(P).map(([k, v]) => `#define P_${k} ${v}`).join('\n')}
#define rgb(r, g, b) (vec3(r, g, b) / 255.0)

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}

uvec4 cellAt(ivec2 c) {
  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, uMapSize))) return uvec4(uint(uOob), uint(uOob), 0u, 0u);
  return texelFetch(uMap, c, 0);
}
vec3 mc(int m, int k) { return vec3(texelFetch(uMat, ivec2(k, m), 0).rgb) / 255.0; }
int mPattern(int m) { return int(texelFetch(uMat, ivec2(0, m), 0).a); }
bool mSoft(int m) { return texelFetch(uMat, ivec2(1, m), 0).a > 0u; }
float mHeight(int m) { return float(texelFetch(uMat, ivec2(2, m), 0).a); }
float mNoise(int m) { return float(texelFetch(uMat, ivec2(3, m), 0).r) / 255.0; }
float mParam(int m) { return float(texelFetch(uMat, ivec2(3, m), 0).g); }
bool mSolid(int m) { return texelFetch(uMat, ivec2(3, m), 0).b > 0u; }
vec3 mAccent(int m) { return mc(m, 4); }
bool mGlow(int m) { return texelFetch(uMat, ivec2(4, m), 0).a > 0u; }

float noiseField(vec2 g) { return (fbm(g * 0.55) - 0.5) * 1.1 + (vnoise(g * 2.7) - 0.5) * 0.35; }
float thrOf(int m, float nf) { return clamp(0.5 + nf * mNoise(m) * uNoise, 0.08, 0.92); }

// Soft coverage of material v (by underlay ids) at a grid point.
float softCov(vec2 g, int v) {
  vec2 q = g - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  float a = step(float(v) - 0.5, float(cellAt(i).g)), b = step(float(v) - 0.5, float(cellAt(i + ivec2(1, 0)).g));
  float c = step(float(v) - 0.5, float(cellAt(i + ivec2(0, 1)).g)), d = step(float(v) - 0.5, float(cellAt(i + ivec2(1, 1)).g));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float raisedCov(vec2 g) {
  vec2 q = g - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  float a = float(cellAt(i).b), b = float(cellAt(i + ivec2(1, 0)).b);
  float c = float(cellAt(i + ivec2(0, 1)).b), d = float(cellAt(i + ivec2(1, 1)).b);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Result of picking the top material at a pixel.
int gTop;
float gDist;      // distance to the edge of the top material, screen px
float gShore;     // distance to land, screen px (for water)
float gAO;        // distance to a raised neighbour, px (crisp floors)

void pickTop(vec2 g, float nf) {
  vec2 q = g - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = q - floor(q);
  int ga = int(cellAt(i0).g), gb = int(cellAt(i0 + ivec2(1, 0)).g);
  int gc = int(cellAt(i0 + ivec2(0, 1)).g), gd = int(cellAt(i0 + ivec2(1, 1)).g);
  ivec2 ci = ivec2(floor(g));
  uvec4 cell = cellAt(ci);
  int R = int(cell.r);
  int cand = mSoft(R) ? -1 : R;

  // Land coverage, for shore effects.
  float lv = float(uFirstLand) - 0.5;
  float la = step(lv, float(ga)), lb = step(lv, float(gb)), lc = step(lv, float(gc)), ld = step(lv, float(gd));
  float lcov = mix(mix(la, lb, f.x), mix(lc, ld, f.x), f.y);
  vec2 lgr = vec2(mix(lb - la, ld - lc, f.y), mix(lc - la, ld - lb, f.x)) / uTile;
  gShore = -(lcov - thrOf(uFirstLand, nf)) / max(length(lgr), 1e-3);

  gTop = -1;
  int prev = 9999;
  for (int k = 0; k < 4; k++) {
    int v = -1;
    if (ga < prev) v = max(v, ga);
    if (gb < prev) v = max(v, gb);
    if (gc < prev) v = max(v, gc);
    if (gd < prev) v = max(v, gd);
    if (v <= cand) break;
    float fv = float(v) - 0.5;
    float a = step(fv, float(ga)), b = step(fv, float(gb)), c = step(fv, float(gc)), d = step(fv, float(gd));
    float cov = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    vec2 gr = vec2(mix(b - a, d - c, f.y), mix(c - a, d - b, f.x)) / uTile;
    float dist = (cov - thrOf(v, nf)) / max(length(gr), 1e-3);
    if (dist > 0.0) { gTop = v; gDist = dist; break; }
    prev = v;
  }
  gAO = 99.0;
  if (gTop < 0) {
    gTop = cand < 0 ? R : cand;
    // Crisp edge distance: to each side whose neighbour is a different material.
    vec2 fr = fract(g);
    int rw = int(cellAt(ci + ivec2(-1, 0)).r), re = int(cellAt(ci + ivec2(1, 0)).r);
    int rn = int(cellAt(ci + ivec2(0, -1)).r), rs = int(cellAt(ci + ivec2(0, 1)).r);
    float d = 99.0;
    if (rw != gTop) d = min(d, fr.x * uTile);
    if (re != gTop) d = min(d, (1.0 - fr.x) * uTile);
    if (rn != gTop) d = min(d, fr.y * uTile);
    if (rs != gTop) d = min(d, (1.0 - fr.y) * uTile);
    gDist = d;
    if (cell.b == 0u) {
      if (cellAt(ci + ivec2(-1, 0)).b > 0u) gAO = min(gAO, fr.x * uTile);
      if (cellAt(ci + ivec2(1, 0)).b > 0u) gAO = min(gAO, (1.0 - fr.x) * uTile);
      if (cellAt(ci + ivec2(0, -1)).b > 0u) gAO = min(gAO, fr.y * uTile);
    }
  }
}

vec3 tone3(int m, float t) { return t < 0.42 ? mc(m, 0) : t < 0.6 ? mc(m, 1) : mc(m, 2); }

// Voronoi cells of the given size: returns the px distance to the nearest cell edge.
float stoneEdge(vec2 wp, float size, out vec2 id1) {
  vec2 p = wp / size;
  vec2 ip = floor(p);
  float f1 = 9.0, f2 = 9.0;
  id1 = ip;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y);
    vec2 pt = o + vec2(hash(ip + o), hash(ip + o + 5.3)) * 0.8 + 0.1;
    float d = length(p - ip - pt);
    if (d < f1) { f2 = f1; f1 = d; id1 = ip + o; } else if (d < f2) f2 = d;
  }
  return (f2 - f1) * size;
}

vec3 voronoiStone(vec2 wp, float size, int m, float mortarPx) {
  vec2 id;
  float e = stoneEdge(wp, size, id);
  return e < mortarPx ? mc(m, 0) * 0.7 : tone3(m, hash(id));
}

vec3 waterColor(int m, vec2 wp, vec2 cell, vec2 g) {
  float t = uTime;
  float n = fbm(wp * 0.03 + vec2(t * 0.05, t * 0.03)) * 0.7 + vnoise(wp * vec2(0.12, 0.3) + vec2(0.0, t * 0.6)) * 0.3;
  vec3 c = n < 0.42 ? mc(m, 0) : n < 0.58 ? mc(m, 1) : mc(m, 2);
  float shore = gShore;
  vec3 foamC = mAccent(m);
  vec3 shallow = mix(mc(m, 2), foamC, 0.3);
  if (shore < 5.0) c = shallow;
  else if (shore < 11.0) c = mix(c, shallow, 0.45);
  float phase = fract(t * 0.3 + fbm(g * 0.5) * 0.6);
  float ring = 12.0 * (1.0 - phase);
  if (abs(shore - ring) < 0.7 && hash(cell + floor(t * 3.0)) < phase * 1.1) c = mix(c, foamC, 0.6);
  float foam = 1.6 + 1.3 * sin(t * 1.7 + fbm(g * 0.8) * 9.0);
  if (shore < foam) c = foamC;
  else if (shore < foam + 1.0 && hash(cell) > 0.5) c = mix(foamC, mc(m, 2), 0.35);
  if (hash(cell + floor(t * 3.0)) > 0.998) c = mix(foamC, vec3(1.0), 0.3);
  return c;
}

// Molten rock: crust plates drift over a glowing flow, seams breathe, and the
// rim against land cools dark. Accent is the brightest glow (sparks).
vec3 lavaColor(int m, vec2 wp, vec2 cell) {
  float t = uTime;
  vec2 id;
  float e = stoneEdge(wp + vec2(t * 1.6, t * 0.9), 11.0, id);
  float heat = fbm(wp * 0.03 + vec2(t * 0.05, -t * 0.03));
  vec3 c = mc(m, 0) * (0.85 + hash(id) * 0.4);
  float seam = 1.2 + heat * 3.0 + sin(t * 1.5 + hash(id) * 6.3);
  if (e < seam) c = mix(mc(m, 1), mc(m, 2), smoothstep(0.35, 0.8, heat + 0.15 * sin(t * 2.0 + hash(id) * 9.0)));
  if (fbm(wp * 0.02 - t * 0.02) > 0.62) c = mix(c, mc(m, 2), 0.6);
  if (gShore < 2.5) c = mc(m, 0) * 0.55;
  else if (gShore < 4.0) c = mix(c, mc(m, 0), 0.5);
  if (hash(cell + floor(t * 5.0)) > 0.996) c = mAccent(m);
  return c;
}

// Colour of material m at a pixel, flat (no faces or shadows).
vec3 surface(int m, vec2 wp, vec2 cell, vec2 g, float edge) {
  int pat = mPattern(m);
  float prm = mParam(m);
  if (pat == P_WATER) return waterColor(m, wp, cell, g);
  if (pat == P_LAVA) return lavaColor(m, wp, cell);
  if (pat == P_METAL) {
    // 8 px plates with seams and corner rivets; param 1 adds hazard stripes.
    vec2 fp = mod(wp, 8.0);
    vec3 c = mc(m, 1) * (0.92 + vnoise(vec2(wp.x * 0.05, wp.y * 1.5)) * 0.12 + hash(floor(wp / 8.0)) * 0.06);
    if (prm > 0.0 && fract((wp.x + wp.y) / 10.0) < 0.5) c = mc(m, 2);
    if (fp.x < 0.6 || fp.y < 0.6) c = mc(m, 0);
    else if (fp.x > 7.4 || fp.y > 7.4) c = mc(m, 2) * 0.9;
    vec2 r = abs(fp - 4.0);
    if (r.x > 2.4 && r.x < 3.4 && r.y > 2.4 && r.y < 3.4) c = mc(m, 2) * 1.1;
    return c;
  }
  if (pat == P_GRATE) {
    vec2 fp = mod(wp, 4.0);
    vec3 c = fp.x < 1.0 || fp.y < 1.0 ? mc(m, 1) : mc(m, 0);
    if (fp.x < 0.5 && fp.y < 0.5) c = mc(m, 2);
    if (edge < 1.5) c = mc(m, 1) * 0.8;
    return c;
  }
  if (pat == P_TILES) {
    vec2 fp = mod(wp, 8.0);
    vec3 c = mix(mc(m, 1), mc(m, 2), hash(floor(wp / 8.0)) * 0.6);
    if (fp.x < 1.0 || fp.y < 1.0) c = mc(m, 0);
    return c;
  }
  if (pat == P_STARS) {
    vec3 c = mix(mc(m, 0), mc(m, 1), fbm(wp * 0.01));
    float tw = hash(cell + floor(uTime * 2.0 + hash(cell) * 9.0));
    if (hash(cell) > 0.992) c = mix(mc(m, 2), c, tw * 0.6);
    if (hash(floor(wp / 3.0)) > 0.9985) c = mc(m, 2);
    return c;
  }
  if (pat == P_GLASS) {
    vec3 c = mc(m, 1);
    if (fract((wp.x - wp.y) / 12.0) < 0.12) c = mc(m, 2);
    if (edge < 1.0) c = mc(m, 0);
    return c;
  }
  if (pat == P_GRASS) {
    float t = fbm(wp * 0.045) * 0.75 + vnoise(wp * 0.25) * 0.25 + (hash(cell) - 0.5) * 0.16;
    vec3 c = tone3(m, t);
    if (hash(cell) > 0.93) c = mc(m, 2) * 1.15;
    else if (hash(cell - vec2(0, 1)) > 0.93) c = mc(m, 0) * 0.85;
    float fl = prm > 0.0 ? 0.985 : 0.9975;
    if (hash(cell + 11.0) > fl) c = hash(cell + 3.0) > 0.5 ? rgb(232, 212, 76) : hash(cell + 4.0) > 0.5 ? rgb(226, 232, 240) : rgb(214, 110, 150);
    return c;
  }
  if (pat == P_DIRT) {
    float t = fbm(wp * 0.06) * 0.7 + vnoise(wp * 0.3) * 0.3 + (hash(cell) - 0.5) * 0.14;
    vec3 c = tone3(m, t);
    if (hash(cell + 3.0) > 0.985) c = mAccent(m);
    else if (hash(cell + vec2(3.0, 2.0)) > 0.985) c = mc(m, 0) * 0.8;
    if (prm > 0.0 && edge < 1.2) c = mc(m, 0) * 0.85;
    return c;
  }
  if (pat == P_SAND) {
    float t = fbm(wp * 0.03) * 0.7 + vnoise(wp * 0.2) * 0.3 + (hash(cell) - 0.5) * 0.12;
    vec3 c = tone3(m, t);
    if (hash(cell + 5.0) > 0.985) c = mc(m, 0) * 0.85;
    return c;
  }
  if (pat == P_SWAMP) {
    float t = fbm(wp * 0.05);
    vec3 c = tone3(m, t + (hash(cell) - 0.5) * 0.1);
    if (fbm(wp * 0.08 + 7.0) > 0.62) c = mix(c, rgb(40, 62, 52), 0.7);
    if (hash(cell + 2.0) > 0.99) c = rgb(110, 130, 60);
    return c;
  }
  if (pat == P_NEEDLES) {
    float t = fbm(wp * 0.07) * 0.6 + hash(cell) * 0.4;
    vec3 c = tone3(m, t);
    if (hash(cell + 8.0) > 0.96) c = rgb(110, 70, 40);
    return c;
  }
  if (pat == P_GRAVEL) {
    vec2 c2 = floor(wp / 2.0);
    vec3 c = tone3(m, hash(c2) * 0.7 + fbm(wp * 0.05) * 0.3);
    return c;
  }
  if (pat == P_FIELD) {
    float s = fract(g.y * 4.0 + (vnoise(g * 0.7) - 0.5) * 0.3);
    vec3 c = s < 0.45 ? mc(m, 0) : s < 0.6 ? mc(m, 2) : mc(m, 1);
    if (s > 0.5 && hash(cell + 7.0) > 0.9) c = rgb(98, 142, 52);
    if (edge < 1.5) c = mc(m, 0) * 0.85;
    return c;
  }
  if (pat == P_COBBLE) {
    vec3 c = voronoiStone(wp, 4.5, m, 1.1);
    if (edge < 1.2) c = mc(m, 0) * 0.65;
    return c;
  }
  if (pat == P_FLAGS) {
    vec2 p = wp / vec2(8.0, 6.0);
    p.x += floor(p.y) * 0.5;
    vec2 ip = floor(p), fp = fract(p);
    vec3 c = tone3(m, hash(ip) * 0.8 + fbm(wp * 0.08) * 0.2);
    if (fp.x < 0.125 || fp.y < 0.17) c = mc(m, 0) * 0.75;
    return c;
  }
  if (pat == P_PLANKS) {
    float bw = prm > 1.5 ? 6.0 : 4.0;
    float row = floor(wp.y / bw);
    float off = hash(vec2(row, 1.0)) * 24.0;
    float seg = floor((wp.x + off) / 24.0);
    vec3 c = tone3(m, hash(vec2(seg, row)) * 0.8 + vnoise(wp * vec2(0.3, 2.0)) * 0.2);
    if (fract(wp.y / bw) < 1.0 / bw || fract((wp.x + off) / 24.0) < 0.04) c = mc(m, 0) * 0.7;
    if (prm > 1.5 && fract((wp.x + off) / 6.0) < 0.17 && fract(wp.y / bw) > 0.4 && fract(wp.y / bw) < 0.6) c = mc(m, 0);
    if (prm > 0.5 && prm < 1.5 && edge < 2.0) c = mc(m, 0) * 0.6;
    return c;
  }
  if (pat == P_SNOW) {
    float t = fbm(wp * 0.04) * 0.8 + (hash(cell) - 0.5) * 0.1;
    vec3 c = t < 0.5 ? mc(m, 1) : mc(m, 2);
    if (edge < 2.5) c = mc(m, 0);
    if (hash(cell + 9.0) > 0.996) c = vec3(1.0);
    return c;
  }
  if (pat == P_ROCK) {
    // Rock tops stay dark so they read as solid; raised rock shows its lit
    // colour (c2) on the front face instead.
    float t = fbm(wp * 0.05) * 0.7 + vnoise(wp * 0.35) * 0.3;
    vec3 c = mix(mc(m, 0), mc(m, 1), smoothstep(0.3, 0.7, t));
    vec2 id;
    if (stoneEdge(wp, 9.0, id) < 0.8) c *= 0.8;
    if (mHeight(m) == 0.0) c = tone3(m, t);
    return c;
  }
  if (pat == P_STAIRS) {
    vec2 fr = fract(g);
    float step5 = floor(fr.y * 5.0);
    float k = prm > 0.0 ? 1.0 - step5 / 4.0 : step5 / 4.0;
    vec3 c = mix(mc(m, 2), mc(m, 0), k);
    if (fract(fr.y * 5.0) < 0.2) c *= 0.6;
    if (fr.x < 0.08 || fr.x > 0.92) c = mc(m, 0) * 0.6;
    return c;
  }
  if (pat == P_HOLE) {
    vec2 fr = fract(g) - 0.5;
    float d = length(fr * vec2(1.0, 1.3));
    return d < 0.3 ? mc(m, 0) : d < 0.42 ? mc(m, 1) : mc(m, 2);
  }
  if (pat == P_CARPET) {
    if (edge < 2.0) return mc(m, 2);
    if (edge < 3.0) return mc(m, 0);
    vec2 p = abs(fract(wp / 8.0) - 0.5);
    return (p.x + p.y < 0.18) ? mc(m, 2) * 0.8 : mc(m, 1);
  }
  if (pat == P_WALL) {
    vec3 c = mc(m, 2) * (0.92 + vnoise(wp * 0.4) * 0.12);
    if (edge < 1.0) c = mc(m, 0);
    return c;
  }
  if (pat == P_HEDGE) {
    float t = fbm(wp * 0.2) * 0.6 + hash(floor(wp / 2.0)) * 0.4;
    vec3 c = tone3(m, t);
    if (edge < 1.0) c = mc(m, 0);
    return c;
  }
  if (pat == P_AIR) return mc(m, 1);
  return mc(m, 1);
}

// A wall's front face, d px above its bottom edge.
vec3 face(int m, vec2 wp, float d, float h) {
  int pat = mPattern(m);
  vec3 c = mc(m, 1) * 0.78;
  if (pat == P_WALL && mParam(m) > 2.5) {
    // Logs: stacked rounds, lit on top, dark between.
    float k = fract(wp.y / 4.0);
    c = mix(mc(m, 2), mc(m, 1), smoothstep(0.0, 1.0, k)) * (0.85 + vnoise(vec2(wp.x * 0.3, floor(wp.y / 4.0))) * 0.25);
    if (k > 0.8) c = mc(m, 0);
  } else if (pat == P_WALL && mParam(m) > 1.5) {
    // Hull panels with a blinking light strip.
    c = mc(m, 1) * (0.85 + hash(vec2(floor(wp.x / 10.0), 1.0)) * 0.15);
    if (fract(wp.x / 10.0) < 0.1 || d < 1.0 || d > h - 1.0) c = mc(m, 0);
    if (abs(d - h * 0.55) < 0.6 && fract(wp.x / 10.0) > 0.3 && fract(wp.x / 10.0) < 0.7)
      c = hash(vec2(floor(wp.x / 10.0), floor(uTime * 1.5))) > 0.3 ? mAccent(m) : mc(m, 0);
  } else if (pat == P_GLASS) {
    c = mix(mc(m, 1), mc(m, 0), 0.4);
    if (fract((wp.x - d) / 10.0) < 0.15) c = mc(m, 2);
    if (d > h - 1.0) c = mc(m, 2);
  } else if (pat == P_WALL) {
    if (mParam(m) > 0.0) {
      float row = floor(wp.y / 3.0);
      float bx = fract((wp.x + row * 3.0) / 6.0);
      c = mc(m, 1) * (0.7 + hash(vec2(floor((wp.x + row * 3.0) / 6.0), row)) * 0.15);
      if (fract(wp.y / 3.0) < 0.34 || bx < 0.17) c = mc(m, 0);
    } else {
      c = mc(m, 1) * (0.88 + vnoise(wp * 0.5) * 0.1);
      if (d > h - 1.5 || d < 1.5) c = mc(m, 0);
      if (fract(wp.x / 7.0) < 0.15) c = mc(m, 0) * 1.1;
    }
  } else if (pat == P_ROCK) {
    c = mc(m, 2) * (0.75 + vnoise(vec2(wp.x * 0.6, wp.y * 0.08)) * 0.35);
    if (d > h - 1.5) c = mc(m, 2) * 1.15;
  } else if (pat == P_HEDGE) {
    c = mc(m, 0) * (0.9 + hash(floor(wp / 2.0)) * 0.3);
  }
  if (d < 1.0) c *= 0.7;
  return c;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 wp = floor(px) + 0.5 - uCenter + uCamPx;
  vec2 cell = floor(wp);
  vec2 g = wp / uTile;
  ivec2 ci = ivec2(floor(g));
  uvec4 here = cellAt(ci);
  float nf = uMode == 2 ? 0.0 : noiseField(g);

  pickTop(g, nf);
  int top = gTop;
  vec3 col;

  if (uMode == 1) {
    col = mc(int(here.r), 1);
  } else {
    int pat = mPattern(top);
    if (pat == P_FENCE) {
      int base = int(here.g);
      col = surface(base, wp, cell, g, 99.0);
      // Rails toward fence neighbours, a post in the middle.
      vec2 fr = fract(g) - 0.5;
      bool e = int(cellAt(ci + ivec2(1, 0)).r) == top, w = int(cellAt(ci + ivec2(-1, 0)).r) == top;
      bool n = int(cellAt(ci + ivec2(0, -1)).r) == top, s = int(cellAt(ci + ivec2(0, 1)).r) == top;
      float rail = 99.0;
      if (e && fr.x > 0.0 || w && fr.x < 0.0 || !(n || s)) rail = min(rail, abs(fr.y + 0.05));
      if (n && fr.y < 0.0 || s && fr.y > 0.0) rail = min(rail, abs(fr.x));
      if (abs(fr.y - 0.12) < 0.08 && abs(fr.x) < 0.25 && (e || w || !(n || s))) col *= 0.7;
      if (rail * uTile < 1.5) col = rail * uTile < 0.6 ? mc(top, 2) : mc(top, 1);
      if (max(abs(fr.x), abs(fr.y + 0.05)) * uTile < 2.0) col = mc(top, 0);
    } else if (pat == P_AIR) {
      col = mc(top, 1);
      if (uHasBelow == 1) {
        uvec4 b = texelFetch(uBelow, ci, 0);
        col = mix(col, mc(int(b.r), 1), 0.28);
      }
    } else {
      col = surface(top, wp, cell, g, gDist);
      float h = mHeight(top);
      if (h > 0.0 && uMode == 0) {
        // Front face: the bottom h px of a raised material, where the point h
        // px further south is no longer inside it.
        vec2 gs = g + vec2(0.0, h / uTile);
        bool inside;
        if (mSoft(top)) inside = softCov(gs, top) - thrOf(top, noiseField(gs)) > 0.0;
        else inside = cellAt(ivec2(floor(gs))).b > 0u;
        if (!inside) {
          float d;
          if (mSoft(top)) d = h * 0.5; // depth unknown for soft edges; mid tone
          else d = (1.0 - fract(g.y)) * uTile;
          col = face(top, wp, d, h);
          if (!mSoft(top) && d > h - 1.0) col = mc(top, 0);
        }
      }
    }
    if (uMode == 0 && mHeight(top) == 0.0) {
      // Shadow south of raised things, and a little ambient dark at the foot of walls.
      if (raisedCov(g - vec2(0.12, 0.3)) > 0.5) col *= 0.72;
      if (gAO < 2.0) col *= 0.8;
    }
  }

  if (uMode == 3 && mSolid(top)) col = mix(col, rgb(220, 40, 40), 0.45);

  if (uLight > 0.0 && uMode != 1) {
    float d = length(px - uCenter) / uTile;
    float flick = 0.3 * sin(uTime * 7.0) + 0.2 * sin(uTime * 13.0);
    float lit = mix(0.18, 1.0, smoothstep(uLight + 1.5 + flick, uLight * 0.35, d));
    if (mGlow(top)) lit = max(lit, 0.95);
    col *= lit;
  }

  if (uGrid == 1) {
    vec2 f = fract(g);
    vec2 dpx = min(f, 1.0 - f) * uTile;
    if (min(dpx.x, dpx.y) < 0.6) col = mix(col, vec3(0.0), 0.3);
  }
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`);
    const m = /ERROR: 0:(\d+)/.exec(log);
    throw new Error(log + (m ? '\n' + lines.slice(+m[1] - 3, +m[1] + 2).join('\n') : ''));
  }
  return s;
}

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Without an accent, water foams white and everything else specks a little
// lighter than its light tone.
export function defaultAccent(m) {
  if (m.pattern === 'water') return '#e2f0ec';
  if (m.pattern === 'lava') return '#fff0a0';
  const [r, g, b] = hex(m.colors[2]).map(v => Math.min(255, Math.round(v * 1.2)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function intTexture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createTerrain(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const texMap = intTexture(gl), texBelow = intTexture(gl), texMat = intTexture(gl);
  const u = {};
  for (const name of ['uMap', 'uBelow', 'uMat', 'uMapSize', 'uRes', 'uCenter', 'uCamPx', 'uTile', 'uTime', 'uNoise', 'uLight',
    'uMode', 'uGrid', 'uFirstLand', 'uOob', 'uHasBelow']) u[name] = gl.getUniformLocation(prog, name);
  let size = [1, 1], hasBelow = 0, oob = 0, firstLand = 0;

  const upload = (tex, w, h, bytes) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, bytes);
  };

  return {
    // materials: the doc's material table.
    setMaterials(materials) {
      const b = new Uint8Array(materials.length * 20);
      materials.forEach((m, i) => {
        const o = i * 20;
        m.colors.forEach((c, k) => b.set(hex(c), o + k * 4));
        b[o + 3] = Math.max(0, PATTERNS.indexOf(m.pattern));
        b[o + 7] = m.soft ? 1 : 0;
        b[o + 11] = Math.round(m.height || 0);
        b[o + 12] = Math.round((m.noise || 0) * 255);
        b[o + 13] = Math.round(m.param || 0);
        b[o + 14] = m.solid ? 1 : 0;
        b.set(hex(m.accent || defaultAccent(m)), o + 16);
        b[o + 19] = m.glow ? 1 : 0;
      });
      upload(texMat, 5, materials.length, b);
      // Shore effects measure to the first material after the liquids at the bottom of the stack.
      firstLand = Math.max(0, materials.findIndex(m => m.pattern !== 'water' && m.pattern !== 'lava'));
    },
    // floor: {w, h, cells: Uint8Array RGBA}; below: same or null; oobId: material outside the map.
    setFloor(w, h, cells, below, oobId) {
      upload(texMap, w, h, cells);
      if (below) upload(texBelow, w, h, below);
      else upload(texBelow, 1, 1, new Uint8Array(4));
      hasBelow = below ? 1 : 0;
      size = [w, h];
      oob = oobId;
    },
    render(p) {
      gl.viewport(0, 0, p.res[0], p.res[1]);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      [[texMap, 'uMap'], [texBelow, 'uBelow'], [texMat, 'uMat']].forEach(([t, n], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(u[n], i);
      });
      gl.uniform2i(u.uMapSize, size[0], size[1]);
      gl.uniform2f(u.uRes, p.res[0], p.res[1]);
      gl.uniform2f(u.uCenter, p.center[0], p.center[1]);
      gl.uniform2f(u.uCamPx, p.camPx[0], p.camPx[1]);
      gl.uniform1f(u.uTile, p.tile);
      gl.uniform1f(u.uTime, p.time);
      gl.uniform1f(u.uNoise, p.noise);
      gl.uniform1f(u.uLight, p.light);
      gl.uniform1i(u.uMode, p.mode);
      gl.uniform1i(u.uGrid, p.grid ? 1 : 0);
      gl.uniform1i(u.uFirstLand, firstLand);
      gl.uniform1i(u.uOob, oob);
      gl.uniform1i(u.uHasBelow, hasBelow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
