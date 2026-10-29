// The edge lab and the theme editor. A theme is a skin over the palette: it
// overrides how materials and props look, never what is solid, so any map
// (lab, world, sub-map) can be shown in any theme, live.

import { PATTERNS, defaultAccent } from './terrain.js';
import { DRAWERS, TREE_PALETTES } from './props.js';

const SET_ORDER = ['water', 'nature', 'settlement', 'interior', 'underground', 'links', 'ship', 'wood'];

export function createEditor({ el, api, app, game, render, busy, setHash }) {
  const ed = {
    palette: null, themes: [],
    theme: { name: 'default', title: 'Default', materials: {}, props: {} },
    dirty: false,
    lab: { mode: 'matrix', set: '', a: 'water', b: 'sand' },
  };

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  async function init(themeName) {
    ed.palette = await api('/api/palette');
    ed.themes = await api('/api/themes');
    await loadTheme(themeName || storage.get('automix.theme') || 'default');
  }

  async function loadTheme(name) {
    try {
      const t = await api(`/api/themes/${encodeURIComponent(name)}`);
      ed.theme = { materials: {}, props: {}, ...t };
    } catch {
      ed.theme = { name: 'default', title: 'Default', materials: {}, props: {} };
    }
    ed.dirty = false;
    storage.set('automix.theme', ed.theme.name);
    game.setTheme(ed.theme);
  }

  const apply = () => { ed.dirty = true; game.setTheme(ed.theme); };
  const sets = () => {
    const found = [...new Set(ed.palette.materials.map(m => m.set || 'other'))];
    return found.sort((a, b) => (SET_ORDER.indexOf(a) + 99) % 99 - (SET_ORDER.indexOf(b) + 99) % 99);
  };

  // ---- lab ---------------------------------------------------------------------------------
  async function buildLab() {
    const o = ed.lab;
    await busy('building edge lab…', async () => {
      const q = new URLSearchParams({ mode: o.mode, set: o.set, a: o.a, b: o.b });
      const doc = await api(`/api/lab?${q}`);
      app.doc = doc;
      game.load(doc);
      game.setView({ noclip: true });
      app.msg = `${doc.name}: ${doc.w}×${doc.h} tiles. No-clip is on; Shift flies.`;
      setHash('lab', o);
    });
  }

  function labTab() {
    if (!ed.palette) return el('div', { class: 'msg' }, 'loading…');
    const o = ed.lab;
    const row = (label, input) => el('div', { class: 'row' }, el('span', {}, label), input);
    const sel = (value, options, onChange) => {
      const s = el('select', { onChange: e => { onChange(e.target.value); render(); } }, options.map(([v, t]) => el('option', { value: v }, t)));
      s.value = value;
      return s;
    };
    const mats = ed.palette.materials.filter(m => m.name !== ed.palette.void.above).map(m => [m.name, `${m.name} (${m.set})`]);
    return [
      el('div', { class: 'msg' }, 'Every material edge, generated. Pick a theme in the themes tab to see the same lab in it.'),
      row('mode', sel(o.mode, [['matrix', 'every pair'], ['one', 'one against all'], ['pair', 'edge cases of a pair']], v => { o.mode = v; })),
      o.mode === 'matrix' ? row('kit', sel(o.set, [['', 'all kits'], ...sets().map(s => [s, s])], v => { o.set = v; })) : null,
      o.mode !== 'matrix' ? row('material A', sel(o.a, mats, v => { o.a = v; })) : null,
      o.mode === 'pair' ? row('material B', sel(o.b, mats, v => { o.b = v; })) : null,
      o.mode === 'one' ? row('kit', sel(o.set, [['', 'all kits'], ...sets().map(s => [s, s])], v => { o.set = v; })) : null,
      el('div', { class: 'actions' }, el('button', { class: 'primary', disabled: app.busy, onClick: buildLab }, 'build lab')),
      el('div', { class: 'msg' }, 'Each patch is the base material with the other as a lone tile, a 2×2 block, a line, a diagonal and an L. The matrix ends with every prop on grass and on stone. The HUD names the patch under you.'),
    ];
  }

  // ---- themes ------------------------------------------------------------------------------
  function override(name) {
    ed.theme.materials = ed.theme.materials || {};
    return (ed.theme.materials[name] = ed.theme.materials[name] || {});
  }

  function materialRow(m) {
    const base = ed.palette.materials.find(x => x.name === m.name);
    const has = !!(ed.theme.materials || {})[m.name];
    const set = (k, v) => { override(m.name)[k] = v; apply(); };
    const colors = [...m.colors];
    const color = (i, value) => el('input', { type: 'color', value, title: ['dark', 'mid', 'light', 'accent'][i], onInput: e => {
      if (i === 3) set('accent', e.target.value);
      else { colors[i] = e.target.value; set('colors', [...colors]); }
    } });
    const pat = el('select', { style: 'width: 74px', onChange: e => set('pattern', e.target.value) }, PATTERNS.map(p => el('option', { value: p }, p)));
    pat.value = m.pattern;
    return el('div', { class: 'site' },
      el('div', { class: 'top' },
        el('span', { class: 'name', title: `${base.soft ? 'soft' : 'crisp'}${base.solid ? ', solid' : ''}${base.height ? ', raised' : ''}` }, m.name),
        has ? el('button', { class: 'link', title: 'drop this override', onClick: () => { delete ed.theme.materials[m.name]; apply(); render(); } }, 'reset') : null),
      el('div', { class: 'ops' },
        m.colors.map((c, i) => color(i, c)), color(3, m.accent || defaultAccent(m)),
        pat,
        el('label', { title: 'stays lit in the dark' }, el('input', { type: 'checkbox', checked: !!m.glow, onChange: e => set('glow', e.target.checked) }), 'glow')),
      base.soft ? el('div', { class: 'row' }, el('span', {}, 'edge noise'), el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: m.noise || 0, onInput: e => set('noise', +e.target.value) })) : null,
      el('div', { class: 'row' }, el('span', { title: 'pattern variant (flowers, hazard stripes, wall style…)' }, 'variant'),
        el('input', { type: 'number', min: 0, max: 9, step: 1, value: m.param || 0, onChange: e => set('param', +e.target.value) })));
  }

  function propRows() {
    const draws = [...new Set(Object.values(ed.palette.props).filter(d => !d.skip && !d.ground).map(d => d.draw || 'box'))].sort();
    ed.theme.props = ed.theme.props || {};
    return draws.map(d => {
      const o = ed.theme.props[d] || {};
      const change = (k, v) => {
        const cur = { ...(ed.theme.props[d] || {}) };
        if (v === '') delete cur[k]; else cur[k] = v;
        if (Object.keys(cur).length) ed.theme.props[d] = cur; else delete ed.theme.props[d];
        apply();
      };
      const drawSel = el('select', { style: 'width: 92px', onChange: e => change('draw', e.target.value) },
        el('option', { value: '' }, '(same)'), DRAWERS.map(x => el('option', { value: x }, x)));
      drawSel.value = o.draw || '';
      return el('div', { class: 'row' }, el('span', {}, d), drawSel,
        el('input', { type: 'text', list: 'tree-palettes', placeholder: 'colour', style: 'width: 64px', value: o.color ?? '', onChange: e => change('color', e.target.value) }));
    });
  }

  async function save(name) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) { app.msg = 'Theme names are lower-case letters, digits and dashes.'; app.err = true; render(); return; }
    await busy('saving theme…', async () => {
      ed.theme.name = name;
      const r = await fetch(`/api/themes/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ed.theme) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      ed.themes = j;
      ed.dirty = false;
      storage.set('automix.theme', name);
      app.msg = `Saved theme ${name} to data/themes/${name}.json`;
    });
  }

  function themesTab() {
    if (!ed.palette) return el('div', { class: 'msg' }, 'loading…');
    const t = ed.theme;
    const pick = el('select', { onChange: async e => { await loadTheme(e.target.value); render(); } },
      ed.themes.map(x => el('option', { value: x.name }, `${x.title || x.name}${x.saved && !x.builtin ? ' (saved)' : ''}`)));
    pick.value = t.name;
    const nameIn = el('input', { type: 'text', value: t.name, style: 'width: 118px' });
    const mats = game.materials().length ? game.materials() : ed.palette.materials;
    const bySet = new Map();
    for (const m of mats) {
      if (!bySet.has(m.set || 'other')) bySet.set(m.set || 'other', []);
      bySet.get(m.set || 'other').push(m);
    }
    return [
      el('div', { class: 'row' }, el('span', {}, 'theme'), pick),
      el('div', { class: 'msg' }, (t.description || '') + (ed.dirty ? '\n(unsaved changes)' : '')),
      el('div', { class: 'row' }, el('span', {}, 'title'), el('input', { type: 'text', value: t.title || '', onChange: e => { t.title = e.target.value; ed.dirty = true; } })),
      el('div', { class: 'row' }, el('span', {}, 'save as'), nameIn),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', disabled: app.busy, onClick: () => save(nameIn.value.trim()) }, 'save'),
        el('button', { onClick: async () => { await loadTheme(t.name); render(); } }, 'revert'),
        el('button', { onClick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' })), download: `${t.name}.theme.json` });
          a.click();
        } }, 'download')),
      el('h4', {}, 'world'),
      el('div', { class: 'row' }, el('span', { title: '0 = daylight; otherwise the surface is dark and the walker carries a light this many tiles wide' }, 'night light'),
        el('input', { type: 'number', min: 0, max: 20, step: 1, value: t.surface_light || 0, onChange: e => { t.surface_light = +e.target.value; apply(); } })),
      el('div', { class: 'row' }, el('span', { title: 'CSS filter baked into every prop sprite, e.g. hue-rotate(40deg) saturate(1.3)' }, 'prop filter'),
        el('input', { type: 'text', value: t.prop_filter || '', onChange: e => { t.prop_filter = e.target.value; apply(); } })),
      el('h4', {}, 'materials'),
      [...bySet.keys()].sort((a, b) => (SET_ORDER.indexOf(a) + 99) % 99 - (SET_ORDER.indexOf(b) + 99) % 99).map(s =>
        el('details', {}, el('summary', {}, `${s} (${bySet.get(s).length})`), bySet.get(s).map(materialRow))),
      el('h4', {}, 'props'),
      el('details', {}, el('summary', {}, 'swap drawers and colours'), propRows(),
        el('datalist', { id: 'tree-palettes' }, TREE_PALETTES.map(p => el('option', { value: p })))),
    ];
  }

  return { ed, init, loadTheme, buildLab, labTab, themesTab };
}
