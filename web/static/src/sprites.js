// The walker: a small ranger with a 4-frame walk in four directions, built in
// code. Copied from auto-tiles.

const PAL = {
  o: '#24170f', h: '#6b3e1f', H: '#8a5429', s: '#e8b58a', e: '#24170f',
  r: '#b8322b', t: '#3d6fb5', T: '#2c5288', b: '#5a3a1a', p: '#4a3b2e', k: '#2b1d14',
};

const FRONT = [
  '....oooo....',
  '...oHHhho...',
  '..ohHhhhho..',
  '..ohssssho..',
  '..osesseso..',
  '...osssso...',
  '..orrrrrro..',
  '.otttttttto.',
  '.oTttttttTo.',
  '.obbbbbbbbo.',
  '.sTttttttTs.',
  '..otttttto..',
];
const BACK = [
  '....oooo....',
  '...ohhhho...',
  '..ohhHhhho..',
  '..ohhhhhho..',
  '..ohhhhhho..',
  '...ohhhho...',
  '..orrrrrro..',
  '.otttttttto.',
  '.oTttttttTo.',
  '.obbbbbbbbo.',
  '.sTttttttTs.',
  '..otttttto..',
];
const SIDE = [
  '....oooo....',
  '...oHhhho...',
  '..ohHhhhho..',
  '..ohhhssso..',
  '..ohhsseso..',
  '...ohssso...',
  '...orrrrro..',
  '...otttto...',
  '...otTTto...',
  '...obbbbo...',
  '...ottsto...',
  '...otttto...',
];
const LEG = ['opo', 'opo', 'oko', 'ooo'];
const SIDE_IDLE = ['oppo', 'oppo', 'okko', 'oooo'];
const SIDE_STRIDE = ['.oppppo.', 'opo..opo', 'oko..oko', 'oo....oo'];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function stamp(ctx, rows, ox, oy) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x];
      if (k === '.' || !PAL[k]) continue;
      ctx.fillStyle = PAL[k];
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

// frames[dir][frame], dir in down/up/right/left, frame 0 idle, 1 and 2 stride.
export function makeCharacter() {
  const W = 12, H = 17;
  const frames = {};
  for (const dir of ['down', 'up', 'right']) {
    frames[dir] = [0, 1, 2].map(f => {
      const c = canvas(W, H), ctx = c.getContext('2d');
      const bob = f === 0 ? 1 : 0;
      if (dir === 'right') {
        if (f === 1) stamp(ctx, SIDE_STRIDE, 2, 12 + bob);
        else stamp(ctx, SIDE_IDLE, 4, 12 + bob);
        stamp(ctx, SIDE, 0, bob);
      } else {
        stamp(ctx, LEG.slice(0, f === 1 ? 3 : 4), 3, 12 + bob);
        stamp(ctx, LEG.slice(0, f === 2 ? 3 : 4), 6, 12 + bob);
        stamp(ctx, dir === 'down' ? FRONT : BACK, 0, bob);
      }
      return c;
    });
  }
  frames.left = frames.right.map(src => {
    const c = canvas(W, H), ctx = c.getContext('2d');
    ctx.scale(-1, 1);
    ctx.drawImage(src, -W, 0);
    return c;
  });
  return { frames, w: W, h: H };
}
