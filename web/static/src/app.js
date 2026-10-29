import { createGame, floorName } from './game.js';
import { createEditor } from './editor.js';

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') e.className = v;
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

function fail(msg) {
  $('err').textContent = msg;
  $('err').style.display = 'grid';
  throw new Error(msg);
}

let game;
try { game = createGame($('gl'), $('overlay'), $('mini')); } catch (e) { fail(e.message); }

const SITE_TOOLS = ['city', 'village', 'cave', 'dungeon', 'dwelling'];
const randomSeed = () => Math.floor(Math.random() * 999999) + 1;

const app = {
  tools: [], tab: 'world',
  realm: null,          // realm params for the world tab
  world: null,          // last {request, sites, doc}
  sub: { tool: 'dungeon', params: null },
  doc: null, msg: '', err: false, busy: false,
};

const editor = createEditor({ el, api, app, game, render, busy, setHash });

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

async function busy(label, fn) {
  app.busy = true;
  $('busy').textContent = label;
  $('busy').style.display = 'block';
  render();
  try { await fn(); app.err = false; }
  catch (e) { app.msg = e.message; app.err = true; }
  finally { app.busy = false; $('busy').style.display = 'none'; render(); }
}

const tool = name => app.tools.find(t => t.name === name);

// ---- forms -------------------------------------------------------------------------------
// A form from a generator schema. values is mutated in place.
function form(info, values) {
  const basic = [], adv = [];
  for (const f of info.schema.fields) {
    if (f.name === 'name') continue;
    if (!(f.name in values)) values[f.name] = info.defaults[f.name];
    (f.advanced ? adv : basic).push(field(f, info, values));
  }
  return el('div', {}, basic, adv.length ? el('details', {}, el('summary', {}, 'advanced'), adv) : null);
}

function field(f, info, values) {
  const label = el('span', { title: f.help || '' }, f.title || f.name);
  const set = v => { values[f.name] = v; };
  if (f.type === 'tags') return tagField(info, values);
  if (f.type === 'bool') {
    return el('div', { class: 'row' }, label, el('input', { type: 'checkbox', checked: !!values[f.name], onChange: e => set(e.target.checked) }));
  }
  if (f.type === 'enum') {
    const s = el('select', { onChange: e => set(e.target.value) }, (f.enum || []).map(o => el('option', { value: o }, o || '(auto)')));
    s.value = values[f.name] ?? '';
    return el('div', { class: 'row' }, label, s);
  }
  if (f.type === 'seed') {
    const inp = el('input', { type: 'number', value: values[f.name] ?? 1, onChange: e => set(+e.target.value) });
    return el('div', { class: 'row' }, label, el('div', { class: 'seed' }, inp,
      el('button', { title: 'random seed', onClick: () => { const s = randomSeed(); inp.value = s; set(s); } }, '⚄')));
  }
  if (f.type === 'string') {
    return el('div', { class: 'row' }, label, el('input', { type: 'text', value: values[f.name] ?? '', onChange: e => set(e.target.value) }));
  }
  const num = el('input', { type: 'number', value: values[f.name], step: f.step || (f.type === 'float' ? 0.05 : 1),
    min: f.min ?? undefined, max: f.max || undefined, onChange: e => set(f.type === 'int' ? Math.round(+e.target.value) : +e.target.value) });
  return el('div', { class: 'row' }, label, num);
}

// Tags as chips; tags that share a group are exclusive.
function tagField(info, values) {
  const defs = info.schema.tags || [];
  values.tags = (values.tags || []).filter(t => defs.some(d => d.name === t));
  const wrap = el('div', { class: 'tags' });
  const draw = () => {
    wrap.replaceChildren(...defs.map(d => {
      const on = values.tags.includes(d.name);
      return el('label', { class: on ? 'on' : '', title: (d.group ? `[${d.group}] ` : '') + (d.help || ''), onClick: e => {
        e.preventDefault();
        if (on) values.tags = values.tags.filter(t => t !== d.name);
        else {
          if (d.group) values.tags = values.tags.filter(t => (defs.find(x => x.name === t) || {}).group !== d.group);
          values.tags.push(d.name);
        }
        draw();
      } }, d.name);
    }));
  };
  draw();
  return el('div', {}, el('div', { class: 'row' }, el('span', {}, 'tags')), wrap);
}

