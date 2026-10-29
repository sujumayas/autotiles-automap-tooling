// Props drawn in code, one small canvas per (draw, color, variant). Each
// drawer returns { img, ax, ay }: the anchor pixel that sits on the prop's
// ground point. Trees and bushes follow auto-tiles; the rest are simple
// pixel shapes, enough to read what an object is and where it blocks.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function seeded(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function sprite(w, h, ax, ay, fn) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const px = (x, y, ww, hh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, ww, hh); };
  fn(px, ctx);
  return { img: c, ax, ay };
}

// Filled box with a dark outline and a lighter top edge.
function box(px, x, y, w, h, fill, dark, light) {
  px(x, y, w, h, dark);
  px(x + 1, y + 1, w - 2, h - 2, fill);
  if (light) px(x + 1, y + 1, w - 2, 1, light);
}

const TREE_COLORS = {
  oak: ['#1c3315', '#2f5a22', '#3d7a2c', '#58993a', '#74b04a'],
  fruit: ['#1c3315', '#2f5a22', '#3d7a2c', '#58993a', '#c8483a'],
  willow: ['#1f3a22', '#3a6a3a', '#4f8048', '#6a9a58', '#88b070'],
  palm: ['#1c3315', '#3a6a22', '#4f8a2c', '#68a038', '#88b84a'],
  autumn: ['#3a1a0c', '#8f4317', '#c0661f', '#e08c30', '#f0b050'],
  pine: ['#10261a', '#1f4630', '#2d5e3d', '#3f7a4c', '#5a9660'],
  crimson: ['#2a0c0c', '#6a1a18', '#9a2a22', '#c0402c', '#e06a40'],
  gold: ['#3a2a0c', '#7a5a14', '#a8801e', '#d0a830', '#f0d060'],
  frost: ['#2a3a44', '#6a8a98', '#9ab8c4', '#c8dce4', '#eef6fa'],
  candy: ['#5a1a3a', '#c04a88', '#e070a8', '#f4a0c8', '#fff0f6'],
  mint: ['#0e4a3a', '#2a9a78', '#4ac09a', '#80e0c0', '#d0fff0'],
  toxic: ['#1e2a0a', '#4a6a10', '#7a9a18', '#a8c820', '#e0f040'],
  alien: ['#140a2a', '#3a1a6a', '#5a2a9a', '#20b0b0', '#70fff0'],
  ash: ['#141210', '#2a2622', '#3e3934', '#56504a', '#6e6760'],
};

function roundTree(seed, color) {
  const rnd = seeded(seed);
  const pal = TREE_COLORS[color] || TREE_COLORS.oak;
  const W = 22, H = 28, c = canvas(W, H), ctx = c.getContext('2d');
  const cx = 11, cy = 10, R = 7.5 + rnd() * 1.5;
  ctx.fillStyle = color === 'palm' ? '#8a6a40' : '#4a3020';
  ctx.fillRect(cx - 1, cy + 4, 3, H - cy - 5);
  ctx.fillStyle = '#2e1d10';
  ctx.fillRect(cx + 1, cy + 4, 1, H - cy - 5);
  const bumps = Array.from({ length: 7 }, () => rnd() * 1.6);
  const inside = (x, y) => {
    const a = Math.atan2(y - cy, x - cx);
    const k = (a / (Math.PI * 2) + 0.5) * 7;
    const i = Math.floor(k) % 7, j = (i + 1) % 7, f = k - Math.floor(k);
    return Math.hypot(x - cx, (y - cy) * 1.1) < R + bumps[i] * (1 - f) + bumps[j] * f;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const edge = !inside(x + 1.5, y + 0.5) || !inside(x - 0.5, y + 0.5) || !inside(x + 0.5, y + 1.5) || !inside(x + 0.5, y - 0.5);
      const light = ((x - cx) * 0.55 + (y - cy) * 0.85) / R + (rnd() - 0.5) * 0.35;
      let tone = edge ? 0 : light > 0.45 ? 1 : light > -0.05 ? 2 : light > -0.5 ? 3 : 4;
      if (!edge && rnd() > 0.9) tone = Math.max(1, tone - 1);
      if (color !== 'fruit' && tone === 4 && rnd() > 0.5) tone = 3;
      if (color === 'fruit' && tone === 4 && rnd() > 0.35) tone = 3;
      ctx.fillStyle = pal[tone];
      ctx.fillRect(x, y, 1, 1);
    }
  return { img: c, ax: cx, ay: H - 1 };
}

