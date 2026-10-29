import { createTerrain } from './terrain.js';
import { createProps, FLAT, FLAME } from './props.js';
import { makeCharacter } from './sprites.js';

const TILE = 16;
const CHUNK = 16;
// Props that grow out of the ground get a little offset inside their cell.
const JITTER = new Set(['tree', 'pine', 'bare', 'bush', 'rock', 'stalagmite', 'crystal', 'mushrooms', 'reeds', 'fern', 'flowers', 'pebbles', 'stump', 'log']);
// Props that hang on a wall cell sit low on its front face.
const ON_WALL = new Set(['window', 'torch', 'banner']);

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function floorName(dz) {
  if (dz === 0) return 'ground';
  return dz > 0 ? `storey +${dz}` : `underground ${dz}`;
}

export function createGame(glCanvas, ovCanvas, miniCanvas) {
  const gl = glCanvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const ctx = ovCanvas.getContext('2d');
  const mini = miniCanvas.getContext('2d');
  const terrain = createTerrain(gl);
  const props = createProps();
  const hero = makeCharacter();

  const S = {
    doc: null, floors: new Map(), dz: 0, floor: null,
    mats: [], soft: [], solid: [], theme: { materials: {}, props: {} },
    player: { x: 0, y: 0, dir: 'down', dist: 0, moving: false },
    cam: { x: 0, y: 0 }, keys: new Set(),
    armed: true, portals: new Map(),
    view: { scale: 3, mode: 0, noise: 1, grid: false, labels: true, minimap: true, noclip: false },
    res: [1, 1], fps: 0, flash: 0, flashText: '',
    onStatus: () => {},
  };

  // ---- loading ---------------------------------------------------------------------------
  function load(doc, keepPlayer) {
    S.doc = doc;
    S.soft = doc.materials.map(m => !!m.soft);
    S.solid = doc.materials.map(m => !!m.solid);
    S.floors = new Map();
    for (const f of doc.floors) S.floors.set(f.dz, buildFloor(doc, f));
    applyTheme();
    S.portals = new Map();
    for (const p of doc.portals) S.portals.set(`${p.from.x},${p.from.y},${p.from.dz}`, p);
    const at = keepPlayer && S.floors.has(S.dz) ? { x: S.player.x, y: S.player.y, dz: S.dz } : { x: doc.spawn.x + 0.5, y: doc.spawn.y + 0.5, dz: doc.spawn.dz };
    setFloor(at.dz);
    S.player.x = at.x; S.player.y = at.y;
    S.cam.x = at.x; S.cam.y = at.y;
    S.armed = !portalAt(at.x, at.y);
  }

  function buildFloor(doc, f) {
    const w = doc.w, h = doc.h;
    const cells = b64(f.cells);
    const list = [];
    const buckets = new Map();
    const colliders = new Map();
    const P = f.props;
    for (let i = 0; i < P.length; i += 4) {
      const kind = doc.prop_kinds[P[i]], x = P[i + 1], y = P[i + 2], v = P[i + 3];
      let px = x + 0.5, py = y + 0.5;
      if (JITTER.has(kind.draw)) { px += ((v & 15) / 15 - 0.5) * 0.36; py += (((v >> 4) & 15) / 15 - 0.5) * 0.36; }
      if (ON_WALL.has(kind.draw)) py = y + 0.95;
      const p = { kind, x: px, y: py, v, cx: x, cy: y };
      list.push(p);
      const key = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
      if (kind.solid) {
        const ci = y * w + x;
        if (!colliders.has(ci)) colliders.set(ci, []);
        colliders.get(ci).push(p);
      }
    }
    // Material outside the map: the most common one along the border.
    const count = new Map();
    const add = (x, y) => { const r = cells[(y * w + x) * 4]; count.set(r, (count.get(r) || 0) + 1); };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    const oob = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { dz: f.dz, cells, list, buckets, colliders, oob, blocked: new Set(f.blocked || []), open: new Set(f.open || []), miniImg: null };
  }

  // Only the look changes with a theme: what is solid or soft stays the doc's.
  const VISUAL = ['pattern', 'colors', 'accent', 'glow', 'noise', 'param'];
  function themed(materials, theme) {
    return materials.map(m => {
      const o = (theme.materials || {})[m.name];
      if (!o) return m;
      const out = { ...m };
      for (const k of VISUAL) if (k in o) out[k] = o[k];
      return out;
    });
  }

  function applyTheme() {
    if (!S.doc) return;
    S.mats = themed(S.doc.materials, S.theme);
    terrain.setMaterials(S.mats);
    props.setFilter(S.theme.prop_filter);
    for (const f of S.floors.values()) f.miniImg = null;
  }

  function propLook(kind) {
    const all = S.theme.props || {};
    const o = all[kind.key] || all[kind.draw];
    if (!o) return kind;
    return { ...kind, draw: o.draw || kind.draw, color: 'color' in o ? o.color : kind.color };
  }

  function setFloor(dz) {
    S.dz = dz;
    S.floor = S.floors.get(dz);
    const below = dz > 0 && S.floors.get(dz - 1);
    terrain.setFloor(S.doc.w, S.doc.h, S.floor.cells, below ? below.cells : null, S.floor.oob);
  }

  // ---- collision -------------------------------------------------------------------------
  const cellR = (f, x, y) => (x < 0 || y < 0 || x >= S.doc.w || y >= S.doc.h ? f.oob : f.cells[(y * S.doc.w + x) * 4]);
  const cellG = (f, x, y) => (x < 0 || y < 0 || x >= S.doc.w || y >= S.doc.h ? f.oob : f.cells[(y * S.doc.w + x) * 4 + 1]);

  // The material drawn at a grid point, picked like the shader does but without noise.
  function topAt(f, gx, gy) {
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const R = cellR(f, ix, iy);
    const cand = S.soft[R] ? -1 : R;
    const qx = gx - 0.5, qy = gy - 0.5;
    const x0 = Math.floor(qx), y0 = Math.floor(qy), fx = qx - x0, fy = qy - y0;
    const gs = [cellG(f, x0, y0), cellG(f, x0 + 1, y0), cellG(f, x0, y0 + 1), cellG(f, x0 + 1, y0 + 1)];
    const wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const vals = [...new Set(gs)].sort((a, b) => b - a);
    for (const v of vals) {
      if (v <= cand) break;
      let cov = 0;
      for (let k = 0; k < 4; k++) if (gs[k] >= v) cov += wt[k];
      if (cov >= 0.5) return v;
    }
    return cand >= 0 ? cand : R;
  }

  function walkable(gx, gy) {
    const f = S.floor, w = S.doc.w;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    if (ix < 0 || iy < 0 || ix >= w || iy >= S.doc.h) return false;
    const ci = iy * w + ix;
    if (f.blocked.has(ci)) return false;
    if (!f.open.has(ci) && S.solid[topAt(f, gx, gy)]) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const list = f.colliders.get((iy + dy) * w + ix + dx);
        if (!list) continue;
        for (const p of list) {
          if (p.kind.solid === 'cell') {
            if (gx > p.cx + 0.08 && gx < p.cx + 0.92 && gy > p.cy + 0.08 && gy < p.cy + 0.92) return false;
          } else if (Math.hypot(gx - p.x, gy - p.y) < (p.kind.r || 0.3)) return false;
        }
      }
    return true;
  }

  // The walker's feet are a small box, not a point, so it cannot hug into walls.
  const FEET = [[-0.2, -0.08], [0.2, -0.08], [-0.2, 0.1], [0.2, 0.1]];
  const feetFree = (x, y) => S.view.noclip || FEET.every(([dx, dy]) => walkable(x + dx, y + dy));

  function portalAt(x, y) {
    return S.portals.get(`${Math.floor(x)},${Math.floor(y)},${S.dz}`);
  }

  function travel(p) {
    if (p.to.dz !== S.dz) setFloor(p.to.dz);
    S.player.x = p.to.x + 0.5; S.player.y = p.to.y + 0.5;
    S.cam.x = S.player.x; S.cam.y = S.player.y;
    S.armed = false;
    S.flash = 1.2;
    S.flashText = p.to.dz > p.from.dz ? 'up' : p.to.dz < p.from.dz ? 'down' : 'through';
  }

  // Put the walker at a cell (minimap click, site list), on the nearest open spot.
  function teleport(x, y, dz) {
    if (!S.floors.has(dz)) return;
    if (dz !== S.dz) setFloor(dz);
    const w = S.doc.w, h = S.doc.h;
    for (let r = 0; r < 40; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx + 0.5, cy = y + dy + 0.5;
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          if (feetFree(cx, cy) && !portalAt(cx, cy)) {
            S.player.x = cx; S.player.y = cy; S.cam.x = cx; S.cam.y = cy;
            S.armed = true;
            return;
          }
        }
  }

  // ---- update ----------------------------------------------------------------------------
  function update(dt) {
    if (!S.doc) return;
    const k = S.keys;
    let sx = 0, sy = 0;
    if (k.has('a') || k.has('arrowleft')) sx -= 1;
    if (k.has('d') || k.has('arrowright')) sx += 1;
    if (k.has('w') || k.has('arrowup')) sy -= 1;
    if (k.has('s') || k.has('arrowdown')) sy += 1;
    const p = S.player;
    p.moving = sx !== 0 || sy !== 0;
    if (p.moving) {
      p.dir = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : sy > 0 ? 'down' : 'up';
      const len = Math.hypot(sx, sy);
      const speed = (k.has('shift') ? (S.view.noclip ? 24 : 7) : 3.4) * dt;
      const mx = (sx / len) * speed, my = (sy / len) * speed;
      const bx = p.x, by = p.y;
      if (feetFree(p.x + mx, p.y)) p.x += mx;
      if (feetFree(p.x, p.y + my)) p.y += my;
      p.dist += Math.hypot(p.x - bx, p.y - by);
    }
    const here = portalAt(p.x, p.y);
    if (!here) S.armed = true;
    else if (S.armed) travel(here);
    S.cam.x += (p.x - S.cam.x) * Math.min(1, dt * 8);
    S.cam.y += (p.y - S.cam.y) * Math.min(1, dt * 8);
    S.flash = Math.max(0, S.flash - dt);
  }

  // ---- draw ------------------------------------------------------------------------------
  function resize() {
    const s = S.view.scale;
    const w = Math.ceil(innerWidth / s), h = Math.ceil(innerHeight / s);
    for (const c of [glCanvas, ovCanvas]) { c.width = w; c.height = h; }
    S.res = [w, h];
  }

  function draw(time) {
    if (!S.doc) return;
    const [W, H] = S.res;
    const camPx = [Math.round(S.cam.x * TILE), Math.round(S.cam.y * TILE)];
    const center = [Math.floor(W / 2), Math.floor(H / 2)];
    const light = S.dz < 0 ? 7 : S.theme.surface_light || 0;
    terrain.render({ res: S.res, center, camPx, tile: TILE, time, noise: S.view.noise, light, mode: S.view.mode, grid: S.view.grid });

    ctx.clearRect(0, 0, W, H);
    const proj = (gx, gy) => [Math.round(gx * TILE - camPx[0] + center[0]), Math.round(gy * TILE - camPx[1] + center[1])];
    const showProps = S.view.mode === 0 || S.view.mode === 3;

    const flats = [], stand = [];
    if (showProps) {
      const x0 = Math.floor((S.cam.x - W / 2 / TILE - 2) / CHUNK), x1 = Math.floor((S.cam.x + W / 2 / TILE + 2) / CHUNK);
      const y0 = Math.floor((S.cam.y - H / 2 / TILE - 2) / CHUNK), y1 = Math.floor((S.cam.y + H / 2 / TILE + 3) / CHUNK);
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const b = S.floor.buckets.get(cx + ',' + cy);
          if (!b) continue;
          for (const p of b) (FLAT.has(p.kind.draw) ? flats : stand).push(p);
        }
    }
    const drawProp = p => {
      const look = propLook(p.kind);
      const s = props.get(look.draw, look.color, p.v);
      const [x, y] = proj(p.x, p.y);
      if (!FLAT.has(look.draw) && !ON_WALL.has(look.draw)) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(3, s.img.width * 0.3), 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.drawImage(s.img, x - s.ax, y - s.ay);
      const fl = FLAME[look.draw];
      if (fl !== undefined) flame(x - s.ax + (fl ? fl[0] : 3), y - s.ay + (fl ? fl[1] : 1), time, p.v);
    };
    for (const p of flats) drawProp(p);

    const items = stand.map(p => ({ y: p.y, fn: () => drawProp(p) }));
    items.push({ y: S.player.y, fn: () => drawPlayer(proj) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.fn();
    if (light > 0 && S.view.mode !== 1) {
      // The same falloff the shader gives the ground, on the sprites only.
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      const g = ctx.createRadialGradient(center[0], center[1], light * 0.35 * TILE, center[0], center[1], (light + 1.5) * TILE);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.82)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (S.view.labels) drawLabels(proj, W, H);
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, S.flash) * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (S.view.minimap) drawMinimap();
  }

  function flame(x, y, t, v) {
    const f = Math.floor(t * 10 + v) % 3;
    ctx.fillStyle = '#e8601c'; ctx.fillRect(x - 1, y - 2, 3, 3);
    ctx.fillStyle = '#f8b040'; ctx.fillRect(x, y - 3 - (f === 1 ? 1 : 0), 1, 3);
    ctx.fillStyle = 'rgba(255,190,90,0.12)';
    ctx.beginPath(); ctx.arc(x + 0.5, y, 7 + f, 0, Math.PI * 2); ctx.fill();
  }

  function drawPlayer(proj) {
    const p = S.player;
    const [x, y] = proj(p.x, p.y);
    const step = p.moving ? [1, 0, 2, 0][Math.floor(p.dist * 5) % 4] : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - 4, y - 1, 8, 2);
    ctx.fillRect(x - 3, y - 2, 6, 1);
    ctx.drawImage(hero.frames[p.dir][step], x - 6, y - hero.h + 1);
  }

  function drawLabels(proj, W, H) {
    ctx.font = '8px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const l of S.doc.labels) {
      // Long texts (dungeon stories) belong in a panel, not on the ground.
      if ((l.dz || 0) !== S.dz || l.kind === 'note' || l.text.length > 32) continue;
      const [x, y] = proj(l.x, l.y);
      if (x < -80 || y < -20 || x > W + 80 || y > H + 20) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(l.text, x + 1, y + 1);
      ctx.fillStyle = l.kind === 'title' ? '#f0d890' : 'rgba(240,235,220,0.85)';
      ctx.fillText(l.text, x, y);
    }
  }

  // ---- minimap ---------------------------------------------------------------------------
  function miniImage(f) {
    if (f.miniImg) return f.miniImg;
    const w = S.doc.w, h = S.doc.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    const cols = S.mats.map(m => [1, 3, 5].map(i => parseInt(m.colors[1].slice(i, i + 2), 16)));
    for (let i = 0; i < w * h; i++) {
      const col = cols[f.cells[i * 4]] || [255, 0, 255];
      img.data.set(col, i * 4);
      img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    f.miniImg = c;
    return c;
  }

  const MINI = 200;
  function miniScale() { return Math.min(MINI / S.doc.w, MINI / S.doc.h); }

  function drawMinimap() {
    const k = miniScale();
    const w = Math.round(S.doc.w * k), h = Math.round(S.doc.h * k);
    if (miniCanvas.width !== w || miniCanvas.height !== h) { miniCanvas.width = w; miniCanvas.height = h; }
    mini.imageSmoothingEnabled = k < 1;
    mini.drawImage(miniImage(S.floor), 0, 0, w, h);
    mini.lineWidth = 1;
    for (const z of S.doc.zones) {
      if (z.kind !== 'site' || (z.dz || 0) !== S.dz) continue;
      mini.strokeStyle = 'rgba(232,184,74,0.7)';
      mini.strokeRect(z.rect.X * k + 0.5, z.rect.Y * k + 0.5, z.rect.W * k, z.rect.H * k);
    }
    for (const p of S.doc.portals) {
      if (p.from.dz !== S.dz) continue;
      mini.fillStyle = p.to.dz < p.from.dz ? '#ff6a4a' : '#6ad0ff';
      mini.fillRect(p.from.x * k - 1, p.from.y * k - 1, 3, 3);
    }
    const [W, H] = S.res;
    mini.strokeStyle = 'rgba(255,255,255,0.6)';
    mini.strokeRect((S.cam.x - W / 2 / TILE) * k, (S.cam.y - H / 2 / TILE) * k, (W / TILE) * k, (H / TILE) * k);
    mini.fillStyle = '#fff';
    mini.fillRect(S.player.x * k - 2, S.player.y * k - 2, 4, 4);
  }

  miniCanvas.addEventListener('pointerdown', e => {
    if (!S.doc) return;
    const r = miniCanvas.getBoundingClientRect();
    const k = miniScale() * (r.width / miniCanvas.width);
    teleport(Math.floor((e.clientX - r.left) / k), Math.floor((e.clientY - r.top) / k), S.dz);
  });

  // ---- status ----------------------------------------------------------------------------
  function status() {
    if (!S.doc) return null;
    const p = S.player, x = Math.floor(p.x), y = Math.floor(p.y);
    let zone = null;
    for (const z of S.doc.zones) {
      if ((z.dz || 0) !== S.dz || !z.name) continue;
      const r = z.rect;
      if (x >= r.X && y >= r.Y && x < r.X + r.W && y < r.Y + r.H && (!zone || r.W * r.H < zone.rect.W * zone.rect.H)) zone = z;
    }
    const mat = S.mats[topAt(S.floor, p.x, p.y)];
    const portal = portalAt(p.x, p.y);
    return { x, y, dz: S.dz, floor: floorName(S.dz), zone, material: mat && mat.name, portal, fps: S.fps };
  }

  let last = performance.now(), frames = 0, fpsT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frames++; fpsT += dt;
    if (fpsT > 0.5) { S.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
    update(dt);
    draw(now / 1000);
    S.onStatus(status());
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(frame);

  return {
    state: S, load, resize, teleport, status, themed,
    setTheme(theme) { S.theme = theme || { materials: {}, props: {} }; applyTheme(); },
    // Materials as the current theme shows them.
    materials: () => S.mats,
    setView(v) { Object.assign(S.view, v); if ('scale' in v) resize(); },
    floors: () => [...S.floors.keys()].sort((a, b) => a - b),
  };
}