// ---- world -------------------------------------------------------------------------------
async function buildWorld(req) {
  await busy('generating world…', async () => {
    const t0 = performance.now();
    const res = await api('/api/world', req);
    app.world = res;
    app.doc = res.doc;
    game.load(res.doc);
    const n = res.request.pieces.length;
    app.msg = `${res.doc.name}: ${res.doc.w}×${res.doc.h}, ${n} pieces, ${res.doc.portals.length / 2} links, ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    setHash('world', res.request);
  });
}

function freshWorld() {
  return buildWorld({ surface: { ...app.realm }, pieces: [], autofill: true, skip: [] });
}

function editWorld(fn) {
  const req = structuredClone(app.world.request);
  fn(req);
  return buildWorld(req);
}

function pieceParams(site, t, seed) {
  const p = { seed, width: site.rect.W, height: site.rect.H, name: site.name };
  if (t === 'city' && site.kind === 'town') p.tags = ['small'];
  if (t === 'dwelling') { p.width = Math.min(24, site.rect.W); p.height = Math.min(24, site.rect.H); }
  return p;
}

function goToPiece(id) {
  const d = app.doc;
  const mk = d.markers.find(m => m.name === `${id}/entry`) || d.markers.find(m => m.name === `${id}/spawn`) || d.markers.find(m => m.name.startsWith(id + '/') && m.dz === 0);
  const piece = (d.meta.pieces || []).find(p => p.id === id);
  if (mk && mk.dz === 0) game.teleport(mk.x, mk.y, 0);
  else if (piece) game.teleport(piece.x + (piece.w >> 1), piece.y + (piece.h >> 1), 0);
}

function worldTab() {
  const info = tool('realm');
  if (!info) return el('div', { class: 'msg' }, 'loading tools…');
  const out = [
    el('h4', {}, 'surface (realm)'),
    form(info, app.realm),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', disabled: app.busy, onClick: freshWorld }, 'generate world'),
      el('button', { disabled: app.busy, onClick: () => { app.realm.seed = randomSeed(); freshWorld(); } }, 'new seed')),
  ];
  const w = app.world;
  if (w) {
    const pieces = new Map(w.request.pieces.map(p => [p.id, p]));
    const skip = new Set(w.request.skip || []);
    out.push(el('h4', {}, `sites (${w.sites.length})`));
    if (!w.sites.length) out.push(el('div', { class: 'msg' }, 'No sites. Raise settlements or dangers.'));
    out.push(el('div', { class: 'sites' }, w.sites.map(s => {
      const pc = s.piece && pieces.get(s.piece);
      const sel = el('select', { disabled: !pc || app.busy, onChange: e => editWorld(req => {
        const p = req.pieces.find(x => x.id === pc.id);
        p.tool = e.target.value;
        p.params = pieceParams(s, p.tool, randomSeed());
      }) }, SITE_TOOLS.map(t => el('option', { value: t }, t)));
      if (pc) sel.value = pc.tool;
      return el('div', { class: 'site' },
        el('div', { class: 'top' }, el('span', { class: 'name' }, s.name || s.slug), el('span', { class: 'kind' }, `${s.kind} ${s.rect.W}×${s.rect.H}`)),
        el('div', { class: 'ops' },
          pc ? [
            el('button', { onClick: () => goToPiece(pc.id) }, 'go'),
            sel,
            pc.tool === 'city' ? el('input', { type: 'number', min: 0, max: 40, style: 'width: 44px', disabled: app.busy,
              title: 'houses rebuilt as multi-storey dwellings', value: pc.params.dwellings ?? 6, onChange: e => editWorld(req => {
                req.pieces.find(x => x.id === pc.id).params.dwellings = Math.max(0, Math.round(+e.target.value));
              }) }) : null,
            el('button', { disabled: app.busy, title: 'regenerate with a new seed', onClick: () => editWorld(req => {
              req.pieces.find(x => x.id === pc.id).params.seed = randomSeed();
            }) }, 'reroll'),
            el('button', { disabled: app.busy, onClick: () => editWorld(req => {
              req.pieces = req.pieces.filter(x => x.id !== pc.id);
              req.skip = [...(req.skip || []), s.slug];
            }) }, 'clear'),
          ] : el('button', { disabled: app.busy, onClick: () => editWorld(req => {
            req.skip = (req.skip || []).filter(x => x !== s.slug);
            req.autofill = true;
          }) }, skip.has(s.slug) ? 'fill' : 'fill')));
    })));
  }
  return out;
}

// ---- sub-map -----------------------------------------------------------------------------
async function buildSub() {
  const { tool: name, params } = app.sub;
  await busy(`generating ${name}…`, async () => {
    const t0 = performance.now();
    const doc = await api(`/api/generate/${name}`, params);
    app.doc = doc;
    game.load(doc);
    const floors = doc.floors.map(f => f.dz).join(', ');
    app.msg = `${doc.name}: ${doc.w}×${doc.h}, floors ${floors}, ${doc.portals.length / 2} links, ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    const un = Object.keys(doc.unmapped);
    if (un.length) app.msg += `\nunmapped: ${un.join(', ')}`;
    setHash('sub', { tool: name, params });
  });
}