function pineTree(seed, color) {
  const rnd = seeded(seed);
  const snowy = color === 'snow';
  const W = 18, H = 30, c = canvas(W, H), ctx = c.getContext('2d');
  const cx = 9, pal = (!snowy && TREE_COLORS[color]) || TREE_COLORS.pine;
  ctx.fillStyle = '#3a2614';
  ctx.fillRect(cx - 1, H - 6, 2, 5);
  for (let t = 0; t < 4; t++) {
    const top = 1 + t * 5, bot = top + 9;
    for (let y = top; y < bot; y++) {
      const half = 1 + ((y - top) / 9) * (3 + t * 1.6);
      for (let x = Math.round(cx - half); x <= Math.round(cx + half - 1); x++) {
        const edge = y === bot - 1 || x === Math.round(cx - half) || x === Math.round(cx + half - 1);
        const light = (x - cx) / half;
        let col = edge ? pal[0] : light < -0.3 ? pal[3] : light < 0.3 ? pal[2] : pal[1];
        if (snowy && (y - top) < 2 + rnd() * 2 && !edge) col = rnd() > 0.3 ? '#eef3f8' : '#c3d0e0';
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return { img: c, ax: cx, ay: H - 2 };
}

function bareTree(seed) {
  const rnd = seeded(seed);
  const W = 20, H = 26, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#3a2a1e';
  const branch = (x, y, len, ang, w) => {
    for (let i = 0; i < len; i++) {
      x += Math.cos(ang); y += Math.sin(ang);
      ctx.fillRect(Math.round(x), Math.round(y), w, 1);
      ang += (rnd() - 0.5) * 0.3;
    }
    if (len > 3) {
      branch(x, y, len * 0.6, ang - 0.6 - rnd() * 0.3, 1);
      branch(x, y, len * 0.6, ang + 0.6 + rnd() * 0.3, 1);
    }
  };
  branch(10, H - 1, 10, -Math.PI / 2, 2);
  return { img: c, ax: 10, ay: H - 1 };
}

function bush(seed, color) {
  const rnd = seeded(seed);
  const W = 12, H = 9, c = canvas(W, H), ctx = c.getContext('2d');
  const pal = TREE_COLORS[color] || TREE_COLORS.oak;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - 6) / 5.5, (y + 0.5 - 5) / 4);
      if (d > 1 - rnd() * 0.12) continue;
      let col = pal[d > 0.85 ? 0 : y < 3 ? 3 : y < 6 ? 2 : 1];
      if (color === 'berry' && d < 0.8 && rnd() > 0.88) col = '#b0283a';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  return { img: c, ax: 6, ay: H - 1 };
}

const WOOD = ['#2e1d10', '#6a4626', '#8a5e34'];
const STONE = ['#2a2724', '#7a746a', '#9a9488'];

const DRAW = {
  tree: (v, color) => roundTree(v, color),
  pine: (v, color) => pineTree(v, color),
  bare: v => bareTree(v),
  bush: (v, color) => bush(v, color),
  stump: () => sprite(10, 7, 5, 5, px => { box(px, 1, 1, 8, 6, '#6a4626', '#2e1d10', '#a07a4a'); px(3, 2, 4, 1, '#7a5634'); }),
  log: () => sprite(14, 6, 7, 4, px => { box(px, 0, 1, 14, 5, '#5a3a1e', '#24160c', '#7a5634'); px(1, 2, 3, 3, '#a07a4a'); }),
  rock: (v, color) => {
    const big = color === 'big', rnd = seeded(v);
    const W = big ? 16 : 10, H = big ? 12 : 8;
    return sprite(W, H, W / 2, H - 2, px => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot((x + 0.5 - W / 2) / (W / 2 - 0.5), (y + 0.5 - H * 0.55) / (H * 0.45));
        if (d > 1 - rnd() * 0.1) continue;
        px(x, y, 1, 1, d > 0.85 ? '#2a2622' : y < H * 0.4 ? '#9a948a' : y < H * 0.7 ? '#7a746a' : '#5a554e');
      }
    });
  },
  stalagmite: v => sprite(9, 16, 4, 15, px => {
    for (let y = 0; y < 16; y++) { const hw = Math.max(0, Math.round((y / 16) * 4)); px(4 - hw, y, hw * 2 + 1, 1, '#2a2420'); if (hw > 0) px(4 - hw + 1, y, hw * 2 - 1, 1, y % 3 ? '#5a5048' : '#6a6058'); }
  }),
  pebbles: (v, color) => {
    const rnd = seeded(v), col = color === 'shell' ? ['#e8dccc', '#b8a890'] : color === 'rubble' ? ['#7a746a', '#4a4540'] : ['#8a847a', '#5a554e'];
    return sprite(14, 10, 7, 5, px => { for (let i = 0; i < 6; i++) { const x = Math.floor(rnd() * 12), y = Math.floor(rnd() * 8); px(x, y, 2, 2, col[1]); px(x, y, 1, 1, col[0]); } });
  },
  crystal: v => sprite(12, 16, 6, 15, px => {
    const sh = (x, h, c1, c2) => { for (let y = 0; y < h; y++) { const w = y < 3 ? 1 : 2; px(x, 15 - h + y, w, 1, y < 3 ? c2 : c1); } };
    sh(5, 14, '#6ab0d8', '#d0f0ff'); sh(2, 9, '#4a90c0', '#a0e0ff'); sh(8, 10, '#5aa0d0', '#c0ecff');
  }),
  mushrooms: (v, color) => {
    const rnd = seeded(v), glow = color === 'glow';
    return sprite(14, 10, 7, 8, px => {
      for (let i = 0; i < 3; i++) {
        const x = 1 + Math.floor(rnd() * 9), y = 3 + Math.floor(rnd() * 4);
        px(x + 1, y + 1, 1, 2, '#e0d8c8');
        px(x, y, 3, 1, glow ? '#60f0c0' : '#b03028'); px(x + 1, y - 1, 1, 1, glow ? '#b0fff0' : '#d04838');
      }
    });
  },
  reeds: v => {
    const rnd = seeded(v);
    return sprite(12, 14, 6, 13, px => { for (let i = 0; i < 6; i++) { const x = 1 + Math.floor(rnd() * 10), h = 6 + Math.floor(rnd() * 7); px(x, 14 - h, 1, h, rnd() > 0.5 ? '#6a8a3a' : '#4a6a2a'); if (rnd() > 0.6) px(x, 14 - h, 1, 2, '#5a3a1e'); } });
  },
  fern: v => sprite(14, 9, 7, 8, px => { for (let i = -3; i <= 3; i++) { px(7 + i * 2, 8 - (3 - Math.abs(i)) * 2, 1, (3 - Math.abs(i)) * 2 + 1, i % 2 ? '#3d7a2c' : '#2f5a22'); } }),
  flowers: v => {
    const rnd = seeded(v), cols = ['#e8d44c', '#e2e8f0', '#d66e96', '#8a6ad8'];
    return sprite(14, 10, 7, 5, px => { for (let i = 0; i < 5; i++) { const x = Math.floor(rnd() * 12), y = Math.floor(rnd() * 8); px(x, y + 1, 1, 1, '#2f5a22'); px(x, y, 1, 1, cols[Math.floor(rnd() * 4)]); } });
  },
  lily: () => sprite(10, 7, 5, 3, px => { px(1, 1, 8, 5, '#2f6a32'); px(2, 0, 6, 7, '#2f6a32'); px(4, 1, 1, 3, '#1c4422'); px(6, 2, 2, 2, '#e8a0c0'); }),

  door: (v, color) => sprite(14, 16, 7, 15, px => {
    const leaf = color === 'secret' ? '#6e685d' : color === 'gate' ? '#3a3632' : color === 'locked' ? '#4a2e18' : '#6a4626';
    if (color === 'airlock') {
      px(0, 0, 14, 16, '#1a1d22'); px(1, 1, 12, 15, '#5a626c'); px(6, 1, 2, 15, '#1a1d22');
      for (let y = 3; y < 15; y += 4) { px(1, y, 5, 1, '#d8a820'); px(8, y, 5, 1, '#d8a820'); }
      px(2, 2, 2, 1, '#5ad0ff');
      return;
    }
    px(0, 0, 14, 16, '#1e140c');
    if (color === 'open') { px(2, 2, 3, 14, leaf); return; }
    px(2, 2, 10, 14, leaf);
    if (color === 'gate') { for (let x = 3; x < 12; x += 3) px(x, 2, 1, 14, '#8a847a'); return; }
    for (let x = 4; x < 12; x += 3) px(x, 2, 1, 14, '#00000033');
    px(9, 9, 2, 2, color === 'locked' ? '#d8b040' : '#c8a060');
  }),
  window: () => sprite(8, 6, 4, 3, px => { px(0, 0, 8, 6, '#2e1d10'); px(1, 1, 6, 4, '#7ab0d0'); px(1, 1, 2, 2, '#c0e0f0'); px(4, 1, 1, 4, '#2e1d10'); }),
  torch: () => sprite(5, 8, 2, 7, px => { px(2, 3, 1, 5, '#4a3020'); px(1, 2, 3, 2, '#2e1d10'); }),
  lamp: (v, color) => sprite(6, 16, 3, 15, px => { px(2, 4, 2, 12, '#2a2724'); px(1, 14, 4, 2, '#2a2724'); px(1, 0, 4, 4, '#2a2724'); px(2, 1, 2, 2, color === 'tech' ? '#8ae8ff' : '#ffe08a'); }),
  console: v => sprite(16, 14, 8, 12, px => {
    box(px, 0, 4, 16, 10, '#3e444c', '#14171b', '#5a626c'); px(2, 0, 12, 6, '#14171b'); px(3, 1, 10, 4, '#0e3a4a');
    px(4, 2, 4, 1, '#5ad0ff'); px(4, 3, 7, 1, '#2a8aa8'); for (let i = 0; i < 4; i++) px(3 + i * 3, 8, 2, 2, ['#e04040', '#40e070', '#e0c040', '#5ad0ff'][(i + v) % 4]);
  }),
  locker: () => sprite(12, 18, 6, 16, px => { box(px, 0, 0, 12, 17, '#4a5058', '#14171b', '#646b74'); px(6, 1, 1, 15, '#14171b'); px(2, 3, 3, 1, '#14171b'); px(8, 3, 3, 1, '#14171b'); px(4, 9, 1, 2, '#d8a820'); px(7, 9, 1, 2, '#d8a820'); }),
  pipes: () => sprite(16, 10, 8, 5, px => { px(0, 1, 16, 3, '#3e444c'); px(0, 1, 16, 1, '#646b74'); px(0, 6, 16, 3, '#5a3a2a'); px(0, 6, 16, 1, '#8a5a3a'); px(5, 0, 2, 10, '#1a1d22'); px(12, 0, 2, 10, '#1a1d22'); }),
  reactor: () => sprite(20, 22, 10, 18, px => {
    for (let y = 0; y < 22; y++) for (let x = 0; x < 20; x++) {
      const d = Math.hypot((x + 0.5 - 10) / 9.5, (y + 0.5 - 14) / 7);
      if (d < 1) px(x, y, 1, 1, d > 0.85 ? '#14171b' : d > 0.55 ? '#4a5058' : '#40e8c0');
    }
    px(8, 0, 4, 12, '#3e444c'); px(9, 2, 2, 9, '#8afff0');
  }),
  brazier: () => sprite(12, 10, 6, 9, px => { box(px, 1, 3, 10, 5, '#5a554e', '#1e1b19', '#7a746a'); px(3, 8, 1, 2, '#1e1b19'); px(8, 8, 1, 2, '#1e1b19'); }),
  fire: () => sprite(12, 6, 6, 4, px => { px(1, 3, 10, 3, '#3a2614'); px(2, 2, 8, 2, '#5a3a1e'); }),
  column: () => sprite(12, 22, 6, 20, px => {
    box(px, 1, 0, 10, 4, STONE[1], STONE[0], STONE[2]); px(2, 4, 8, 15, STONE[0]); px(3, 4, 6, 15, STONE[1]); px(4, 4, 2, 15, STONE[2]); box(px, 1, 18, 10, 4, STONE[1], STONE[0], STONE[2]);
  }),
  statue: () => sprite(14, 24, 7, 22, px => {
    box(px, 1, 17, 12, 7, STONE[1], STONE[0], STONE[2]);
    px(5, 1, 4, 4, '#8a847a'); px(4, 5, 6, 8, '#7a746a'); px(5, 13, 1, 4, '#6a645a'); px(8, 13, 1, 4, '#6a645a'); px(3, 6, 1, 5, '#6a645a'); px(10, 6, 1, 5, '#6a645a');
  }),
  fountain: () => sprite(28, 22, 14, 14, px => {
    for (let y = 0; y < 18; y++) for (let x = 0; x < 28; x++) {
      const d = Math.hypot((x + 0.5 - 14) / 13.5, (y + 0.5 - 12) / 8);
      if (d < 1) px(x, y + 2, 1, 1, d > 0.85 ? STONE[0] : d > 0.72 ? STONE[2] : '#4a90b0');
    }
    px(12, 2, 4, 12, STONE[1]); px(13, 0, 2, 4, '#a0d8f0');
  }),
  well: () => sprite(18, 20, 9, 15, px => {
    box(px, 1, 8, 16, 10, STONE[1], STONE[0], STONE[2]); px(3, 9, 12, 4, '#14202a');
    px(2, 0, 2, 10, WOOD[1]); px(14, 0, 2, 10, WOOD[1]); px(1, 0, 16, 2, WOOD[0]); px(8, 2, 1, 6, '#8a7a5a');
  }),
  gravestone: () => sprite(10, 14, 5, 13, px => { px(1, 2, 8, 12, STONE[0]); px(2, 1, 6, 1, STONE[0]); px(2, 2, 6, 11, STONE[1]); px(3, 2, 4, 1, STONE[2]); px(4, 5, 2, 1, STONE[0]); }),
  box: (v, color) => {
    const pal = { stone: STONE, trough: ['#2e1d10', '#5a3a1e', '#4a7ab0'], dark: ['#1e140c', '#4a2e18', '#6a4626'] }[color] || WOOD;
    return sprite(14, 14, 7, 12, px => { box(px, 1, 2, 12, 11, pal[1], pal[0], pal[2]); if (color === 'trough') px(3, 4, 8, 5, pal[2]); });
  },
  banner: v => sprite(8, 14, 4, 13, px => { px(3, 0, 1, 14, '#4a3020'); px(0, 1, 8, 9, v % 2 ? '#8a2a2c' : '#2a4a8a'); px(1, 2, 6, 1, '#c2a050'); px(0, 10, 2, 2, v % 2 ? '#8a2a2c' : '#2a4a8a'); px(6, 10, 2, 2, v % 2 ? '#8a2a2c' : '#2a4a8a'); }),
  hay: () => sprite(14, 12, 7, 10, px => { box(px, 1, 2, 12, 9, '#c8a848', '#6a5422', '#e8cc70'); for (let x = 3; x < 12; x += 3) px(x, 3, 1, 7, '#a88a38'); }),
  scarecrow: () => sprite(14, 20, 7, 19, px => { px(6, 4, 2, 16, WOOD[1]); px(1, 7, 12, 2, WOOD[1]); px(4, 7, 6, 7, '#6a5a8a'); px(5, 1, 4, 4, '#c8a848'); px(4, 0, 6, 2, '#4a3020'); }),
  stall: v => sprite(16, 18, 8, 15, px => {
    const cl = ['#b03028', '#2a6a8a', '#c8a040'][v % 3];
    px(1, 3, 2, 13, WOOD[0]); px(13, 3, 2, 13, WOOD[0]); box(px, 0, 9, 16, 6, WOOD[1], WOOD[0], WOOD[2]);
    for (let x = 0; x < 16; x += 4) { px(x, 0, 2, 4, cl); px(x + 2, 0, 2, 4, '#e8e0d0'); }
    px(3, 10, 3, 2, '#d0a040'); px(8, 10, 3, 2, '#88a040');
  }),
  sign: () => sprite(12, 16, 6, 15, px => { px(5, 4, 2, 12, WOOD[0]); box(px, 0, 1, 12, 6, WOOD[2], WOOD[0], '#b08050'); px(2, 3, 7, 1, WOOD[0]); }),
  barrel: (v, color) => {
    const pal = color === 'urn' ? ['#3a2414', '#9a5a32', '#c07a4a'] : WOOD;
    return sprite(12, 14, 6, 12, px => { box(px, 1, 1, 10, 12, pal[1], pal[0], pal[2]); px(1, 4, 10, 1, pal[0]); px(1, 9, 10, 1, pal[0]); px(4, 1, 1, 12, '#ffffff22'); });
  },
  crate: () => sprite(14, 14, 7, 12, px => { box(px, 1, 1, 12, 12, '#8a6a3a', '#3a2a14', '#aa8a50'); px(2, 6, 10, 1, '#3a2a14'); px(6, 2, 1, 10, '#3a2a14'); }),
  bones: v => {
    const rnd = seeded(v);
    return sprite(14, 10, 7, 5, px => { px(4, 2, 4, 3, '#d8d0c0'); px(5, 3, 1, 1, '#2a2420'); px(7, 3, 1, 1, '#2a2420'); for (let i = 0; i < 3; i++) px(Math.floor(rnd() * 10), 6 + Math.floor(rnd() * 3), 4, 1, '#c8c0b0'); });
  },
  pit: () => sprite(14, 12, 7, 6, px => { px(0, 1, 14, 10, '#2a2420'); px(1, 2, 12, 8, '#0a0806'); }),
  boat: () => sprite(26, 12, 13, 6, px => { px(2, 3, 22, 7, '#2e1d10'); px(3, 4, 20, 5, '#6a4626'); px(0, 5, 3, 3, '#2e1d10'); px(23, 5, 3, 3, '#2e1d10'); px(8, 4, 1, 5, '#2e1d10'); px(16, 4, 1, 5, '#2e1d10'); }),
  steps: () => sprite(14, 12, 7, 6, px => { for (let i = 0; i < 4; i++) px(1 + i, i * 3, 12 - i * 2, 3, i % 2 ? '#5a5048' : '#6a6058'); }),
  bed: v => sprite(14, 18, 7, 15, px => {
    const cl = ['#8a2a2c', '#2a4a8a', '#3a6a3a', '#8a6a2a'][v % 4];
    box(px, 1, 0, 12, 18, WOOD[1], WOOD[0]); px(2, 1, 10, 4, '#e8e0d0'); px(2, 6, 10, 11, cl); px(2, 6, 10, 1, '#e8e0d0');
  }),
  table: (v, color) => {
    const top = color === 'work' ? '#7a5a30' : color === 'counter' ? '#5a3a1e' : '#8a5e34';
    return sprite(16, 14, 8, 11, px => { box(px, 0, 1, 16, 10, top, WOOD[0], '#aa7a48'); px(1, 11, 2, 3, WOOD[0]); px(13, 11, 2, 3, WOOD[0]); if (color === 'work') px(4, 3, 5, 2, '#8a847a'); if (!color && v % 2) px(6, 4, 3, 3, '#e8e0d0'); });
  },
  chair: (v, color) => {
    const seat = color === 'throne' ? '#8a2a2c' : color === 'arm' ? '#3a6a3a' : WOOD[2];
    const frame = color === 'throne' ? '#c2a050' : WOOD[0];
    return sprite(10, 14, 5, 12, px => { px(1, 0, 8, 7, frame); px(2, 1, 6, 5, seat); box(px, 1, 6, 8, 5, seat, frame); px(1, 11, 1, 3, frame); px(8, 11, 1, 3, frame); });
  },
  bench: () => sprite(16, 8, 8, 6, px => { box(px, 0, 1, 16, 4, WOOD[2], WOOD[0]); px(1, 5, 2, 3, WOOD[0]); px(13, 5, 2, 3, WOOD[0]); }),
  chest: (v, color) => {
    const body = color === 'gold' ? '#8a5a20' : color === 'depot' ? '#3a4a6a' : '#6a4626';
    const band = color === 'gold' ? '#e8c050' : '#c8a060';
    return sprite(14, 12, 7, 10, px => { box(px, 1, 1, 12, 10, body, WOOD[0], '#ffffff33'); px(1, 4, 12, 1, WOOD[0]); px(3, 1, 1, 10, band); px(10, 1, 1, 10, band); px(6, 4, 2, 2, band); });
  },
  shelf: (v, color) => sprite(16, 18, 8, 15, px => {
    box(px, 0, 0, 16, 16, WOOD[1], WOOD[0]);
    if (color === 'plain') { px(7, 2, 1, 13, WOOD[0]); px(5, 8, 1, 2, '#c8a060'); px(9, 8, 1, 2, '#c8a060'); return; }
    const rnd = seeded(v), cols = ['#8a2a2c', '#2a4a8a', '#3a6a3a', '#c8a040', '#6a3a7a'];
    for (let r = 0; r < 3; r++) { px(1, 5 + r * 5, 14, 1, WOOD[0]); for (let x = 2; x < 14; x += 2) if (color === 'books' || rnd() > 0.5) px(x, 2 + r * 5, 2, 3, cols[Math.floor(rnd() * 5)]); }
  }),
  rug: v => {
    const cl = ['#7a2a2c', '#2a4a7a', '#6a5a2a'][v % 3];
    return sprite(16, 14, 8, 7, px => { px(0, 0, 16, 14, '#c2a050'); px(1, 1, 14, 12, cl); px(3, 3, 10, 8, '#c2a05066'); px(5, 5, 6, 4, cl); });
  },
  plant: () => sprite(10, 14, 5, 13, px => { box(px, 2, 9, 6, 5, '#9a5a32', '#3a2414'); px(1, 2, 3, 7, '#3d7a2c'); px(5, 0, 3, 9, '#2f5a22'); px(3, 4, 4, 5, '#58993a'); }),
  anvil: () => sprite(14, 10, 7, 8, px => { px(1, 1, 12, 3, '#3a3a40'); px(0, 1, 3, 2, '#3a3a40'); px(4, 4, 6, 3, '#2a2a30'); px(3, 7, 8, 3, '#2a2a30'); px(2, 1, 10, 1, '#6a6a74'); }),
  stove: () => sprite(14, 16, 7, 13, px => { box(px, 1, 1, 12, 14, '#4a4540', '#1e1b19', '#6e685d'); px(4, 8, 6, 5, '#1a0a04'); px(5, 10, 4, 2, '#e06020'); }),
  cauldron: () => sprite(14, 12, 7, 9, px => { px(1, 2, 12, 9, '#1e1b19'); px(2, 3, 10, 7, '#2a2a30'); px(2, 2, 10, 2, '#3a8a4a'); px(4, 2, 2, 1, '#8ae09a'); px(3, 11, 2, 1, '#1e1b19'); px(9, 11, 2, 1, '#1e1b19'); }),
};