function subTab() {
  const tools = app.tools.filter(t => t.name !== 'realm');
  if (!tools.length) return el('div', { class: 'msg' }, 'loading tools…');
  const info = tool(app.sub.tool);
  if (!app.sub.params) app.sub.params = {};
  const sel = el('select', { onChange: e => { app.sub.tool = e.target.value; app.sub.params = {}; render(); } },
    app.tools.map(t => el('option', { value: t.name }, t.title || t.name)));
  sel.value = app.sub.tool;
  return [
    el('div', { class: 'row' }, el('span', {}, 'generator'), sel),
    el('div', { class: 'msg' }, info.description || ''),
    form(info, app.sub.params),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', disabled: app.busy, onClick: buildSub }, 'generate'),
      el('button', { disabled: app.busy, onClick: () => { app.sub.params.seed = randomSeed(); buildSub(); } }, 'new seed')),
  ];
}

// ---- view --------------------------------------------------------------------------------
function viewTab() {
  const v = game.state.view;
  const row = (label, input) => el('div', { class: 'row' }, el('span', {}, label), input);
  const mode = el('select', { onChange: e => game.setView({ mode: +e.target.value }) },
    ['final', 'raw material ids', 'smooth, no noise', 'colliders'].map((n, i) => el('option', { value: i }, n)));
  mode.value = v.mode;
  const check = key => el('input', { type: 'checkbox', checked: v[key], onChange: e => { game.setView({ [key]: e.target.checked }); render(); } });
  const floors = game.floors();
  return [
    row('render', mode),
    row('edge noise', el('input', { type: 'range', min: 0, max: 2, step: 0.05, value: v.noise, onInput: e => game.setView({ noise: +e.target.value }) })),
    row('pixel size', el('input', { type: 'range', min: 1, max: 6, step: 1, value: v.scale, onInput: e => game.setView({ scale: +e.target.value }) })),
    row('tile grid', check('grid')),
    row('labels', check('labels')),
    row('minimap', check('minimap')),
    row('no-clip (debug)', check('noclip')),
    floors.length > 1 ? el('h4', {}, 'floors') : null,
    floors.length > 1 ? el('div', { class: 'actions' }, floors.map(dz => el('button', { onClick: () => jumpFloor(dz) }, floorName(dz)))) : null,
  ];
}

// Jump to a floor at its first portal, for inspection.
function jumpFloor(dz) {
  const p = app.doc.portals.find(p => p.from.dz === dz);
  if (p) game.teleport(p.from.x, p.from.y + 1, dz);
  else game.teleport(app.doc.w >> 1, app.doc.h >> 1, dz);
}

// ---- export ------------------------------------------------------------------------------
function download(name, data) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = s => (s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function exportBlock() {
  if (!app.doc) return null;
  const d = app.doc;
  return [
    el('h4', {}, 'export'),
    el('div', { class: 'actions' },
      el('button', { title: 'materials per cell, props, portals: what this viewer plays', onClick: () => download(`${fileName(d.name)}.terrain.json`, { ...d, materials: game.materials(), theme: editor.ed.theme.name }) }, 'terrain map'),
      d.tool === 'lab' ? null : el('button', { title: 'the tilegen semantic map: re-bake to Asterion tiles with tilegen', onClick: () => { location.href = `/api/semantic/${d.id}`; } }, 'semantic map'),
      app.tab === 'world' && app.world ? el('button', { title: 'surface params + pieces: regenerates this world', onClick: () => download(`${fileName(d.name)}.world.json`, app.world.request) }, 'world recipe') : null),
  ];
}

// ---- panel -------------------------------------------------------------------------------
function render() {
  const body = $('body');
  const scroll = body.scrollTop;
  const tabs = { world: worldTab, sub: subTab, lab: editor.labTab, themes: editor.themesTab, view: viewTab };
  const tab = tabs[app.tab]();
  body.replaceChildren(
    ...[tab].flat(Infinity).filter(x => x !== null && x !== undefined && x !== false),
    app.msg ? el('div', { class: 'msg' + (app.err ? ' err' : '') }, app.msg) : null,
    ...[app.tab === 'world' || app.tab === 'sub' || app.tab === 'lab' ? exportBlock() : null].flat().filter(Boolean),
    el('div', { class: 'help' },
      el('kbd', {}, 'WASD'), ' move, ', el('kbd', {}, 'Shift'), ' run. Walk onto stairs or a cave mouth to change floor.', el('br'),
      el('kbd', {}, 'M'), ' minimap (click it to travel), ', el('kbd', {}, 'R'), ' render mode, ', el('kbd', {}, 'G'), ' grid, ',
      el('kbd', {}, 'L'), ' labels, ', el('kbd', {}, 'N'), ' no-clip, ', el('kbd', {}, '+/-'), ' zoom, ', el('kbd', {}, 'H'), ' panel'));
  body.scrollTop = scroll;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === app.tab);
  $('mini').classList.toggle('hidden', !game.state.view.minimap);
}

function hud(s) {
  if (!s) { $('hud').textContent = ''; return; }
  const z = s.zone ? `${s.zone.name}${s.zone.kind && s.zone.kind !== 'site' ? ' · ' + s.zone.kind : ''}` : '';
  const portal = s.portal ? `${s.portal.to.dz < s.portal.from.dz ? '↓ down to' : s.portal.to.dz > s.portal.from.dz ? '↑ up to' : '→'} ${floorName(s.portal.to.dz)}` : '';
  const key = [app.doc && app.doc.name, s.floor, z, s.x, s.y, s.material, portal, s.fps].join('|');
  if (key === hud.last) return;
  hud.last = key;
  $('hud').replaceChildren(...[
    el('div', { class: 'big' }, app.doc ? app.doc.name : ''),
    el('div', {}, s.floor),
    z ? el('div', {}, z) : null,
    el('div', {}, `${s.x}, ${s.y} · ${s.material || ''}`),
    portal ? el('div', { class: 'portal' }, portal) : null,
    el('div', { style: 'color: var(--dim)' }, `${s.fps} fps`)].filter(Boolean));
}

// ---- permalink ---------------------------------------------------------------------------
function setHash(kind, data) {
  try { history.replaceState(null, '', `#${kind}=${encodeURIComponent(JSON.stringify(data))}`); } catch { /* ignore */ }
}
function readHash() {
  const m = /^#(world|sub|lab)=(.*)$/.exec(location.hash);
  if (!m) return null;
  try { return { kind: m[1], data: JSON.parse(decodeURIComponent(m[2])) }; } catch { return null; }
}

// ---- keys --------------------------------------------------------------------------------
function setupKeys() {
  addEventListener('keydown', e => {
    const t = e.target.tagName;
    if (t === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' || t === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    game.state.keys.add(k);
    const v = game.state.view;
    if (k === 'm') { game.setView({ minimap: !v.minimap }); render(); }
    if (k === 'g') game.setView({ grid: !v.grid });
    if (k === 'l') game.setView({ labels: !v.labels });
    if (k === 'n') { game.setView({ noclip: !v.noclip }); if (app.tab === 'view') render(); }
    if (k === 'r') { game.setView({ mode: (v.mode + 1) % 4 }); if (app.tab === 'view') render(); }
    if (k === '+' || k === '=') game.setView({ scale: Math.min(6, v.scale + 1) });
    if (k === '-') game.setView({ scale: Math.max(1, v.scale - 1) });
    if (k === 'h') $('panel').classList.toggle('hidden');
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  });
  addEventListener('keyup', e => game.state.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => game.state.keys.clear());
}

async function main() {
  game.state.onStatus = hud;
  setupKeys();
  $('hide').onclick = () => $('panel').classList.toggle('hidden');
  for (const b of $('tabs').children) b.onclick = () => { app.tab = b.dataset.tab; render(); };
  render();
  app.tools = await api('/api/tools');
  const realm = tool('realm');
  app.realm = { ...realm.defaults, seed: 3, dangers: 4 };
  const q = new URLSearchParams(location.search);
  if (q.has('scale')) game.setView({ scale: +q.get('scale') });
  if (q.has('mode')) game.setView({ mode: +q.get('mode') });
  if (q.has('hidepanel')) $('panel').classList.add('hidden');
  await editor.init(q.get('theme'));
  const h = readHash();
  if (h && h.kind === 'lab') {
    app.tab = 'lab';
    Object.assign(editor.ed.lab, h.data);
    await editor.buildLab();
  } else if (h && h.kind === 'sub' && tool(h.data.tool)) {
    app.tab = 'sub';
    app.sub = { tool: h.data.tool, params: h.data.params || {} };
    await buildSub();
  } else if (h && h.kind === 'world') {
    app.realm = { ...app.realm, ...(h.data.surface || {}) };
    await buildWorld(h.data);
  } else {
    await freshWorld();
  }
}

// Console handle for debugging: automix.game.teleport(x, y, dz), automix.app.doc.
window.automix = { game, app, editor };

main().catch(e => fail(e.message));