// Props that lie on the ground and are drawn under everything that stands.
export const FLAT = new Set(['rug', 'pebbles', 'lily', 'flowers', 'steps', 'pit', 'bones', 'door', 'window', 'fire']);
// Props that flicker and glow.
export const FLAME = { torch: [2, 1], brazier: [6, 2], fire: [6, 1], lamp: null };

export const DRAWERS = Object.keys(DRAW).sort();
export const TREE_PALETTES = Object.keys(TREE_COLORS).sort();

export function createProps() {
  let cache = new Map(), filter = '';
  return {
    // A CSS filter baked into every sprite (themes recolour props this way).
    setFilter(f) {
      if ((f || '') === filter) return;
      filter = f || '';
      cache = new Map();
    },
    get(draw, color, v) {
      const variant = v & 3;
      const key = `${draw}|${color || ''}|${variant}`;
      let s = cache.get(key);
      if (!s) {
        const fn = DRAW[draw] || DRAW.box;
        s = fn(variant * 7 + 3, color || '');
        if (filter) {
          const c = canvas(s.img.width, s.img.height), ctx = c.getContext('2d');
          ctx.filter = filter;
          ctx.drawImage(s.img, 0, 0);
          s = { ...s, img: c };
        }
        cache.set(key, s);
      }
      return s;
    },
  };
}
