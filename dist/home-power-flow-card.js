/*!
 * Home Power Flow Card
 * A configurable Lovelace custom card for visualizing real-time home energy flow
 * (solar, inverter, battery, grid, EV and other devices) as an animated diagram.
 *
 * Author:     Dom (mimikm)
 * Repository: https://github.com/mimikm/Home-Power-Flow-Card
 * License:    MIT
 *
 * Issues & feature requests: https://github.com/mimikm/Home-Power-Flow-Card/issues
 */
(() => {
  const VERSION = '0.9.2';
  const DEFAULT_BG = '/hacsfiles/Home-Power-Flow-Card/smart-home-energy-background.png';
  const DEFAULT_BG_NIGHT = '/hacsfiles/Home-Power-Flow-Card/smart-home-energy-background2.png';
  const TYPES = [
    ['solar', '☀️ Solar PV'],
    ['inverter', '⚡ Inverter'],
    ['battery', '🔋 Battery'],
    ['gateway', '🧠 Gateway'],
    ['house', '🏠 House'],
    ['grid', '⚡ Grid'],
    ['generator', '⛽ Generator'],
    ['water', '💧 Water'],
    ['gas', '🔥 Gas'],
    ['ev', '🚗 EV Charger'],
    ['load', '⚙️ Extra Load'],
  ];

  const ICONS = {
    solar: '☀️', inverter: '⚡', battery: '🔋', gateway: '🧠', house: '🏠', grid: '⚡', generator: '⛽', water: '💧', gas: '🔥', ev: '🚗', load: '⚙️'
  };

  const LABELS = Object.fromEntries(TYPES);

  const FLOW_COLORS = {
    solar: '#63ff7d',
    inverter: '#a78bfa',
    battery: '#ff5c5c',
    gateway: '#b98cff',
    house: '#ffb52e',
    grid: '#43a5ff',
    generator: '#ff7eb6',
    water: '#4dd0e1',
    gas: '#ff7043',
    ev: '#ffd43b',
    load: '#ff9f2d',
    neutral: '#aab7c4'
  };

  function flowColor(a, b, reverse, active, customColors = {}) {
    const colors = { ...FLOW_COLORS, ...(customColors || {}) };
    if (!active) return colors.neutral || FLOW_COLORS.neutral;
    // Inverters and Gateways are junctions: they never dictate a flow line's
    // colour themselves, even when metered - colour always comes from
    // whichever connected device is the "real" one (solar, battery, grid,
    // house, EV, load). Only when BOTH sides of an edge are junctions
    // (e.g. inverter <-> gateway) does a junction's own colour apply, since
    // there's nothing else for that edge to take its colour from.
    let source = reverse ? b : a;
    const isHub = d => { const t = d?.type || 'load'; return t === 'inverter' || t === 'gateway'; };
    if (isHub(source)) {
      const other = source === a ? b : a;
      if (!isHub(other)) source = other;
    }
    return source?.flow_color || colors[source?.type || 'neutral'] || colors.neutral || FLOW_COLORS.neutral;
  }

  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  // Power display. mode: 'auto' (default: W below 1000 W, kW from 1000 W),
  // 'w' (always watts) or 'kw' (always kilowatts).
  const fmtPower = (v, mode = 'auto') => {
    const n = num(v);
    const kw = mode === 'kw' || (mode !== 'w' && Math.abs(n) >= 1000);
    if (!kw) return `${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)} W`;
    const k = n / 1000, a = Math.abs(k);
    return `${k.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)} kW`;
  };
  const fmtEnergy = v => {
    const n = num(v);
    return `${n.toFixed(n >= 100 ? 0 : 1)} kWh`;
  };

  function fire(el, type, detail) {
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  function genDeviceId() {
    return 'd' + Math.random().toString(36).slice(2, 9);
  }

  // Devices are referenced elsewhere (connects_to, and the manual
  // connections list's from/to) by a stable id, never by their position in
  // the devices array - so deleting or reordering a device can never
  // silently rewire a link onto the wrong one; a dangling reference just
  // falls back to automatic topology instead. This function is idempotent:
  // it assigns an id to any device that doesn't already have a unique one,
  // and migrates legacy configs (where connects_to / from / to were plain
  // array indices) into id references exactly once, using the array order
  // they were given in.
  function migrateDeviceIdsAndLinks(config) {
    if (!Array.isArray(config.devices)) config.devices = [];
    if (!Array.isArray(config.connections)) config.connections = [];

    const usedIds = new Set();
    config.devices.forEach(d => {
      if (d && typeof d.id === 'string' && d.id && !usedIds.has(d.id)) { usedIds.add(d.id); return; }
      let id; do { id = genDeviceId(); } while (usedIds.has(id));
      if (d) d.id = id;
      usedIds.add(id);
    });

    // Snapshot: old array index -> newly-assigned id, for migrating legacy
    // numeric references below (must happen before any index can drift).
    const idByOldIndex = config.devices.map(d => d.id);

    config.devices.forEach((d, i) => {
      if (!d) return;
      const raw = d.connects_to;
      if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
        const oldIdx = Number(raw);
        const resolved = (oldIdx >= 0 && oldIdx < idByOldIndex.length && oldIdx !== i) ? idByOldIndex[oldIdx] : undefined;
        if (resolved) d.connects_to = resolved; else delete d.connects_to;
      } else if (typeof raw === 'string') {
        if (!usedIds.has(raw) || raw === d.id) delete d.connects_to;
      } else if (raw !== undefined) {
        delete d.connects_to;
      }
    });

    config.connections = config.connections.map(e => {
      if (!e) return null;
      let from = e.from, to = e.to;
      if (typeof from === 'number') from = idByOldIndex[from];
      if (typeof to === 'number') to = idByOldIndex[to];
      if (typeof from !== 'string' || typeof to !== 'string' || !usedIds.has(from) || !usedIds.has(to) || from === to) return null;
      return { from, to, direction: Number(e.direction || 0) };
    }).filter(Boolean);

    return config;
  }

  // A noise-filtering flow threshold in the thousands of watts is never
  // intentional for a home setup - it's almost always a stale/corrupted
  // value carried over from an old config format or a units mixup. The
  // legacy migration below only fills in a MISSING value; it previously
  // trusted an already-present-but-wrong value forever. Clamp it instead.
  function migrateFlowThreshold(config) {
    if (!Number.isFinite(Number(config.flow_threshold_watts))) {
      const legacy = Number(config.flow_threshold);
      config.flow_threshold_watts = Number.isFinite(legacy) ? legacy * 1000 : 1;
    }
    config.flow_threshold_watts = Math.min(2000, Math.max(0, Number(config.flow_threshold_watts) || 0));
    config.flow_threshold = config.flow_threshold_watts / 1000;
    return config;
  }

  // ---- UK grid mix (NESO Carbon Intensity API, no key needed) ----------
  // One shared cache for every card instance (dashboard + editor preview),
  // keyed by outward postcode ('' = Great Britain). The API updates every
  // 30 minutes, so data is refetched at most that often; failures are
  // retried after 5 minutes.
  const GRID_MIX_API = 'https://api.carbonintensity.org.uk';
  const GRID_MIX_CACHE = new Map();
  const GRID_MIX_TTL = 30 * 60 * 1000, GRID_MIX_RETRY = 5 * 60 * 1000;
  const GRID_FUELS = {
    wind:    { label:'Wind',    icon:'mdi:wind-turbine',               color:'#4fc3f7' },
    solar:   { label:'Solar',   icon:'mdi:solar-power-variant',        color:'#ffd54f' },
    nuclear: { label:'Nuclear', icon:'mdi:atom',                       color:'#b388ff' },
    hydro:   { label:'Hydro',   icon:'mdi:hydro-power',                color:'#26a69a' },
    biomass: { label:'Biomass', icon:'mdi:leaf',                       color:'#8bc34a' },
    gas:     { label:'Gas',     icon:'mdi:fire',                       color:'#ff8a3d' },
    coal:    { label:'Coal',    icon:'mdi:factory',                    color:'#8d8d8d' },
    imports: { label:'Imports', icon:'mdi:transmission-tower-import',  color:'#90a4ae' },
    other:   { label:'Other',   icon:'mdi:dots-horizontal-circle-outline', color:'#bdbdbd' },
  };
  const GRID_INDEX = {
    'very low':  { label:'Very low',  color:'#2e7d32' },
    'low':       { label:'Low',       color:'#66bb6a' },
    'moderate':  { label:'Moderate',  color:'#f9a825' },
    'high':      { label:'High',      color:'#ef6c00' },
    'very high': { label:'Very high', color:'#c62828' },
  };
  function gridMixPostcode(raw) {
    const outward = String(raw || '').trim().toUpperCase().split(/\s+/)[0].replace(/[^A-Z0-9]/g, '');
    return /^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(outward) ? outward : '';
  }
  async function gridMixFetchJson(url) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 10000) : null;
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl?.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { if (timer) clearTimeout(timer); }
  }
  // Normalises both API shapes into { region, intensity, index, mix:[{fuel,perc}] }.
  async function gridMixLoad(postcode) {
    if (postcode) {
      const j = await gridMixFetchJson(`${GRID_MIX_API}/regional/postcode/${encodeURIComponent(postcode)}`);
      const reg = Array.isArray(j?.data) ? j.data[0] : j?.data;
      const period = Array.isArray(reg?.data) ? reg.data[0] : reg?.data;
      if (!period) throw new Error('No regional data');
      return { region: reg.shortname || postcode, intensity: period.intensity?.forecast, index: period.intensity?.index, mix: period.generationmix || [] };
    }
    const [ij, gj] = await Promise.all([gridMixFetchJson(`${GRID_MIX_API}/intensity`), gridMixFetchJson(`${GRID_MIX_API}/generation`)]);
    const ip = Array.isArray(ij?.data) ? ij.data[0] : ij?.data;
    const gp = Array.isArray(gj?.data) ? gj.data[0] : gj?.data;
    if (!ip) throw new Error('No national data');
    return { region: 'Great Britain', intensity: ip.intensity?.actual ?? ip.intensity?.forecast, index: ip.intensity?.index, mix: gp?.generationmix || [] };
  }
  function gridMixGet(postcode, onData) {
    const key = postcode || '';
    let e = GRID_MIX_CACHE.get(key);
    const now = Date.now();
    if (e?.promise) { e.promise.then(() => onData(GRID_MIX_CACHE.get(key))); return e; }
    if (e && ((e.data && now - e.t < GRID_MIX_TTL) || (e.error && now - e.t < GRID_MIX_RETRY))) return e;
    const entry = { t: now, data: e?.data || null, error: null };
    entry.promise = gridMixLoad(key)
      .then(d => { entry.data = d; entry.error = null; })
      .catch(err => { entry.error = String(err?.message || err); })
      .finally(() => { entry.t = Date.now(); entry.promise = null; onData(entry); });
    GRID_MIX_CACHE.set(key, entry);
    return entry;
  }

  // ---- Themes: colours for boxes/panels and their text ------------------
  // 'dark' holds the card's original colours, so existing cards look the same.
  const NODE_DARK = 'linear-gradient(145deg,rgba(9,25,40,.87),rgba(15,30,44,.73))';
  const THEMES = {
    dark:     { label:'Dark',     node:NODE_DARK, panel:'rgba(8,29,52,.78)', stats:'linear-gradient(145deg,rgba(45,38,33,.74),rgba(18,25,31,.74))', border:'rgba(255,255,255,.16)', text:'#ffffff', track:'rgba(255,255,255,.1)' },
    light:    { label:'Light',    node:'linear-gradient(145deg,rgba(255,255,255,.9),rgba(236,241,246,.82))', panel:'rgba(250,252,255,.86)', stats:'linear-gradient(145deg,rgba(255,255,255,.88),rgba(235,240,245,.84))', border:'rgba(20,40,60,.14)', text:'#15202b', track:'rgba(0,0,0,.1)' },
    midnight: { label:'Midnight', node:'linear-gradient(145deg,rgba(0,0,0,.84),rgba(14,14,18,.74))', panel:'rgba(0,0,0,.74)', stats:'linear-gradient(145deg,rgba(0,0,0,.8),rgba(14,14,18,.76))', border:'rgba(255,255,255,.12)', text:'#f5f5f5', track:'rgba(255,255,255,.1)' },
    ocean:    { label:'Ocean',    node:'linear-gradient(145deg,rgba(0,77,92,.84),rgba(0,51,68,.76))', panel:'rgba(0,64,80,.8)', stats:'linear-gradient(145deg,rgba(0,70,86,.8),rgba(0,45,60,.78))', border:'rgba(128,222,234,.26)', text:'#e0f7fa', track:'rgba(224,247,250,.14)' },
    forest:   { label:'Forest',   node:'linear-gradient(145deg,rgba(27,67,40,.84),rgba(17,45,28,.76))', panel:'rgba(22,56,34,.8)', stats:'linear-gradient(145deg,rgba(26,62,38,.8),rgba(15,40,25,.78))', border:'rgba(165,214,167,.26)', text:'#f1f8e9', track:'rgba(241,248,233,.14)' },
    sunset:   { label:'Sunset',   node:'linear-gradient(145deg,rgba(94,33,64,.84),rgba(140,58,33,.74))', panel:'rgba(110,40,60,.8)', stats:'linear-gradient(145deg,rgba(100,36,62,.8),rgba(130,52,32,.78))', border:'rgba(255,183,77,.3)', text:'#fff3e0', track:'rgba(255,243,224,.16)' },
    graphite: { label:'Graphite', node:'linear-gradient(145deg,rgba(55,60,66,.86),rgba(38,42,47,.78))', panel:'rgba(48,52,58,.82)', stats:'linear-gradient(145deg,rgba(52,56,62,.82),rgba(36,40,45,.8))', border:'rgba(255,255,255,.14)', text:'#eceff1', track:'rgba(255,255,255,.12)' },
  };
  // Multiplies every rgba() alpha in a CSS background by f (capped at 1),
  // used for the "Box opacity" setting on top of any theme.
  function scaleAlpha(css, f) {
    return String(css).replace(/rgba\(([^,]+),([^,]+),([^,]+),\s*([\d.]+)\)/g, (m, r, g, b, a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, Number(a) * f)).toFixed(3)})`);
  }
  function hexRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  // Custom theme from a panel colour, text colour and opacity.
  function customTheme(panelHex, textHex, opacity) {
    const p = hexRgb(panelHex) || [8, 29, 52];
    const t = hexRgb(textHex) || [255, 255, 255];
    const op = Math.max(0.2, Math.min(1, Number.isFinite(Number(opacity)) ? Number(opacity) : 0.8));
    const d = p.map(v => Math.round(v * 0.72));
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(2)})`;
    const grad = `linear-gradient(145deg,${rgba(p, op + 0.06)},${rgba(d, op - 0.04)})`;
    return { node: grad, panel: rgba(p, op), stats: grad, border: rgba(t, 0.18), text: `rgb(${t.join(',')})`, track: rgba(t, 0.12) };
  }

  // ---- Phone layout ------------------------------------------------------
  // Phone mode uses a portrait 800x1200 stage with its own positions. Keys
  // for panel positions: desktop key -> phone key, with default positions.
  const PANEL_POS = {
    header:  { key:'header_position',   phone:'phone_header_position',   d:[2.6, 2.7], p:[4, 1.5] },
    weather: { key:'weather_position',  phone:'phone_weather_position',  d:[82, 10],   p:[74, 10] },
    gridmix: { key:'grid_mix_position', phone:'phone_grid_mix_position', d:[83, 32],   p:[27, 14] },
    updated: { key:'updated_position',  phone:'phone_updated_position',  d:[50, 95],   p:[50, 21.5] },
    bins:    { key:'bins_position',     phone:'phone_bins_position',     d:[50, 8],    p:[30, 13] },
    stats:   { key:'stats_position',    phone:'phone_stats_position',    d:[17, 86],   p:[50, 84] },
  };
  // Default phone layout: devices keep their desktop top-to-bottom order
  // and are arranged in rows of three (left to right by desktop position),
  // below the title/weather area. The Today panel goes under the last row.
  function phoneAutoLayout(devices, desktopPos) {
    const order = devices.map((d, i) => i).filter(i => devices[i]?.phone_hidden !== true).sort((a, b) => (desktopPos[a].y - desktopPos[b].y) || (desktopPos[a].x - desktopPos[b].x));
    const out = new Array(devices.length), rows = Math.ceil(order.length / 3);
    const rowH = rows > 1 ? Math.min(10.5, 44 / (rows - 1)) : 0, top = 28;
    for (let r = 0; r < rows; r++) {
      const chunk = order.slice(r * 3, r * 3 + 3).sort((a, b) => desktopPos[a].x - desktopPos[b].x);
      const xs = chunk.length === 1 ? [50] : chunk.length === 2 ? [30, 70] : [17, 50, 83];
      chunk.forEach((i, k) => { out[i] = { x: xs[k], y: top + r * rowH }; });
    }
    devices.forEach((d, i) => { if (!out[i]) out[i] = desktopPos[i]; }); // hidden devices: not shown on phone
    const lastY = rows ? top + (rows - 1) * rowH : top;
    return { positions: out, statsY: Math.max(72, Math.min(88, lastY + 19)) };
  }
  // Background focus point for the portrait crop (percent, default centre).
  function phoneBgFocus(c) {
    const f = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; };
    return `${f(c?.phone_bg_focus_x)}% ${f(c?.phone_bg_focus_y)}%`;
  }
  // Today panel style for a layout: floating (draggable) or docked to a card
  // edge, optionally auto-hiding. The phone layout can override desktop.
  function statsDockFor(c, phone) {
    c = c || {};
    let mode = c.stats_mode === 'docked' ? 'docked' : 'floating', edge = c.stats_dock_edge, autohide = c.stats_dock_autohide !== false;
    if (phone && c.phone_stats_mode && c.phone_stats_mode !== 'same') {
      mode = c.phone_stats_mode === 'docked' ? 'docked' : 'floating'; edge = c.phone_stats_dock_edge; autohide = c.phone_stats_dock_autohide !== false;
    }
    return { mode, edge: ['bottom', 'top', 'left', 'right'].includes(edge) ? edge : 'bottom', autohide };
  }
  // Desktop card shapes (width / height). 'image' matches the background
  // picture, 'screen' fills the available screen area.
  const CARD_RATIOS = { '3:2': 1.5, '4:3': 4 / 3, '16:10': 1.6, '16:9': 16 / 9, '2:1': 2, '21:9': 21 / 9, '32:9': 32 / 9 };
  const clampRatio = r => Math.max(1, Math.min(4, Number(r) || 1.5));
  // Last 'Fill the screen' shape measured by a dashboard card on this page.
  // The editor preview uses it instead of measuring itself: the preview
  // resizes the card to fit its shape, so measuring there would loop.
  let SCREEN_RATIO_HINT = null;
  // Battery and Grid can use either one signed power sensor (default) or two
  // separate sensors that both report positive values (e.g. Growatt). The
  // pair is combined into the card's convention: battery positive =
  // discharging, grid positive = export.
  const SPLIT_KEYS = { battery: ['battery_discharge_power_entity', 'battery_charge_power_entity'], grid: ['grid_export_power_entity', 'grid_import_power_entity'] };
  function isSplit(d) { return d?.power_mode === 'split' && !!SPLIT_KEYS[d.type]; }
  function deviceEntities(d) {
    if (isSplit(d)) return SPLIT_KEYS[d.type].map(k => d[k]).filter(e => e && String(e).trim());
    return d?.power_entity && String(d.power_entity).trim() ? [d.power_entity] : [];
  }
  function hasPower(d) { return deviceEntities(d).length > 0; }
  function devicePower(hass, d) {
    if (!isSplit(d)) return powerValue(hass, d?.power_entity);
    const [pk, nk] = SPLIT_KEYS[d.type];
    const pos = d[pk] ? powerValue(hass, d[pk]) : null, neg = d[nk] ? powerValue(hass, d[nk]) : null;
    if (pos == null && neg == null) return null;
    return Math.abs(pos || 0) - Math.abs(neg || 0);
  }
  // Custom device box size (stage px) for desktop or phone; null = default.
  const BOX_MIN_W = 110, BOX_MIN_H = 60, BOX_MAX_W = 700, BOX_MAX_H = 500;
  function boxSizeFor(d, phone) {
    const w = Number(phone ? d?.phone_box_w : d?.box_w), h = Number(phone ? d?.phone_box_h : d?.box_h);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w: Math.max(BOX_MIN_W, Math.min(BOX_MAX_W, w)), h: Math.max(BOX_MIN_H, Math.min(BOX_MAX_H, h)) } : null;
  }
  // Flow line looks: line pattern, thickness, glow and what moves along it.
  const FLOW_LOOKS = {
    classic:   { label: 'Classic',       pattern: '2 6',  width: 2.1,     glow: 'soft', anim: 'dot' },
    neon:      { label: 'Neon',          pattern: '',     width: 2.4,     glow: 'neon', anim: 'comet' },
    stream:    { label: 'Energy stream', pattern: '2 6',  width: 'power', glow: 'soft', anim: 'particles' },
    marching:  { label: 'Marching',      pattern: '10 8', width: 2.4,     glow: 'soft', anim: 'march' },
    minimal:   { label: 'Minimal',       pattern: '',     width: 1.4,     glow: 'off',  anim: 'dot', small: true },
    blueprint: { label: 'Blueprint',     pattern: '8 6',  width: 1.5,     glow: 'off',  anim: 'arrows' },
    static:    { label: 'Static',        pattern: '2 6',  width: 2.1,     glow: 'soft', anim: 'none' },
  };
  const validPos = p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null;

  // ---- Translations ------------------------------------------------------
  // Card and editor follow the Home Assistant user's language (Polish and
  // Spanish so far); anything without a translation stays in English.
  // Keys are the English phrases; {x} placeholders are filled in by tr().
  const I18N = { pl: {"Today": "Dzisiaj", "Energy Flow": "Przepływ energii", "Self-sufficiency now": "Samowystarczalność teraz", "Self-sufficiency today": "Samowystarczalność dziś", "Self-consumption now": "Autokonsumpcja teraz", "Self-consumption today": "Autokonsumpcja dziś", "Updated": "Aktualizacja", "just now": "przed chwilą", "{n}s ago": "{n} s temu", "{m}m {s}s ago": "{m} min {s} s temu", "{h}h {m}m ago": "{h} godz. {m} min temu", "{d}d {h}h ago": "{d} dn. {h} godz. temu", "No data": "Brak danych", "Unknown": "Nieznane", "to full": "do pełna", "to empty": "do 0%", "to {p}%": "do {p}%", "at reserve": "na rezerwie", "at {p}%": "osiągnięto {p}%", "Grid": "Sieć", "Great Britain": "Wielka Brytania", "Loading grid data…": "Ładowanie danych sieci…", "Grid data unavailable": "Dane sieci niedostępne", "Showing last data (update failed)": "Ostatnie dane (aktualizacja nieudana)", "Wind": "Wiatr", "Solar": "Słońce", "Nuclear": "Jądrowa", "Hydro": "Wodna", "Biomass": "Biomasa", "Gas": "Gaz", "Coal": "Węgiel", "Imports": "Import", "Other": "Inne", "Very low": "Bardzo niska", "Low": "Niska", "Moderate": "Umiarkowana", "High": "Wysoka", "Very high": "Bardzo wysoka", "Add your first device": "Dodaj pierwsze urządzenie", "Open the card editor and add Solar, Inverter, Battery, Grid or House.": "Otwórz edytor karty i dodaj fotowoltaikę, falownik, baterię, sieć lub dom.", "☀️ Solar PV": "☀️ Fotowoltaika", "⚡ Inverter": "⚡ Falownik", "🔋 Battery": "🔋 Bateria", "🧠 Gateway": "🧠 Bramka", "🏠 House": "🏠 Dom", "⚡ Grid": "⚡ Sieć", "⛽ Generator": "⛽ Agregat", "💧 Water": "💧 Woda", "🔥 Gas": "🔥 Gaz", "🚗 EV Charger": "🚗 Ładowarka EV", "⚙️ Extra Load": "⚙️ Dodatkowe obciążenie", "Home Power Flow": "Home Power Flow", "Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.": "Dwukierunkowy przepływ energii na podstawie bieżących wartości dodatnich/ujemnych, kropkowane połączenia, poruszająca się kropka, odwracalny kierunek urządzeń, dynamiczne kolory przepływu i układ z przeciąganiem. Pełne identyfikatory encji są widoczne pod każdym polem wyboru.", "Backup": "Kopia zapasowa", "Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.": "Pobierz całą konfigurację karty jako plik albo przywróć wcześniej zapisaną. Import zastępuje wszystkie ustawienia poniżej (urządzenia, połączenia, układ, statystyki) - zmiany trafią na pulpit dopiero po kliknięciu Zapisz.", "⬇ Export config": "⬇ Eksportuj konfigurację", "⬆ Import config": "⬆ Importuj konfigurację", "Downloaded.": "Pobrano.", "Export failed - see the browser console for details.": "Eksport nieudany - szczegóły w konsoli przeglądarki.", "Import failed - that file is not a valid Home Power Flow Card config.": "Import nieudany - ten plik nie jest prawidłową konfiguracją Home Power Flow Card.", "Imported. Click Save below to keep it on this dashboard.": "Zaimportowano. Kliknij Zapisz poniżej, aby zachować na tym pulpicie.", "Title": "Tytuł", "Subtitle": "Podtytuł", "Title colour": "Kolor tytułu", "Time format": "Format czasu", "24 hour": "24-godzinny", "12 hour": "12-godzinny", "Weather entity": "Encja pogody", "Day background": "Tło dzienne", "Night background": "Tło nocne", "📤 Upload image": "📤 Prześlij obraz", "👁 Preview this background": "👁 Podgląd tła", "Restore default": "Przywróć domyślne", "Using the default background": "Używane jest domyślne tło", "Uploading…": "Przesyłanie…", "Upload failed - check that you are an admin user and try again.": "Przesyłanie nieudane - sprawdź, czy masz uprawnienia administratora i spróbuj ponownie.", "Sun entity (switches day/night background)": "Encja słońca (przełącza tło dzień/noc)", "Flow threshold (W)": "Próg przepływu (W)", "Flow animation speed (seconds)": "Szybkość animacji przepływu (sekundy)", "Particle stagger (seconds)": "Odstęp cząsteczek (sekundy)", "Not selected": "Nie wybrano", "Last updated box": "Ramka ostatniej aktualizacji", "Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.": "Opcjonalna mała ramka pokazująca, jak dawno zaktualizowano encję, np. dane falownika. Używa własnego znacznika czasu encji, jeśli go ma. Zmienia kolor na pomarańczowy, gdy dane są starsze niż czas ostrzeżenia.", "Show last updated box": "Pokaż ramkę ostatniej aktualizacji", "Label": "Etykieta", "Warn after (minutes)": "Ostrzeż po (minutach)", "Entity": "Encja", "UK grid mix": "Miks energetyczny UK", "Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.": "Opcjonalna ramka pokazująca, jak „zielona” jest teraz brytyjska sieć (emisyjność i miks wytwarzania), z API Carbon Intensity operatora National Grid ESO. Aktualizacja co 30 minut.", "Show grid mix box": "Pokaż ramkę miksu energetycznego", "Postcode (optional)": "Kod pocztowy (opcjonalnie)", "Appearance": "Wygląd", "Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.": "Motyw kolorystyczny ramek i paneli. Tło, kolory przepływu i kolor tytułu ustawia się osobno.", "Theme": "Motyw", "Auto (follow Home Assistant)": "Auto (jak w Home Assistant)", "Dark": "Ciemny", "Light": "Jasny", "Midnight": "Północ", "Ocean": "Ocean", "Forest": "Las", "Sunset": "Zachód słońca", "Graphite": "Grafit", "Custom colours": "Własne kolory", "Panel colour": "Kolor paneli", "Text colour": "Kolor tekstu", "Panel opacity": "Krycie paneli", "Flow line style": "Styl linii przepływu", "Curved": "Zaokrąglone", "Right angles (avoid boxes)": "Kąty proste (omijają ramki)", "Power units": "Jednostki mocy", "Auto (W, kW from 1000 W)": "Auto (W, kW od 1000 W)", "Always W": "Zawsze W", "Always kW": "Zawsze kW", "History hours": "Zakres historii", "History opacity": "Krycie historii", "6 h": "6 godz.", "12 h": "12 godz.", "24 h": "24 godz.", "48 h": "48 godz.", "Sizing": "Rozmiary", "1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.": "1 = rozmiar domyślny. Skala małego ekranu powiększa ramki na telefonach (stopniowo poniżej 900 px szerokości). Maks. szerokość 0 = cała dostępna szerokość; karta nigdy nie jest wyższa niż ekran. Panel Dzisiaj zmniejsza się automatycznie, jeśli byłby wyższy niż karta.", "Device boxes": "Ramki urządzeń", "Weather box": "Ramka pogody", "Today panel": "Panel Dzisiaj", "Small screen": "Mały ekran", "Max width (px)": "Maks. szerokość (px)", "Grid mix": "Miks energetyczny", "Updated box": "Ramka aktualizacji", "Visual layout": "Układ wizualny", "🖥️ Desktop": "🖥️ Komputer", "📱 Phone": "📱 Telefon", "Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.": "Przeciągaj ramki urządzeń na szablonie, aby ustawić je dokładnie tam, gdzie chcesz. Pozycje zapisują się automatycznie. Nowe urządzenia bez zapisanej pozycji używają układu automatycznego.", "Phone layout: used when the card is narrower than the breakpoint. Drag boxes to arrange it; boxes you have not moved use an automatic arrangement. Your desktop layout is not affected.": "Układ telefonu: używany, gdy karta jest węższa niż próg. Przeciągaj ramki, aby go ułożyć; nieprzesunięte ramki układają się automatycznie. Układ komputerowy pozostaje bez zmian.", "Phone layout": "Układ telefonu", "Auto (narrow screens)": "Auto (wąskie ekrany)", "Always": "Zawsze", "Never": "Nigdy", "Switch below (px)": "Przełącz poniżej (px)", "Background focus ↔": "Punkt skupienia tła ↔", "Background focus ↕": "Punkt skupienia tła ↕", "↺ Reset positions to automatic": "↺ Przywróć automatyczne pozycje", "⧉ Copy desktop layout": "⧉ Kopiuj układ komputerowy", "↺ Reset phone layout": "↺ Resetuj układ telefonu", "Show on phone": "Pokaż na telefonie", "Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.": "Odznaczone elementy są ukryte tylko w układzie telefonu. Ukrycie urządzenia ukrywa też jego linie przepływu.", "🔤 Title": "🔤 Tytuł", "🌤️ Weather": "🌤️ Pogoda", "🌍 Grid mix": "🌍 Miks energetyczny", "🕒 Updated": "🕒 Aktualizacja", "📊 Daily Stats": "📊 Statystyki dnia", "Devices": "Urządzenia", "＋ Add device": "＋ Dodaj urządzenie", "Type": "Typ", "Name": "Nazwa", "Power entity": "Encja mocy", "Meter or flow entity": "Encja licznika lub przepływu", "Connects to": "Połączone z", "Automatic": "Automatycznie", "Automatic = the (first) inverter, or a Gateway/Distribution Board device for extra inverters. Override this for multi-inverter or custom topologies.": "Automatycznie = (pierwszy) falownik albo bramka/rozdzielnica dla kolejnych falowników. Zmień to dla wielu falowników lub własnych topologii.", "Flow colour": "Kolor przepływu", "Only used if this device has its own power entity.": "Używany tylko, gdy urządzenie ma własną encję mocy.", "Flow direction": "Kierunek przepływu", "↔ Normal": "↔ Normalny", "↔ Inverted": "↔ Odwrócony", "Visual direction only": "Tylko kierunek wizualny", "Show history graph": "Pokaż wykres historii", "Power history as a faint graph behind the box. Range and opacity are under Appearance.": "Historia mocy jako delikatny wykres w tle ramki. Zakres i krycie ustawisz w sekcji Wygląd.", "Show charge/discharge glow": "Pokaż poświatę ładowania/rozładowania", "Pulses the box when actively charging or discharging.": "Ramka pulsuje podczas ładowania lub rozładowania.", "Show time remaining": "Pokaż pozostały czas", "Estimated time to full (charging) or to reserve (discharging), shown under the power value.": "Szacowany czas do pełna (ładowanie) lub do rezerwy (rozładowanie), wyświetlany pod wartością mocy.", "State of charge (%)": "Stan naładowania (%)", "Capacity (kWh)": "Pojemność (kWh)", "Reserve %": "Rezerwa %", "Charge limit %": "Limit ładowania %", "Capacity sensor (optional, overrides the number above)": "Czujnik pojemności (opcjonalnie, zastępuje liczbę powyżej)", "Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.": "Wyświetlane w litrach. Czujniki w m³ są przeliczane automatycznie. W trybie automatycznym woda łączy się z urządzeniem Dom.", "Show gas in": "Pokaż gaz w", "Calorific value (MJ/m³)": "Wartość opałowa (MJ/m³)", "Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.": "Służy do przeliczania m³ i kWh (zob. rachunek za gaz). W trybie automatycznym gaz łączy się z urządzeniem Dom.", "＋ Add extra entity": "＋ Dodaj dodatkową encję", "Maximum of 5 extra entities reached.": "Osiągnięto maksimum 5 dodatkowych encji.", "Icon (Material Design Icons)": "Ikona (Material Design Icons)", "Connections": "Połączenia", "Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.": "Opcjonalne. Zostaw puste, aby użyć topologii automatycznej. Dodaj połączenia, aby w pełni kontrolować, dokąd płynie energia.", "From": "Od", "To": "Do", "From → To": "Od → Do", "To → From": "Do → Od", "Auto — use live power signs": "Auto — według znaku bieżącej mocy", "Remove connection": "Usuń połączenie", "＋ Add connection": "＋ Dodaj połączenie", "Today statistics": "Statystyki dnia", "Add up to 20 custom statistics. Choose your own name, entity and icon.": "Dodaj do 20 własnych statystyk. Wybierz nazwę, encję i ikonę.", "Material Design Icon": "Ikona Material Design", "Custom icon override": "Własna ikona (zastępuje)", "＋ Add statistic": "＋ Dodaj statystykę", "No statistics added.": "Nie dodano statystyk.", "Statistic": "Statystyka", "Self-sufficiency": "Samowystarczalność", "Self-consumption": "Autokonsumpcja", ": share of your home's electricity that didn't come from the grid.": ": udział energii w domu, która nie pochodziła z sieci.", ": share of your solar you used yourself instead of exporting. Shown at the top of the Today panel.": ": udział energii słonecznej zużytej na miejscu zamiast oddanej do sieci. Wyświetlane na górze panelu Dzisiaj.", "Now": "Teraz", "is calculated automatically from your devices;": "jest obliczane automatycznie z twoich urządzeń;", "today": "dziś", "uses the daily energy sensors below.": "korzysta z dziennych czujników energii poniżej.", "Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.": "Dzienne czujniki energii (kWh lub Wh). Samowystarczalność dziś wymaga poboru i zużycia; autokonsumpcja dziś wymaga produkcji PV i oddania.", "Grid import today": "Pobór z sieci dziś", "Grid export today": "Oddanie do sieci dziś", "Solar production today": "Produkcja PV dziś", "Home consumption today": "Zużycie domu dziś", "Calculate consumption instead (import + solar − export + battery discharge − battery charge)": "Oblicz zużycie zamiast tego (pobór + PV − oddanie + rozładowanie baterii − ładowanie baterii)", "Battery charge today (optional, for calculated consumption)": "Ładowanie baterii dziś (opcjonalnie, do obliczania zużycia)", "Battery discharge today (optional, for calculated consumption)": "Rozładowanie baterii dziś (opcjonalnie, do obliczania zużycia)", "off": "wyłączone", "Choose flow colour": "Wybierz kolor przepływu", "Drag to reorder": "Przeciągnij, aby zmienić kolejność", "Duplicate device": "Duplikuj urządzenie", "Leave empty for no title": "Zostaw puste, aby nie było tytułu", "Leave empty for none": "Zostaw puste, aby nie było etykiety", "Optional": "Opcjonalnie", "Or paste an image URL instead": "Albo wklej adres URL obrazu", "Remove": "Usuń", "e.g. 13.5": "np. 13,5", "e.g. SW1A, blank = all of GB": "np. SW1A, puste = cała Wielka Brytania", "Not connected to anything": "Brak połączeń", "idle": "bezczynne", "Today panel style": "Styl panelu Dzisiaj", "Floating (drag anywhere)": "Pływający (przeciągnij w dowolne miejsce)", "Docked to card edge": "Przypięty do krawędzi karty", "Dock edge": "Krawędź", "Bottom": "Dół", "Top": "Góra", "Left": "Lewo", "Right": "Prawo", "Auto-hide (slides out on hover or tap)": "Autoukrywanie (wysuwa się po najechaniu lub dotknięciu)", "On phone": "Na telefonie", "Same as desktop": "Tak jak na komputerze", "Floating": "Pływający", "Docked": "Przypięty", "Phone dock edge": "Krawędź na telefonie", "Phone auto-hide": "Autoukrywanie na telefonie", "Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.": "Przypięty panel znajduje się przy krawędzi karty i nie da się go przeciągać. Autoukrywanie zwija panel do zakładki, która wysuwa się po najechaniu lub dotknięciu.", "Box opacity": "Krycie ramek", "Card shape": "Kształt karty", "3:2 (default)": "3:2 (domyślny)", "21:9 (ultra-wide)": "21:9 (ultraszeroki)", "32:9 (super ultra-wide)": "32:9 (superszeroki)", "Match background image": "Dopasuj do obrazu tła", "Fill the screen": "Wypełnij ekran", "Background fit": "Dopasowanie tła", "Fill (crop to card)": "Wypełnij (przytnij do karty)", "Fit whole image (blurred edges)": "Pokaż cały obraz (rozmyte krawędzie)", "Power sensor": "Czujnik mocy", "One sensor (+/−)": "Jeden czujnik (+/−)", "Separate sensors": "Osobne czujniki", "Discharge power (W)": "Moc rozładowania (W)", "Charge power (W)": "Moc ładowania (W)", "Export power (W)": "Moc oddawana do sieci (W)", "Import power (W)": "Moc pobierana z sieci (W)", "Each sensor reports a positive number; the card combines them.": "Każdy czujnik podaje liczbę dodatnią; karta łączy je w jedną wartość.", "Show idle connections": "Pokaż nieaktywne połączenia", "Power sensors": "Czujniki mocy", "One sensor (+ and −)": "Jeden czujnik (+ i −)", "Charging power": "Moc ładowania", "Discharging power": "Moc rozładowania", "Import power": "Moc poboru z sieci", "Export power": "Moc oddawania do sieci", "Positive = discharging, negative = charging. If yours is the other way round, use Flow direction.": "Dodatnia = rozładowanie, ujemna = ładowanie. Jeśli u ciebie jest odwrotnie, użyj ustawienia Kierunek przepływu.", "Positive = export, negative = import. If yours is the other way round, use Flow direction.": "Dodatnia = oddawanie do sieci, ujemna = pobór. Jeśli u ciebie jest odwrotnie, użyj ustawienia Kierunek przepływu.", "Two sensors that both report positive values (e.g. Growatt). The card combines them into one value.": "Dwa czujniki, oba z wartościami dodatnimi (np. Growatt). Karta łączy je w jedną wartość.", "Show flow lines": "Pokaż linie przepływu", "Untick to hide this device's flow lines. Its box and values keep working.": "Odznacz, aby ukryć linie przepływu tego urządzenia. Ramka i wartości działają dalej.", "Reverses the flow. For batteries and the grid it also swaps charging/discharging or import/export.": "Odwraca przepływ. Dla baterii i sieci zamienia też ładowanie/rozładowanie lub pobór/oddawanie.", "Drag to resize, double-click to reset size": "Przeciągnij, aby zmienić rozmiar; kliknij dwukrotnie, aby przywrócić", "Resize a device box by dragging its right or bottom edge or its corner; double-click the corner to reset its size. Text scales to fit.": "Zmieniaj rozmiar ramki urządzenia, przeciągając jej prawą lub dolną krawędź albo róg; dwuklik na rogu przywraca rozmiar. Tekst dopasowuje się do ramki.", "Manual (draw your own)": "Ręcznie (narysuj własne)", "Manual lines: click a line to add a bend point, drag points to move them (they snap into line; hold Shift to place freely), double-click a point to remove it, double-click a line to make it straight again.": "Linie ręczne: kliknij linię, aby dodać punkt załamania, przeciągaj punkty (przyciągają się do linii; przytrzymaj Shift, aby ustawić swobodnie), kliknij dwukrotnie punkt, aby go usunąć, kliknij dwukrotnie linię, aby znów była prosta.", "↺ Reset all lines": "↺ Resetuj wszystkie linie", "Flow line look (day)": "Wygląd linii (dzień)", "Flow line look (night)": "Wygląd linii (noc)", "Same as day": "Tak jak w dzień", "Classic": "Klasyczny", "Neon": "Neon", "Energy stream": "Strumień energii", "Marching": "Maszerujące kreski", "Minimal": "Minimalny", "Blueprint": "Plan techniczny", "Static": "Statyczny", "Flow colour by direction": "Kolor przepływu wg kierunku", "One colour": "Jeden kolor", "Glow colours (green charging, amber discharging)": "Kolory poświaty (zielony ładowanie, pomarańczowy rozładowanie)", "Charging colour": "Kolor ładowania", "Discharging colour": "Kolor rozładowania", "Import colour": "Kolor poboru", "Export colour": "Kolor oddawania", "Today decimals": "Miejsca po przecinku (Dzisiaj)", "No power sensor selected.": "Nie wybrano czujnika mocy.", "Separate sensors: pick both sensors.": "Osobne czujniki: wybierz oba czujniki.", "{e} doesn't exist (renamed or removed?).": "{e} nie istnieje (zmieniono nazwę lub usunięto?).", "{e} is currently unavailable.": "{e} jest obecnie niedostępny.", "{e} reports {u}, not watts. Pick a power sensor (W or kW); state of charge belongs in the battery's State of charge field.": "{e} podaje {u}, a nie waty. Wybierz czujnik mocy (W lub kW); stan naładowania ustaw w polu Stan naładowania baterii.", "Connects to a device that no longer exists, so Automatic is used.": "Połączone z urządzeniem, które już nie istnieje, więc używane jest Automatycznie.", "Connection loop: these devices connect to each other ({n}).": "Pętla połączeń: te urządzenia łączą się ze sobą nawzajem ({n}).", "Not connected to anything: add an Inverter or Gateway, or set Connects to.": "Brak połączenia: dodaj falownik lub bramkę albo ustaw Połączone z.", "Water and gas connect to a House device on Automatic: add a House device or set Connects to.": "Woda i gaz w trybie automatycznym łączą się z urządzeniem Dom: dodaj Dom lub ustaw Połączone z.", "Time remaining needs a state of charge sensor and a capacity.": "Pozostały czas wymaga czujnika stanu naładowania i pojemności.", "{n} device(s) need attention": "Urządzenia wymagające uwagi: {n}", "Day": "Dzień", "Night": "Noc", "Rain": "Deszcz", "Snow": "Śnieg", "Halloween": "Halloween", "Christmas": "Boże Narodzenie", "Easter": "Wielkanoc", "Custom dates": "Własne daty", "Season": "Sezon", "Upload": "Prześlij", "Uses day picture": "Używa zdjęcia dziennego", "Paste an image URL": "Wklej adres URL obrazu", "Image URL": "Adres URL obrazu", "Preview in the layout below": "Podgląd w układzie poniżej", "Tap to upload or replace the picture": "Kliknij, aby przesłać lub zmienić zdjęcie", "showing now": "wyświetlane teraz", "Palm Sunday to Easter Monday": "Od Niedzieli Palmowej do Poniedziałku Wielkanocnego", "Animated rain & snow": "Animowany deszcz i śnieg", "Draws falling rain, snow, hail and lightning over your background whenever your weather entity reports them. Works with any background, no extra pictures needed. Wind from the weather entity tilts the rain.": "Rysuje padający deszcz, śnieg, grad i błyskawice na tle, gdy encja pogody je zgłasza. Działa z każdym tłem, bez dodatkowych zdjęć. Wiatr z encji pogody pochyla deszcz.", "Amount": "Ilość", "Lightning flashes in thunderstorms": "Błyski podczas burzy", "Try it on the card preview": "Wypróbuj na podglądzie karty", "Heavy rain": "Ulewa", "Storm": "Burza", "Sleet": "Deszcz ze śniegiem", "Hail": "Grad", "Stop": "Zatrzymaj", "Preview only while the editor is open; the card then follows your real weather again.": "Podgląd działa tylko przy otwartym edytorze; potem karta znów pokazuje prawdziwą pogodę.", "Animated rain and snow need a Weather entity (set above).": "Animowany deszcz i śnieg wymagają encji pogody (ustaw powyżej).", "Seasonal background": "Tło sezonowe", "A different picture for a time of year, such as Halloween or Christmas. It comes back by itself every year.": "Inne zdjęcie na określoną porę roku, np. Halloween lub Boże Narodzenie. Wraca samo co roku.", "Tap a box to upload a picture. Leave Night empty to use the Day picture all the time. Animated rain and snow still show on top.": "Kliknij pole, aby przesłać zdjęcie. Zostaw Noc pustą, aby zawsze używać zdjęcia dziennego. Animowany deszcz i śnieg nadal są widoczne na wierzchu.", "View style": "Styl widoku", "Compact rings": "Kompaktowe kręgi", "Energy river": "Rzeka energii", "Tiles": "Kafelki", "At a glance": "W skrócie", "Schematic": "Schemat", "Your background picture with floating boxes and flow lines.": "Twoje zdjęcie w tle z pływającymi polami i liniami przepływu.", "Round icons around a hub. Small and tidy, great for phones and Sections dashboards.": "Okrągłe ikony wokół centrum. Małe i schludne, świetne na telefony i pulpity z sekcjami.", "Where your power comes from and where it goes, as flowing bands sized by power.": "Skąd pochodzi Twoja energia i dokąd płynie, jako pasma o szerokości zależnej od mocy.", "Big numbers in tidy tiles with history graphs. Ideal for wall tablets.": "Duże liczby w schludnych kafelkach z wykresami historii. Idealne na tablety ścienne.", "One plain-language headline you can read from across the room.": "Jeden prosty nagłówek, który przeczytasz z drugiego końca pokoju.", "A technical one-line diagram with electrical symbols on grid paper.": "Techniczny schemat jednokreskowy z symbolami elektrycznymi na papierze w kratkę.", "Background pictures, box positions, box sizes and line shapes only apply to the Classic style. Devices, colours, theme, Today statistics and history graphs work in every style.": "Zdjęcia w tle, pozycje i rozmiary pól oraz kształty linii dotyczą tylko stylu Klasyczny. Urządzenia, kolory, motyw, statystyki Dzisiaj i wykresy historii działają w każdym stylu.", "Producing": "Produkuje", "Using": "Zużywa", "Charging": "Ładowanie", "Discharging": "Rozładowanie", "Importing": "Pobór", "Exporting": "Oddawanie", "Active": "Aktywny", "In use": "W użyciu", "Idle": "Bezczynny", "in use": "w użyciu", "self-powered": "z własnej energii", "Self-powered": "Z własnej energii", "{n}% self-powered": "{n}% z własnej energii", "Using {p}": "Zużycie {p}", "Home": "Dom", "Battery": "Bateria", "From grid": "Z sieci", "To grid": "Do sieci", "Unmeasured": "Niezmierzone", "Other use": "Inne zużycie", "Nothing is flowing right now": "Teraz nic nie płynie", "Solar covers everything": "Słońce pokrywa wszystko", "Running on sunshine": "Na energii słonecznej", "Sun and battery": "Słońce i bateria", "Solar and grid": "Słońce i sieć", "Running on battery": "Na baterii", "Running on the grid": "Na energii z sieci", "All quiet": "Cisza i spokój", "Sending {p} to the grid": "Oddaje {p} do sieci", "charging battery {s}": "ładuje baterię {s}", "{p} from solar": "{p} ze słońca", "{p} from the grid": "{p} z sieci", "Battery {b}": "Bateria {b}", "Date": "Data", "Time": "Godzina", "Weather": "Pogoda", "Bin collection": "Wywóz śmieci", "Shows which bins go out: all day before collection (\"Tomorrow\") and on collection day (\"Today\"). Give each bin its own calendar, or use match words when one calendar holds several bins. No calendar? Use a repeating schedule.": "Pokazuje, które pojemniki wystawić: przez cały dzień przed wywozem („Jutro”) i w dniu wywozu („Dzisiaj”). Każdy pojemnik może mieć własny kalendarz albo użyj słów dopasowania, gdy jeden kalendarz zawiera kilka pojemników. Brak kalendarza? Użyj harmonogramu powtarzalnego.", "Show bin collection": "Pokaż wywóz śmieci", "Show": "Pokazuj", "Day before and collection day": "Dzień przed i w dniu wywozu", "Always show the next collection": "Zawsze pokazuj najbliższy wywóz", "Dates from": "Daty z", "Calendar": "Kalendarz", "Repeating schedule": "Harmonogram powtarzalny", "A collection date": "Data wywozu", "Repeats": "Powtarza się", "Every week": "Co tydzień", "Every {n} weeks": "Co {n} tyg.", "Skip dates (optional)": "Pomiń daty (opcjonalnie)", "Extra dates (optional)": "Dodatkowe daty (opcjonalnie)", "Match words (optional)": "Słowa dopasowania (opcjonalnie)", "Only if one calendar has several bins, e.g. recycling, blue": "Tylko gdy jeden kalendarz ma kilka pojemników, np. recykling, niebieski", "Bin name": "Nazwa pojemnika", "＋ Add bin": "＋ Dodaj pojemnik", "Bins badge": "Plakietka śmieci", "Bins": "Śmieci", "Bin": "Pojemnik", "Tomorrow": "Jutro", "Next collection": "Następny wywóz", "Set a collection date to see the next one.": "Ustaw datę wywozu, aby zobaczyć następną.", "No collection found in the next 6 weeks.": "Nie znaleziono wywozu w ciągu 6 tygodni.", "Choose a calendar.": "Wybierz kalendarz.", "1 bin": "1 pojemnik", "{n} bins": "pojemniki: {n}", "1 device": "1 urządzenie", "{n} devices": "urządzenia: {n}", "1 row": "1 wiersz", "{n} rows": "wiersze: {n}", "About": "O karcie", "All of GB": "Cała Wielka Brytania", "Auto": "Auto", "Background": "Tło", "Choose an entity": "Wybierz encję", "Custom": "Własne", "Default": "Domyślne", "Day + night": "Dzień + noc", "Desktop & phone": "Komputer i telefon", "Export / import": "Eksport / import", "Flow lines": "Linie przepływu", "How the flow lines look and move. Speed is for 1000 W; busier lines move faster.": "Wygląd i ruch linii przepływu. Prędkość dotyczy 1000 W; linie z większą mocą poruszają się szybciej.", "Look": "Wygląd", "Manual": "Ręczne", "More": "Więcej", "No title": "Bez tytułu", "On / off": "Wł. / wył.", "Panels": "Panele", "Right angles": "Kąty proste", "Title & clock": "Tytuł i zegar", "rain & snow": "deszcz i śnieg", "seasonal": "sezonowe", "{n} connections": "połączenia: {n}", "{n} of 4 on": "włączone: {n} z 4", "Full screen": "Pełny ekran", "Exit full screen": "Zamknij pełny ekran", "Show full-screen button": "Pokaż przycisk pełnego ekranu", "Keep the screen on in full screen": "Nie wygaszaj ekranu w trybie pełnoekranowym", "Tap actions": "Akcje dotknięcia", "Tap": "Dotknięcie", "Hold": "Przytrzymanie", "Double tap": "Podwójne dotknięcie", "Details": "Szczegóły", "Go to page": "Przejdź do strony", "Toggle": "Przełącz", "Run action": "Uruchom akcję", "Open link": "Otwórz link", "Nothing": "Nic", "Assist": "Assist", "Ask first": "Zapytaj najpierw", "Target entity (optional)": "Encja docelowa (opcjonalnie)", "Entity (optional)": "Encja (opcjonalnie)", "Entity, e.g. switch.ev_charger": "Encja, np. switch.ev_charger", "Action, e.g. switch.turn_on": "Akcja, np. switch.turn_on", "{n} set": "ustawione: {n}", "What tapping, holding or double-tapping each panel does. Devices have their own tap actions in their settings (Devices tab), and so does each Today row.": "Co robi dotknięcie, przytrzymanie lub podwójne dotknięcie każdego panelu. Urządzenia mają własne akcje w swoich ustawieniach (zakładka Urządzenia), tak samo każdy wiersz Dzisiaj."}, es: {"Today": "Hoy", "Energy Flow": "Flujo de energía", "Self-sufficiency now": "Autosuficiencia ahora", "Self-sufficiency today": "Autosuficiencia hoy", "Self-consumption now": "Autoconsumo ahora", "Self-consumption today": "Autoconsumo hoy", "Updated": "Actualizado", "just now": "ahora mismo", "{n}s ago": "hace {n} s", "{m}m {s}s ago": "hace {m} min {s} s", "{h}h {m}m ago": "hace {h} h {m} min", "{d}d {h}h ago": "hace {d} d {h} h", "No data": "Sin datos", "Unknown": "Desconocido", "to full": "hasta el 100%", "to empty": "hasta el 0%", "to {p}%": "hasta el {p}%", "at reserve": "en reserva", "at {p}%": "al {p}%", "Grid": "Red", "Great Britain": "Gran Bretaña", "Loading grid data…": "Cargando datos de la red…", "Grid data unavailable": "Datos de la red no disponibles", "Showing last data (update failed)": "Últimos datos (falló la actualización)", "Wind": "Eólica", "Solar": "Solar", "Nuclear": "Nuclear", "Hydro": "Hidráulica", "Biomass": "Biomasa", "Gas": "Gas", "Coal": "Carbón", "Imports": "Importaciones", "Other": "Otros", "Very low": "Muy baja", "Low": "Baja", "Moderate": "Moderada", "High": "Alta", "Very high": "Muy alta", "Add your first device": "Añade tu primer dispositivo", "Open the card editor and add Solar, Inverter, Battery, Grid or House.": "Abre el editor de la tarjeta y añade solar, inversor, batería, red o casa.", "☀️ Solar PV": "☀️ Solar FV", "⚡ Inverter": "⚡ Inversor", "🔋 Battery": "🔋 Batería", "🧠 Gateway": "🧠 Pasarela", "🏠 House": "🏠 Casa", "⚡ Grid": "⚡ Red", "⛽ Generator": "⛽ Generador", "💧 Water": "💧 Agua", "🔥 Gas": "🔥 Gas", "🚗 EV Charger": "🚗 Cargador VE", "⚙️ Extra Load": "⚙️ Carga adicional", "Home Power Flow": "Home Power Flow", "Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.": "Flujo de energía bidireccional a partir de valores positivos/negativos en directo, conexiones punteadas, un punto de energía en movimiento, dirección de dispositivo invertible, colores de flujo dinámicos y diseño arrastrable. Los ID de entidad completos se muestran bajo cada selector.", "Backup": "Copia de seguridad", "Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.": "Descarga toda la configuración de la tarjeta como archivo o restaura una guardada antes. Importar reemplaza todos los ajustes de abajo (dispositivos, conexiones, diseño, estadísticas); no se guarda en tu panel hasta que pulses Guardar.", "⬇ Export config": "⬇ Exportar configuración", "⬆ Import config": "⬆ Importar configuración", "Downloaded.": "Descargado.", "Export failed - see the browser console for details.": "Error al exportar: consulta la consola del navegador.", "Import failed - that file is not a valid Home Power Flow Card config.": "Error al importar: el archivo no es una configuración válida de Home Power Flow Card.", "Imported. Click Save below to keep it on this dashboard.": "Importado. Pulsa Guardar abajo para conservarlo en este panel.", "Title": "Título", "Subtitle": "Subtítulo", "Title colour": "Color del título", "Time format": "Formato de hora", "24 hour": "24 horas", "12 hour": "12 horas", "Weather entity": "Entidad del tiempo", "Day background": "Fondo de día", "Night background": "Fondo de noche", "📤 Upload image": "📤 Subir imagen", "👁 Preview this background": "👁 Vista previa del fondo", "Restore default": "Restaurar predeterminado", "Using the default background": "Usando el fondo predeterminado", "Uploading…": "Subiendo…", "Upload failed - check that you are an admin user and try again.": "Error al subir: comprueba que eres administrador e inténtalo de nuevo.", "Sun entity (switches day/night background)": "Entidad del sol (cambia el fondo día/noche)", "Flow threshold (W)": "Umbral de flujo (W)", "Flow animation speed (seconds)": "Velocidad de la animación (segundos)", "Particle stagger (seconds)": "Separación de partículas (segundos)", "Not selected": "Sin seleccionar", "Last updated box": "Recuadro de última actualización", "Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.": "Recuadro pequeño opcional que muestra cuánto hace que se actualizó una entidad, p. ej. los datos del inversor. Usa la marca de tiempo propia de la entidad si la tiene. Se vuelve ámbar cuando los datos superan el tiempo de aviso.", "Show last updated box": "Mostrar recuadro de última actualización", "Label": "Etiqueta", "Warn after (minutes)": "Avisar tras (minutos)", "Entity": "Entidad", "UK grid mix": "Mix eléctrico de Reino Unido", "Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.": "Recuadro opcional que muestra lo verde que es ahora la red eléctrica de Gran Bretaña (intensidad de carbono y mix de generación), desde la API Carbon Intensity de National Grid ESO. Se actualiza cada 30 minutos.", "Show grid mix box": "Mostrar recuadro del mix eléctrico", "Postcode (optional)": "Código postal (opcional)", "Appearance": "Apariencia", "Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.": "Tema de color para los recuadros y paneles. El fondo, los colores de flujo y el color del título se ajustan por separado.", "Theme": "Tema", "Auto (follow Home Assistant)": "Auto (según Home Assistant)", "Dark": "Oscuro", "Light": "Claro", "Midnight": "Medianoche", "Ocean": "Océano", "Forest": "Bosque", "Sunset": "Atardecer", "Graphite": "Grafito", "Custom colours": "Colores personalizados", "Panel colour": "Color de los paneles", "Text colour": "Color del texto", "Panel opacity": "Opacidad de los paneles", "Flow line style": "Estilo de las líneas", "Curved": "Curvas", "Right angles (avoid boxes)": "Ángulos rectos (evitan recuadros)", "Power units": "Unidades de potencia", "Auto (W, kW from 1000 W)": "Auto (W, kW desde 1000 W)", "Always W": "Siempre W", "Always kW": "Siempre kW", "History hours": "Horas de historial", "History opacity": "Opacidad del historial", "6 h": "6 h", "12 h": "12 h", "24 h": "24 h", "48 h": "48 h", "Sizing": "Tamaños", "1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.": "1 = tamaño predeterminado. La escala de pantalla pequeña agranda los recuadros en móviles (gradualmente por debajo de 900 px). Ancho máx. 0 = ocupar todo el ancho; la tarjeta nunca supera la altura de la pantalla. El panel Hoy también se reduce si fuera más alto que la tarjeta.", "Device boxes": "Recuadros de dispositivos", "Weather box": "Recuadro del tiempo", "Today panel": "Panel Hoy", "Small screen": "Pantalla pequeña", "Max width (px)": "Ancho máx. (px)", "Grid mix": "Mix eléctrico", "Updated box": "Recuadro de actualización", "Visual layout": "Diseño visual", "🖥️ Desktop": "🖥️ Escritorio", "📱 Phone": "📱 Móvil", "Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.": "Arrastra los recuadros de los dispositivos en la plantilla para colocarlos donde quieras. Las posiciones se guardan automáticamente. Los dispositivos nuevos sin posición guardada usan el diseño automático.", "Phone layout: used when the card is narrower than the breakpoint. Drag boxes to arrange it; boxes you have not moved use an automatic arrangement. Your desktop layout is not affected.": "Diseño móvil: se usa cuando la tarjeta es más estrecha que el punto de corte. Arrastra los recuadros para ordenarlo; los que no muevas se colocan automáticamente. El diseño de escritorio no cambia.", "Phone layout": "Diseño móvil", "Auto (narrow screens)": "Auto (pantallas estrechas)", "Always": "Siempre", "Never": "Nunca", "Switch below (px)": "Cambiar por debajo de (px)", "Background focus ↔": "Enfoque del fondo ↔", "Background focus ↕": "Enfoque del fondo ↕", "↺ Reset positions to automatic": "↺ Restablecer posiciones automáticas", "⧉ Copy desktop layout": "⧉ Copiar diseño de escritorio", "↺ Reset phone layout": "↺ Restablecer diseño móvil", "Show on phone": "Mostrar en el móvil", "Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.": "Los elementos desmarcados solo se ocultan en el diseño móvil. Ocultar un dispositivo también oculta sus líneas de flujo.", "🔤 Title": "🔤 Título", "🌤️ Weather": "🌤️ Tiempo", "🌍 Grid mix": "🌍 Mix eléctrico", "🕒 Updated": "🕒 Actualizado", "📊 Daily Stats": "📊 Estadísticas del día", "Devices": "Dispositivos", "＋ Add device": "＋ Añadir dispositivo", "Type": "Tipo", "Name": "Nombre", "Power entity": "Entidad de potencia", "Meter or flow entity": "Entidad de contador o caudal", "Connects to": "Conectado a", "Automatic": "Automático", "Automatic = the (first) inverter, or a Gateway/Distribution Board device for extra inverters. Override this for multi-inverter or custom topologies.": "Automático = el (primer) inversor, o una pasarela/cuadro eléctrico para inversores adicionales. Cámbialo para varios inversores o topologías personalizadas.", "Flow colour": "Color del flujo", "Only used if this device has its own power entity.": "Solo se usa si el dispositivo tiene su propia entidad de potencia.", "Flow direction": "Dirección del flujo", "↔ Normal": "↔ Normal", "↔ Inverted": "↔ Invertido", "Visual direction only": "Solo la dirección visual", "Show history graph": "Mostrar gráfico de historial", "Power history as a faint graph behind the box. Range and opacity are under Appearance.": "Historial de potencia como gráfico tenue detrás del recuadro. El rango y la opacidad están en Apariencia.", "Show charge/discharge glow": "Mostrar brillo de carga/descarga", "Pulses the box when actively charging or discharging.": "El recuadro pulsa al cargar o descargar.", "Show time remaining": "Mostrar tiempo restante", "Estimated time to full (charging) or to reserve (discharging), shown under the power value.": "Tiempo estimado hasta completar (carga) o hasta la reserva (descarga), mostrado bajo el valor de potencia.", "State of charge (%)": "Estado de carga (%)", "Capacity (kWh)": "Capacidad (kWh)", "Reserve %": "Reserva %", "Charge limit %": "Límite de carga %", "Capacity sensor (optional, overrides the number above)": "Sensor de capacidad (opcional, sustituye el número de arriba)", "Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.": "Se muestra en litros. Los sensores en m³ se convierten automáticamente. En Automático, el agua se conecta al dispositivo Casa.", "Show gas in": "Mostrar gas en", "Calorific value (MJ/m³)": "Poder calorífico (MJ/m³)", "Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.": "Se usa para convertir entre m³ y kWh (consulta tu factura de gas). En Automático, el gas se conecta al dispositivo Casa.", "＋ Add extra entity": "＋ Añadir entidad adicional", "Maximum of 5 extra entities reached.": "Se ha alcanzado el máximo de 5 entidades adicionales.", "Icon (Material Design Icons)": "Icono (Material Design Icons)", "Connections": "Conexiones", "Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.": "Opcional. Déjalo vacío para usar la topología automática. Añade conexiones para controlar por completo hacia dónde fluye la energía.", "From": "Desde", "To": "Hasta", "From → To": "Desde → Hasta", "To → From": "Hasta → Desde", "Auto — use live power signs": "Auto — según el signo de la potencia", "Remove connection": "Eliminar conexión", "＋ Add connection": "＋ Añadir conexión", "Today statistics": "Estadísticas de hoy", "Add up to 20 custom statistics. Choose your own name, entity and icon.": "Añade hasta 20 estadísticas propias. Elige tu nombre, entidad e icono.", "Material Design Icon": "Icono de Material Design", "Custom icon override": "Icono personalizado (sustituye)", "＋ Add statistic": "＋ Añadir estadística", "No statistics added.": "No hay estadísticas añadidas.", "Statistic": "Estadística", "Self-sufficiency": "Autosuficiencia", "Self-consumption": "Autoconsumo", ": share of your home's electricity that didn't come from the grid.": ": parte de la electricidad de tu casa que no vino de la red.", ": share of your solar you used yourself instead of exporting. Shown at the top of the Today panel.": ": parte de tu energía solar que usaste en lugar de exportarla. Se muestra arriba en el panel Hoy.", "Now": "Ahora", "is calculated automatically from your devices;": "se calcula automáticamente a partir de tus dispositivos;", "today": "hoy", "uses the daily energy sensors below.": "usa los sensores de energía diaria de abajo.", "Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.": "Sensores de energía diaria (kWh o Wh). La autosuficiencia de hoy necesita importación y consumo; el autoconsumo de hoy necesita solar y exportación.", "Grid import today": "Importación de red hoy", "Grid export today": "Exportación a red hoy", "Solar production today": "Producción solar hoy", "Home consumption today": "Consumo de la casa hoy", "Calculate consumption instead (import + solar − export + battery discharge − battery charge)": "Calcular el consumo (importación + solar − exportación + descarga de batería − carga de batería)", "Battery charge today (optional, for calculated consumption)": "Carga de batería hoy (opcional, para el consumo calculado)", "Battery discharge today (optional, for calculated consumption)": "Descarga de batería hoy (opcional, para el consumo calculado)", "off": "desactivado", "Choose flow colour": "Elige el color del flujo", "Drag to reorder": "Arrastra para reordenar", "Duplicate device": "Duplicar dispositivo", "Leave empty for no title": "Déjalo vacío para no mostrar título", "Leave empty for none": "Déjalo vacío para no mostrar nada", "Optional": "Opcional", "Or paste an image URL instead": "O pega la URL de una imagen", "Remove": "Quitar", "e.g. 13.5": "p. ej. 13,5", "e.g. SW1A, blank = all of GB": "p. ej. SW1A, vacío = toda Gran Bretaña", "Not connected to anything": "No conectado a nada", "idle": "inactivo", "Today panel style": "Estilo del panel Hoy", "Floating (drag anywhere)": "Flotante (arrastrar a cualquier lugar)", "Docked to card edge": "Anclado al borde de la tarjeta", "Dock edge": "Borde", "Bottom": "Abajo", "Top": "Arriba", "Left": "Izquierda", "Right": "Derecha", "Auto-hide (slides out on hover or tap)": "Ocultar automáticamente (aparece al pasar el ratón o tocar)", "On phone": "En el móvil", "Same as desktop": "Igual que en escritorio", "Floating": "Flotante", "Docked": "Anclado", "Phone dock edge": "Borde en el móvil", "Phone auto-hide": "Ocultar automáticamente en el móvil", "Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.": "El panel anclado se sitúa en un borde de la tarjeta y no se puede arrastrar. Ocultar automáticamente lo reduce a una pestaña que aparece al pasar el ratón o tocar.", "Box opacity": "Opacidad de los recuadros", "Card shape": "Forma de la tarjeta", "3:2 (default)": "3:2 (predeterminado)", "21:9 (ultra-wide)": "21:9 (ultrapanorámico)", "32:9 (super ultra-wide)": "32:9 (superultrapanorámico)", "Match background image": "Ajustar a la imagen de fondo", "Fill the screen": "Llenar la pantalla", "Background fit": "Ajuste del fondo", "Fill (crop to card)": "Rellenar (recortar a la tarjeta)", "Fit whole image (blurred edges)": "Mostrar la imagen completa (bordes difuminados)", "Power sensor": "Sensor de potencia", "One sensor (+/−)": "Un sensor (+/−)", "Separate sensors": "Sensores separados", "Discharge power (W)": "Potencia de descarga (W)", "Charge power (W)": "Potencia de carga (W)", "Export power (W)": "Potencia de exportación (W)", "Import power (W)": "Potencia de importación (W)", "Each sensor reports a positive number; the card combines them.": "Cada sensor da un número positivo; la tarjeta los combina.", "Show idle connections": "Mostrar conexiones inactivas", "Power sensors": "Sensores de potencia", "One sensor (+ and −)": "Un sensor (+ y −)", "Charging power": "Potencia de carga", "Discharging power": "Potencia de descarga", "Import power": "Potencia importada", "Export power": "Potencia exportada", "Positive = discharging, negative = charging. If yours is the other way round, use Flow direction.": "Positivo = descarga, negativo = carga. Si el tuyo es al revés, usa Dirección del flujo.", "Positive = export, negative = import. If yours is the other way round, use Flow direction.": "Positivo = exportación, negativo = importación. Si el tuyo es al revés, usa Dirección del flujo.", "Two sensors that both report positive values (e.g. Growatt). The card combines them into one value.": "Dos sensores que dan valores positivos (p. ej. Growatt). La tarjeta los combina en un solo valor.", "Show flow lines": "Mostrar líneas de flujo", "Untick to hide this device's flow lines. Its box and values keep working.": "Desmárcalo para ocultar las líneas de flujo de este dispositivo. El recuadro y los valores siguen funcionando.", "Reverses the flow. For batteries and the grid it also swaps charging/discharging or import/export.": "Invierte el flujo. En baterías y red también intercambia carga/descarga o importación/exportación.", "Drag to resize, double-click to reset size": "Arrastra para cambiar el tamaño; doble clic para restablecer", "Resize a device box by dragging its right or bottom edge or its corner; double-click the corner to reset its size. Text scales to fit.": "Cambia el tamaño de un recuadro arrastrando su borde derecho o inferior o su esquina; doble clic en la esquina para restablecerlo. El texto se ajusta al recuadro.", "Manual (draw your own)": "Manual (dibuja las tuyas)", "Manual lines: click a line to add a bend point, drag points to move them (they snap into line; hold Shift to place freely), double-click a point to remove it, double-click a line to make it straight again.": "Líneas manuales: haz clic en una línea para añadir un punto de giro, arrastra los puntos (se alinean solos; mantén Mayús para colocarlos libremente), doble clic en un punto para quitarlo, doble clic en una línea para volver a dejarla recta.", "↺ Reset all lines": "↺ Restablecer todas las líneas", "Flow line look (day)": "Aspecto de las líneas (día)", "Flow line look (night)": "Aspecto de las líneas (noche)", "Same as day": "Igual que de día", "Classic": "Clásico", "Neon": "Neón", "Energy stream": "Flujo de energía", "Marching": "Rayas en marcha", "Minimal": "Minimalista", "Blueprint": "Plano técnico", "Static": "Estático", "Flow colour by direction": "Color del flujo según la dirección", "One colour": "Un color", "Glow colours (green charging, amber discharging)": "Colores del brillo (verde carga, ámbar descarga)", "Charging colour": "Color de carga", "Discharging colour": "Color de descarga", "Import colour": "Color de importación", "Export colour": "Color de exportación", "Today decimals": "Decimales (Hoy)", "No power sensor selected.": "No se ha seleccionado ningún sensor de potencia.", "Separate sensors: pick both sensors.": "Sensores separados: elige los dos sensores.", "{e} doesn't exist (renamed or removed?).": "{e} no existe (¿renombrado o eliminado?).", "{e} is currently unavailable.": "{e} no está disponible ahora mismo.", "{e} reports {u}, not watts. Pick a power sensor (W or kW); state of charge belongs in the battery's State of charge field.": "{e} indica {u}, no vatios. Elige un sensor de potencia (W o kW); el estado de carga va en el campo Estado de carga de la batería.", "Connects to a device that no longer exists, so Automatic is used.": "Conectado a un dispositivo que ya no existe, así que se usa Automático.", "Connection loop: these devices connect to each other ({n}).": "Bucle de conexión: estos dispositivos se conectan entre sí ({n}).", "Not connected to anything: add an Inverter or Gateway, or set Connects to.": "No está conectado a nada: añade un inversor o una pasarela, o elige Conectado a.", "Water and gas connect to a House device on Automatic: add a House device or set Connects to.": "El agua y el gas se conectan a un dispositivo Casa en Automático: añade una Casa o elige Conectado a.", "Time remaining needs a state of charge sensor and a capacity.": "El tiempo restante necesita un sensor de estado de carga y una capacidad.", "{n} device(s) need attention": "Dispositivos que requieren atención: {n}", "Day": "Día", "Night": "Noche", "Rain": "Lluvia", "Snow": "Nieve", "Halloween": "Halloween", "Christmas": "Navidad", "Easter": "Pascua", "Custom dates": "Fechas personalizadas", "Season": "Temporada", "Upload": "Subir", "Uses day picture": "Usa la imagen de día", "Paste an image URL": "Pega la URL de una imagen", "Image URL": "URL de la imagen", "Preview in the layout below": "Vista previa en el diseño de abajo", "Tap to upload or replace the picture": "Toca para subir o cambiar la imagen", "showing now": "se muestra ahora", "Palm Sunday to Easter Monday": "Del Domingo de Ramos al Lunes de Pascua", "Animated rain & snow": "Lluvia y nieve animadas", "Draws falling rain, snow, hail and lightning over your background whenever your weather entity reports them. Works with any background, no extra pictures needed. Wind from the weather entity tilts the rain.": "Dibuja lluvia, nieve, granizo y relámpagos sobre el fondo cuando tu entidad del tiempo los indica. Funciona con cualquier fondo, sin imágenes extra. El viento de la entidad del tiempo inclina la lluvia.", "Amount": "Cantidad", "Lightning flashes in thunderstorms": "Destellos de relámpagos en tormentas", "Try it on the card preview": "Pruébalo en la vista previa de la tarjeta", "Heavy rain": "Lluvia intensa", "Storm": "Tormenta", "Sleet": "Aguanieve", "Hail": "Granizo", "Stop": "Detener", "Preview only while the editor is open; the card then follows your real weather again.": "La vista previa solo funciona con el editor abierto; después la tarjeta vuelve a seguir el tiempo real.", "Animated rain and snow need a Weather entity (set above).": "La lluvia y la nieve animadas necesitan una entidad del tiempo (configúrala arriba).", "Seasonal background": "Fondo de temporada", "A different picture for a time of year, such as Halloween or Christmas. It comes back by itself every year.": "Una imagen distinta para una época del año, como Halloween o Navidad. Vuelve sola cada año.", "Tap a box to upload a picture. Leave Night empty to use the Day picture all the time. Animated rain and snow still show on top.": "Toca una casilla para subir una imagen. Deja Noche vacía para usar la imagen de Día siempre. La lluvia y la nieve animadas se siguen viendo encima.", "View style": "Estilo de vista", "Compact rings": "Anillos compactos", "Energy river": "Río de energía", "Tiles": "Mosaicos", "At a glance": "De un vistazo", "Schematic": "Esquema", "Your background picture with floating boxes and flow lines.": "Tu imagen de fondo con cajas flotantes y líneas de flujo.", "Round icons around a hub. Small and tidy, great for phones and Sections dashboards.": "Iconos redondos alrededor de un centro. Pequeño y ordenado, ideal para móviles y paneles con secciones.", "Where your power comes from and where it goes, as flowing bands sized by power.": "De dónde viene tu energía y adónde va, como bandas con el ancho según la potencia.", "Big numbers in tidy tiles with history graphs. Ideal for wall tablets.": "Números grandes en mosaicos ordenados con gráficos de historial. Ideal para tabletas de pared.", "One plain-language headline you can read from across the room.": "Un titular sencillo que puedes leer desde el otro lado de la habitación.", "A technical one-line diagram with electrical symbols on grid paper.": "Un esquema unifilar técnico con símbolos eléctricos sobre papel cuadriculado.", "Background pictures, box positions, box sizes and line shapes only apply to the Classic style. Devices, colours, theme, Today statistics and history graphs work in every style.": "Las imágenes de fondo, las posiciones y tamaños de las cajas y la forma de las líneas solo se aplican al estilo Clásico. Dispositivos, colores, tema, estadísticas de Hoy y gráficos de historial funcionan en todos los estilos.", "Producing": "Produciendo", "Using": "Consumiendo", "Charging": "Cargando", "Discharging": "Descargando", "Importing": "Importando", "Exporting": "Exportando", "Active": "Activo", "In use": "En uso", "Idle": "Inactivo", "in use": "en uso", "self-powered": "autoabastecido", "Self-powered": "Autoabastecido", "{n}% self-powered": "{n}% autoabastecido", "Using {p}": "Consumo {p}", "Home": "Casa", "Battery": "Batería", "From grid": "De la red", "To grid": "A la red", "Unmeasured": "Sin medir", "Other use": "Otro consumo", "Nothing is flowing right now": "Ahora no fluye nada", "Solar covers everything": "El sol lo cubre todo", "Running on sunshine": "Funcionando con sol", "Sun and battery": "Sol y batería", "Solar and grid": "Sol y red", "Running on battery": "Funcionando con batería", "Running on the grid": "Funcionando con la red", "All quiet": "Todo tranquilo", "Sending {p} to the grid": "Enviando {p} a la red", "charging battery {s}": "cargando batería {s}", "{p} from solar": "{p} del sol", "{p} from the grid": "{p} de la red", "Battery {b}": "Batería {b}", "Date": "Fecha", "Time": "Hora", "Weather": "Tiempo", "Bin collection": "Recogida de basura", "Shows which bins go out: all day before collection (\"Tomorrow\") and on collection day (\"Today\"). Give each bin its own calendar, or use match words when one calendar holds several bins. No calendar? Use a repeating schedule.": "Muestra qué cubos sacar: todo el día anterior a la recogida («Mañana») y el día de la recogida («Hoy»). Da a cada cubo su propio calendario, o usa palabras clave si un calendario contiene varios cubos. ¿Sin calendario? Usa un horario que se repite.", "Show bin collection": "Mostrar recogida de basura", "Show": "Mostrar", "Day before and collection day": "El día antes y el día de recogida", "Always show the next collection": "Mostrar siempre la próxima recogida", "Dates from": "Fechas de", "Calendar": "Calendario", "Repeating schedule": "Horario que se repite", "A collection date": "Una fecha de recogida", "Repeats": "Se repite", "Every week": "Cada semana", "Every {n} weeks": "Cada {n} semanas", "Skip dates (optional)": "Omitir fechas (opcional)", "Extra dates (optional)": "Fechas extra (opcional)", "Match words (optional)": "Palabras clave (opcional)", "Only if one calendar has several bins, e.g. recycling, blue": "Solo si un calendario tiene varios cubos, p. ej. reciclaje, azul", "Bin name": "Nombre del cubo", "＋ Add bin": "＋ Añadir cubo", "Bins badge": "Insignia de cubos", "Bins": "Cubos", "Bin": "Cubo", "Tomorrow": "Mañana", "Next collection": "Próxima recogida", "Set a collection date to see the next one.": "Indica una fecha de recogida para ver la siguiente.", "No collection found in the next 6 weeks.": "No hay recogidas en las próximas 6 semanas.", "Choose a calendar.": "Elige un calendario.", "1 bin": "1 cubo", "{n} bins": "{n} cubos", "1 device": "1 dispositivo", "{n} devices": "{n} dispositivos", "1 row": "1 fila", "{n} rows": "{n} filas", "About": "Acerca de", "All of GB": "Todo GB", "Auto": "Auto", "Background": "Fondo", "Choose an entity": "Elige una entidad", "Custom": "Personalizado", "Default": "Predeterminado", "Day + night": "Día + noche", "Desktop & phone": "Escritorio y móvil", "Export / import": "Exportar / importar", "Flow lines": "Líneas de flujo", "How the flow lines look and move. Speed is for 1000 W; busier lines move faster.": "Cómo se ven y se mueven las líneas de flujo. La velocidad es para 1000 W; las líneas con más potencia van más rápido.", "Look": "Aspecto", "Manual": "Manual", "More": "Más", "No title": "Sin título", "On / off": "Encender / apagar", "Panels": "Paneles", "Right angles": "Ángulos rectos", "Title & clock": "Título y reloj", "rain & snow": "lluvia y nieve", "seasonal": "de temporada", "{n} connections": "{n} conexiones", "{n} of 4 on": "{n} de 4 activadas", "Full screen": "Pantalla completa", "Exit full screen": "Salir de pantalla completa", "Show full-screen button": "Mostrar botón de pantalla completa", "Keep the screen on in full screen": "Mantener la pantalla encendida en pantalla completa", "Tap actions": "Acciones al tocar", "Tap": "Tocar", "Hold": "Mantener", "Double tap": "Doble toque", "Details": "Detalles", "Go to page": "Ir a la página", "Toggle": "Alternar", "Run action": "Ejecutar acción", "Open link": "Abrir enlace", "Nothing": "Nada", "Assist": "Assist", "Ask first": "Preguntar antes", "Target entity (optional)": "Entidad objetivo (opcional)", "Entity (optional)": "Entidad (opcional)", "Entity, e.g. switch.ev_charger": "Entidad, p. ej. switch.ev_charger", "Action, e.g. switch.turn_on": "Acción, p. ej. switch.turn_on", "{n} set": "{n} configuradas", "What tapping, holding or double-tapping each panel does. Devices have their own tap actions in their settings (Devices tab), and so does each Today row.": "Qué hace tocar, mantener o tocar dos veces cada panel. Los dispositivos tienen sus propias acciones en su configuración (pestaña Dispositivos), y también cada fila de Hoy."} };
  // Editor text that contains numbers or a variable part.
  const I18N_PATTERNS = [
    [/^([▸▾]) Extra entities \((\d+)\/5\)$/, { pl: m => `${m[1]} Dodatkowe encje (${m[2]}/5)`, es: m => `${m[1]} Entidades adicionales (${m[2]}/5)` }],
    [/^([▸▾]) Extra entities \(optional\)$/, { pl: m => `${m[1]} Dodatkowe encje (opcjonalnie)`, es: m => `${m[1]} Entidades adicionales (opcional)` }],
    [/^([▸▾]) Self-sufficiency & self-consumption$/, { pl: m => `${m[1]} Samowystarczalność i autokonsumpcja`, es: m => `${m[1]} Autosuficiencia y autoconsumo` }],
    [/^(\d+) of 4 on$/, { pl: m => `włączone: ${m[1]} z 4`, es: m => `${m[1]} de 4 activadas` }],
    [/^🔎 Extra entity (\d+)$/, { pl: m => `🔎 Dodatkowa encja ${m[1]}`, es: m => `🔎 Entidad adicional ${m[1]}` }],
    [/^Statistic (\d+)$/, { pl: m => `Statystyka ${m[1]}`, es: m => `Estadística ${m[1]}` }],
    [/^Custom uploaded file: (.+)$/, { pl: m => `Własny przesłany plik: ${m[1]}`, es: m => `Archivo propio subido: ${m[1]}` }],
  ];
  function langOf(hass) {
    const l = String(hass?.locale?.language || hass?.language || 'en').toLowerCase().split('-')[0];
    return I18N[l] ? l : 'en';
  }
  // ---- Seasonal background ----
  // Config keys: background_season_day / background_season_night.
  // A missing night picture falls back to the day one. Animated rain and
  // snow (WeatherFx) are drawn over it like over any other background.
  const SEASONS = {
    halloween: { icon: '🎃', label: 'Halloween', start: [10, 25], end: [11, 1] },
    christmas: { icon: '🎄', label: 'Christmas', start: [12, 1], end: [1, 6] },
    easter:    { icon: '🐣', label: 'Easter' },
    custom:    { icon: '📅', label: 'Custom dates' },
  };
  const seasonKey = c => (SEASONS[c?.season] ? c.season : 'halloween');
  // Western (Gregorian) Easter Sunday, anonymous algorithm.
  function easterSunday(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  // [start, end] as [month, day] pairs for the season in a given year.
  function seasonRange(c, year) {
    const key = seasonKey(c);
    if (key === 'easter') {
      const e = easterSunday(year), s = new Date(e), en = new Date(e);
      s.setDate(e.getDate() - 7); en.setDate(e.getDate() + 1); // Palm Sunday .. Easter Monday
      return [[s.getMonth() + 1, s.getDate()], [en.getMonth() + 1, en.getDate()]];
    }
    if (key === 'custom') {
      const n = (v, lo, hi) => { const x = Math.round(Number(v)); return x >= lo && x <= hi ? x : null; };
      const sm = n(c.season_start_month, 1, 12), sd = n(c.season_start_day, 1, 31), em = n(c.season_end_month, 1, 12), ed = n(c.season_end_day, 1, 31);
      if (sm == null || sd == null || em == null || ed == null) return null;
      return [[sm, sd], [em, ed]];
    }
    return [SEASONS[key].start, SEASONS[key].end];
  }
  function seasonActive(c, now = new Date()) {
    const r = seasonRange(c, now.getFullYear()); if (!r) return false;
    const md = (now.getMonth() + 1) * 100 + now.getDate(), a = r[0][0] * 100 + r[0][1], b = r[1][0] * 100 + r[1][1];
    return a <= b ? (md >= a && md <= b) : (md >= a || md <= b); // wraps the new year (Christmas)
  }
  const extraBgFor = (c, kind, night) => {
    const d = c?.[`background_${kind}_day`] || '', n = c?.[`background_${kind}_night`] || '';
    return night ? (n || d) : d;
  };
  const isExtraSlot = slot => /^season_(day|night)$/.test(String(slot || ''));
  const seasonalOn = c => c?.seasonal_background === true;
  const bgKeyFor = slot => slot === 'day' ? 'background_upload_day' : slot === 'night' ? 'background_upload_night' : `background_${slot}`;

  // ---- Animated weather over the background (canvas, no images) ----
  // Particle counts are per 1200x800 design area, so density looks the same
  // at any card size. Sizes/speeds scale with the canvas width.
  let WX_FX_PREVIEW = null; // condition forced by the editor's preview buttons
  function wxFxTarget(cond, amount) {
    const a = Math.max(0.25, Math.min(2, Number(amount) || 1));
    switch (cond) {
      case 'rainy': return { rain: 140 * a };
      case 'pouring': return { rain: 320 * a };
      case 'lightning-rainy': return { rain: 260 * a, lightning: true };
      case 'lightning': return { lightning: true };
      case 'hail': return { hail: 120 * a, rain: 60 * a };
      case 'snowy': return { snow: 140 * a };
      case 'snowy-rainy': return { snow: 80 * a, rain: 80 * a };
      default: return {};
    }
  }
  // Rain slant from the weather entity's wind (east-west component).
  function wxWindSlant(st) {
    const at = st?.attributes || {};
    let v = Number(at.wind_speed);
    if (!Number.isFinite(v)) return 0.12;
    const u = String(at.wind_speed_unit || 'km/h').toLowerCase();
    if (u === 'm/s') v *= 3.6; else if (u === 'mph') v *= 1.609; else if (u === 'kn' || u === 'kt') v *= 1.852;
    const b = Number(at.wind_bearing);
    const dir = Number.isFinite(b) ? -Math.sin(b * Math.PI / 180) : 1; // wind FROM the west blows to the right
    return Math.max(-0.55, Math.min(0.55, (v / 70) * dir));
  }
  class WeatherFx {
    constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.parts = []; this.target = {}; this.flash = 0; this.nextFlash = 0; this.flashQueue = []; this.running = false; this.visible = true; }
    set(target) { this.target = target || {}; if (this.visible && this._busy()) this.start(); else if (!this.visible) this.stop(); }
    _busy() { const t = this.target; return (t.rain || 0) > 0 || (t.snow || 0) > 0 || (t.hail || 0) > 0 || !!t.lightning || this.parts.length > 0 || this.flash > 0; }
    _size() {
      const r = this.c.getBoundingClientRect(), dpr = Math.min(1.5, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== this.c.width || h !== this.c.height) { this.c.width = w; this.c.height = h; }
      this.w = w; this.h = h; this.k = w / 1200;
    }
    start() {
      if (this.running) return;
      this.running = true; this.last = performance.now();
      const loop = t => {
        if (!this.running) return;
        this._frame(t);
        if (this._busy()) this.raf = requestAnimationFrame(loop);
        else { this.running = false; this.ctx.clearRect(0, 0, this.w, this.h); }
      };
      this.raf = requestAnimationFrame(loop);
    }
    stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }
    destroy() { this.stop(); this.parts = []; try { this.ctx.clearRect(0, 0, this.c.width, this.c.height); } catch (e) {} }
    _spawn(type, anywhere) {
      const k = this.k, far = Math.random() < 0.45, x = Math.random() * this.w * 1.2 - this.w * 0.1;
      const y = anywhere ? Math.random() * this.h : -Math.random() * 60 * k;
      if (type === 'rain') return { type, far, x, y, len: (far ? 10 : 18) * k * (0.8 + Math.random() * 0.5), vy: (far ? 850 : 1250) * k * (0.85 + Math.random() * 0.3) };
      if (type === 'hail') return { type, far, x, y, r: (far ? 1.4 : 2.3) * k, vy: (far ? 650 : 900) * k * (0.9 + Math.random() * 0.2) };
      return { type, far, x, y, r: (far ? 1.5 : 3.1) * k * (0.7 + Math.random() * 0.6), vy: (far ? 38 : 70) * k * (0.8 + Math.random() * 0.4), ph: Math.random() * 6.28, sw: (8 + Math.random() * 18) * k };
    }
    _frame(t) {
      const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000)); this.last = t;
      this._size();
      const T = this.target, slant = Number.isFinite(T.wind) ? T.wind : 0.12, ctx = this.ctx, k = this.k;
      const counts = { rain: 0, snow: 0, hail: 0 };
      this.parts.forEach(p => counts[p.type]++);
      // Fade in gradually: spawn about a third of the target per second.
      const firstFrame = !this._started && ['rain', 'snow', 'hail'].some(x => (T[x] || 0) > 0);
      if (firstFrame) this._started = true;
      ['rain', 'snow', 'hail'].forEach(type => {
        const want = Math.round(T[type] || 0); let add = Math.min(want - counts[type], Math.ceil(want * dt / 1.5));
        const first = firstFrame && want > 0;
        if (first) add = want; // first appearance: fill the sky at once
        for (let i = 0; i < add; i++) this.parts.push(this._spawn(type, first));
        counts[type] += Math.max(0, add);
      });
      const keep = [];
      for (const p of this.parts) {
        p.y += p.vy * dt;
        if (p.type === 'snow') { p.ph += dt * 1.2; p.x += (Math.sin(p.ph) * p.sw * 0.9 + slant * 60 * k) * dt; }
        else p.x += p.vy * slant * dt;
        if (p.y - 40 * k > this.h || p.x < -this.w * 0.2 || p.x > this.w * 1.2) {
          const want = Math.round(T[p.type] || 0);
          if (counts[p.type] > want) { counts[p.type]--; continue; } // weather easing off: let it fall out
          Object.assign(p, this._spawn(p.type, false));
        }
        keep.push(p);
      }
      this.parts = keep;
      ctx.clearRect(0, 0, this.w, this.h);
      // rain: two depth layers, one stroke each
      for (const far of [true, false]) {
        ctx.beginPath();
        let any = false;
        for (const p of this.parts) if (p.type === 'rain' && p.far === far) { any = true; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * slant, p.y - p.len); }
        if (any) { ctx.strokeStyle = far ? 'rgba(205,220,240,.22)' : 'rgba(220,232,250,.42)'; ctx.lineWidth = (far ? 0.8 : 1.3) * Math.max(1, k * 1.2); ctx.lineCap = 'round'; ctx.stroke(); }
      }
      for (const [type, far, col] of [['snow', true, 'rgba(255,255,255,.55)'], ['snow', false, 'rgba(255,255,255,.9)'], ['hail', true, 'rgba(235,245,255,.6)'], ['hail', false, 'rgba(245,250,255,.9)']]) {
        ctx.beginPath(); let any = false;
        for (const p of this.parts) if (p.type === type && p.far === far) { any = true; ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, 6.2832); }
        if (any) { ctx.fillStyle = col; ctx.fill(); }
      }
      // lightning: soft full-frame flash, sometimes a double flicker
      if (T.lightning) {
        if (!this.nextFlash) this.nextFlash = t + 1500 + Math.random() * 3000;
        if (t >= this.nextFlash) { this.flash = 1; this.nextFlash = t + 6000 + Math.random() * 10000; if (Math.random() < 0.6) this.flashQueue.push(t + 140 + Math.random() * 120); }
      } else this.nextFlash = 0;
      if (this.flashQueue.length && t >= this.flashQueue[0]) { this.flashQueue.shift(); this.flash = 0.75; }
      if (this.flash > 0) { ctx.fillStyle = `rgba(235,240,255,${(0.28 * this.flash).toFixed(3)})`; ctx.fillRect(0, 0, this.w, this.h); this.flash = Math.max(0, this.flash - dt * 4); }
    }
  }

  // ---- Bin collection ----
  // Up to 5 bins. Each comes from a Home Assistant calendar (optionally
  // filtered by match words, for one calendar holding several bins) or a
  // repeating schedule (one known collection date + every N weeks, with
  // optional skip/extra dates). Shown all day before collection
  // ("Tomorrow") and on collection day ("Today").
  const BIN_MAX = 5;
  const BIN_DEFAULTS = [
    { name: 'General waste', color: '#3a3f45' }, { name: 'Recycling', color: '#1e73d2' }, { name: 'Garden waste', color: '#2e9e4f' },
    { name: 'Food waste', color: '#8b5a2b' }, { name: 'Glass', color: '#8e44ad' },
  ];
  const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ymdOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
  const ymdAdd = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return ymdLocal(new Date(y, m - 1, d + n)); };
  const ymdDiff = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); };
  const ymdList = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(ymdOk);
  const binColor = b => (/^#[0-9a-f]{6}$/i.test(String(b?.color || '')) ? b.color : '#3a3f45');
  // A small wheelie bin in the bin's colour.
  function binSVG(color, size = 18) {
    return `<svg class="bin-svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><rect x="9" y="2.2" width="6" height="2" rx="1" fill="${color}" stroke="rgba(255,255,255,.6)" stroke-width=".6"/><path d="M3.6 5.2 H20.4 L19.6 7.6 H4.4 Z" fill="${color}" stroke="rgba(255,255,255,.6)" stroke-width=".7" stroke-linejoin="round"/><path d="M5.4 8.2 H18.6 L17.3 20 H6.7 Z" fill="${color}" stroke="rgba(255,255,255,.6)" stroke-width=".7" stroke-linejoin="round"/><path d="M9 10.5 V17.5 M12 10.5 V17.5 M15 10.5 V17.5" stroke="rgba(255,255,255,.35)" stroke-width="1" stroke-linecap="round"/><circle cx="8" cy="21.2" r="1.6" fill="#1d2126"/><circle cx="16" cy="21.2" r="1.6" fill="#1d2126"/></svg>`;
  }
  // The date an event falls on (local), for all-day and timed events and
  // for the older plain-string format.
  function binEventDate(ev) {
    const s = ev?.start;
    const raw = typeof s === 'string' ? s : (s?.date || s?.dateTime || s?.date_time || '');
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const t = new Date(String(raw).replace(' ', 'T'));
    return Number.isFinite(t.getTime()) ? ymdLocal(t) : null;
  }
  // Next event from the calendar entity itself (used when the calendar API
  // can't be reached, and merged in otherwise).
  function binEventsFromState(hass, cal) {
    const at = hass?.states?.[cal]?.attributes || {};
    const date = at.start_time ? binEventDate({ start: at.start_time }) : null;
    return date ? [{ date, summary: String(at.message || '') }] : [];
  }
  async function binFetchEvents(hass, cals) {
    const out = new Map();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 42 * 86400000);
    await Promise.all(cals.map(async cal => {
      let list = [];
      try {
        if (hass?.callApi) {
          const res = await hass.callApi('GET', `calendars/${cal}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
          list = (Array.isArray(res) ? res : []).map(ev => ({ date: binEventDate(ev), summary: String(ev.summary || ev.message || '') })).filter(e => e.date);
        }
      } catch (e) { list = []; }
      const fromState = binEventsFromState(hass, cal);
      fromState.forEach(e => { if (!list.some(x => x.date === e.date && x.summary === e.summary)) list.push(e); });
      out.set(cal, list);
    }));
    return out;
  }
  // Next collection date (YYYY-MM-DD, today or later) for one bin.
  function binNextDate(b, events, hass, today) {
    if (!b) return null;
    if (b.source === 'manual') {
      const skip = new Set(ymdList(b.skip)), extra = ymdList(b.extra).filter(d => d >= today);
      let best = null;
      if (ymdOk(b.start)) {
        const step = 7 * Math.max(1, Math.min(8, Math.round(Number(b.every) || 1)));
        let cand = b.start;
        if (cand < today) cand = ymdAdd(b.start, Math.ceil(ymdDiff(b.start, today) / step) * step);
        for (let k = 0; k < 60 && skip.has(cand); k++) cand = ymdAdd(cand, step);
        if (!skip.has(cand)) best = cand;
      }
      extra.forEach(d => { if (!skip.has(d) && (!best || d < best)) best = d; });
      return best;
    }
    if (!b.calendar) return null;
    const words = String(b.match || '').toLowerCase().split(/[,;]+/).map(w => w.trim()).filter(Boolean);
    const list = (events?.get?.(b.calendar)) || binEventsFromState(hass, b.calendar);
    let best = null;
    list.forEach(e => {
      if (!e.date || e.date < today) return;
      if (words.length && !words.some(w => e.summary.toLowerCase().includes(w))) return;
      if (!best || e.date < best) best = e.date;
    });
    return best;
  }

  function localeOf(hass) { return hass?.locale?.language || hass?.language || undefined; }
  function tr(lang, text, vars) {
    let out = (lang !== 'en' && I18N[lang]?.[text]) || text;
    if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
    return out;
  }

  function state(hass, entity) {
    return entity && hass?.states?.[entity] ? hass.states[entity] : null;
  }

  function entityValue(hass, entity) {
    const s = state(hass, entity);
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  // Power entities are normalized to watts. This means sensors reporting kW
  // (very common for solar/inverter/Zappi entities) work exactly like sensors
  // reporting W, both for display and flow logic.
  function powerValue(hass, entity) {
    const s = state(hass, entity);
    if (!s) return null;
    const v = parseFloat(s.state);
    if (!Number.isFinite(v)) return null;
    const unit = String(s.attributes?.unit_of_measurement || '').trim().toLowerCase();
    if (unit === 'kw' || unit === 'kilowatt' || unit === 'kilowatts') return v * 1000;
    if (unit === 'mw' || unit === 'megawatt' || unit === 'megawatts') return v * 1000000;
    return v;
  }

  function friendlyState(s) {
    if (!s) return '';
    const n = Number(s.state);
    if (Number.isFinite(n)) return n;
    return s.state;
  }

  // ======================= View styles (0.8) =======================
  // Classic is the original photo-background card. Every other style is
  // drawn from the same live model (_altModel): the same devices, power
  // readings, flow directions, battery logic and Today statistics, so all
  // styles always agree with each other.
  const VIEW_STYLES = {
    classic:   { icon: '🖼️', label: 'Classic', desc: 'Your background picture with floating boxes and flow lines.' },
    rings:     { icon: '⭕', label: 'Compact rings', desc: 'Round icons around a hub. Small and tidy, great for phones and Sections dashboards.' },
    river:     { icon: '🌊', label: 'Energy river', desc: 'Where your power comes from and where it goes, as flowing bands sized by power.' },
    tiles:     { icon: '🔲', label: 'Tiles', desc: 'Big numbers in tidy tiles with history graphs. Ideal for wall tablets.' },
    glance:    { icon: '👀', label: 'At a glance', desc: 'One plain-language headline you can read from across the room.' },
    schematic: { icon: '📐', label: 'Schematic', desc: 'A technical one-line diagram with electrical symbols on grid paper.' },
  };
  // Small preview pictures for the editor's style picker.
  const VIEW_THUMBS = {
    classic: '<rect width="96" height="60" fill="#5f8fb8"/><rect y="38" width="96" height="22" fill="#5c8f4c"/><path d="M34 40 V26 L48 16 L62 26 V40 Z" fill="#e9ddc8"/><rect x="6" y="8" width="22" height="11" rx="3" fill="#0b1c2c" opacity=".85"/><rect x="68" y="30" width="22" height="11" rx="3" fill="#0b1c2c" opacity=".85"/><rect x="8" y="42" width="22" height="11" rx="3" fill="#0b1c2c" opacity=".85"/><path d="M28 14 Q48 10 48 22 M30 46 Q50 50 68 36" fill="none" stroke="#7dffa0" stroke-width="1.6" stroke-dasharray="2 2"/>',
    rings: '<rect width="96" height="60" fill="#13212e"/><g fill="#14263a" stroke-width="2"><circle cx="48" cy="30" r="10" stroke="#6dff95"/><circle cx="48" cy="9" r="6" stroke="#63ff7d"/><circle cx="22" cy="30" r="6" stroke="#43a5ff"/><circle cx="74" cy="30" r="6" stroke="#ffb52e"/><circle cx="48" cy="51" r="6" stroke="#ff5c5c"/></g><path d="M48 15 V20 M28 30 H38 M58 30 H68 M48 40 V45" stroke="#cfd8dc" stroke-width="1.2" stroke-dasharray="1.5 2"/>',
    river: '<rect width="96" height="60" fill="#13212e"/><rect x="18" y="8" width="5" height="28" fill="#63ff7d"/><rect x="18" y="40" width="5" height="12" fill="#43a5ff"/><rect x="73" y="6" width="5" height="22" fill="#ffb52e"/><rect x="73" y="32" width="5" height="12" fill="#ff5c5c"/><rect x="73" y="48" width="5" height="6" fill="#43a5ff"/><path d="M23 8 C48 8 48 6 73 6 V28 C48 28 48 26 23 26 Z" fill="#9ccc65" opacity=".55"/><path d="M23 26 C48 26 48 32 73 32 V44 C48 44 48 36 23 36 Z" fill="#e57373" opacity=".5"/><path d="M23 40 C48 40 48 6 73 14 V22 C48 14 48 52 23 52 Z" fill="#64b5f6" opacity=".4"/>',
    tiles: '<rect width="96" height="60" fill="#13212e"/><g fill="#1d3246"><rect x="6" y="6" width="40" height="22" rx="4"/><rect x="50" y="6" width="19" height="22" rx="4"/><rect x="72" y="6" width="19" height="22" rx="4"/><rect x="6" y="32" width="19" height="22" rx="4"/><rect x="28" y="32" width="19" height="22" rx="4"/><rect x="50" y="32" width="19" height="22" rx="4"/><rect x="72" y="32" width="19" height="22" rx="4"/></g><circle cx="17" cy="17" r="6" fill="none" stroke="#6dff95" stroke-width="2.5"/><path d="M50 26 L56 21 L62 24 L69 17 V28 H50 Z" fill="#63ff7d" opacity=".35"/><rect x="28" y="12" width="14" height="3" rx="1.5" fill="#cfd8dc"/><rect x="28" y="18" width="10" height="3" rx="1.5" fill="#cfd8dc" opacity=".6"/>',
    glance: '<rect width="96" height="60" fill="#13212e"/><circle cx="6" cy="6" r="38" fill="#7dd96f" opacity=".18"/><circle cx="16" cy="22" r="8" fill="#ffd75e"/><rect x="30" y="16" width="44" height="6" rx="3" fill="#fff"/><rect x="30" y="26" width="30" height="4" rx="2" fill="#cfd8dc" opacity=".75"/><g fill="#1d3246"><rect x="6" y="42" width="18" height="10" rx="5"/><rect x="27" y="42" width="18" height="10" rx="5"/><rect x="48" y="42" width="18" height="10" rx="5"/><rect x="69" y="42" width="18" height="10" rx="5"/></g>',
    schematic: '<rect width="96" height="60" fill="#0d2747"/><path d="M0 10 H96 M0 20 H96 M0 30 H96 M0 40 H96 M0 50 H96 M10 0 V60 M20 0 V60 M30 0 V60 M40 0 V60 M50 0 V60 M60 0 V60 M70 0 V60 M80 0 V60 M90 0 V60" stroke="#d6e6ff" stroke-opacity=".08"/><g fill="none" stroke="#d6e6ff" stroke-width="1.4"><rect x="40" y="22" width="16" height="16"/><path d="M40 38 L56 22"/><rect x="10" y="12" width="12" height="9"/><path d="M12 42 V50 M15 44 V48 M18 42 V50"/><path d="M78 10 L74 22 M78 10 L82 22"/><path d="M73 40 L78 35 L83 40 M74 39 V46 H82 V39"/><path d="M22 16 H31 V30 H40 M22 46 H31 V30 M56 30 H66 V16 H74 M66 30 V42 H74"/></g>',
  };
  const ALT_BG = {
    dark: 'linear-gradient(160deg,#15232f,#0b141c)', light: 'linear-gradient(160deg,#f8fafc,#e8edf2)', midnight: 'linear-gradient(160deg,#0c0c10,#000)',
    ocean: 'linear-gradient(160deg,#05414e,#012632)', forest: 'linear-gradient(160deg,#183e25,#0b2213)', sunset: 'linear-gradient(160deg,#5b2339,#391420)',
    graphite: 'linear-gradient(160deg,#31363c,#1f2327)',
  };
  const ALT_CSS = `
    :host { display:block; width:100%; }
    * { box-sizing:border-box; }
    .card.alt { position:relative; width:100%; max-width:var(--hpf-max-width,100000px); margin:0 auto; border-radius:22px; overflow:hidden; color:var(--hpf-text,#fff); font-family:var(--primary-font-family,Arial,sans-serif); background:var(--hpf-alt-bg,linear-gradient(160deg,#15232f,#0b141c)); box-shadow:0 12px 40px rgba(0,0,0,.28); padding:16px 18px 14px; container-type:inline-size; }
    .alt-head { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; }
    .alt-titles { flex:1; min-width:0; }
    .alt-title { font-size:22px; font-weight:750; letter-spacing:-.02em; color:var(--hpf-title-color,inherit); line-height:1.15; }
    .alt-sub { font-size:13px; opacity:.75; margin-top:2px; }
    .alt-meta { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; font-size:13px; }
    .alt-chip { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); white-space:nowrap; }
    .alt-chip ha-icon { --mdc-icon-size:15px; width:15px; height:15px; }
    .alt-chip.stale { color:#ffb74d; border-color:rgba(255,183,77,.55); }
    .alt-chip:empty { display:none; }
    .bins-chip { gap:10px; } .bins-chip.today { border:2px solid rgba(255,183,77,.9); }
    .bin-seg { display:inline-flex; align-items:center; gap:6px; } .bin-icons { display:inline-flex; gap:1px; } .bin-svg { display:block; flex:none; }
    .alt-today { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; align-items:center; }
    .alt-today-h { font-weight:700; font-size:13px; opacity:.8; margin-right:4px; }
    .alt-stat { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:12px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); font-size:12px; }
    .alt-stat ha-icon { --mdc-icon-size:16px; width:16px; height:16px; opacity:.85; }
    .alt-stat .nm { opacity:.75; }
    .alt-stat b { font-size:13px; }
    .alt-empty { padding:30px 10px; text-align:center; opacity:.75; }
    .flow-path { fill:none; stroke-linecap:round; filter:url(#glow); opacity:.92; }
    .flow-dot { filter:url(#dotglow); }
    [data-entity] { cursor:pointer; }
    .extra-row { display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
    .extra-row ha-icon { --mdc-icon-size:12px; width:12px; height:12px; }
    @keyframes hpf-ring-pulse { 0%,100% { stroke-width:2.5; } 50% { stroke-width:6; } }
    @keyframes hpf-river { to { stroke-dashoffset:-32; } }
    @keyframes hpf-blink { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    @media (prefers-reduced-motion: reduce) { .rn.charging .rn-ring, .rn.discharging .rn-ring, .rv-flow { animation:none !important; } }
    /* ---- Compact rings ---- */
    .rings-svg { display:block; width:100%; height:auto; max-height:min(74vh,640px); margin:0 auto; overflow:visible; }
    .rl { stroke:var(--hpf-text,#fff); stroke-opacity:.16; stroke-width:2; fill:none; stroke-dasharray:2 5; }
    .rn-bg { fill:var(--hpf-node-solid,#16283a); }
    .rn-ring { fill:none; stroke:var(--c); stroke-width:2.5; opacity:.35; transition:opacity .4s; }
    .rn.on .rn-ring { opacity:1; }
    .rn.charging .rn-ring { stroke:var(--hpf-good); animation:hpf-ring-pulse 1.8s ease-in-out infinite; }
    .rn.discharging .rn-ring { stroke:var(--hpf-warn); animation:hpf-ring-pulse 1.8s ease-in-out infinite; }
    .rn-soc { fill:none; stroke:#4dd0e1; stroke-width:5; stroke-linecap:round; }
    .rn.charging .rn-soc { stroke:var(--hpf-good); } .rn.discharging .rn-soc { stroke:var(--hpf-warn); }
    .rn text { text-anchor:middle; fill:var(--hpf-text,#fff); font-family:inherit; }
    .rn-ic { font-size:22px; dominant-baseline:middle; }
    .rn-val { font-size:13px; font-weight:750; }
    .rn-nm { font-size:12px; font-weight:650; opacity:.9; }
    .rn-sub { font-size:11px; opacity:.65; }
    .rn.charging .rn-sub, .rn.exporting .rn-sub, .rn.producing .rn-sub { fill:var(--hpf-good); opacity:1; }
    .rn.discharging .rn-sub, .rn.importing .rn-sub { fill:var(--hpf-warn); opacity:1; }
    .rh-track { fill:none; stroke:var(--hpf-track,rgba(255,255,255,.1)); stroke-width:6; }
    .rh-ss { fill:none; stroke:var(--hpf-good); stroke-width:6; stroke-linecap:round; transition:stroke-dasharray .6s; }
    .rh-val { font-size:18px; font-weight:800; }
    .rh-lb { font-size:10px; opacity:.7; }
    /* ---- Tiles ---- */
    .tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
    .tiles.small { grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); }
    .tile { position:relative; overflow:hidden; border-radius:16px; padding:12px 14px; min-height:112px; background:var(--hpf-node-bg); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 6px 18px rgba(0,0,0,.16); }
    .tile::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--c,#888); opacity:.3; }
    .tile.on::before { opacity:1; }
    .tile.charging { box-shadow:0 0 0 1px var(--hpf-good), 0 6px 22px rgba(0,0,0,.18); } .tile.discharging { box-shadow:0 0 0 1px var(--hpf-warn), 0 6px 22px rgba(0,0,0,.18); }
    .tile .hist { position:absolute; left:0; right:0; bottom:0; height:56%; pointer-events:none; }
    .tile .hist svg { width:100%; height:100%; display:block; }
    .tile > :not(.hist) { position:relative; }
    .t-top { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:650; opacity:.92; }
    .t-ic { font-size:18px; line-height:1; } .t-ic ha-icon { --mdc-icon-size:18px; }
    .t-nm { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .t-val { font-size:28px; font-weight:800; letter-spacing:-.02em; margin-top:8px; line-height:1.1; }
    .t-val.long { font-size:21px; } .tile.stat { min-height:82px; } .tile.stat .t-val { font-size:20px; }
    .t-sub { font-size:12px; opacity:.75; margin-top:3px; }
    .tile.charging .t-sub, .tile.exporting .t-sub, .tile.producing .t-sub { color:var(--hpf-good); opacity:1; }
    .tile.discharging .t-sub, .tile.importing .t-sub { color:var(--hpf-warn); opacity:1; }
    .t-bar { height:6px; border-radius:3px; background:var(--hpf-track,rgba(255,255,255,.1)); margin-top:8px; overflow:hidden; }
    .t-bar i { display:block; height:100%; background:#4dd0e1; border-radius:3px; transition:width .6s; }
    .tile.charging .t-bar i { background:var(--hpf-good); } .tile.discharging .t-bar i { background:var(--hpf-warn); }
    .t-ex { display:flex; flex-wrap:wrap; gap:2px 8px; margin-top:4px; font-size:10px; opacity:.8; } .t-ex:empty { display:none; }
    .tile.sum { grid-column:span 2; display:flex; align-items:center; gap:14px; }
    .t-ring { width:78px; height:78px; flex:none; }
    .tr-track { fill:none; stroke:var(--hpf-track,rgba(255,255,255,.1)); stroke-width:7; }
    .tr-val { fill:none; stroke:var(--hpf-good); stroke-width:7; stroke-linecap:round; transition:stroke-dasharray .6s; }
    .t-ring text { fill:var(--hpf-text,#fff); font-size:15px; font-weight:800; text-anchor:middle; }
    .ts-l { flex:1; min-width:0; } .ts-h { font-size:11px; opacity:.7; margin-bottom:4px; font-weight:750; text-transform:uppercase; letter-spacing:.06em; }
    .ts-r { display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:2px 0; } .ts-r span { opacity:.85; white-space:nowrap; }
    .tl-sec { font-weight:700; font-size:13px; opacity:.8; margin:14px 0 8px; }
    @container (max-width:340px) { .tile.sum { grid-column:span 1; flex-direction:column; align-items:flex-start; } }
    /* ---- At a glance ---- */
    .card.alt.v-glance { background:radial-gradient(120% 150% at 0% 0%, color-mix(in srgb, var(--mood,#7dd96f) 34%, transparent), transparent 62%), var(--hpf-alt-bg); transition:background .8s; }
    .gl-main { display:flex; align-items:center; gap:18px; padding:12px 2px 18px; }
    .gl-ic { font-size:64px; line-height:1; flex:none; filter:drop-shadow(0 4px 16px color-mix(in srgb, var(--mood,#7dd96f) 60%, transparent)); }
    .gl-txt { flex:1; min-width:0; }
    .gl-line { font-size:38px; font-weight:800; letter-spacing:-.025em; line-height:1.08; }
    .gl-sub { font-size:18px; opacity:.85; margin-top:6px; }
    .gl-big { text-align:right; flex:none; } .gl-big b { display:block; font-size:42px; font-weight:800; letter-spacing:-.02em; line-height:1; } .gl-big span { opacity:.7; font-size:13px; }
    .gl-chips { display:flex; flex-wrap:wrap; gap:8px; }
    .gl-chip { display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:14px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); font-size:14px; }
    .gl-chip b { font-weight:750; } .gc-r { opacity:.72; font-size:12px; } .gc-r:empty { display:none; }
    .gl-chip.on { border-color:color-mix(in srgb, var(--c) 75%, transparent); }
    .gl-chip.charging .gc-r, .gl-chip.exporting .gc-r, .gl-chip.producing .gc-r { color:var(--hpf-good); opacity:1; }
    .gl-chip.discharging .gc-r, .gl-chip.importing .gc-r { color:var(--hpf-warn); opacity:1; }
    @container (max-width:640px) { .gl-line { font-size:28px; } .gl-sub { font-size:15px; } .gl-ic { font-size:48px; } .gl-big b { font-size:30px; } }
    @container (max-width:460px) { .gl-main { flex-wrap:wrap; gap:12px; } .gl-big { text-align:left; width:100%; } .gl-line { font-size:24px; } }
    /* ---- Energy river ---- */
    .rv-sum { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:15px; font-weight:650; margin:2px 0 6px; } .rv-sum span { opacity:.9; }
    .river-svg { display:block; width:100%; height:auto; overflow:visible; }
    .rv-band { opacity:.5; transition:opacity .3s; } .rv-band:hover { opacity:.75; }
    .rv-flow { fill:none; stroke:var(--hpf-dot,rgba(255,255,255,.8)); stroke-linecap:round; stroke-dasharray:2 14; animation:hpf-river linear infinite; }
    .rv-col { font-size:12px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; fill:var(--hpf-text,#fff); opacity:.55; }
    .rv-nm { fill:var(--hpf-text,#fff); opacity:.88; font-weight:600; }
    .rv-v { fill:var(--hpf-text,#fff); font-weight:800; }
    /* ---- Schematic ---- */
    .card.alt.v-schematic { background:var(--paper); color:var(--ink); font-family:'SF Mono','Roboto Mono',Menlo,Consolas,monospace; }
    .v-schematic .alt-title, .v-schematic .alt-chip { font-family:inherit; }
    .sch-svg { display:block; width:100%; height:auto; max-height:min(76vh,720px); }
    .sch-wire { fill:none; stroke:var(--ink); stroke-width:1.6; opacity:.55; }
    .sy-s { fill:none; stroke:var(--ink); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
    .sy-s text { fill:var(--ink); stroke:none; font-weight:700; text-anchor:middle; }
    .sy.on .sy-s { stroke:var(--c); } .sy.on .sy-s text { fill:var(--c); }
    .sy-bg { fill:var(--paper); stroke:none; }
    .sy text.sy-nm { fill:var(--ink); font-size:11px; letter-spacing:.12em; text-anchor:middle; opacity:.85; }
    .sy text.sy-v { fill:var(--ink); font-size:15px; font-weight:700; text-anchor:middle; }
    .sy text.sy-x { fill:var(--ink); font-size:11px; text-anchor:middle; opacity:.75; }
    .sy.charging text.sy-x, .sy.exporting text.sy-x, .sy.producing text.sy-x { fill:var(--hpf-good); opacity:1; }
    .sy.discharging text.sy-x, .sy.importing text.sy-x { fill:var(--hpf-warn); opacity:1; }
    .tb { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); border:1.5px solid var(--ink); margin-top:10px; }
    .tb-c { padding:6px 9px; border-right:1px solid color-mix(in srgb, var(--ink) 45%, transparent); border-bottom:1px solid color-mix(in srgb, var(--ink) 45%, transparent); min-width:0; }
    .tb-c span { display:block; font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tb-c b { display:block; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tb-t { grid-column:span 2; } .tb-t b { font-size:17px; }
  `;

  class HomePowerFlowCard extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._hass = null;
      this._timer = null;
      this._editorMode = false;
      this._flowSnapshot = null;
      this._flowVisualKey = null;
      this._rendered = false;
      this.attachShadow({ mode: 'open' });
    }

    static getConfigElement() {
      return document.createElement('home-power-flow-card-editor');
    }

    static getStubConfig() {
      return {
        type: 'custom:home-power-flow-card',
        weather_entity: '',
        background: DEFAULT_BG,
        background_night: DEFAULT_BG_NIGHT,
        sun_entity: 'sun.sun',
        devices: [
          { type: 'solar', name: 'Solar PV', power_entity: '' },
          { type: 'inverter', name: 'Inverter 1', power_entity: '' },
          { type: 'battery', name: 'Battery 1', power_entity: '' },
          { type: 'house', name: 'House', power_entity: '' },
          { type: 'grid', name: 'Grid', power_entity: '' }
        ],
        statistics: { entities: [] },
        connections: [],
        flow_speed: 8,
        flow_stagger: 0.55,
        flow_threshold: 0.001,
        flow_colors: { ...FLOW_COLORS }
      };
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
      this._config = JSON.parse(JSON.stringify(config));
      this._flowSnapshot = null;
      if (!Array.isArray(this._config.devices)) this._config.devices = [];
      if (!Array.isArray(this._config.connections)) this._config.connections = [];
      // Assigns stable ids and migrates any legacy index-based
      // connects_to/connections references onto them (see function).
      migrateDeviceIdsAndLinks(this._config);
      this._config.devices = this._config.devices.map(d => {
        const copy={...d};
        copy.invert_flow = Boolean(copy.invert_flow || copy.power_sign === 'negative_output');
        delete copy.power_sign;
        // Legacy per-type secondary entities (soc/voltage/temp/frequency) are
        // superseded by the generic, user-defined extra_entities list.
        delete copy.soc_entity; delete copy.voltage_entity; delete copy.temp_entity; delete copy.frequency_entity;
        copy.extra_entities = Array.isArray(copy.extra_entities)
          ? copy.extra_entities.filter(e => e && typeof e === 'object').slice(0, 5).map(e => ({ entity: e.entity || '', icon: e.icon || '' }))
          : [];
        return copy;
      });
      this._config.flow_colors = { ...FLOW_COLORS, ...(this._config.flow_colors || {}) };
      // V4.3.10 stores the threshold canonically in watts. Migrate older
      // configs where flow_threshold was stored in kW, and clamp against a
      // stale/corrupted value (see migrateFlowThreshold).
      migrateFlowThreshold(this._config);
      if (!this._config.flow_speed) this._config.flow_speed = 7;
      if (!this._config.background || this._config.background === '/hacsfiles/home-power-flow-card/smart-home-energy-background.png' || this._config.background === '/local/home-power-flow-card/smart-home-energy-background.png') this._config.background = DEFAULT_BG;
      if (!this._config.background_night) this._config.background_night = DEFAULT_BG_NIGHT;
      if (!this._config.sun_entity) this._config.sun_entity = 'sun.sun';
      this._currentBg = null;
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._rendered) this._render();
      else this._updateLiveValues();
    }

    // Masonry dashboards: rough height in 50px rows, from the card's
    // actual width (fixed 3:2 aspect ratio).
    getCardSize() {
      const st = this._viewStyle();
      if (st !== 'classic') return { rings: 8, tiles: 6, glance: 4, river: 6, schematic: 8 }[st] || 6;
      const w = this.clientWidth || 900;
      return Math.max(4, Math.ceil(w / (this._ratio || 1.5) / 50));
    }

    // Sections dashboards: full width by default, height decided by the
    // card itself (fixed 3:2 aspect ratio), never narrower than half.
    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: 'auto' };
    }

    connectedCallback() {
      if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => this._applyScale());
        this._resizeObserver.observe(this);
      }
      if (!this._onWinResize && typeof window !== 'undefined') { this._onWinResize = () => this._applyScale(); window.addEventListener('resize', this._onWinResize); }
      this._applyScale();
      this._fsListen(true);
      if (!this._onWxPreview && typeof window !== 'undefined') { this._onWxPreview = () => { try { this._wxFxUpdate(); } catch (e) {} }; window.addEventListener('hpf-wx-preview', this._onWxPreview); }
      if (!this._onVis && typeof document !== 'undefined' && document.addEventListener) { this._onVis = () => { try { this._wxFxUpdate(); } catch (e) {} }; document.addEventListener('visibilitychange', this._onVis); }
      if (this._rendered) {
        this._updatedTimer();
        if (!this._timer) this._timer = setInterval(() => this._updateLiveValues(), 30000);
        this._updateLiveValues(); // catch up straight away after being away
      }
    }

    disconnectedCallback() {
      // Clear AND forget the handle, so the timer restarts on reconnect
      // (previously it never came back after switching views / app sleep).
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
      if (this._upTimer) { clearInterval(this._upTimer); this._upTimer = null; }
      if (this._onWinResize) { window.removeEventListener('resize', this._onWinResize); this._onWinResize = null; }
      if (this._wxFx) { this._wxFx.destroy(); this._wxFx = null; }
      this._fsListen(false);
      if (this._fsOn) { this._fsOn = false; this._fsPseudo = false; this.removeAttribute('fs'); this._wakeLock(false); }
      if (this._wxIO) { this._wxIO.disconnect(); this._wxIO = null; }
      if (this._onWxPreview) { window.removeEventListener('hpf-wx-preview', this._onWxPreview); this._onWxPreview = null; }
      if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
    }

    // Optional maximum card width in px. Unset or 0 = no limit: the card
    // fills its column and is only capped so it never grows taller than
    // the screen (see .card max-width in CSS).
    _maxWidthCss() {
      const raw = Number(this._config?.max_width);
      return (Number.isFinite(raw) && raw >= 300 ? Math.round(raw) : 100000) + 'px';
    }

    _themeColors() {
      const c = this._config || {};
      let name = c.theme || 'dark';
      if (name === 'auto') name = this._hass?.themes?.darkMode === false ? 'light' : 'dark';
      if (name === 'custom') return customTheme(c.theme_panel_color, c.theme_text_color, c.theme_opacity);
      return THEMES[name] || THEMES.dark;
    }
    _applyTheme() {
      const card = this.shadowRoot?.querySelector('.card');
      if (!card) return;
      const t = this._themeColors();
      const set = (k, v) => { if (card.style.getPropertyValue(k) !== v) card.style.setProperty(k, v); };
      const fr = Number(this._config?.box_opacity), f = Number.isFinite(fr) ? Math.max(0, Math.min(1.5, fr)) : 1;
      set('--hpf-node-bg', f === 1 ? t.node : scaleAlpha(t.node, f)); set('--hpf-panel-bg', f === 1 ? t.panel : scaleAlpha(t.panel, f)); set('--hpf-stats-bg', f === 1 ? t.stats : scaleAlpha(t.stats, f));
      set('--hpf-blur', `${(12 * Math.min(1, f)).toFixed(1)}px`);
      set('--hpf-border', t.border); set('--hpf-text', t.text); set('--hpf-track', t.track);
      // Extra colours for the drawn view styles.
      const tn = this._themeName(), light = this._altLight();
      set('--hpf-alt-bg', ALT_BG[tn] || (t.panel ? `linear-gradient(160deg,${t.panel},${t.panel})` : ALT_BG.dark));
      set('--hpf-node-solid', ALT_SOLID[tn] || (light ? '#ffffff' : '#14263a'));
      set('--hpf-good', light ? '#1f9d55' : '#6dff95'); set('--hpf-warn', light ? '#d9730d' : '#ffab4a');
      set('--hpf-dot', light ? 'rgba(20,30,40,.45)' : 'rgba(255,255,255,.8)');
    }

    // Everything is laid out on a fixed 1200x800 design stage and scaled
    // uniformly to the card's real width, so the whole composition is always
    // visible and identical on any screen (desktop, tablet, phone, Sections
    // column, editor preview). On small cards, boxes and panels get an
    // extra per-element boost so text stays readable.
    _applyScale() {
      if (this._viewStyle() !== 'classic') { this._altApplyScale(); return; }
      const card = this.shadowRoot?.querySelector('.card');
      const stage = this.shadowRoot?.querySelector('.stage');
      if (!card || !stage) return;
      // Switch between desktop and phone layout when needed (full redraw).
      const phone = this._computePhone();
      if (this._rendered && phone !== this._phoneMode) { this._render(); return; }
      const ratioTol = this._config?.card_aspect === 'screen' ? 0.05 : 0.02;
      if (this._rendered && !this._phoneMode && Math.abs(this._computeRatio() - (this._ratio || 1.5)) > ratioTol) { this._render(); return; }
      const w = card.clientWidth;
      if (!w) return;
      stage.style.setProperty('--hpf-scale', String(w / (this._phoneMode ? 800 : this._stageW())));
      const raw = Number(this._config?.mobile_scale);
      const mobileBoost = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.min(2.5, raw)) : 1.4;
      // Ramp the boost in smoothly between 900px (none) and 400px (full),
      // so text size never jumps as the card crosses a breakpoint.
      // Today panel: user scale (default 0.8), automatically reduced further
      // so the panel is never taller than 92% of the card, however many
      // statistics rows it holds. offsetHeight is in unscaled stage px.
      const statsEl = stage.querySelector('.stats');
      if (statsEl && !statsEl.classList.contains('dock')) {
        const rawS = Number(this._config?.stats_scale);
        const userS = Number.isFinite(rawS) && rawS > 0 ? Math.max(0.3, Math.min(1.5, rawS)) : 0.8;
        const h = statsEl.offsetHeight;
        const fitS = h ? ((this._phoneMode ? 1200 : 800) * 0.92) / h : userS;
        const statsS = Math.min(userS, fitS);
        stage.style.setProperty('--hpf-stats-scale', String(statsS));
        // Phone, automatic position: nudge the panel up so it never hangs
        // off the bottom of the card (its height depends on the stat rows).
        if (this._phoneMode && !validPos(this._config?.phone_stats_position) && h) {
          const halfPct = (h * statsS / 2) / 1200 * 100;
          const y = Math.min(this._panelPos('stats').y, 99 - halfPct);
          statsEl.style.setProperty('--stats-y', y + '%');
        }
      }
      const rawT = Number(this._config?.title_scale);
      stage.style.setProperty('--hpf-title-scale', String(Number.isFinite(rawT) && rawT > 0 ? Math.max(0.3, Math.min(3, rawT)) : 1));
      const rawU = Number(this._config?.updated_scale);
      stage.style.setProperty('--hpf-updated-scale', String(Number.isFinite(rawU) && rawU > 0 ? Math.max(0.3, Math.min(3, rawU)) : 1));
      const rawB = Number(this._config?.bins_scale);
      stage.style.setProperty('--hpf-bins-scale', String(Number.isFinite(rawB) && rawB > 0 ? Math.max(0.3, Math.min(3, rawB)) : 1));
      const rawG = Number(this._config?.grid_mix_scale);
      stage.style.setProperty('--hpf-gridmix-scale', String(Number.isFinite(rawG) && rawG > 0 ? Math.max(0.3, Math.min(2, rawG)) : 1));
      const rawW = Number(this._config?.weather_scale);
      stage.style.setProperty('--hpf-weather-scale', String(Number.isFinite(rawW) && rawW > 0 ? Math.max(0.3, Math.min(2, rawW)) : 1));
      const t = Math.max(0, Math.min(1, (900 - w) / 500)) * (this._phoneMode ? 0.5 : 1);
      stage.style.setProperty('--hpf-boost', String(1 + (mobileBoost - 1) * t));
      if (this._lastRouteW !== w) { this._lastRouteW = w; this._scheduleReroute(); }
    }

    _render() {
      if (!this._hass || !this._config) return;
      // View styles other than Classic are drawn by AltViews (see _renderAlt).
      if (this._viewStyle() !== 'classic') { this._renderAlt(); return; }
      this._altStyle = null;
      const c = this._config;
      const bg = this._resolveBackground();
      this._currentBg = bg;
      const weather = state(this._hass, c.weather_entity);
      const weatherTemp = weather?.attributes?.temperature;
      const weatherUnit = weather?.attributes?.temperature_unit || '°C';
      const weatherText = weather ? (weather.attributes?.friendly_name || weather.state || 'Weather') : '';
      const weatherIcon = weather ? this._weatherIcon(weather.state) : '☀️';
      const now = new Date();
      const date = new Intl.DateTimeFormat(localeOf(this._hass), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
      const time = new Intl.DateTimeFormat(localeOf(this._hass), { hour: '2-digit', minute: '2-digit', hour12: c.time_format === '12h' }).format(now);

      const devices = c.devices || [];
      if (!this._flowSnapshot) this._captureFlowSnapshot(devices);
      const groups = {};
      for (const d of devices) {
        const type = d.type || 'load';
        (groups[type] ||= []).push(d);
      }

      // Decide desktop/phone first: device positions and flow lines below
      // depend on it.
      this._phoneMode = this._computePhone();
      this._ratio = this._computeRatio();
      const layout = this._layout(devices);
      const nodes = devices.map((d, i) => this._phoneHiddenDevice(d) ? '' : this._deviceHTML(d, i, layout[i])).join('');
      const flows = this._flows(devices, layout);
      const stats = this._statsHTML(c.statistics || {});
      // How big the device boxes render relative to the background - useful
      // when a smaller/simpler background image makes the default box size
      // look oversized. Clamped to a sane range regardless of what's in the
      // config (hand-edited YAML, old configs with no value, etc).
      const nodeScaleRaw = Number(c.device_scale);
      const nodeScale = Number.isFinite(nodeScaleRaw) && nodeScaleRaw > 0 ? Math.max(0.5, Math.min(2, nodeScaleRaw)) : 1;

      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; width:100%; }
          * { box-sizing:border-box; }
          ${FS_CSS}${ACT_CSS}
          .card { position:relative; width:100%; max-width:min(var(--hpf-max-width,100000px), calc((100vh - 96px) * var(--hpf-ratio,1.5))); margin:0 auto; aspect-ratio: var(--hpf-ratio,1.5); overflow:hidden; border-radius:22px; color:var(--hpf-text,#fff); font-family:var(--primary-font-family,Arial,sans-serif); background:#101820; box-shadow:0 12px 40px rgba(0,0,0,.28); }
          .bg { position:absolute; inset:0; background-size:cover; background-position:center; }
          .bg-fill { position:absolute; inset:-40px; background-size:cover; background-position:center; filter:blur(28px) brightness(.6); display:none; }
          .card.fit-contain .bg-fill { display:block; }
          .card.fit-contain .bg { background-size:contain; background-repeat:no-repeat; }
          .card.phone { aspect-ratio: 2 / 3; max-width:min(var(--hpf-max-width,100000px), calc((100vh - 96px) * 0.6667)); }
          .card.phone .stage { width:800px; height:1200px; }
          .stage { position:absolute; left:0; top:0; width:var(--hpf-stage-w,1200px); height:800px; transform-origin:top left; transform:scale(var(--hpf-scale,1)); }
          .wx-fx { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.vignette { position:absolute; inset:0; background:radial-gradient(circle at 55% 45%,transparent 25%,rgba(0,0,0,.12) 72%,rgba(0,0,0,.32)); pointer-events:none; }
          .header { position:absolute; left:var(--header-x,2.6%); top:var(--header-y,2.7%); z-index:20; transform-origin:top left; transform:scale(calc(var(--hpf-title-scale,1) * var(--hpf-boost,1))); color:var(--hpf-title-color,#fff); white-space:nowrap; }
          .title { font-size:42px; font-weight:700; letter-spacing:-.03em; text-shadow:0 2px 8px rgba(0,0,0,.4); }
          .subtitle { margin-top:4px; font-size:18px; opacity:.88; text-shadow:0 2px 8px rgba(0,0,0,.45); }
          .updated { position:absolute; z-index:19; left:var(--up-x,50%); top:var(--up-y,95%); transform:translate(-50%,-50%) scale(calc(var(--hpf-updated-scale,1) * var(--hpf-boost,1))); display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 6px 18px rgba(0,0,0,.25); backdrop-filter:blur(var(--hpf-blur,12px)); font-size:13px; white-space:nowrap; }
          .bins { position:absolute; z-index:19; left:var(--bn-x,50%); top:var(--bn-y,8%); transform:translate(-50%,-50%) scale(calc(var(--hpf-bins-scale,1) * var(--hpf-boost,1))); display:flex; flex-direction:column; gap:5px; padding:7px 14px; border-radius:16px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 6px 18px rgba(0,0,0,.25); backdrop-filter:blur(var(--hpf-blur,12px)); font-size:14px; white-space:nowrap; cursor:pointer; }
          .bins:empty { display:none; }
          .bins.today { border:2px solid rgba(255,183,77,.9); box-shadow:0 0 18px rgba(255,183,77,.35), 0 6px 18px rgba(0,0,0,.25); }
          .bin-seg { display:flex; align-items:center; gap:8px; } .bin-icons { display:inline-flex; gap:1px; } .bin-svg { display:block; flex:none; }
          .updated ha-icon { --mdc-icon-size:16px; width:16px; height:16px; opacity:.85; }
          .updated.stale { color:#ffb74d; border-color:rgba(255,183,77,.55); }
          .gridmix { position:absolute; z-index:19; left:var(--gm-x,83%); top:var(--gm-y,32%); transform:translate(-50%,-50%) scale(calc(var(--hpf-gridmix-scale,1) * var(--hpf-boost,1))); width:270px; padding:12px 14px; border-radius:15px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 8px 28px rgba(0,0,0,.25); backdrop-filter:blur(var(--hpf-blur,12px)); font-size:12px; }
          .gridmix .gm-head { display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; opacity:.9; }
          .gridmix .gm-head ha-icon { --mdc-icon-size:16px; width:16px; height:16px; }
          .gridmix .gm-main { display:flex; align-items:baseline; gap:6px; margin:6px 0 8px; }
          .gridmix .gm-val { font-size:24px; font-weight:750; }
          .gridmix .gm-unit { opacity:.7; font-size:11px; }
          .gridmix .gm-badge { margin-left:auto; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; color:#fff; }
          .gridmix .gm-bar { display:flex; height:7px; border-radius:4px; overflow:hidden; margin-bottom:8px; background:var(--hpf-track,rgba(255,255,255,.1)); }
          .gridmix .gm-list { display:grid; grid-template-columns:1fr 1fr; gap:3px 12px; }
          .gridmix .gm-row { display:flex; align-items:center; gap:5px; white-space:nowrap; }
          .gridmix .gm-row ha-icon { --mdc-icon-size:14px; width:14px; height:14px; flex:none; }
          .gridmix .gm-row b { margin-left:auto; font-weight:650; }
          .gridmix .gm-msg { opacity:.7; margin-top:6px; }
          .weather { position:absolute; z-index:20; left:var(--weather-x,82%); top:var(--weather-y,10%); transform:translate(-50%,-50%) scale(calc(var(--hpf-weather-scale,1) * var(--hpf-boost,1))); min-width:250px; max-width:31%; padding:13px 17px; border-radius:17px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 8px 28px rgba(0,0,0,.25); backdrop-filter:blur(var(--hpf-blur,12px)); display:grid; grid-template-columns:1fr auto; gap:4px 14px; }
          .date { font-size:14px; opacity:.82; align-self:end; }.clock { font-size:26px; font-weight:700; }.wicon { grid-row:1/3; grid-column:2; font-size:35px; align-self:center; }.temp { font-size:23px; font-weight:600; }.wstate { font-size:13px; opacity:.85; }
          .stats { position:absolute; z-index:18; left:var(--stats-x,17%); top:var(--stats-y,86%); transform:translate(-50%,-50%) scale(var(--hpf-stats-scale,0.8)); width:min(360px,30%); padding:18px 20px; border-radius:21px; background:var(--hpf-stats-bg,linear-gradient(145deg,rgba(45,38,33,.74),rgba(18,25,31,.74))); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 10px 30px rgba(0,0,0,.24); backdrop-filter:blur(var(--hpf-blur,12px)); }
          .stats h3 { margin:0 0 14px; font-size:20px; }
          .stats.dock { transform:none; width:auto; max-width:none; border-radius:0; padding:10px 18px; display:flex; gap:4px; z-index:22; transition:transform .35s ease; scrollbar-width:thin; }
          .stats.dock h3 { margin:0 10px 0 0; font-size:17px; white-space:nowrap; align-self:center; }
          .stats.dock .stat { grid-template-columns:auto auto; grid-template-areas:"ico value" "ico name"; column-gap:8px; row-gap:0; padding:4px 12px; font-size:12px; border-left:1px solid var(--hpf-border,rgba(255,255,255,.16)); flex:none; }
          .stats.dock .stat .ico { grid-area:ico; }
          .stats.dock .stat > span:nth-child(2) { grid-area:name; opacity:.75; font-size:11px; white-space:nowrap; }
          .stats.dock .stat .value { grid-area:value; font-weight:700; font-size:15px; white-space:nowrap; text-align:left; }
          .stats.dock-bottom, .stats.dock-top { left:0; right:0; flex-direction:row; align-items:center; overflow-x:auto; }
          .stats.dock-bottom { top:auto; bottom:0; border-radius:16px 16px 0 0; }
          .stats.dock-top { top:0; bottom:auto; border-radius:0 0 16px 16px; }
          .stats.dock-left, .stats.dock-right { top:0; bottom:0; width:230px; flex-direction:column; align-items:stretch; overflow-y:auto; }
          .stats.dock-left { left:0; right:auto; border-radius:0 16px 16px 0; }
          .stats.dock-right { right:0; left:auto; border-radius:16px 0 0 16px; }
          .stats.dock-left .stat, .stats.dock-right .stat { border-left:0; border-top:1px solid var(--hpf-border,rgba(255,255,255,.16)); padding:8px 4px; }
          .stats.dock-left h3, .stats.dock-right h3 { margin:4px 0 8px; }
          .stats.dock.autohide.dock-bottom { transform:translateY(100%); }
          .stats.dock.autohide.dock-top { transform:translateY(-100%); }
          .stats.dock.autohide.dock-left { transform:translateX(-100%); }
          .stats.dock.autohide.dock-right { transform:translateX(100%); }
          .stats.dock.autohide.open { transform:none; }
          .stats-tab { position:absolute; z-index:21; padding:6px 18px; font-size:14px; font-weight:700; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); backdrop-filter:blur(var(--hpf-blur,12px)); cursor:pointer; user-select:none; transition:opacity .25s; }
          .stats-tab.hidden { opacity:0; }
          .stats-tab.dock-bottom { bottom:0; left:50%; transform:translateX(-50%); border-radius:12px 12px 0 0; border-bottom:0; }
          .stats-tab.dock-top { top:0; left:50%; transform:translateX(-50%); border-radius:0 0 12px 12px; border-top:0; }
          .stats-tab.dock-left, .stats-tab.dock-right { top:50%; writing-mode:vertical-rl; padding:18px 6px; }
          .stats-tab.dock-left { left:0; transform:translateY(-50%) rotate(180deg); border-radius:12px 0 0 12px; }
          .stats-tab.dock-right { right:0; transform:translateY(-50%); border-radius:12px 0 0 12px; }.stat { display:grid; grid-template-columns:28px 1fr auto; align-items:center; gap:7px; padding:8px 0; font-size:14px; }.stat .ico{font-size:19px}.stat .value{font-weight:700;font-size:15px}.co2{border-top:1px solid rgba(255,255,255,.18);margin-top:7px;padding-top:12px;color:#d6f5d0}
          .canvas { position:absolute; inset:0; z-index:5; }
          svg.flows { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
          .flow-path { fill:none; stroke-linecap:round; filter:url(#glow); opacity:.92; }
          .flow-dot { filter:url(#dotglow); }
          .node { position:absolute; transform:translate(-50%,-50%) scale(calc(${nodeScale} * var(--hpf-boost,1))); width:195px; min-height:74px; padding:11px 13px; border-radius:15px; z-index:10; background:var(--hpf-node-bg,linear-gradient(145deg,rgba(9,25,40,.87),rgba(15,30,44,.73))); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 8px 22px rgba(0,0,0,.32); backdrop-filter:blur(var(--hpf-blur,10px)); }
          .node.has-hist { overflow:hidden; }.node .hist { position:absolute; left:0; right:0; bottom:0; height:62%; pointer-events:none; z-index:0; }.node .hist svg { width:100%; height:100%; display:block; }.node > :not(.hist) { position:relative; z-index:1; }.node.sized { min-height:0; overflow:hidden; }.node.sized .node-body { width:169px; transform-origin:top left; }.node .top { display:flex; align-items:center; gap:8px; }.node .icon { font-size:24px; line-height:1; }.node .name { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.node .power { margin-top:5px; font-size:19px; font-weight:750; }.node .batt-time { margin-top:3px; display:flex; align-items:center; gap:4px; font-size:12px; font-weight:600; opacity:.9; }.node .batt-time:empty { display:none; }.node .batt-time ha-icon { --mdc-icon-size:13px; width:13px; height:13px; }.node .extras { margin-top:4px; display:flex; flex-wrap:wrap; gap:2px 8px; }.node .extras:empty { display:none; margin:0; }.node .extra-row { display:inline-flex; align-items:center; gap:3px; font-size:10px; line-height:1.3; opacity:.78; white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }.node .extra-row ha-icon { --mdc-icon-size:12px; width:12px; height:12px; flex:none; }.node.battery { border-color:rgba(123,255,158,.28); }.node.grid { border-color:rgba(93,191,255,.3); }.node.ev { border-color:rgba(151,255,103,.28); }
          @keyframes hpf-charge-pulse { 0%,100% { box-shadow:0 8px 22px rgba(0,0,0,.32), 0 0 0 0 var(--pulse-color); } 50% { box-shadow:0 8px 22px rgba(0,0,0,.32), 0 0 30px 8px var(--pulse-color); } }
          @media (prefers-reduced-motion: reduce) { .node[data-batt-state="charging"], .node[data-batt-state="discharging"] { animation:none !important; } }
          .empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:30; }.empty > div { padding:24px 30px; background:rgba(10,25,38,.82); border-radius:18px; border:1px solid var(--hpf-border,rgba(255,255,255,.16)); text-align:center; backdrop-filter:blur(var(--hpf-blur,10px)); }.empty b{display:block;font-size:20px;margin-bottom:6px}.empty span{opacity:.75}
        </style>
        <div class="card${this._phoneMode ? ' phone' : ''}${this._config?.background_fit === 'contain' ? ' fit-contain' : ''}" style="--hpf-max-width:${this._maxWidthCss()}${this._phoneMode ? '' : `;--hpf-ratio:${this._ratio};--hpf-stage-w:${this._stageW()}px`}">
          <div class="bg-fill"></div><div class="bg" style="${this._phoneMode ? `background-position:${phoneBgFocus(this._config)}` : ''}"></div><div class="vignette"></div>${this._config?.weather_effects === true ? '<canvas class="wx-fx"></canvas>' : ''}
          <div class="stage">
          ${this._headerHTML()}
          ${this._gridMixBoxHTML()}
          ${this._updatedBoxHTML()}
          ${this._binsBoxHTML()}
          ${this._phoneHidden('weather') ? '' : `<div class="weather" data-act="weather" style="--weather-x:${this._panelPos('weather').x}%;--weather-y:${this._panelPos('weather').y}%"><div class="date">${esc(date)}</div><div class="clock">${esc(time)}</div><div class="wicon">${weatherIcon}</div><div class="temp">${weatherTemp != null ? esc(weatherTemp) + esc(weatherUnit) : '—'}</div><div class="wstate">${esc(weatherText)}</div></div>`}
          <div class="canvas"><svg class="flows" viewBox="0 0 ${this._vbW()} ${this._vbH()}" preserveAspectRatio="none">${this._svgFilterDefs()}${flows}</svg>${nodes}</div>
          ${stats && !this._phoneHidden('stats') ? this._statsPlaced(stats) : ''}
          ${devices.length ? '' : `<div class="empty"><div><b>${esc(this._t('Add your first device'))}</b><span>${esc(this._t('Open the card editor and add Solar, Inverter, Battery, Grid or House.'))}</span></div></div>`}
          </div>
          ${this._fsBtnHTML()}
        </div>`;

      this._rendered = true;
      this._applyBackground(bg);
      try { this._wxFxUpdate(); } catch (e) {}
      this._applyTheme();
      this._histRefresh();
      this._lastRouteW = null;
      this._applyScale();
      this._updatedTimer();
      this._bindDock();
      this._fitBodies();
      this._gridMixRefresh();
      this._binsRefresh();
      this._fsBind();
      this._bindActions();
      if (!this._timer) this._timer = setInterval(() => this._updateLiveValues(), 30000);
    }

    _isNight() {
      const sunEntity = this._config?.sun_entity || 'sun.sun';
      const sunState = state(this._hass, sunEntity);
      return !!sunState && sunState.state === 'below_horizon';
    }

    _wxFxUpdate() {
      const c = this._config || {};
      const cv = this.shadowRoot?.querySelector('.wx-fx');
      if (!c.weather_effects || !cv || typeof requestAnimationFrame === 'undefined') { if (this._wxFx) { this._wxFx.destroy(); this._wxFx = null; } return; }
      let reduce = false; try { reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
      if (!this._wxFx || this._wxFx.c !== cv) { this._wxFx?.destroy(); this._wxFx = new WeatherFx(cv); }
      if (!this._wxIO && typeof IntersectionObserver !== 'undefined') {
        this._wxIO = new IntersectionObserver(es => { const v = es.some(e => e.isIntersecting); this._wxVisible = v; this._wxFxUpdate(); });
        this._wxIO.observe(this);
      }
      const st = state(this._hass, c.weather_entity);
      const target = reduce ? {} : wxFxTarget(WX_FX_PREVIEW || st?.state || '', c.weather_effects_amount);
      if (target.lightning && c.weather_effects_lightning === false) delete target.lightning;
      target.wind = wxWindSlant(st);
      this._wxFx.visible = this._wxVisible !== false && !(typeof document !== 'undefined' && document.hidden);
      this._wxFx.set(target);
    }

    _resolveBackground() {
      const c = this._config || {};
      if (seasonalOn(c) && seasonActive(c)) {
        const s = extraBgFor(c, 'season', this._isNight());
        if (s) return s;
      }
      if (this._isNight()) return c.background_upload_night || c.background_night || DEFAULT_BG_NIGHT;
      return c.background_upload_day || c.background || DEFAULT_BG;
    }

    // Paths under /media/ are served by Home Assistant's protected media
    // view and require an Authorization header - a plain CSS url() or <img>
    // request cannot supply one. We fetch those ourselves with the current
    // access token and swap in a local blob URL. Anything else (the
    // /hacsfiles/ defaults, /local/, or a full external URL) loads directly.
    // Paints the background (and the blurred fill used by "Fit whole image")
    // and measures the picture's proportions for the 'Match background
    // image' card shape.
    _paintBg(url) {
      const grad = 'linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.22))';
      this.shadowRoot?.querySelectorAll('.bg, .bg-fill').forEach(el => { el.style.backgroundImage = `${grad},url('${url}')`; });
      if (typeof Image === 'undefined') return;
      this._bgRatios ||= {};
      const use = r => {
        if (!r) return;
        const changed = Math.abs(r - (this._bgRatio || 0)) > 0.01;
        this._bgRatio = r;
        if (changed && this._config?.card_aspect === 'image' && this._rendered && !this._phoneMode) this._render();
      };
      if (this._bgRatios[url]) { use(this._bgRatios[url]); return; }
      const img = new Image();
      img.onload = () => { if (img.naturalWidth && img.naturalHeight) { this._bgRatios[url] = img.naturalWidth / img.naturalHeight; if (this._currentBg && (url.includes(this._currentBg) || this._bgBlobUrls?.[this._currentBg] === url)) use(this._bgRatios[url]); } };
      img.src = url;
    }
    async _applyBackground(bg) {
      const bgEl = this.shadowRoot?.querySelector('.bg');
      if (!bgEl || !bg) return;
      const grad = 'linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.22))';
      if (!bg.startsWith('/media/')) {
        this._paintBg(bg);
        return;
      }
      this._bgBlobUrls ||= {};
      if (this._bgBlobUrls[bg]) {
        this._paintBg(this._bgBlobUrls[bg]);
        return;
      }
      try {
        const token = this._hass?.auth?.data?.access_token;
        const resp = await fetch(bg, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        this._bgBlobUrls[bg] = url;
        if (this._currentBg === bg) {
          const el = this.shadowRoot?.querySelector('.bg');
          if (el) this._paintBg(url);
        }
      } catch (e) {
        console.error('Home Power Flow Card: failed to load uploaded background', bg, e);
      }
    }

    // Title + subtitle: plain text (no box), positioned by its top-left
    // corner so longer/shorter text grows to the right instead of shifting.
    // Title defaults to 'Energy Flow' only when never set; an explicitly
    // emptied title stays blank. Nothing is rendered if both are blank.
    _headerHTML() {
      const c = this._config || {};
      const title = c.title === undefined || c.title === null ? this._t('Energy Flow') : String(c.title);
      const subtitle = c.subtitle ? String(c.subtitle) : '';
      if (!title.trim() && !subtitle.trim()) return '';
      if (this._phoneHidden('header')) return '';
      const p = this._panelPos('header');
      const color = /^#[0-9a-f]{3,8}$/i.test(String(c.title_color || '')) ? c.title_color : '#ffffff';
      return `<div class="header" style="--header-x:${p.x}%;--header-y:${p.y}%;--hpf-title-color:${color}">${title.trim() ? `<div class="title">${esc(title)}</div>` : ''}${subtitle.trim() ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}</div>`;
    }

    // "Last updated" pill: how long ago an entity's data was updated. If the
    // entity's own state is a timestamp (e.g. an inverter's "last updated
    // time" sensor) that time is used; otherwise Home Assistant's
    // last_updated for the entity. Turns amber once older than the
    // configured number of minutes.
    // Reads the time from the entity's own state when it holds one, in any
    // common format: full date-time (ISO or 'YYYY-MM-DD HH:MM:SS'), time
    // only ('HH:MM' / 'HH:MM:SS', today, or yesterday if still ahead), or a
    // Unix timestamp in seconds or milliseconds. Otherwise falls back to
    // Home Assistant's last_updated for the entity.
    _updatedTimestamp(st) {
      const raw = String(st?.state ?? '').trim();
      let ts = NaN;
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(raw)) ts = Date.parse(raw.replace(' ', 'T'));
      else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
        const [h, m, sec] = raw.split(':').map(Number);
        const d = new Date(); d.setHours(h, m, sec || 0, 0);
        if (h < 24 && m < 60 && (sec || 0) < 60) { ts = d.getTime(); if (ts - Date.now() > 60000) ts -= 86400000; }
      } else if (/^\d{9,13}(\.\d+)?$/.test(raw)) {
        const n = Number(raw); const ms = n > 1e12 ? n : n * 1000;
        if (ms > 946684800000 && ms < Date.now() + 86400000) ts = ms;
      }
      if (!Number.isFinite(ts)) ts = Date.parse(st?.last_updated || st?.last_changed || '');
      return ts;
    }
    _updatedInfo() {
      const c = this._config || {};
      const st = state(this._hass, c.updated_entity);
      if (!st) return { text: this._t('No data'), stale: true };
      const ts = this._updatedTimestamp(st);
      if (!Number.isFinite(ts)) return { text: this._t('Unknown'), stale: true };
      const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      const p2 = n => String(n).padStart(2, '0');
      const ago = sec < 2 ? this._t('just now')
        : sec < 60 ? this._t('{n}s ago', { n: sec })
        : sec < 3600 ? this._t('{m}m {s}s ago', { m: Math.floor(sec / 60), s: p2(sec % 60) })
        : sec < 86400 ? this._t('{h}h {m}m ago', { h: Math.floor(sec / 3600), m: p2(Math.floor((sec % 3600) / 60)) })
        : this._t('{d}d {h}h ago', { d: Math.floor(sec / 86400), h: Math.floor((sec % 86400) / 3600) });
      const lim = Number(c.updated_stale_minutes);
      const staleMin = Number.isFinite(lim) && lim > 0 ? lim : 10;
      return { text: ago, stale: sec > staleMin * 60 };
    }
    // Ticks the "ago" counter every second while the box is shown.
    _updatedTimer() {
      if (this._config?.updated_enabled === true) {
        if (!this._upTimer) this._upTimer = setInterval(() => this._updatedRefresh(), 1000);
      } else if (this._upTimer) { clearInterval(this._upTimer); this._upTimer = null; }
    }
    _updatedInner() {
      const label = this._config?.updated_label === undefined ? this._t('Updated') : String(this._config.updated_label || '');
      const info = this._updatedInfo();
      return `<ha-icon icon="mdi:update"></ha-icon><span>${label ? esc(label) + ' ' : ''}${esc(info.text)}</span>`;
    }
    _updatedBoxHTML() {
      if (this._config?.updated_enabled !== true || this._phoneHidden('updated')) return '';
      const p = this._panelPos('updated');
      return `<div class="updated${this._updatedInfo().stale ? ' stale' : ''}" data-act="updated" style="--up-x:${p.x}%;--up-y:${p.y}%">${this._updatedInner()}</div>`;
    }
    _updatedRefresh() {
      this.shadowRoot?.querySelectorAll('[data-upd-text]').forEach(t => { const v = this._updatedInfo().text; if (t.textContent !== v) t.textContent = v; });
      const el = this.shadowRoot?.querySelector('.updated');
      if (!el) return;
      const h = this._updatedInner();
      if (el.innerHTML !== h) el.innerHTML = h;
      el.classList.toggle('stale', this._updatedInfo().stale);
    }

    _gridMixEnabled() { return this._config?.grid_mix_enabled === true; }
    _gridMixBoxHTML() {
      if (!this._gridMixEnabled() || this._phoneHidden('gridmix')) return '';
      const p = this._panelPos('gridmix');
      return `<div class="gridmix" data-act="gridmix" style="--gm-x:${p.x}%;--gm-y:${p.y}%">${this._gridMixInner()}</div>`;
    }
    _gridMixInner() {
      const e = GRID_MIX_CACHE.get(gridMixPostcode(this._config?.grid_mix_postcode));
      const d = e?.data;
      const head = `<div class="gm-head"><ha-icon icon="mdi:transmission-tower"></ha-icon><span>${esc(this._t('Grid'))} · ${esc(this._t(d?.region || (gridMixPostcode(this._config?.grid_mix_postcode) || 'Great Britain')))}</span></div>`;
      if (!d) return head + `<div class="gm-msg">${esc(this._t(e?.error ? 'Grid data unavailable' : 'Loading grid data…'))}</div>`;
      const idx = GRID_INDEX[String(d.index || '').toLowerCase()];
      const mix = (d.mix || []).filter(m => Number(m.perc) > 0).sort((a, b) => b.perc - a.perc);
      const bar = mix.map(m => `<span style="width:${Number(m.perc)}%;background:${(GRID_FUELS[m.fuel] || GRID_FUELS.other).color}"></span>`).join('');
      const rows = mix.slice(0, 8).map(m => { const f = GRID_FUELS[m.fuel] || { ...GRID_FUELS.other, label: m.fuel }; return `<div class="gm-row"><ha-icon icon="${f.icon}" style="color:${f.color}"></ha-icon><span>${esc(this._t(f.label))}</span><b>${Number(m.perc).toFixed(0)}%</b></div>`; }).join('');
      return head + `<div class="gm-main"><span class="gm-val">${Number.isFinite(Number(d.intensity)) ? Math.round(d.intensity) : '—'}</span><span class="gm-unit">gCO₂/kWh</span>${idx ? `<span class="gm-badge" style="background:${idx.color}">${esc(this._t(idx.label))}</span>` : ''}</div><div class="gm-bar">${bar}</div><div class="gm-list">${rows}</div>` + (e.error ? `<div class="gm-msg">${esc(this._t('Showing last data (update failed)'))}</div>` : '');
    }
    // Fetches (via the shared cache) when enabled; cheap to call often.
    _gridMixRefresh() {
      if (!this._gridMixEnabled()) return;
      gridMixGet(gridMixPostcode(this._config.grid_mix_postcode), () => {
        const box = this.shadowRoot?.querySelector('.gridmix');
        if (box) box.innerHTML = this._gridMixInner();
      });
    }

    _uiPosition(pos, dx, dy) {
      if (pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))) return { x:Number(pos.x), y:Number(pos.y) };
      return { x:dx, y:dy };
    }

    _tick() { this._updateLiveValues(); }

    _captureFlowSnapshot(devices) {
      this._flowSnapshot = {};
      (devices || []).forEach((d, i) => {
        this._flowSnapshot[i] = devicePower(this._hass, d);
      });
      this._flowVisualKey = this._flowStateKey(devices || [], this._flowSnapshot);
    }

    _updateLiveValues() {
      if (!this._hass || !this._config || !this._rendered) return;
      // Each step is isolated: an error in one (e.g. a history fetch during a
      // dropped connection) can no longer freeze the Today panel, the values
      // or anything after it.
      const safe = (name, fn) => { try { fn(); } catch (e) { console.warn(`Home Power Flow Card: ${name} update failed`, e); } };
      safe('stats', () => this._updateStatsValues());
      safe('theme', () => this._applyTheme());
      safe('history', () => this._histRefresh());
      safe('grid mix', () => this._gridMixRefresh());
      safe('last updated', () => this._updatedRefresh());
      safe('weather effects', () => this._wxFxUpdate());
      safe('bins', () => this._binsRefresh());
      if (this._viewStyle() !== 'classic') { safe('view', () => this._updateAlt()); return; }
      const nextBg = this._resolveBackground();
      if (nextBg !== this._currentBg) {
        this._currentBg = nextBg;
        this._applyBackground(nextBg);
      }
      const devices = this._config.devices || [];
      this.shadowRoot.querySelectorAll('.node[data-device-index]').forEach(node => {
        const i = Number(node.dataset.deviceIndex);
        const d = devices[i];
        if (!d) return;
        const power = devicePower(this._hass, d);
        const powerEl = node.querySelector('.power');
        if (powerEl) powerEl.textContent = this._isUtility(d) ? this._utilityText(d) : (power == null ? '—' : fmtPower(power, this._config?.power_unit));
        const extrasEl = node.querySelector('.extras');
        if (extrasEl) extrasEl.innerHTML = this._extraEntitiesRows(d);
        const histEl = node.querySelector('.hist');
        if (histEl && d.history_graph === true) { this._histAppend(d); const h = this._histSVG(d); if (histEl.innerHTML !== h) histEl.innerHTML = h; }
        const btEl = node.querySelector('.batt-time');
        if (btEl) { const h = this._batteryTimeHTML(d, power); if (btEl.innerHTML !== h) btEl.innerHTML = h; }
        if (node.classList.contains('sized')) this._fitBodies();
        const battState = this._batteryState(d, power);
        node.dataset.battState = battState || '';
        // Plain inline styles (see _batteryGlowStyle), not a CSS class -
        // directly visible in the node's own style attribute when inspected.
        node.style.borderColor = '';
        node.style.borderWidth = '';
        node.style.boxShadow = '';
        node.style.animation = '';
        node.style.removeProperty('--pulse-color');
        if (battState) {
          const glow = battState === 'charging' ? 'rgba(90,255,125,.95)' : 'rgba(255,150,40,.95)';
          const border = battState === 'charging' ? 'rgba(90,255,125,.85)' : 'rgba(255,150,40,.85)';
          node.style.borderColor = border;
          node.style.borderWidth = '2px';
          node.style.boxShadow = `0 8px 22px rgba(0,0,0,.32), 0 0 30px 8px ${glow}`;
          node.style.setProperty('--pulse-color', glow);
          node.style.animation = 'hpf-charge-pulse 1.8s ease-in-out infinite';
        }
      });
      const c = this._config;
      const weather = state(this._hass, c.weather_entity);
      const weatherTemp = weather?.attributes?.temperature;
      const weatherUnit = weather?.attributes?.temperature_unit || '°C';
      const weatherText = weather ? (weather.attributes?.friendly_name || weather.state || 'Weather') : '';
      const weatherIcon = weather ? this._weatherIcon(weather.state) : '☀️';
      const now = new Date();
      const date = new Intl.DateTimeFormat(localeOf(this._hass), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
      const time = new Intl.DateTimeFormat(localeOf(this._hass), { hour: '2-digit', minute: '2-digit', hour12: c.time_format === '12h' }).format(now);
      const dateEl=this.shadowRoot.querySelector('.date'), timeEl=this.shadowRoot.querySelector('.clock'), tempEl=this.shadowRoot.querySelector('.temp'), stateEl=this.shadowRoot.querySelector('.wstate'), iconEl=this.shadowRoot.querySelector('.wicon');
      if(dateEl) dateEl.textContent=date; if(timeEl) timeEl.textContent=time; if(tempEl) tempEl.textContent=weatherTemp != null ? `${weatherTemp}${weatherUnit}` : '—'; if(stateEl) stateEl.textContent=weatherText; if(iconEl) iconEl.textContent=weatherIcon;

      // Rebuild only when active/inactive state, direction, or a meaningful
      // (roughly doubling/halving) change in load occurs - see
      // _flowStateKey. Minor value fluctuations do not restart the
      // travelling-dot animation, but a real load change now updates its
      // speed.
      const currentSnapshot = {};
      devices.forEach((d, i) => { currentSnapshot[i] = devicePower(this._hass, d); });
      const look = this._flowLookName();
      if (look !== this._lastLook) { this._lastLook = look; this._flowVisualKey = null; }
      const nextFlowKey = this._flowStateKey(devices, currentSnapshot);
      if (nextFlowKey !== this._flowVisualKey) {
        this._flowSnapshot = currentSnapshot;
        this._flowVisualKey = nextFlowKey;
        const svg = this.shadowRoot.querySelector('svg.flows');
        if (svg) {
          const layout = this._layout(devices);
          if (this._config.flow_style === 'orthogonal') { const obs = this._measureObstacles(); if (obs) this._obstacles = obs; }
          svg.innerHTML = this._svgFilterDefs() + this._flows(devices, layout);
        }
      } else {
        this._flowSnapshot = currentSnapshot;
      }
    }

    _weatherIcon(condition) {
      const s = String(condition || '').toLowerCase();
      // Home Assistant's standard conditions first, then loose matching for
      // integrations that use their own words.
      const exact = { 'clear-night': '🌙', 'cloudy': '☁️', 'exceptional': '⚠️', 'fog': '🌫️', 'hail': '🧊', 'lightning': '🌩️', 'lightning-rainy': '⛈️', 'partlycloudy': '⛅', 'pouring': '🌧️', 'rainy': '🌧️', 'snowy': '❄️', 'snowy-rainy': '🌨️', 'sunny': '☀️', 'windy': '💨', 'windy-variant': '💨' };
      if (exact[s]) return exact[s];
      if (s.includes('storm') || s.includes('thunder')) return '⛈️';
      if (s.includes('rain') || s.includes('drizzle') || s.includes('pour')) return '🌧️';
      if (s.includes('snow')) return '❄️';
      if (s.includes('cloud')) return '⛅';
      if (s.includes('fog') || s.includes('mist')) return '🌫️';
      if (s.includes('wind')) return '💨';
      if (s.includes('storm')) return '⛈️';
      return '☀️';
    }

    // Flow canvas size in SVG units (landscape on desktop, portrait on phone).
    _t(text, vars) { return tr(langOf(this._hass), text, vars); }
    // Floating panel at its position, or docked bar (plus its tab when
    // auto-hiding) on the chosen card edge.
    _statsPlaced(stats) {
      const dk = statsDockFor(this._config, this._phoneMode);
      if (dk.mode !== 'docked') return stats.replace('<div class="stats">', `<div class="stats" style="--stats-x:${this._panelPos('stats').x}%;--stats-y:${this._panelPos('stats').y}%">`);
      const bar = stats.replace('<div class="stats">', `<div class="stats dock dock-${dk.edge}${dk.autohide ? ' autohide' : ''}">`);
      const title = this._config?.statistics?.title || this._t('Today');
      return (dk.autohide ? `<div class="stats-tab dock-${dk.edge}">${esc(title)}</div>` : '') + bar;
    }
    // Auto-hide: hover (or tap) the tab to slide the bar out; it slides back
    // shortly after the pointer leaves, a few seconds after a tap, or when
    // you tap elsewhere on the card.
    _bindDock() {
      const bar = this.shadowRoot?.querySelector('.stats.dock.autohide'), tab = this.shadowRoot?.querySelector('.stats-tab');
      if (!bar || !tab) return;
      const open = () => { clearTimeout(this._dockT); bar.classList.add('open'); tab.classList.add('hidden'); };
      const close = ms => { clearTimeout(this._dockT); this._dockT = setTimeout(() => { bar.classList.remove('open'); tab.classList.remove('hidden'); }, ms); };
      tab.addEventListener('mouseenter', open);
      tab.addEventListener('mouseleave', () => close(1200));
      tab.addEventListener('click', e => { e.stopPropagation(); open(); close(6000); });
      bar.addEventListener('mouseenter', () => clearTimeout(this._dockT));
      bar.addEventListener('mouseleave', () => close(1200));
      bar.addEventListener('click', e => { e.stopPropagation(); open(); close(6000); });
      this.shadowRoot.querySelector('.card')?.addEventListener('click', () => { if (bar.classList.contains('open')) close(0); });
    }
    // Card shape (desktop). Fixed ratios, 'image' (background picture's own
    // proportions, measured when it loads) or 'screen' (card width / screen
    // height, so the card fills the available area).
    _computeRatio() {
      if (this._fsOn && typeof window !== 'undefined') return clampRatio(window.innerWidth / Math.max(1, window.innerHeight));
      const a = this._config?.card_aspect || '3:2';
      if (CARD_RATIOS[a]) return CARD_RATIOS[a];
      if (a === 'image') return clampRatio(this._bgRatio || 1.5);
      if (a === 'screen') {
        const h = Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 900) - 96);
        if (typeof this._editorPhone === 'boolean') {
          // In the card editor's preview: use the dashboard's shape (or the
          // screen's proportions), never this preview's own width.
          return SCREEN_RATIO_HINT || clampRatio((typeof window !== 'undefined' ? window.innerWidth : 1600) / h);
        }
        const w = this.clientWidth || this.getBoundingClientRect?.().width || 0;
        if (!(w > 0)) return SCREEN_RATIO_HINT || 1.5;
        const r = clampRatio(w / h);
        SCREEN_RATIO_HINT = r;
        return r;
      }
      return 1.5;
    }
    _stageW() { return Math.round(800 * (this._ratio || 1.5)); }
    _vbW() { return this._phoneMode ? 667 : (this._ratio && this._ratio !== 1.5 ? Math.round(667 * this._ratio) : 1000); }
    _vbH() { return this._phoneMode ? 1000 : 667; }
    _layout(devices) {
      const desk = this._desktopLayout(devices);
      if (!this._phoneMode) return desk;
      const auto = phoneAutoLayout(devices, desk).positions;
      return devices.map((d, i) => validPos(d.phone_position) || auto[i]);
    }
    // Position of a panel (title, weather, grid mix, last updated, Today)
    // for the current layout, falling back to that layout's default.
    // Hidden in the phone layout (devices: phone_hidden; panels: phone_hide_<kind>).
    _phoneHidden(kind) { return this._phoneMode === true && this._config?.['phone_hide_' + kind] === true; }
    _phoneHiddenDevice(d) { return this._phoneMode === true && d?.phone_hidden === true; }
    _panelPos(kind) {
      const c = this._config || {}, def = PANEL_POS[kind];
      if (!this._phoneMode) return this._uiPosition(c[def.key], def.d[0], def.d[1]);
      const own = validPos(c[def.phone]);
      if (own) return own;
      if (kind === 'stats') { const devices = c.devices || []; return { x: def.p[0], y: phoneAutoLayout(devices, this._desktopLayout(devices)).statsY }; }
      return { x: def.p[0], y: def.p[1] };
    }
    // Phone layout on/off: 'auto' (default) switches below the breakpoint
    // (card width, default 600px); 'always' / 'never' force it. The card
    // editor can force it while you're editing the phone layout.
    _computePhone() {
      if (typeof this._editorPhone === 'boolean') return this._editorPhone;
      const mode = this._config?.phone_layout || 'auto';
      if (mode === 'always') return true;
      if (mode === 'never') return false;
      // Full screen on a portrait screen: the portrait layout fits far better.
      if (this._fsOn && typeof window !== 'undefined') return window.innerWidth < window.innerHeight;
      const bp = Number(this._config?.phone_breakpoint);
      const w = this.clientWidth || this.getBoundingClientRect?.().width || 0;
      return w > 0 && w < (Number.isFinite(bp) && bp > 0 ? bp : 600);
    }
    _desktopLayout(devices) {
      const zones = {
        solar: [18, 23], inverter: [56, 39], battery: [58, 65], gateway: [48, 78], house: [28, 82], grid: [82, 84], generator: [18, 62], water: [14, 90], gas: [40, 92], ev: [83, 50], load: [76, 67]
      };
      const counters = {};
      return devices.map(d => {
        const type = d.type || 'load';
        const [cx, cy] = zones[type] || [70, 68];
        const n = counters[type] || 0; counters[type] = n + 1;
        const same = devices.filter(x => (x.type || 'load') === type).length;
        const spacing = Math.min(15, 70 / Math.max(1, same));
        let x = cx, y = cy;
        if (same > 1) x = cx + (n - (same - 1) / 2) * spacing;
        if (type === 'battery' && same > 3) { const col = n % 3; const row = Math.floor(n / 3); x = 48 + col * 12; y = 64 + row * 12; }
        if (type === 'solar' && same > 4) { const col = n % 4; const row = Math.floor(n / 4); x = 33 + col * 12; y = 22 + row * 11; }
        if (type === 'ev' && same > 2) { const col = n % 2; const row = Math.floor(n / 2); x = 78 + col * 10; y = 45 + row * 13; }
        if (d.position && Number.isFinite(Number(d.position.x)) && Number.isFinite(Number(d.position.y))) { x = Number(d.position.x); y = Number(d.position.y); }
        return { x, y };
      });
    }

    // Extra entities are purely informational: display-only readouts the user
    // picks per device. They never feed _flowDirection/_flowEdges/_flows, which
    // read only d.power_entity, so they cannot affect flow logic or animation.
    _extraEntitiesRows(d) {
      const list = Array.isArray(d.extra_entities) ? d.extra_entities.slice(0, 5) : [];
      return list.filter(ex => ex && ex.entity).map(ex => {
        const st = state(this._hass, ex.entity);
        const icon = ex.icon || 'mdi:information-outline';
        const val = st ? friendlyState(st) : '—';
        const unit = st?.attributes?.unit_of_measurement || '';
        return `<div class="extra-row"><ha-icon icon="${esc(icon)}"></ha-icon><span>${esc(val)}${unit ? esc(' ' + unit) : ''}</span></div>`;
      }).join('');
    }

    // Charging/discharging state for a battery device, purely from its own
    // live value + invert_flow. This mirrors _flowDirection's battery
    // branch formula exactly (not just its intent), so the pulse can never
    // contradict the dot's own travel direction on the flow line, whichever
    // way that resolves for a given sensor and Invert Flow setting. Returns
    // null when idle/below threshold, or for any non-battery device.
    _batteryState(d, value) {
      if (d.battery_glow === false) return null; // user opted out in the editor
      return this._batteryDirection(d, value);
    }

    // Charging/discharging from the battery's own reading, using the same
    // formula as the flow animation (incl. Invert flow). Independent of the
    // glow setting, so time remaining works with the glow switched off.
    _batteryDirection(d, value) {
      if ((d.type || 'load') !== 'battery') return null;
      const threshold = Math.max(1, Number.isFinite(Number(this._config.flow_threshold_watts)) ? Number(this._config.flow_threshold_watts) : 1);
      if (value == null || !Number.isFinite(Number(value)) || Math.abs(Number(value)) < threshold) return null;
      let reverse = Number(value) < 0 ? false : true; // same expression as _flowDirection's battery branch
      if (d.invert_flow) reverse = !reverse;
      // reverse=true means the dot travels battery -> hub (discharging);
      // reverse=false means hub -> battery (charging).
      return reverse ? 'discharging' : 'charging';
    }

    // Estimated time until the battery reaches its charge limit (charging)
    // or its reserve (discharging). Power is smoothed with a ~2 minute
    // moving average so the estimate doesn't jump with every reading.
    _batteryTimeText(d, value) {
      if (d.type !== 'battery' || d.battery_time !== true) return '';
      const dir = this._batteryDirection(d, value);
      this._battAvg ||= new Map();
      const key = d.id || d.name;
      if (!dir) { this._battAvg.delete(key); return ''; }
      const now = Date.now(), w = Math.abs(Number(value));
      let avg = this._battAvg.get(key);
      if (!avg || avg.dir !== dir) avg = { dir, w, t: now };
      else { const a = 1 - Math.exp(-(now - avg.t) / 120000); avg = { dir, w: avg.w + (w - avg.w) * a, t: now }; }
      this._battAvg.set(key, avg);
      const soc = parseFloat(state(this._hass, d.battery_soc_entity)?.state);
      let cap = parseFloat(d.battery_capacity);
      if (d.battery_capacity_entity) { const cs = state(this._hass, d.battery_capacity_entity); let cv = parseFloat(cs?.state); if (Number.isFinite(cv)) { if (String(cs?.attributes?.unit_of_measurement || '').toLowerCase() === 'wh') cv /= 1000; cap = cv; } }
      if (!Number.isFinite(soc) || !Number.isFinite(cap) || cap <= 0 || avg.w < 1) return '';
      const reserve = Math.max(0, Math.min(99, Number.isFinite(parseFloat(d.battery_reserve)) ? parseFloat(d.battery_reserve) : 0));
      const limit = Math.max(1, Math.min(100, Number.isFinite(parseFloat(d.battery_charge_limit)) ? parseFloat(d.battery_charge_limit) : 100));
      const target = dir === 'charging' ? limit : reserve;
      const pct = dir === 'charging' ? target - soc : soc - target;
      if (pct <= 0) return dir === 'charging' ? this._t('at {p}%', { p: Math.round(limit) }) : this._t('at reserve');
      const hours = (pct / 100) * cap * 1000 / avg.w;
      const mins = Math.round(hours * 60);
      const t = mins >= 48 * 60 ? `${Math.floor(mins / 1440)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${Math.max(1, mins)}m`;
      const label = dir === 'charging' ? (target >= 100 ? this._t('to full') : this._t('to {p}%', { p: Math.round(target) })) : (target <= 0 ? this._t('to empty') : this._t('to {p}%', { p: Math.round(target) }));
      return `${t} ${label}`;
    }
    // Water: litres (m³ converted). Gas: m³ or kWh (user's choice),
    // converted with the UK billing formula kWh = m³ × 1.02264 × CV ÷ 3.6
    // (CV = calorific value, MJ/m³, default 39.5). Rates keep their time
    // unit (e.g. L/min); a gas rate in kWh per hour is shown as kW.
    _utilityText(d) {
      const st = state(this._hass, d.power_entity);
      const v = parseFloat(st?.state);
      if (!Number.isFinite(v)) return '—';
      const rawUnit = String(st?.attributes?.unit_of_measurement || '').trim();
      const m = rawUnit.match(/^([^/]*)(?:\/(.+))?$/) || [];
      let base = String(m[1] || '').trim().toLowerCase().replace('m3', 'm³');
      let per = m[2] ? '/' + m[2].trim() : '';
      if (['l', 'litre', 'litres', 'liter', 'liters'].includes(base)) base = 'l';
      const num = x => Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
      if (d.type === 'water') {
        if (base === 'm³') return `${num(v * 1000)} L${per}`;
        if (base === 'l' || base === '') return `${num(v)} L${per}`;
        return `${num(v)} ${rawUnit}`;
      }
      const cvRaw = parseFloat(d.gas_cv);
      const kwhPerM3 = 1.02264 * (Number.isFinite(cvRaw) && cvRaw > 0 ? cvRaw : 39.5) / 3.6;
      let kwh = null, m3 = null;
      if (base === 'm³') m3 = v;
      else if (base === 'kwh') kwh = v;
      else if (base === 'wh') kwh = v / 1000;
      else if (base === 'kw') { kwh = v; per = '/h'; }
      else if (base === 'w') { kwh = v / 1000; per = '/h'; }
      else return `${num(v)} ${rawUnit}`.trim();
      if (d.utility_unit === 'kWh') { const x = kwh ?? m3 * kwhPerM3; return per === '/h' ? `${num(x)} kW` : `${num(x)} kWh${per}`; }
      return `${num(m3 ?? kwh / kwhPerM3)} m³${per}`;
    }
    _isUtility(d) { return d?.type === 'water' || d?.type === 'gas'; }

    // ---- Device history graphs -------------------------------------------
    // Fetched in one request from Home Assistant's recorder for every device
    // with "Show history graph" on, then extended with live readings.
    // A full refresh happens every 15 minutes or when the set of graphed
    // entities / the time range changes.
    _histHours() { const h = Number(this._config?.history_hours); return [6, 12, 24, 48].includes(h) ? h : 24; }
    _histRefresh() {
      const ents = [...new Set((this._config?.devices || []).filter(d => this._histOn(d) && hasPower(d)).flatMap(d => deviceEntities(d)))].sort();
      if (!ents.length || !this._hass?.callWS) return;
      const key = ents.join(',') + '|' + this._histHours();
      if (this._histBusy && Date.now() - (this._histBusyAt || 0) > 60000) this._histBusy = false;
      if (this._histBusy || (this._histKey === key && Date.now() - (this._histAt || 0) < 15 * 60 * 1000)) return;
      this._histBusy = true; this._histBusyAt = Date.now();
      const end = new Date(), start = new Date(end.getTime() - this._histHours() * 3600 * 1000);
      this._hass.callWS({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: ents, minimal_response: true, no_attributes: true, significant_changes_only: false })
        .then(res => {
          const data = new Map();
          for (const ent of ents) {
            const pts = [];
            for (const it of (res?.[ent] || [])) {
              const v = parseFloat(it.s ?? it.state);
              const t = it.lu != null ? it.lu * 1000 : it.lc != null ? it.lc * 1000 : Date.parse(it.last_updated || it.last_changed || '');
              if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v });
            }
            data.set(ent, pts.sort((a, b) => a.t - b.t));
          }
          this._hist = data; this._histKey = key; this._histAt = Date.now();
          this._histRedraw();
        })
        .catch(() => { this._histAt = Date.now(); this._histKey = key; })
        .finally(() => { this._histBusy = false; });
    }
    _histAppend(d) {
      for (const ent of deviceEntities(d)) {
        const pts = this._hist?.get(ent); if (!pts) continue;
        const v = parseFloat(state(this._hass, ent)?.state); if (!Number.isFinite(v)) continue;
        const now = Date.now(), last = pts[pts.length - 1];
        if (!last || now - last.t >= 30000 || last.v !== v) pts.push({ t: now, v });
        const from = now - this._histHours() * 3600 * 1000;
        while (pts.length > 2 && pts[1].t < from) pts.shift();
      }
    }
    // A device's history: its own sensor, or for a separate-sensor pair the
    // two histories combined over time (positive minus negative side).
    _histSeries(d) {
      if (!isSplit(d)) return this._hist?.get(d.power_entity);
      const [pk, nk] = SPLIT_KEYS[d.type];
      const P = (d[pk] && this._hist?.get(d[pk])) || [], N = (d[nk] && this._hist?.get(d[nk])) || [];
      if (!P.length && !N.length) return null;
      const times = [...new Set([...P, ...N].map(p => p.t))].sort((a, b) => a - b);
      let i = 0, j = 0, pv = 0, nv = 0; const out = [];
      for (const t of times) {
        while (i < P.length && P[i].t <= t) pv = Math.abs(P[i++].v);
        while (j < N.length && N[j].t <= t) nv = Math.abs(N[j++].v);
        out.push({ t, v: pv - nv });
      }
      return out;
    }
    _histRedraw() {
      (this._config?.devices || []).forEach((d, i) => {
        if (!this._histOn(d)) return;
        const el = this.shadowRoot?.querySelector(`.node[data-device-index="${i}"] .hist`) || this.shadowRoot?.querySelector(`.tile[data-i="${i}"] [data-th]`);
        if (el) el.innerHTML = this._histSVG(d);
      });
    }
    // Area graph (96 time buckets, each the average of its readings; empty
    // buckets hold the previous value). Signed data gets a zero line.
    _histSVG(d) {
      if (!this._histOn(d) || !hasPower(d)) return '';
      const pts = this._histSeries(d);
      if (!pts || pts.length < 2) return '';
      const N = 96, end = Date.now(), span = this._histHours() * 3600 * 1000, start = end - span;
      const vals = new Array(N); let k = 0, hold = null;
      while (k < pts.length && pts[k].t < start) { hold = pts[k].v; k++; }
      for (let b = 0; b < N; b++) {
        const bEnd = start + (b + 1) * span / N; let sum = 0, n = 0;
        while (k < pts.length && pts[k].t < bEnd) { sum += pts[k].v; n++; hold = pts[k].v; k++; }
        vals[b] = n ? sum / n : hold;
      }
      const real = vals.filter(v => v != null); if (!real.length) return '';
      let lo = Math.min(0, ...real), hi = Math.max(0, ...real); if (hi - lo < 1e-9) hi = lo + 1;
      const y = v => (40 - (v - lo) / (hi - lo) * 38 - 1).toFixed(2), zy = y(0);
      const xs = b => (b / (N - 1) * 100).toFixed(2);
      let line = '', first = -1, lastB = -1;
      vals.forEach((v, b) => { if (v == null) return; line += `${first < 0 ? 'M' : 'L'} ${xs(b)} ${y(v)} `; if (first < 0) first = b; lastB = b; });
      const area = `${line}L ${xs(lastB)} ${zy} L ${xs(first)} ${zy} Z`;
      const color = d.flow_color || FLOW_COLORS[d.type] || FLOW_COLORS.neutral;
      const opRaw = Number(this._config?.history_opacity), op = Number.isFinite(opRaw) ? Math.max(0.05, Math.min(1, opRaw)) : 0.35;
      const zero = lo < 0 ? `<line x1="0" x2="100" y1="${zy}" y2="${zy}" stroke="${color}" stroke-opacity="${(op * 0.8).toFixed(2)}" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : '';
      return `<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${area}" fill="${color}" fill-opacity="${(op * 0.55).toFixed(2)}"/><path d="${line}" fill="none" stroke="${color}" stroke-opacity="${op.toFixed(2)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${zero}</svg>`;
    }

    // Custom-sized boxes: the contents keep their normal layout and are
    // scaled as one piece so everything (name, value, extras) fits the box.
    _fitBodies() {
      this.shadowRoot?.querySelectorAll('.node.sized').forEach(node => {
        const body = node.querySelector('.node-body'); if (!body) return;
        body.style.transform = '';
        const cs = getComputedStyle(node);
        const availW = node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const availH = node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const w = body.offsetWidth, h = body.offsetHeight;
        if (!w || !h || availW <= 0 || availH <= 0) return;
        body.style.transform = `scale(${Math.min(availW / w, availH / h).toFixed(3)})`;
      });
    }

    _batteryTimeHTML(d, value) {
      const t = this._batteryTimeText(d, value);
      return t ? `<ha-icon icon="mdi:timer-sand"></ha-icon><span>${esc(t)}</span>` : '';
    }

    // Plain inline CSS text for the charge/discharge glow - deliberately NOT
    // a stylesheet class or a ::after pseudo-element, so the effect is
    // directly visible in the node's own style="..." attribute (and its
    // data-batt-state attribute) when inspected, with nothing hidden behind
    // cascade order or pseudo-elements that don't show up when copying HTML.
    _batteryGlowStyle(battState) {
      if (!battState) return '';
      const glow = battState === 'charging' ? 'rgba(90,255,125,.95)' : 'rgba(255,150,40,.95)';
      const border = battState === 'charging' ? 'rgba(90,255,125,.85)' : 'rgba(255,150,40,.85)';
      return `border-color:${border};border-width:2px;box-shadow:0 8px 22px rgba(0,0,0,.32), 0 0 30px 8px ${glow};--pulse-color:${glow};animation:hpf-charge-pulse 1.8s ease-in-out infinite;`;
    }

    _deviceHTML(d, i, p) {
      const power = devicePower(this._hass, d);
      const powerText = this._isUtility(d) ? this._utilityText(d) : (power == null ? '—' : fmtPower(power, this._config?.power_unit));
      const battState = this._batteryState(d, power);
      return `<div data-act="dev:${i}" class="node ${esc(d.type || 'load')}${d.history_graph === true && hasPower(d) ? ' has-hist' : ''}${boxSizeFor(d, this._phoneMode) ? ' sized' : ''}" data-device-index="${i}" data-batt-state="${battState || ''}" data-entity-id="${esc(deviceEntities(d)[0] || '')}" title="${esc(deviceEntities(d)[0] ? 'Open ' + deviceEntities(d)[0] : '')}" style="left:${p.x}%;top:${p.y}%;${(() => { const bs = boxSizeFor(d, this._phoneMode); return bs ? `width:${bs.w}px;height:${bs.h}px;` : ''; })()}${this._batteryGlowStyle(battState)}"><div class="hist">${this._histSVG(d)}</div><div class="node-body"><div class="top"><span class="icon">${esc(ICONS[d.type] || '⚙️')}</span><span class="name">${esc(d.name || LABELS[d.type] || 'Device')}</span></div><div class="power">${esc(powerText)}</div><div class="batt-time">${this._batteryTimeHTML(d, power)}</div><div class="extras">${this._extraEntitiesRows(d)}</div></div></div>`;
    }

    // Generic junction model: a device with no power_entity configured acts
    // as a pass-through hub (direction/magnitude derived entirely from the
    // metered side) - this used to only apply to type 'inverter'; now it
    // applies to any bare device, so a second metered inverter, a Gateway,
    // or a Distribution Board can equally act as - or be driven by - a hub.
    // preferChild: when the edge builder knows which side is structurally
    // the child (via an explicit connects_to link or the automatic
    // hub/gateway fallback), that device's own reading is always
    // authoritative for whether ITS edge is active - even if the hub/parent
    // side also happens to have its own power_entity. Without this, two
    // metered endpoints (e.g. a metered second inverter feeding an EV
    // charger that also has its own sensor) fall back to "either side
    // active", which can show a flow into a device reading 0W just because
    // its parent is busy elsewhere.
    _flowDirection(a, b, va, vb, preferChild) {
      const threshold = Math.max(1, Number.isFinite(Number(this._config.flow_threshold_watts)) ? Number(this._config.flow_threshold_watts) : 1);

      const aHas = hasPower(a);
      const bHas = hasPower(b);
      let source = (aHas && !bHas) ? a : (bHas && !aHas) ? b : null;
      if (!source && aHas && bHas && (preferChild === a || preferChild === b)) source = preferChild;
      const value = source === a ? va : source === b ? vb : null;

      if (source) {
        // Water and gas aren't measured in watts: any usage above zero is
        // active, and they animate at the base speed (magnitude 1000 W).
        const utility = source.type === 'water' || source.type === 'gas';
        if (value == null || !Number.isFinite(Number(value)) || Math.abs(Number(value)) < (utility ? 1e-9 : threshold))
          return {active:false, reverse:false, magnitude:0};
        if (utility) return {active:true, reverse:false, magnitude:1000};

        let reverse = false;
        const t = source.type;
        // "a is the hub side" here means a is NOT the metered device - true
        // regardless of which literal position an automatic or explicit
        // (connects_to) edge happened to place it in.
        const aIsHub = a !== source;

        if (t === 'solar' || t === 'generator') {
          // Solar and generators only produce power: always toward the rest of the system.
          reverse = (b === source);
        } else if (t === 'battery') {
          // positive = charging (hub -> battery). Position-independent: the
          // automatic/explicit builder always places the hub first.
          reverse = Number(value) < 0 ? false : true;
        } else if (t === 'grid') {
          // positive = export (hub -> grid), negative = import (grid -> hub).
          // Sensors with the opposite convention are corrected by Invert flow.
          reverse = Number(value) < 0 ? true : false;
        } else {
          // Generic bidirectional convention for every other device type
          // (house, EV, load, gateway, or a second inverter reporting its
          // own load): positive = hub -> device (consuming/importing),
          // negative = device -> hub (exporting back). A magnitude-only
          // sensor (house/EV/load - always positive) simply always renders
          // hub -> device, exactly as before. Wrong polarity or orientation
          // for your sensor? Use that device's Invert Flow toggle.
          const physicalHubToDevice = Number(value) >= 0;
          reverse = physicalHubToDevice !== aIsHub;
        }

        if (source.invert_flow) reverse = !reverse;
        return {active:true, reverse, magnitude:Math.abs(Number(value))};
      }

      const aa = Math.abs(Number(va || 0)), ab = Math.abs(Number(vb || 0));
      if (Math.max(aa, ab) < threshold) return {active:false, reverse:false, magnitude:0};

      return {active:true, reverse:false, magnitude:Math.max(aa,ab)};
    }

    _flowEdges(devices) {
      const edges = [];
      // Devices are referenced by id, never by array position (see
      // migrateDeviceIdsAndLinks) - resolve to a current index here, so a
      // deleted/reordered device either resolves correctly or, if it no
      // longer exists, is simply treated as unset rather than silently
      // pointing at whatever now occupies its old slot.
      const idxOfId = id => (typeof id === 'string' ? devices.findIndex(x => x.id === id) : -1);

      if (Array.isArray(this._config.connections) && this._config.connections.length) {
        // "To" is treated as the child/consumer side for the same
        // both-metered tie-break used below.
        this._config.connections.forEach(e => {
          if (!e) return;
          const from = idxOfId(e.from), to = idxOfId(e.to);
          if (from === -1 || to === -1 || from === to) return;
          edges.push([from, to, Number(e.direction || 0), to]);
        });
        return edges;
      }

      const typeOf = d => d.type || 'load';
      const inverterIdx = devices.findIndex(d => typeOf(d) === 'inverter');
      const gatewayIdx = devices.findIndex(d => typeOf(d) === 'gateway');
      // A device's explicit "Connects to" link, if it points at another real device.
      const parentOf = (d, i) => {
        const p = idxOfId(d.connects_to);
        return p !== -1 && p !== i ? p : null;
      };

      // Every non-inverter device: use its explicit link if set, otherwise
      // fall back to the (first) inverter - unchanged single-inverter
      // behaviour for anyone who hasn't touched this setting.
      devices.forEach((d, i) => {
        if (typeOf(d) === 'inverter') return;
        // Water and gas are separate supplies: on Automatic they connect to
        // the first House device (no flow line if there isn't one).
        const utility = typeOf(d) === 'water' || typeOf(d) === 'gas';
        const houseIdx = devices.findIndex(x => typeOf(x) === 'house');
        const parent = parentOf(d, i) ?? (utility ? (houseIdx !== -1 ? houseIdx : null) : (inverterIdx !== -1 ? inverterIdx : null));
        if (parent === null) return;
        // Solar keeps its historical child-first edge order ([solar, hub]);
        // everything else is hub-first ([hub, device]). 4th element (i) is
        // the known child index, used to break both-metered ties.
        edges.push(['solar', 'generator', 'water', 'gas'].includes(typeOf(d)) ? [i, parent, 0, i] : [parent, i, 0, i]);
      });

      // Every inverter beyond the first: use its explicit link if set,
      // otherwise a Gateway/Distribution Board device if one exists,
      // otherwise the first inverter - so a multi-inverter setup is never
      // silently orphaned even with zero explicit configuration.
      devices.forEach((d, i) => {
        if (typeOf(d) !== 'inverter' || i === inverterIdx) return;
        const parent = parentOf(d, i) ?? (gatewayIdx !== -1 ? gatewayIdx : (inverterIdx !== -1 ? inverterIdx : null));
        if (parent === null) return;
        edges.push([parent, i, 0, i]);
      });

      return edges;
    }

    _flowStateKey(devices, snapshot) {
      if (!devices.length) return '';
      const seen = new Set();
      return this._flowEdges(devices).map(([a,b,dir,child]) => {
        const key=`${a}-${b}`;
        if (seen.has(key)) return '';
        seen.add(key);
        const childDevice = Number.isInteger(child) ? devices[child] : null;
        const info=this._flowDirection(devices[a], devices[b], snapshot?.[a], snapshot?.[b], childDevice);
        let reverse=info.reverse;
        if(Number(dir)===1) reverse=false;
        if(Number(dir)===2) reverse=true;
        // Coarse log2 bucket of magnitude (roughly: changes only when load
        // doubles/halves) - included so the load-based dot speed actually
        // updates over time, without rebuilding (and restarting the dot's
        // animation) on every minor fluctuation in a live sensor reading.
        const bucket = info.active ? Math.round(Math.log2(Math.max(1, info.magnitude))) : 0;
        return `${key}:${info.active?1:0}:${info.active?Number(reverse):0}:${bucket}`;
      }).join('|');
    }

    // Glow filters for .flow-path/.flow-dot (see CSS). These must be present
    // inside the SVG every time its content is set - Chrome/Firefox quietly
    // ignore a filter:url(#id) reference to a missing filter, but WebKit
    // (Safari, and therefore the iOS Home Assistant app) treats it as
    // "paint nothing", making flow lines invisible there specifically until
    // the filters actually exist. Shared here so the full render and the
    // incremental live-update path (which replaces the SVG's own innerHTML)
    // can never drift out of sync and lose them again.
    _svgFilterDefs() {
      return `<defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="dotglow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="neon" filterUnits="userSpaceOnUse" x="-200" y="-200" width="4000" height="4000"><feGaussianBlur in="SourceGraphic" stdDeviation="3.4" result="b1"/><feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="b2"/><feMerge><feMergeNode in="b1"/><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
    }
    // ---- Flow line routing ---------------------------------------------
    // 'curved' (default): smooth curve between box centres.
    // 'orthogonal': right-angle lines routed around every box on the card.
    // Boxes are measured from the rendered card (so real sizes/positions
    // are used), then each line is found with A* on a grid over the
    // 1000x667 flow canvas: cells covered by other boxes are expensive
    // (not forbidden, so a line always exists even between overlapping
    // boxes), and every bend costs extra, so lines stay clean.
    _edgePath(a, b, x1, y1, x2, y2) {
      // Manual style: straight segments through the user's bend points
      // (stored in % of the card, per layout); a line without points is a
      // straight line between the two boxes.
      if (this._config?.flow_style === 'manual') {
        const devs = this._config.devices || [];
        const key = `${devs[a]?.id}>${devs[b]?.id}`;
        const routes = (this._phoneMode ? this._config.phone_flow_routes : this._config.flow_routes) || {};
        const pts = Array.isArray(routes[key]) ? routes[key].map(validPos).filter(Boolean) : [];
        const vw = this._vbW() / 100, vh = this._vbH() / 100;
        return `M ${x1} ${y1} ` + pts.map(q => `L ${(q.x * vw).toFixed(1)} ${(q.y * vh).toFixed(1)} `).join('') + `L ${x2} ${y2}`;
      }
      if (this._config?.flow_style === 'orthogonal' && this._obstacles) {
        const p = this._routeOrthogonal(a, b, x1, y1, x2, y2);
        if (p) return p;
      }
      const dx = (x2 - x1) * .38;
      return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
    }
    _measureObstacles() {
      const canvas = this.shadowRoot?.querySelector('.canvas');
      const cr = canvas?.getBoundingClientRect();
      if (!cr || !cr.width || !cr.height) return null;
      const sx = this._vbW() / cr.width, sy = this._vbH() / cr.height, list = [];
      this.shadowRoot.querySelectorAll('.node, .weather, .stats:not(.autohide), .gridmix, .updated').forEach(el => {
        const r = el.getBoundingClientRect(); if (!r.width) return;
        list.push({ x1:(r.left-cr.left)*sx, y1:(r.top-cr.top)*sy, x2:(r.right-cr.left)*sx, y2:(r.bottom-cr.top)*sy,
          dev: el.dataset.deviceIndex !== undefined ? Number(el.dataset.deviceIndex) : null });
      });
      return list;
    }
    _routeOrthogonal(a, b, x1, y1, x2, y2) {
      const G = 8, W = Math.ceil(this._vbW() / G) + 1, H = Math.ceil(this._vbH() / G) + 1, N = W * H;
      const key = `${this._phoneMode ? 'p' : 'd'}|${a}|${b}|${Math.round(x1)}|${Math.round(y1)}|${Math.round(x2)}|${Math.round(y2)}`;
      this._routeCache ||= new Map();
      const lanes = this._lanes;
      // Marks a finished route's lanes: 2 = the lane itself, 1 = beside it.
      const markLanes = pts => {
        if (!lanes) return;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1].map(v => Math.round(v / G)), [bx, by] = pts[i].map(v => Math.round(v / G));
          const horiz = ay === by, arr = horiz ? lanes.h : lanes.v;
          const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          for (let k = 0; k <= n; k++) {
            const x = ax + Math.sign(bx - ax) * k, y = ay + Math.sign(by - ay) * k;
            const put = (px, py, v) => { if (px >= 0 && py >= 0 && px < W && py < H) { const c = py * W + px; if (arr[c] < v) arr[c] = v; } };
            put(x, y, 2);
            if (horiz) { put(x, y - 1, 1); put(x, y + 1, 1); } else { put(x - 1, y, 1); put(x + 1, y, 1); }
          }
        }
      };
      if (this._routeCache.has(key)) { const hit = this._routeCache.get(key); if (hit) markLanes(hit.pts); return hit ? hit.path : null; }
      const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
      const cost = new Float32Array(N), PAD = 6, BOX = 40, BEND = 12, LANE = 10, NEAR = 4;
      const own = new Uint8Array(N);
      for (const o of this._obstacles) {
        if (o.dev === a || o.dev === b) {
          const ox1 = cl(Math.floor(o.x1 / G), W), ox2 = cl(Math.ceil(o.x2 / G), W), oy1 = cl(Math.floor(o.y1 / G), H), oy2 = cl(Math.ceil(o.y2 / G), H);
          for (let y = oy1; y <= oy2; y++) for (let x = ox1; x <= ox2; x++) own[y * W + x] = 1;
          continue;
        }
        const cx1 = cl(Math.floor((o.x1 - PAD) / G), W), cx2 = cl(Math.ceil((o.x2 + PAD) / G), W);
        const cy1 = cl(Math.floor((o.y1 - PAD) / G), H), cy2 = cl(Math.ceil((o.y2 + PAD) / G), H);
        for (let y = cy1; y <= cy2; y++) for (let x = cx1; x <= cx2; x++) cost[y * W + x] = BOX;
      }
      const sx = cl(Math.round(x1 / G), W), sy = cl(Math.round(y1 / G), H);
      const ex = cl(Math.round(x2 / G), W), ey = cl(Math.round(y2 / G), H);
      if (sx === ex && sy === ey) return null;
      const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
      const g = new Float32Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
      // binary heap of [f, state]
      const hf = [], hs = [];
      const push = (f, st) => { let i = hf.length; hf.push(f); hs.push(st); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hs[p], hs[i]] = [hs[i], hs[p]]; i = p; } };
      const pop = () => { const st = hs[0], lf = hf.pop(), ls = hs.pop(); if (hf.length) { hf[0] = lf; hs[0] = ls; let i = 0; for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === i) break; [hf[m], hf[i]] = [hf[i], hf[m]]; [hs[m], hs[i]] = [hs[i], hs[m]]; i = m; } } return st; };
      const hcost = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);
      const start = sy * W + sx;
      for (let d = 0; d < 4; d++) { g[start * 4 + d] = 0; push(hcost(sx, sy), start * 4 + d); }
      let found = -1, iter = 0;
      while (hf.length && iter++ < 400000) {
        const st = pop(), cell = st >> 2, d = st & 3, x = cell % W, y = (cell - x) / W;
        if (cell === ey * W + ex) { found = st; break; }
        const gc = g[st];
        for (let nd = 0; nd < 4; nd++) {
          if (nd === ((d + 2) & 3)) continue;
          const nx = x + DX[nd], ny = y + DY[nd];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = ny * W + nx, ns = nc * 4 + nd;
          let lanePen = 0;
          if (lanes && !own[nc]) { const u = (nd === 0 || nd === 2) ? lanes.h[nc] : lanes.v[nc]; lanePen = u === 2 ? LANE : u === 1 ? NEAR : 0; }
          const ng = gc + 1 + cost[nc] + lanePen + (nd !== d ? BEND : 0);
          if (ng < g[ns]) { g[ns] = ng; prev[ns] = st; push(ng + hcost(nx, ny), ns); }
        }
      }
      if (found < 0) { this._routeCache.set(key, null); return null; }
      const cells = [];
      for (let st = found; st >= 0; st = prev[st]) cells.push(st >> 2);
      cells.reverse();
      const pts = cells.map(c => [(c % W) * G, Math.floor(c / W) * G]);
      const corners = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
        if ((px === cx) !== (cx === nx) || (py === cy) !== (cy === ny)) corners.push(pts[i]);
      }
      corners.push(pts[pts.length - 1]);
      const path = 'M ' + corners.map(p => `${p[0]} ${p[1]}`).join(' L ');
      this._routeCache.set(key, { path, pts: corners });
      markLanes(corners);
      return path;
    }
    // Re-measures boxes and redraws the flow lines (orthogonal style only).
    _scheduleReroute() {
      if (this._config?.flow_style !== 'orthogonal') return;
      clearTimeout(this._rerouteT);
      this._rerouteT = setTimeout(() => {
        const obs = this._measureObstacles(); if (!obs) return;
        this._obstacles = obs; this._routeCache = new Map();
        const svg = this.shadowRoot?.querySelector('svg.flows');
        const devices = this._config?.devices || [];
        if (svg) svg.innerHTML = this._svgFilterDefs() + this._flows(devices, this._layout(devices));
      }, 80);
    }

    // Current look: night look when it's night (same sun entity as the
    // backgrounds), otherwise the day look. With the system "reduce motion"
    // setting on, lines are always static.
    // Optional per-direction line colour. Battery: 'glow' (same green/amber
    // as the battery glow) or 'custom' charge/discharge colours. Grid:
    // 'custom' import/export colours. Uses the same direction logic as the
    // flow animation, so Invert flow and separate sensors are respected.
    _directionColor(d, value) {
      const mode = d?.flow_color_mode;
      if (!mode || mode === 'single' || value == null || !Number.isFinite(Number(value))) return null;
      const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);
      if (d.type === 'battery') {
        const dir = this._batteryDirection(d, value);
        if (!dir) return null;
        if (mode === 'glow') return dir === 'charging' ? '#5aff7d' : '#ff9628';
        if (mode === 'custom') return dir === 'charging' ? (hex(d.flow_color_charge) || '#5aff7d') : (hex(d.flow_color_discharge) || '#ff9628');
      }
      if (d.type === 'grid' && mode === 'custom') {
        let importing = Number(value) < 0; if (d.invert_flow) importing = !importing;
        return importing ? (hex(d.flow_color_import) || '#ff5c5c') : (hex(d.flow_color_export) || '#66bb6a');
      }
      return null;
    }
    _flowLookName() {
      const c = this._config || {};
      // The Schematic style defaults to Blueprint arrows unless a look was chosen.
      const day = FLOW_LOOKS[c.flow_look_day] ? c.flow_look_day : (this._viewStyle() === 'schematic' ? 'blueprint' : 'classic');
      const night = FLOW_LOOKS[c.flow_look_night] ? c.flow_look_night : day;
      let name = this._isNight() ? night : day;
      try { if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) name = 'static'; } catch (e) {}
      return name;
    }
    _flowMarkup({ id, path, stroke, duration, delay, reverse, mag }) {
      const L = FLOW_LOOKS[this._flowLookName()] || FLOW_LOOKS.classic;
      const durS = parseFloat(duration), delS = parseFloat(delay);
      const width = L.width === 'power' ? (1.6 + Math.min(4.4, mag / 900)).toFixed(2) : L.width;
      const lineFilt = L.glow === 'off' ? ' style="filter:none"' : L.glow === 'neon' ? ' style="filter:url(#neon)"' : '';
      const dotFilt = L.glow === 'off' ? ' style="filter:none"' : L.glow === 'neon' ? ' style="filter:url(#neon)"' : '';
      const dash = L.pattern ? ` stroke-dasharray="${L.pattern}"` : '';
      const kp = reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : '';
      const motion = (begin, rot = 'auto') => `<animateMotion dur="${duration}" begin="${begin.toFixed(3)}s" repeatCount="indefinite" rotate="${rot}" ${kp}><mpath href="#${id}"/></animateMotion>`;
      let out = `<path id="${id}" class="flow-path" d="${path}" stroke="${stroke}" stroke-width="${width}"${dash} opacity=".92"${lineFilt}>`;
      if (L.anim === 'march') {
        const period = L.pattern.split(' ').reduce((a, b) => a + Number(b), 0);
        out += `<animate attributeName="stroke-dashoffset" values="${reverse ? `0;${period}` : `${period};0`}" dur="${Math.max(0.3, durS / 6).toFixed(2)}s" repeatCount="indefinite"/>`;
      }
      out += '</path>';
      if (L.anim === 'dot') {
        const r = L.small ? [1.2, 2.2] : [1.8, 3.4];
        out += `<circle class="flow-dot" r="${r[0]}" fill="${stroke}"${dotFilt}>${motion(-delS)}<animate attributeName="r" values="${r[0]};${r[1]};${r[0]}" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".55;1;.55" dur="1.1s" repeatCount="indefinite"/></circle>`;
      } else if (L.anim === 'particles') {
        const n = Math.max(1, Math.min(6, Math.round(mag / 700) + 1));
        for (let k = 0; k < n; k++) out += `<circle class="flow-dot" r="2.2" fill="${stroke}"${dotFilt}>${motion(-(delS + durS * k / n))}</circle>`;
      } else if (L.anim === 'comet') {
        for (let k = 0; k < 5; k++) out += `<circle class="flow-dot" r="${(3.2 - k * 0.5).toFixed(2)}" fill="${stroke}" opacity="${(1 - k * 0.18).toFixed(2)}"${k ? ' style="filter:none"' : dotFilt}>${motion(-delS + k * durS * 0.012)}</circle>`;
      } else if (L.anim === 'arrows') {
        for (let k = 0; k < 3; k++) out += `<path d="M -4 -3 L 1.5 0 L -4 3" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${motion(-(delS + durS * k / 3), reverse ? 'auto-reverse' : 'auto')}</path>`;
      }
      return out;
    }

    _flows(devices, pos) {
      if (!devices.length) return '';
      // Lane memory for orthogonal routing: lines routed earlier in this
      // build make their lanes (and the lanes beside them) more expensive,
      // so later lines running the same way pick a parallel lane.
      const LW = Math.ceil(this._vbW() / 8) + 1, LH = Math.ceil(this._vbH() / 8) + 1;
      this._lanes = { h: new Uint8Array(LW * LH), v: new Uint8Array(LW * LH) };
      const edges = this._flowEdges(devices);
      const seen=new Set();
      const speed=Math.max(3,Math.min(30,num(this._config.flow_speed)||8));
      const stagger=Math.max(.15,Math.min(1.5,num(this._config.flow_stagger)||.55));
      return edges.map(([a,b,dir,child],idx)=>{
        const key=`${a}-${b}`; if(seen.has(key))return ''; seen.add(key);
        const A=pos[a],B=pos[b]; if(!A||!B)return ''; if(this._phoneHiddenDevice(devices[a])||this._phoneHiddenDevice(devices[b]))return ''; if(devices[a]?.flow_lines===false||devices[b]?.flow_lines===false)return '';
        const vw=this._vbW()/100, vh=this._vbH()/100, x1=A.x*vw,y1=A.y*vh,x2=B.x*vw,y2=B.y*vh;
        const path=this._edgePath(a,b,x1,y1,x2,y2);
        const da=devices[a],db=devices[b],va=this._flowSnapshot?.[a],vb=this._flowSnapshot?.[b];
        const childDevice = Number.isInteger(child) ? devices[child] : null;
        const info=this._flowDirection(da,db,va,vb,childDevice);
        // No valid entity value = no visible connection. Zero/below threshold
        // also remains completely hidden until meaningful power exists.
        if (!info.active) {
          // Optional: keep idle connections visible as faint lines (no dot).
          if (this._config?.show_idle_lines !== true) return '';
          return `<path class="flow-path" d="${path}" stroke="${flowColor(da,db,false,true,this._config.flow_colors)}" stroke-width="1.6" stroke-dasharray="2 6" opacity=".3"></path>`;
        }
        // info.reverse already includes each device's Invert Flow toggle
        // (applied once, inside _flowDirection). Only a manual connection's
        // forced direction (1 = From->To, 2 = To->From) overrides it here -
        // do NOT re-apply invert_flow a second time, or it cancels itself out.
        let reverse=info.reverse;
        if(Number(dir)===1)reverse=false; if(Number(dir)===2)reverse=true;
        const id=`flow${a}_${b}_${idx}`;
        // Faster dots for higher-power connections, slower for lighter ones -
        // the configured "Flow animation speed" is the baseline duration at
        // a 1000W reference load; sqrt-scaling keeps it responsive without
        // letting a multi-kW flow flicker unreadably fast, and the min/max
        // clamp keeps every connection within a sane, comparable range.
        const loadFactor = Math.sqrt(1000 / Math.max(50, info.magnitude));
        const duration = Math.max(speed * 0.4, Math.min(speed * 2.5, speed * loadFactor)).toFixed(2) + 's';
        const stroke=this._directionColor(childDevice, Number.isInteger(child) ? this._flowSnapshot?.[child] : null) || flowColor(da,db,reverse,true,this._config.flow_colors);
        const width=2.1;
        const delay=(idx*stagger).toFixed(2)+'s';
        return this._flowMarkup({ id, path, stroke, duration, delay, reverse, mag: info.magnitude });
      }).join('');
    }

    // Rows shown in the Today panel: optional computed self-sufficiency
    // rows first, then the user's statistics. Values are plain text so the
    // live update loop can refresh them in place.
    _statsRows() {
      const c = this._config || {};
      const rows = [];
      if (c.self_sufficiency_live === true) {
        const v = this._selfSufficiencyLive();
        rows.push({ icon: 'mdi:home-lightning-bolt-outline', name: this._t('Self-sufficiency now'), value: v == null ? '—' : `${v} %` });
      }
      if (c.self_sufficiency_today === true) {
        const v = this._selfSufficiencyToday();
        rows.push({ icon: 'mdi:home-clock-outline', name: this._t('Self-sufficiency today'), value: v == null ? '—' : `${v} %` });
      }
      if (c.self_consumption_live === true) {
        const v = this._selfConsumptionLive();
        rows.push({ icon: 'mdi:solar-power-variant', name: this._t('Self-consumption now'), value: v == null ? '—' : `${v} %` });
      }
      if (c.self_consumption_today === true) {
        const v = this._selfConsumptionToday();
        rows.push({ icon: 'mdi:sun-clock', name: this._t('Self-consumption today'), value: v == null ? '—' : `${v} %` });
      }
      const list = Array.isArray(c.statistics?.entities) ? c.statistics.entities.slice(0,20) : [];
      list.forEach((r, k) => rows.push({ icon: r.custom_icon || r.icon || 'mdi:chart-line', name: r.name || 'Statistic', value: this._energyEntity(r.entity), entity: r.entity || '', src: k }));
      return rows;
    }

    // Share of home consumption NOT imported from the grid, right now:
    // 1 - import / consumption, from the Grid and House devices. Import is
    // decided with the exact same formula as the grid flow animation
    // (negative = import, flipped by Invert flow), so the percentage always
    // agrees with the direction the dots travel.
    _selfSufficiencyLive() {
      const devices = this._config?.devices || [];
      const grids = devices.filter(d => d.type === 'grid' && hasPower(d));
      const houses = devices.filter(d => d.type === 'house' && hasPower(d));
      if (!grids.length || !houses.length) return null;
      let imp = 0, cons = 0, seen = false;
      for (const g of grids) { const v = devicePower(this._hass, g); if (v == null) continue; seen = true; let importing = v < 0; if (g.invert_flow) importing = !importing; if (importing) imp += Math.abs(v); }
      for (const h of houses) { const v = devicePower(this._hass, h); if (v == null) continue; cons += Math.abs(v); }
      if (!seen || cons < 1) return null;
      return Math.round(Math.max(0, Math.min(1, 1 - imp / cons)) * 100);
    }

    // A daily energy sensor's value in kWh (Wh and MWh are converted, so
    // sensors with different units still give correct ratios). Returns
    // null when the entity isn't set or has no numeric value.
    _energyKwh(entity) {
      if (!entity) return null;
      const st = state(this._hass, entity);
      const v = parseFloat(st?.state);
      if (!Number.isFinite(v)) return null;
      const unit = String(st?.attributes?.unit_of_measurement || 'kWh').toLowerCase();
      return unit === 'wh' ? v / 1000 : unit === 'mwh' ? v * 1000 : v;
    }

    // Today's home consumption: from the consumption sensor, or - when
    // "calculate" is on - from the energy balance
    // import + solar - export + battery discharge - battery charge.
    // Battery sensors are optional (treated as 0 when not set).
    _consumptionToday() {
      const c = this._config || {};
      if (c.self_sufficiency_calc_consumption !== true) return this._energyKwh(c.self_sufficiency_consumption_entity);
      const imp = this._energyKwh(c.self_sufficiency_import_entity);
      const solar = this._energyKwh(c.energy_solar_entity);
      const exp = this._energyKwh(c.energy_export_entity);
      if (imp == null || solar == null || exp == null) return null;
      const opt = key => { if (!c[key]) return 0; return this._energyKwh(c[key]); };
      const dis = opt('energy_battery_discharge_entity'), chg = opt('energy_battery_charge_entity');
      if (dis == null || chg == null) return null;
      return imp + solar - exp + dis - chg;
    }

    // Same formula over today's energy: 1 - grid import today / consumption today.
    _selfSufficiencyToday() {
      const imp = this._energyKwh(this._config?.self_sufficiency_import_entity);
      const cons = this._consumptionToday();
      if (imp == null || cons == null || cons <= 0) return null;
      return Math.round(Math.max(0, Math.min(1, 1 - imp / cons)) * 100);
    }

    // Share of solar production used at home instead of exported, right now:
    // (solar - export) / solar, from the Solar and Grid devices. Export uses
    // the same direction formula as the grid flow animation. Hidden at night.
    _selfConsumptionLive() {
      const devices = this._config?.devices || [];
      const solars = devices.filter(d => d.type === 'solar' && hasPower(d));
      if (!solars.length) return null;
      let solar = 0;
      for (const d of solars) { const v = devicePower(this._hass, d); if (v != null) solar += Math.abs(v); }
      if (solar < 10) return null;
      let exp = 0;
      for (const g of devices.filter(d => d.type === 'grid' && hasPower(d))) {
        const v = devicePower(this._hass, g); if (v == null) continue;
        let importing = v < 0; if (g.invert_flow) importing = !importing;
        if (!importing) exp += Math.abs(v);
      }
      return Math.round(Math.max(0, Math.min(1, (solar - exp) / solar)) * 100);
    }

    // Same over today's energy: (solar today - export today) / solar today.
    _selfConsumptionToday() {
      const solar = this._energyKwh(this._config?.energy_solar_entity);
      const exp = this._energyKwh(this._config?.energy_export_entity);
      if (solar == null || exp == null || solar <= 0) return null;
      return Math.round(Math.max(0, Math.min(1, (solar - exp) / solar)) * 100);
    }

    _statsHTML(s) {
      const rows = this._statsRows();
      if (!rows.length) return '';
      return `<div class="stats"><h3>${esc(s.title || this._t('Today'))}</h3>${rows.map((r,k)=>{
        const iconHtml = String(r.icon).startsWith('mdi:') ? `<ha-icon icon="${esc(r.icon)}"></ha-icon>` : esc(r.icon);
        return `<div class="stat" data-act="stat:${k}"><span class="ico">${iconHtml}</span><span>${esc(r.name)}</span><span class="value">${esc(r.value)}</span></div>`;
      }).join('')}</div>`;
    }

    // Keeps Today panel values current between full redraws (previously
    // they only updated on page load or config changes).
    _updateStatsValues() {
      const statsEl = this.shadowRoot?.querySelector('.stats');
      if (!statsEl) return;
      const rows = this._statsRows();
      const vals = statsEl.querySelectorAll('.stat .value');
      if (vals.length !== rows.length) return;
      rows.forEach((r, k) => { if (vals[k].textContent !== r.value) vals[k].textContent = r.value; });
    }

    _energyEntity(entity) {
      const s = state(this._hass, entity); if (!s) return '—'; const v = parseFloat(s.state); if (!Number.isFinite(v)) return s.state;
      const dr = Number(this._config?.stats_decimals), dec = Number.isFinite(dr) ? Math.max(0, Math.min(3, Math.round(dr))) : 2;
      return `${v.toFixed(dec)} ${s.attributes?.unit_of_measurement || 'kWh'}`;
    }
  }

  // ---- Full screen ----
  // Real full screen (Fullscreen API) where the device allows it; otherwise
  // the card fills the whole app window, above Home Assistant's header and
  // sidebar but below its dialogs. Corners, shadow and margins are removed.
  const FS_ICON_IN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const FS_ICON_OUT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const FS_CSS = `
    :host([fs]) { position:fixed !important; inset:0; z-index:7; background:#000; display:flex !important; align-items:center; justify-content:center; width:100vw; height:100vh; height:100dvh; }
    :host([fs]) .card { border-radius:0 !important; box-shadow:none !important; margin:0 auto; max-width:none !important; width:min(100vw, calc(100vh * var(--hpf-ratio,1.5))); width:min(100vw, calc(100dvh * var(--hpf-ratio,1.5))); }
    :host([fs]) .card.phone { width:min(100vw, calc(100vh * 0.6667)); width:min(100vw, calc(100dvh * 0.6667)); }
    :host([fs]) .card.alt { width:100vw; height:100vh; height:100dvh; overflow:auto; padding:22px 26px; }
    :host([fs]) .rings-svg, :host([fs]) .sch-svg { max-height:calc(100vh - 170px); }
    .fs-btn { position:absolute; right:10px; bottom:10px; z-index:40; width:36px; height:36px; border-radius:10px; border:1px solid var(--hpf-border,rgba(255,255,255,.18)); background:var(--hpf-panel-bg,rgba(8,29,52,.7)); color:var(--hpf-text,#fff); display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.35; transition:opacity .25s; backdrop-filter:blur(8px); padding:0; }
    .card:hover .fs-btn, .fs-btn:focus-visible { opacity:1; }
    :host([fs]) .fs-btn { opacity:0; } :host([fs]) .card.fs-ui .fs-btn { opacity:.95; }
    @media (hover:none) { .fs-btn { opacity:.55; } }
  `;
  const FsMethods = {
    _fsAllowed() { return this._config?.fullscreen_button !== false && typeof this._editorPhone !== 'boolean'; },
    _fsBtnHTML() { return this._fsAllowed() ? `<button type="button" class="fs-btn" title="${esc(this._fsOn ? this._t('Exit full screen') : this._t('Full screen'))}">${this._fsOn ? FS_ICON_OUT : FS_ICON_IN}</button>` : ''; },
    _fsBind() {
      const btn = this.shadowRoot?.querySelector('.fs-btn');
      btn?.addEventListener('click', e => { e.stopPropagation(); this._fsToggle(); });
      const card = this.shadowRoot?.querySelector('.card');
      if (card && this._fsOn) {
        const show = () => { card.classList.add('fs-ui'); clearTimeout(this._fsUiT); this._fsUiT = setTimeout(() => card.classList.remove('fs-ui'), 3000); };
        card.addEventListener('pointermove', show); card.addEventListener('pointerdown', show); show();
      }
    },
    _fsNative() { return document.fullscreenElement === this || document.webkitFullscreenElement === this; },
    async _fsToggle() {
      if (this._fsOn) { this._fsExit(); return; }
      this._fsOn = true; this._fsPseudo = true;
      const req = this.requestFullscreen || this.webkitRequestFullscreen;
      if (req) {
        try { await req.call(this, { navigationUI: 'hide' }); this._fsPseudo = false; } catch (e) { this._fsPseudo = true; }
      }
      this._fsApply();
    },
    _fsExit() {
      if (this._fsNative()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
      this._fsOn = false; this._fsPseudo = false;
      this._fsApply();
    },
    // Real full screen only shows the card itself, so Home Assistant's
    // details dialog would be hidden behind it: tapping a device drops back
    // to filling the app window, where the dialog can appear.
    _fsForDialog() {
      if (this._fsOn && this._fsNative()) { this._fsPseudo = true; try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
    },
    _fsApply() {
      this.toggleAttribute('fs', !!this._fsOn);
      this._wakeLock(!!this._fsOn && this._config?.fullscreen_wake !== false);
      this._render();
    },
    async _wakeLock(on) {
      try {
        if (on && !this._wake && navigator.wakeLock?.request) { this._wake = await navigator.wakeLock.request('screen'); this._wake.addEventListener?.('release', () => { this._wake = null; }); }
        else if (!on && this._wake) { await this._wake.release(); this._wake = null; }
      } catch (e) { this._wake = null; }
    },
    _fsListen(add) {
      if (add) {
        if (this._fsChange) return;
        this._fsChange = () => { if (this._fsOn && !this._fsPseudo && !this._fsNative()) { this._fsOn = false; this._fsApply(); } };
        this._fsKey = e => { if (e.key === 'Escape' && this._fsOn && this._fsPseudo) this._fsExit(); };
        this._fsVis = () => { if (document.visibilityState === 'visible' && this._fsOn) this._wakeLock(this._config?.fullscreen_wake !== false); };
        this._fsInfo = () => this._fsForDialog();
        document.addEventListener('fullscreenchange', this._fsChange); document.addEventListener('webkitfullscreenchange', this._fsChange);
        document.addEventListener('keydown', this._fsKey); document.addEventListener('visibilitychange', this._fsVis);
        this.addEventListener('hass-more-info', this._fsInfo); this.addEventListener('hass-action', this._fsInfo);
      } else if (this._fsChange) {
        document.removeEventListener('fullscreenchange', this._fsChange); document.removeEventListener('webkitfullscreenchange', this._fsChange);
        document.removeEventListener('keydown', this._fsKey); document.removeEventListener('visibilitychange', this._fsVis);
        this.removeEventListener('hass-more-info', this._fsInfo); this.removeEventListener('hass-action', this._fsInfo);
        this._fsChange = null;
      }
    },
  };

  // ---- Tap actions ----
  // tap_action / hold_action / double_tap_action in Home Assistant's own
  // format, handed to Home Assistant through its 'hass-action' event, so they
  // behave exactly like built-in cards (more-info, navigate, toggle, perform
  // an action, open a URL, confirmations). Unset = today's behaviour: a tap
  // opens the details of the element's entity; hold and double tap do nothing.
  const ACT_KINDS = ['tap', 'hold', 'double_tap'];
  const ACT_CSS = `
    [data-act] { -webkit-tap-highlight-color:transparent; touch-action:manipulation; -webkit-user-select:none; user-select:none; }
    [data-act].act-on { cursor:pointer; }
    [data-act].act-down { filter:brightness(1.18); }
    [data-act].act-holding { animation:hpf-hold .5s linear forwards; }
    @keyframes hpf-hold { to { filter:brightness(1.5) saturate(1.2); } }
  `;
  const ActMethods = {
    // What an element with data-act="<key>" refers to: its entity and where
    // its configured actions live.
    _actTarget(key) {
      const c = this._config || {}; const [kind, idx] = String(key || '').split(':');
      const panel = p => ({ tap_action: c[p + '_tap_action'], hold_action: c[p + '_hold_action'], double_tap_action: c[p + '_double_tap_action'] });
      if (kind === 'dev') { const d = (c.devices || [])[Number(idx)]; return d ? { entity: deviceEntities(d)[0] || '', src: d } : null; }
      if (kind === 'stat') { const row = this._statsRows()[Number(idx)]; if (!row) return null; return { entity: row.entity || '', src: row.src != null ? (c.statistics?.entities?.[row.src] || {}) : {} }; }
      if (kind === 'weather') return { entity: c.weather_entity || '', src: panel('weather') };
      if (kind === 'bins') return { entity: this._binsEntity ? this._binsEntity() : '', src: panel('bins') };
      if (kind === 'updated') return { entity: c.updated_entity || '', src: panel('updated') };
      if (kind === 'gridmix') return { entity: '', src: panel('gridmix') };
      return null;
    },
    _actFor(t, kind) {
      const a = t?.src?.[kind + '_action'];
      if (a && typeof a === 'object' && a.action) return a.action === 'none' ? null : a;
      return kind === 'tap' && t?.entity ? { action: 'more-info' } : null;
    },
    _actHas(key) { const t = this._actTarget(key); return !!t && ACT_KINDS.some(k => this._actFor(t, k)); },
    _actRun(key, kind) {
      const t = this._actTarget(key); const a = this._actFor(t, kind); if (!a) return;
      if (a.action === 'more-info' && !(a.entity || t.entity)) return;
      const config = { entity: a.entity || t.entity || undefined };
      config[kind + '_action'] = a;
      this.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { config, action: kind } }));
    },
    // One gesture handler: tap, hold (0.5 s, with a brightening effect) and
    // double tap (only waits for a second tap when one is configured).
    // Moving the finger more than 10 px (scrolling) cancels.
    _bindActions() {
      this.shadowRoot?.querySelectorAll('[data-act]').forEach(el => {
        el.classList.toggle('act-on', this._actHas(el.getAttribute('data-act')));
        if (el._hpfAct) return; el._hpfAct = true;
        let down = null, holdT = null, held = false, tapT = null;
        const key = () => el.getAttribute('data-act');
        const reset = () => { clearTimeout(holdT); holdT = null; el.classList.remove('act-down', 'act-holding'); };
        el.addEventListener('pointerdown', e => {
          if (e.button > 0) return;
          const t = this._actTarget(key()); if (!t) return;
          down = { x: e.clientX, y: e.clientY }; held = false; el.classList.add('act-down');
          if (this._actFor(t, 'hold')) { el.classList.add('act-holding'); holdT = setTimeout(() => { held = true; reset(); this._actRun(key(), 'hold'); }, 500); }
        });
        el.addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { down = null; reset(); } });
        el.addEventListener('pointercancel', () => { down = null; reset(); });
        el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { down = null; reset(); } });
        el.addEventListener('pointerup', e => {
          if (!down) { reset(); return; }
          down = null; const wasHeld = held; reset(); if (wasHeld) return;
          e.stopPropagation();
          const t = this._actTarget(key()); if (!t) return;
          if (this._actFor(t, 'double_tap')) {
            if (tapT) { clearTimeout(tapT); tapT = null; this._actRun(key(), 'double_tap'); }
            else tapT = setTimeout(() => { tapT = null; this._actRun(key(), 'tap'); }, 250);
          } else this._actRun(key(), 'tap');
        });
        el.addEventListener('contextmenu', e => { const t = this._actTarget(key()); if (t && this._actFor(t, 'hold')) e.preventDefault(); });
      });
    },
  };

  const ALT_SOLID = { dark: '#14263a', light: '#ffffff', midnight: '#121216', ocean: '#063e4b', forest: '#173b24', sunset: '#5c2438', graphite: '#383d43' };

  const AltViews = {
    _viewStyle() { const v = this._config?.view_style; return VIEW_STYLES[v] ? v : 'classic'; },
    _themeName() {
      let name = this._config?.theme || 'dark';
      if (name === 'auto') name = this._hass?.themes?.darkMode === false ? 'light' : 'dark';
      return name;
    },
    // True when the theme has dark text (a light background).
    _altLight() {
      const hex = String(this._themeColors().text || '#ffffff').replace('#', '');
      if (hex.length < 6) return false;
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    },
    _altThreshold() { const t = Number(this._config?.flow_threshold_watts); return Math.max(1, Number.isFinite(t) ? t : 1); },
    _altWidth() {
      let w = 0;
      try { w = this.getBoundingClientRect().width; } catch (e) {}
      return w || this.clientWidth || 800;
    },
    // Width bucket (decides portrait/landscape layouts) and text boost for
    // the drawn styles, so text stays readable on small cards.
    _altMeasure() {
      const w = this._altWidth();
      this._altW = w;
      this._altWB = w < 480 ? 0 : w < 600 ? 1 : w < 820 ? 2 : 3;
      this._altK = Math.max(1, Math.min(1.8, 900 / Math.max(300, w)));
      this._altKB = Math.round(this._altK * 4);
    },

    // ---- One shared live model for every style ----
    _altModel() {
      const c = this._config || {}, hass = this._hass, devices = c.devices || [];
      const colors = { ...FLOW_COLORS, ...(c.flow_colors || {}) }, thr = this._altThreshold(), unit = c.power_unit;
      const snap = {}; devices.forEach((d, i) => { snap[i] = devicePower(hass, d); });
      const devs = devices.map((d, i) => {
        const t = d.type || 'load', util = this._isUtility(d), has = hasPower(d);
        const raw = snap[i], n = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw), abs = n == null ? null : Math.abs(n);
        const active = n != null && (util ? abs > 1e-9 : abs >= thr);
        let role = active ? 'consuming' : 'idle';
        if (t === 'battery') role = this._batteryDirection(d, n) || 'idle';
        else if (t === 'grid') { if (active) { let imp = n < 0; if (d.invert_flow) imp = !imp; role = imp ? 'importing' : 'exporting'; } }
        else if (t === 'solar' || t === 'generator') role = active ? 'producing' : 'idle';
        else if (t === 'inverter' || t === 'gateway') role = active ? 'active' : 'idle';
        else if (util) role = active ? 'flowing' : 'idle';
        const socRaw = t === 'battery' && d.battery_soc_entity ? parseFloat(state(hass, d.battery_soc_entity)?.state) : NaN;
        return {
          d, i, t, id: d.id, name: d.name || String(LABELS[t] || 'Device').replace(/^\S+\s/, ''), icon: ICONS[t] || '⚙️',
          color: /^#[0-9a-f]{3,8}$/i.test(String(d.flow_color || '')) ? d.flow_color : (colors[t] || colors.neutral),
          v: n, abs, has, util, active, role, hub: (t === 'inverter' || t === 'gateway') && !has,
          text: util ? this._utilityText(d) : (abs == null ? '—' : fmtPower(abs, unit)),
          soc: Number.isFinite(socRaw) ? Math.max(0, Math.min(100, socRaw)) : null,
          battTime: t === 'battery' ? this._batteryTimeText(d, n) : '',
          entity: deviceEntities(d)[0] || '',
        };
      });
      const edges = [], seen = new Set();
      this._flowEdges(devices).forEach(([a, b, dir, child], idx) => {
        const key = `${a}-${b}`; if (seen.has(key)) return; seen.add(key);
        const da = devices[a], db = devices[b]; if (!da || !db) return;
        const childDev = Number.isInteger(child) ? devices[child] : null;
        const info = this._flowDirection(da, db, snap[a], snap[b], childDev);
        let reverse = info.reverse; if (Number(dir) === 1) reverse = false; if (Number(dir) === 2) reverse = true;
        const color = info.active ? (this._directionColor(childDev, Number.isInteger(child) ? snap[child] : null) || flowColor(da, db, reverse, true, c.flow_colors)) : colors.neutral;
        edges.push({ a, b, idx, key, active: info.active, reverse, mag: info.magnitude, color, hidden: da.flow_lines === false || db.flow_lines === false });
      });
      const sumBy = f => devs.reduce((s, x) => s + (f(x) ? (x.abs || 0) : 0), 0);
      const tot = {
        solar: sumBy(x => x.t === 'solar' && x.active), gen: sumBy(x => x.t === 'generator' && x.active),
        imp: sumBy(x => x.role === 'importing'), exp: sumBy(x => x.role === 'exporting'),
        dis: sumBy(x => x.role === 'discharging'), chg: sumBy(x => x.role === 'charging'),
        house: sumBy(x => x.t === 'house' && x.active),
      };
      const hasHouse = devs.some(x => x.t === 'house' && x.has);
      tot.use = hasHouse ? tot.house : Math.max(0, tot.solar + tot.gen + tot.imp + tot.dis - tot.exp - tot.chg);
      let ss = this._selfSufficiencyLive();
      if (ss == null && tot.use > thr) ss = Math.round(Math.max(0, Math.min(1, 1 - tot.imp / tot.use)) * 100);
      const socs = devs.filter(x => x.t === 'battery' && x.soc != null);
      const soc = socs.length ? Math.round(socs.reduce((s, x) => s + x.soc, 0) / socs.length) : null;
      const battTime = (devs.find(x => x.t === 'battery' && x.battTime) || {}).battTime || '';
      return { devs, edges, snap, tot, ss, soc, battTime, night: this._isNight(), thr, unit };
    },
    _altRole(x) {
      const words = { producing: 'Producing', consuming: 'Using', charging: 'Charging', discharging: 'Discharging', importing: 'Importing', exporting: 'Exporting', active: 'Active', flowing: 'In use' };
      return words[x.role] ? this._t(words[x.role]) : '';
    },
    _altFlow(e, path, prefix) {
      const c = this._config || {};
      const speed = Math.max(3, Math.min(30, num(c.flow_speed) || 8)), stagger = Math.max(.15, Math.min(1.5, num(c.flow_stagger) || .55));
      const lf = Math.sqrt(1000 / Math.max(50, e.mag));
      const duration = Math.max(speed * 0.4, Math.min(speed * 2.5, speed * lf)).toFixed(2) + 's';
      return this._flowMarkup({ id: `${prefix}${e.a}_${e.b}`, path, stroke: e.color, duration, delay: (e.idx * stagger).toFixed(2) + 's', reverse: e.reverse, mag: e.mag });
    },
    _altFlowKey(m) {
      return this._flowLookName() + '|' + m.edges.map(e => `${e.key}:${e.active ? 1 : 0}:${e.active ? +e.reverse : 0}:${e.active ? Math.round(Math.log2(Math.max(1, e.mag))) : 0}:${e.color}`).join('|');
    },
    _altIcon(icon) { return String(icon || '').startsWith('mdi:') ? `<ha-icon icon="${esc(icon)}"></ha-icon>` : esc(icon || ''); },
    _altClock() {
      return new Intl.DateTimeFormat(localeOf(this._hass), { hour: '2-digit', minute: '2-digit', hour12: this._config?.time_format === '12h' }).format(new Date());
    },
    _altDate() { return new Intl.DateTimeFormat(localeOf(this._hass), { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()); },
    _altWx() {
      const w = state(this._hass, this._config?.weather_entity);
      if (!w) return '';
      const t = w.attributes?.temperature, u = w.attributes?.temperature_unit || '°C';
      return `${this._weatherIcon(w.state)} ${t != null ? t + u : ''}`.trim();
    },
    _altMetaHTML() {
      const c = this._config || {}; let h = '';
      if (c.updated_enabled === true) h += `<span class="alt-chip updated${this._updatedInfo().stale ? ' stale' : ''}" data-act="updated">${this._updatedInner()}</span>`;
      if (this._binsOn()) h += `<span class="alt-chip bins-chip ${this._binsState()}" data-alt-bins data-act="bins">${this._binsInner(true)}</span>`;
      h += `<span class="alt-chip" data-alt-clock>${esc(this._altClock())}</span>`;
      if (state(this._hass, c.weather_entity)) h += `<span class="alt-chip" data-alt-wx data-act="weather">${esc(this._altWx())}</span>`;
      return h;
    },
    _altHeadHTML() {
      const c = this._config || {};
      const title = c.title === undefined || c.title === null ? this._t('Energy Flow') : String(c.title);
      const sub = c.subtitle ? String(c.subtitle) : '';
      const color = /^#[0-9a-f]{3,8}$/i.test(String(c.title_color || '')) && c.title_color.toLowerCase() !== '#ffffff' ? c.title_color : '';
      return `<div class="alt-head"${color ? ` style="--hpf-title-color:${color}"` : ''}><div class="alt-titles">${title.trim() ? `<div class="alt-title">${esc(title)}</div>` : ''}${sub.trim() ? `<div class="alt-sub">${esc(sub)}</div>` : ''}</div><div class="alt-meta">${this._altMetaHTML()}</div></div>`;
    },
    _altTodayHTML() {
      const rows = this._statsRows(); if (!rows.length) return '';
      const title = this._config?.statistics?.title || this._t('Today');
      return `<div class="alt-today"><span class="alt-today-h">${esc(title)}</span>${rows.map((r, k) => `<span class="alt-stat" data-act="stat:${k}"><span class="ico">${this._altIcon(r.icon)}</span><span class="nm">${esc(r.name)}</span><b data-alt-stat="${k}">${esc(r.value)}</b></span>`).join('')}</div>`;
    },
    _altStruct(style, m) {
      const c = this._config || {};
      let k = [style, this._altWB, this._altKB, this._altLight() ? 1 : 0, this._statsRows().length, state(this._hass, c.weather_entity) ? 1 : 0, c.updated_enabled === true ? 1 : 0, this._binsOn() ? 1 : 0,
        m.devs.map(x => `${x.id}:${x.t}:${x.has ? 1 : 0}:${x.soc != null ? 1 : 0}:${x.hub ? 1 : 0}:${x.name}:${x.color}`).join(','),
        m.edges.map(e => e.key + (e.hidden ? 'h' : '')).join(',')].join('|');
      if (style === 'rings' || style === 'tiles' || style === 'schematic') k += '|' + (m.ss != null ? 1 : 0);
      if (style === 'river') { const rd = this._riverData(m); m._rd = rd; k += '|' + rd.S.map(s => s.key).join() + '/' + rd.K.map(s => s.key).join() + '/' + rd.links.map(l => l.s.key + '>' + l.k.key).join(); }
      return k;
    },

    _renderAlt() {
      const style = this._viewStyle();
      this._altMeasure();
      const m = this._altModel();
      this._phoneMode = false; this._ratio = 1.5;
      const body = this[`_v_${style}`](m);
      const light = this._altLight();
      const extra = style === 'schematic' ? (light ? ';--paper:#f7f5ee;--ink:#1d3b6e;--gridc:rgba(29,59,110,.09);--gridc2:rgba(29,59,110,.18)' : ';--paper:#0d2747;--ink:#d6e6ff;--gridc:rgba(214,230,255,.06);--gridc2:rgba(214,230,255,.13)')
        : style === 'glance' ? `;--mood:${this._glance(m).color}` : '';
      this.shadowRoot.innerHTML = `<style>${ALT_CSS}${FS_CSS}${ACT_CSS}</style><div class="card alt v-${style}" style="--hpf-max-width:${this._maxWidthCss()}${extra}">${body}${this._fsBtnHTML()}</div>`;
      this._rendered = true;
      this._altStyle = style;
      this._altStructV = this._altStruct(style, m);
      this._altFlowKeyV = this._altFlowKey(m);
      this._applyTheme();
      this._histRefresh();
      this._updatedTimer();
      try { this._wxFxUpdate(); } catch (e) {}
      this._binsRefresh();
      this._fsBind();
      this._bindAltClicks();
      if (!this._timer) this._timer = setInterval(() => this._updateLiveValues(), 30000);
    },
    _updateAlt() {
      const style = this._viewStyle();
      if (style !== this._altStyle) { this._render(); return; }
      const m = this._altModel();
      if (this._altStruct(style, m) !== this._altStructV) { this._render(); return; }
      const fk = this._altFlowKey(m), flowsChanged = fk !== this._altFlowKeyV;
      this._altFlowKeyV = fk;
      this[`_u_${style}`](m, flowsChanged);
      const r = this.shadowRoot;
      const ck = r.querySelectorAll('[data-alt-clock]'); ck.forEach(el => { const t = this._altClock(); if (el.textContent !== t) el.textContent = t; });
      const dt = r.querySelector('[data-alt-date]'); if (dt) dt.textContent = this._altDate();
      const wx = r.querySelector('[data-alt-wx]'); if (wx) { const t = this._altWx(); if (wx.textContent !== t) wx.textContent = t; }
      const rows = this._statsRows();
      r.querySelectorAll('[data-alt-stat]').forEach(el => { const v = rows[Number(el.dataset.altStat)]?.value; if (v != null && el.textContent !== v) el.textContent = v; });
      this._bindAltClicks();
    },
    _altApplyScale() {
      const wb = this._altWB, kb = this._altKB;
      this._altMeasure();
      if (this._rendered && (wb !== this._altWB || kb !== this._altKB)) this._render();
    },
    _bindAltClicks() {
      this._bindActions();
      this.shadowRoot.querySelectorAll('[data-entity]:not([data-act])').forEach(el => {
        if (el._hpfClick) return; el._hpfClick = true;
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-entity');
          if (id) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
        });
      });
    },
    _setAttr(el, k, v) { if (el && el.getAttribute(k) !== String(v)) el.setAttribute(k, v); },
    _setText(el, v) { if (el && el.textContent !== String(v)) el.textContent = v; },

    // ======================= Compact rings =======================
    _ringsGeom(m) {
      const narrow = this._altWB === 0, n = m.devs.length;
      let root = m.devs.findIndex(x => x.t === 'inverter'); if (root < 0) root = m.devs.findIndex(x => x.t === 'gateway');
      const adj = m.devs.map(() => []);
      m.edges.forEach(e => { adj[e.a].push(e.b); adj[e.b].push(e.a); });
      const depth = new Array(n).fill(-1), parent = new Array(n).fill(-1);
      if (root >= 0) { depth[root] = 0; const q = [root]; while (q.length) { const u = q.shift(); for (const v of adj[u]) if (depth[v] < 0) { depth[v] = depth[u] + 1; parent[v] = u; q.push(v); } } }
      for (let i = 0; i < n; i++) if (depth[i] < 0) { depth[i] = 1; parent[i] = root; }
      // Water and gas hang off the house, but sit on the outer ring beside it
      // (a second ring just for them would squeeze everything inwards).
      for (let i = 0; i < n; i++) if (m.devs[i].util && depth[i] > 1) { depth[i] = 1; parent[i] = root; }
      const maxD = Math.max(1, ...depth);
      // More devices on the ring = a bigger, rounder canvas (circles keep
      // their size relative to the text, so nothing overlaps).
      const n1 = depth.filter(d => d === 1).length, extra = Math.max(0, n1 - 8);
      const W = (narrow ? 420 : 680) + extra * (narrow ? 34 : 46), H = (narrow ? (maxD > 1 ? 700 : 600) : (maxD > 1 ? 560 : 470)) + extra * (narrow ? 50 : 62), cx = W / 2, cy = H / 2;
      const R = 40, HUB = 50;
      const rx = cx - R - (narrow ? 16 : 64), ry = cy - R - 46;
      const ANG = { solar: -90, generator: -135, load: -45, grid: 180, house: 0, battery: 90, ev: 45, gateway: 135, inverter: 135, water: 30, gas: -30 };
      const ang = new Array(n).fill(0);
      const spread = (ids, minSep) => {
        if (ids.length < 2) return;
        for (let it = 0; it < 80; it++) {
          ids.sort((p, q) => ang[p] - ang[q]);
          let moved = false;
          for (let k = 0; k < ids.length; k++) {
            const p = ids[k], q = ids[(k + 1) % ids.length];
            let diff = ang[q] - ang[p]; if (k === ids.length - 1) diff += 360;
            if (diff < minSep - 0.01) { const push = (minSep - diff) / 2; ang[p] -= push; ang[q] += push; moved = true; }
          }
          if (!moved) break;
        }
      };
      const d1 = []; for (let i = 0; i < n; i++) if (depth[i] === 1) d1.push(i);
      const byType = {}; d1.forEach(i => (byType[m.devs[i].t] ||= []).push(i));
      Object.entries(byType).forEach(([t, ids]) => ids.forEach((i, k) => { ang[i] = (ANG[t] ?? 60) + (k - (ids.length - 1) / 2) * 34; }));
      spread(d1, Math.min(narrow ? 46 : 50, 360 / Math.max(1, d1.length)));
      for (let dd = 2; dd <= maxD; dd++) {
        const lvl = []; for (let i = 0; i < n; i++) if (depth[i] === dd) lvl.push(i);
        const kids = {}; lvl.forEach(i => (kids[parent[i]] ||= []).push(i));
        Object.entries(kids).forEach(([p, ids]) => ids.forEach((i, k) => { ang[i] = ang[p] + (k - (ids.length - 1) / 2) * 24; }));
        spread(lvl, Math.min(28, 360 / Math.max(1, lvl.length)));
      }
      const pos = new Array(n);
      for (let i = 0; i < n; i++) {
        if (i === root) { pos[i] = { x: cx, y: cy, r: HUB }; continue; }
        const f = maxD === 1 ? 1 : 0.56 + 0.44 * (depth[i] - 1) / (maxD - 1);
        const a = ang[i] * Math.PI / 180;
        let x = rx * f * Math.cos(a), y = ry * f * Math.sin(a);
        const dist = Math.hypot(x, y), minD = HUB + R + 18;
        if (dist < minD) { const s = minD / (dist || 1); x *= s; y *= s; }
        pos[i] = { x: cx + x, y: cy + y, r: R };
      }
      return { W, H, cx, cy, pos, root, narrow };
    },
    _ringsPath(g, e) {
      const P = g.pos[e.a], Q = g.pos[e.b];
      const dx = Q.x - P.x, dy = Q.y - P.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      return `M ${(P.x + ux * P.r).toFixed(1)} ${(P.y + uy * P.r).toFixed(1)} L ${(Q.x - ux * Q.r).toFixed(1)} ${(Q.y - uy * Q.r).toFixed(1)}`;
    },
    _ringsFlows(m, g) { return m.edges.filter(e => e.active && !e.hidden).map(e => this._altFlow(e, this._ringsPath(g, e), 'rf')).join(''); },
    _ringsSub(x) {
      if (x.t === 'battery') { const p = []; if (x.soc != null) p.push(Math.round(x.soc) + '%'); if (x.battTime) p.push(x.battTime); else { const r = this._altRole(x); if (r) p.push(r); } return p.join(' · '); }
      return this._altRole(x);
    },
    _ringsNode(g, x) {
      const p = g.pos[x.i], C = 2 * Math.PI * 40;
      const soc = x.soc != null ? `<circle class="rn-soc" r="40" stroke-dasharray="${(C * x.soc / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)"/>` : '';
      return `<g class="rn ${x.role}${x.active ? ' on' : ''}" data-i="${x.i}" data-act="dev:${x.i}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" style="--c:${x.color}"><circle class="rn-bg" r="40"/><circle class="rn-ring" r="40"/>${soc}<text class="rn-ic" y="-9">${x.icon}</text><text class="rn-val" y="17" data-rv>${esc(x.text)}</text><text class="rn-nm" y="58">${esc(x.name)}</text><text class="rn-sub" y="73" data-rs>${esc(this._ringsSub(x))}</text></g>`;
    },
    _ringsHubInner(m, x) {
      const R = 50, C = 2 * Math.PI * R, ss = m.ss;
      const arc = ss != null ? `<circle class="rh-ss" r="${R}" stroke-dasharray="${(C * ss / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)" data-rhs/>` : '';
      const main = ss != null ? `${ss}%` : (x && x.has ? x.text : fmtPower(m.tot.use, m.unit));
      const label = ss != null ? this._t('self-powered') : (x && x.has ? '' : this._t('in use'));
      return `<circle class="rn-bg" r="${R}"/><circle class="rh-track" r="${R}"/>${arc}<text class="rn-ic" y="-14">${x ? x.icon : '🏠'}</text><text class="rh-val" y="12" data-rhv>${esc(main)}</text><text class="rh-lb" y="27">${esc(label)}</text>`;
    },
    _v_rings(m) {
      const g = this._ringsGeom(m); this._ringsG = g;
      const lines = m.edges.filter(e => !e.hidden).map(e => `<path class="rl" d="${this._ringsPath(g, e)}"/>`).join('');
      const nodes = m.devs.map(x => {
        if (x.i !== g.root) return this._ringsNode(g, x);
        const p = g.pos[x.i];
        return `<g class="rn hub ${x.role}${x.active ? ' on' : ''}" data-i="${x.i}" data-act="dev:${x.i}" transform="translate(${p.x} ${p.y})" style="--c:${x.color}">${this._ringsHubInner(m, x)}<text class="rn-nm" y="68">${esc(x.name)}</text></g>`;
      }).join('');
      const center = g.root < 0 && m.devs.length ? `<g class="rn hub" data-center transform="translate(${g.cx} ${g.cy})">${this._ringsHubInner(m, null)}</g>` : '';
      const empty = m.devs.length ? '' : `<div class="alt-empty">${esc(this._t('Open the card editor and add Solar, Inverter, Battery, Grid or House.'))}</div>`;
      return `${this._altHeadHTML()}${empty}${m.devs.length ? `<svg class="rings-svg" viewBox="0 0 ${g.W} ${g.H}" preserveAspectRatio="xMidYMid meet">${this._svgFilterDefs()}<g>${lines}</g><g class="alt-flows">${this._ringsFlows(m, g)}</g>${center}${nodes}</svg>` : ''}${this._altTodayHTML()}`;
    },
    _u_rings(m, flowsChanged) {
      const r = this.shadowRoot, g = this._ringsG, C = 2 * Math.PI * 40, CH = 2 * Math.PI * 50;
      m.devs.forEach(x => {
        const el = r.querySelector(`.rn[data-i="${x.i}"]`); if (!el) return;
        this._setAttr(el, 'class', `rn${x.i === g.root ? ' hub' : ''} ${x.role}${x.active ? ' on' : ''}`);
        this._setText(el.querySelector('[data-rv]'), x.text);
        this._setText(el.querySelector('[data-rs]'), this._ringsSub(x));
        const soc = el.querySelector('.rn-soc'); if (soc && x.soc != null) this._setAttr(soc, 'stroke-dasharray', `${(C * x.soc / 100).toFixed(1)} ${C.toFixed(1)}`);
      });
      const hub = g.root >= 0 ? r.querySelector(`.rn[data-i="${g.root}"]`) : r.querySelector('[data-center]');
      if (hub) {
        const x = g.root >= 0 ? m.devs[g.root] : null;
        this._setText(hub.querySelector('[data-rhv]'), m.ss != null ? `${m.ss}%` : (x && x.has ? x.text : fmtPower(m.tot.use, m.unit)));
        const arc = hub.querySelector('[data-rhs]'); if (arc && m.ss != null) this._setAttr(arc, 'stroke-dasharray', `${(CH * m.ss / 100).toFixed(1)} ${CH.toFixed(1)}`);
      }
      if (flowsChanged) { const fg = r.querySelector('.alt-flows'); if (fg) fg.innerHTML = this._ringsFlows(m, g); }
    },

    // ======================= Tiles =======================
    _tilesSumLines(m) {
      const L = [];
      if (m.devs.some(x => x.t === 'solar' || x.t === 'generator')) L.push(['☀️', this._t('Solar'), fmtPower(m.tot.solar + m.tot.gen, m.unit)]);
      L.push(['🏠', this._t('Home'), fmtPower(m.tot.use, m.unit)]);
      if (m.devs.some(x => x.t === 'grid')) L.push(['⚡', m.tot.imp > 0 ? this._t('From grid') : m.tot.exp > 0 ? this._t('To grid') : this._t('Grid'), fmtPower(m.tot.imp > 0 ? m.tot.imp : m.tot.exp, m.unit)]);
      if (m.soc != null) L.push(['🔋', this._t('Battery'), `${m.soc}%`]);
      return L;
    },
    _tileSub(x) {
      if (x.t === 'battery') { const p = []; if (x.soc != null) p.push(Math.round(x.soc) + '%'); const r = this._altRole(x); if (r) p.push(r); if (x.battTime) p.push(x.battTime); return p.join(' · ') || this._t('Idle'); }
      return this._altRole(x) || this._t('Idle');
    },
    _histOn(d) { return d?.history_graph === true || (this._viewStyle && this._viewStyle() === 'tiles' && d?.history_graph !== false); },
    _v_tiles(m) {
      const C = 2 * Math.PI * 26, ss = m.ss;
      const showSum = m.devs.some(x => ['solar', 'house', 'grid', 'battery'].includes(x.t));
      const ring = ss != null ? `<svg viewBox="0 0 64 64" class="t-ring"><circle cx="32" cy="32" r="26" class="tr-track"/><circle cx="32" cy="32" r="26" class="tr-val" data-trv stroke-dasharray="${(C * ss / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="37" data-trt>${ss}%</text></svg>` : '';
      const sum = showSum ? `<div class="tile sum">${ring}<div class="ts-l"><div class="ts-h">${esc(ss != null ? this._t('Self-powered') : this._t('Now'))}</div>${this._tilesSumLines(m).map((l, k) => `<div class="ts-r"><span>${l[0]} <span data-tsl="${k}">${esc(l[1])}</span></span><b data-tsr="${k}">${esc(l[2])}</b></div>`).join('')}</div></div>` : '';
      const tiles = m.devs.filter(x => !x.hub).map(x => {
        const bar = x.t === 'battery' && x.soc != null ? `<div class="t-bar"><i data-tb style="width:${x.soc}%"></i></div>` : '';
        return `<div class="tile ${x.role}${x.active ? ' on' : ''}" data-i="${x.i}" data-act="dev:${x.i}" style="--c:${x.color}"><div class="hist" data-th>${this._histSVG(x.d)}</div><div class="t-top"><span class="t-ic">${x.icon}</span><span class="t-nm">${esc(x.name)}</span></div><div class="t-val${[...x.text].length > 8 ? ' long' : ''}" data-tv>${esc(x.text)}</div><div class="t-sub" data-ts>${esc(this._tileSub(x))}</div>${bar}<div class="t-ex" data-tx>${this._extraEntitiesRows(x.d)}</div></div>`;
      }).join('');
      const rows = this._statsRows();
      const today = rows.length ? `<div class="tl-sec">${esc(this._config?.statistics?.title || this._t('Today'))}</div><div class="tiles small">${rows.map((r, k) => `<div class="tile stat" data-act="stat:${k}"><div class="t-top"><span class="t-ic">${this._altIcon(r.icon)}</span><span class="t-nm">${esc(r.name)}</span></div><div class="t-val" data-alt-stat="${k}">${esc(r.value)}</div></div>`).join('')}</div>` : '';
      const empty = m.devs.length ? '' : `<div class="alt-empty">${esc(this._t('Open the card editor and add Solar, Inverter, Battery, Grid or House.'))}</div>`;
      return `${this._altHeadHTML()}${empty}<div class="tiles">${sum}${tiles}</div>${today}`;
    },
    _u_tiles(m) {
      const r = this.shadowRoot, C = 2 * Math.PI * 26;
      m.devs.forEach(x => {
        const el = r.querySelector(`.tile[data-i="${x.i}"]`); if (!el) return;
        const cls = `tile ${x.role}${x.active ? ' on' : ''}`; if (el.className !== cls) el.className = cls;
        const tv = el.querySelector('[data-tv]'); if (tv) { this._setText(tv, x.text); tv.classList.toggle('long', [...x.text].length > 8); }
        this._setText(el.querySelector('[data-ts]'), this._tileSub(x));
        const tb = el.querySelector('[data-tb]'); if (tb && x.soc != null) tb.style.width = x.soc + '%';
        const tx = el.querySelector('[data-tx]'); if (tx) { const h = this._extraEntitiesRows(x.d); if (tx.innerHTML !== h) tx.innerHTML = h; }
        const th = el.querySelector('[data-th]'); if (th) { this._histAppend(x.d); const h = this._histSVG(x.d); if (th.innerHTML !== h) th.innerHTML = h; }
      });
      this._tilesSumLines(m).forEach((l, k) => { this._setText(r.querySelector(`[data-tsl="${k}"]`), l[1]); this._setText(r.querySelector(`[data-tsr="${k}"]`), l[2]); });
      if (m.ss != null) { this._setAttr(r.querySelector('[data-trv]'), 'stroke-dasharray', `${(C * m.ss / 100).toFixed(1)} ${C.toFixed(1)}`); this._setText(r.querySelector('[data-trt]'), `${m.ss}%`); }
    },

    // ======================= At a glance =======================
    _glance(m) {
      const T = m.tot, P = v => fmtPower(v, m.unit), S = T.solar + T.gen, on = v => v >= m.thr;
      const soc = m.soc != null ? `${m.soc}%` : '';
      const battBits = [soc, m.battTime].filter(Boolean).join(' · ');
      const j = (...a) => a.filter(Boolean).join(' · ');
      const sunIcon = T.solar > 0 ? '☀️' : '⛽';
      if (on(S) && !on(T.imp)) {
        if (on(T.exp)) return { color: '#3ddc84', icon: sunIcon, line: this._t('Solar covers everything'), sub: j(this._t('Sending {p} to the grid', { p: P(T.exp) }), on(T.chg) ? this._t('charging battery {s}', { s: soc }).trim() : '') };
        if (on(T.chg)) return { color: '#7dd96f', icon: sunIcon, line: this._t('Running on sunshine'), sub: j(this._t('charging battery {s}', { s: soc }).trim(), this._t('{p} from solar', { p: P(S) })) };
        if (on(T.dis)) return { color: '#4fc3f7', icon: '🌤️', line: this._t('Sun and battery'), sub: j(this._t('{p} from solar', { p: P(S) }), this._t('Battery {b}', { b: battBits || P(T.dis) })) };
        return { color: '#7dd96f', icon: sunIcon, line: this._t('Running on sunshine'), sub: this._t('{p} from solar', { p: P(S) }) };
      }
      if (on(S) && on(T.imp)) return { color: '#f5b942', icon: '⛅', line: this._t('Solar and grid'), sub: j(this._t('{p} from solar', { p: P(S) }), this._t('{p} from the grid', { p: P(T.imp) }), on(T.dis) ? this._t('Battery {b}', { b: battBits || P(T.dis) }) : '') };
      if (on(T.dis) && !on(T.imp)) return { color: '#40c4ff', icon: m.night ? '🌙' : '🔋', line: this._t('Running on battery'), sub: j(battBits, on(T.exp) ? this._t('Sending {p} to the grid', { p: P(T.exp) }) : '') || P(T.dis) };
      if (on(T.imp)) return { color: '#ff8a65', icon: m.night ? '🌙' : '⚡', line: this._t('Running on the grid'), sub: j(this._t('{p} from the grid', { p: P(T.imp) }), on(T.chg) ? this._t('charging battery {s}', { s: soc }).trim() : '', on(T.dis) ? this._t('Battery {b}', { b: battBits }) : '') };
      return { color: '#90a4ae', icon: m.night ? '🌙' : '😌', line: this._t('All quiet'), sub: m.soc != null ? this._t('Battery {b}', { b: `${m.soc}%` }) : this._t('Nothing is flowing right now') };
    },
    _glanceChipRole(x) {
      if (x.t === 'battery') return [x.soc != null ? Math.round(x.soc) + '%' : '', this._altRole(x)].filter(Boolean).join(' · ');
      return this._altRole(x);
    },
    _v_glance(m) {
      const s = this._glance(m);
      const chips = m.devs.filter(x => !x.hub && !x.util).map(x => `<span class="gl-chip ${x.role}${x.active ? ' on' : ''}" data-i="${x.i}" data-act="dev:${x.i}" title="${esc(x.name)}" style="--c:${x.color}"><span>${x.icon}</span><b data-gcv>${esc(x.text)}</b><span class="gc-r" data-gcr>${esc(this._glanceChipRole(x))}</span></span>`).join('')
        + (m.ss != null ? `<span class="gl-chip"><span>🏡</span><b data-gss>${m.ss}%</b><span class="gc-r">${esc(this._t('self-powered'))}</span></span>` : '');
      const big = m.devs.length ? `<div class="gl-big"><b data-glb>${esc(fmtPower(m.tot.use, m.unit))}</b><span>${esc(this._t('in use'))}</span></div>` : '';
      return `${this._altHeadHTML()}<div class="gl-main"><div class="gl-ic" data-gli>${s.icon}</div><div class="gl-txt"><div class="gl-line" data-gll>${esc(s.line)}</div><div class="gl-sub" data-gls>${esc(s.sub)}</div></div>${big}</div><div class="gl-chips">${chips}</div>${this._altTodayHTML()}`;
    },
    _u_glance(m) {
      const r = this.shadowRoot, s = this._glance(m);
      const card = r.querySelector('.card'); if (card && card.style.getPropertyValue('--mood') !== s.color) card.style.setProperty('--mood', s.color);
      this._setText(r.querySelector('[data-gli]'), s.icon); this._setText(r.querySelector('[data-gll]'), s.line); this._setText(r.querySelector('[data-gls]'), s.sub);
      this._setText(r.querySelector('[data-glb]'), fmtPower(m.tot.use, m.unit));
      if (m.ss != null) this._setText(r.querySelector('[data-gss]'), `${m.ss}%`);
      m.devs.forEach(x => {
        const el = r.querySelector(`.gl-chip[data-i="${x.i}"]`); if (!el) return;
        const cls = `gl-chip ${x.role}${x.active ? ' on' : ''}`; if (el.className !== cls) el.className = cls;
        this._setText(el.querySelector('[data-gcv]'), x.text); this._setText(el.querySelector('[data-gcr]'), this._glanceChipRole(x));
      });
    },

    // ======================= Energy river (Sankey) =======================
    // Sources (solar, generator, battery discharging, grid import) on the
    // left; uses (house, EV, loads, battery charging, grid export) on the
    // right. Power is shared out in the natural order: solar feeds the home
    // first, then the battery, then export; the grid feeds the home, then the
    // battery. Anything the sensors don't account for shows as "Unmeasured"
    // or "Other use" so the bands always add up.
    _riverData(m) {
      const S = [], K = [];
      m.devs.forEach(x => {
        if (x.util || x.hub || x.abs == null) return;
        const node = (key, kind) => ({ key, kind, x, v: x.abs, name: x.name, icon: x.icon, color: x.color });
        if (x.t === 'solar' && x.active) S.push(node('s' + x.id, 'solar'));
        else if (x.t === 'generator' && x.active) S.push(node('s' + x.id, 'gen'));
        else if (x.role === 'discharging') S.push(node('s' + x.id, 'batt'));
        else if (x.role === 'importing') S.push(node('s' + x.id, 'grid'));
        else if (['house', 'ev', 'load'].includes(x.t) && x.active) K.push(node('k' + x.id, 'use'));
        else if (x.role === 'charging') K.push(node('k' + x.id, 'batt'));
        else if (x.role === 'exporting') K.push(node('k' + x.id, 'grid'));
      });
      const so = { solar: 0, gen: 1, batt: 2, grid: 3 }, ko = { use: 0, batt: 1, grid: 2 };
      S.sort((a, b) => so[a.kind] - so[b.kind]); K.sort((a, b) => ko[a.kind] - ko[b.kind]);
      const pref = { solar: ['use', 'batt', 'grid'], gen: ['use', 'batt', 'grid'], batt: ['use', 'grid'], grid: ['use', 'batt'] };
      const rem = new Map(K.map(k => [k.key, k.v])), links = [];
      S.forEach(s => {
        let left = s.v;
        pref[s.kind].forEach(kind => K.forEach(k => {
          if (k.kind !== kind || left <= 0) return;
          const r = rem.get(k.key); if (r <= 0) return;
          const a = Math.min(left, r); links.push({ s, k, v: a }); left -= a; rem.set(k.key, r - a);
        }));
        s.left = left;
      });
      const total = Math.max(S.reduce((a, s) => a + s.v, 0), K.reduce((a, k) => a + k.v, 0));
      const tol = Math.max(m.thr * 3, 60, total * 0.04);
      const missing = K.filter(k => rem.get(k.key) > tol);
      if (missing.length) {
        const o = { key: 's-other', kind: 'other', x: null, v: missing.reduce((a, k) => a + rem.get(k.key), 0), name: this._t('Unmeasured'), icon: '❔', color: FLOW_COLORS.neutral };
        S.push(o); missing.forEach(k => links.push({ s: o, k, v: rem.get(k.key) }));
      }
      const spare = S.filter(s => s.kind !== 'other' && s.left > tol);
      if (spare.length) {
        const o = { key: 'k-other', kind: 'other', x: null, v: spare.reduce((a, s) => a + s.left, 0), name: this._t('Other use'), icon: '❔', color: FLOW_COLORS.neutral };
        K.push(o); spare.forEach(s => links.push({ s, k: o, v: s.left }));
      }
      return { S, K, links: links.filter(l => l.v > 0.5) };
    },
    _riverGeom(rd) {
      const narrow = this._altWB <= 1;
      const W = narrow ? 600 : 1000, labW = narrow ? 205 : 290, bw = 14;
      const xL = labW, xR = W - labW - bw;
      const fs = narrow ? { n: 18, v: 22 } : { n: 14, v: 18 };
      const sumS = rd.S.reduce((a, s) => a + s.v, 0), sumK = rd.K.reduce((a, k) => a + k.v, 0);
      const total = Math.max(sumS, sumK, 1);
      const n = Math.max(rd.S.length, rd.K.length, 1);
      const barsH = Math.max(200, Math.min(440, 74 * n));
      const sc = barsH / total, gap = 14, minSlot = narrow ? 60 : 48, top = 34, pad = 12;
      const col = list => { let y = 0; return list.map(s => { const h = Math.max(4, s.v * sc), slot = Math.max(h, minSlot); const o = { top: y, slot, y: y + (slot - h) / 2, h }; y += slot + gap; return o; }); };
      const cs = col(rd.S), ck = col(rd.K);
      const hOf = a => a.length ? a[a.length - 1].top + a[a.length - 1].slot : 0;
      const hS = hOf(cs), hK = hOf(ck), hMax = Math.max(hS, hK, 80);
      const H = top + hMax + pad;
      cs.forEach(o => { const off = top + (hMax - hS) / 2; o.top += off; o.y += off; });
      ck.forEach(o => { const off = top + (hMax - hK) / 2; o.top += off; o.y += off; });
      const usedS = new Map(), usedK = new Map();
      const L = rd.links.map(l => {
        const si = rd.S.indexOf(l.s), ki = rd.K.indexOf(l.k), t = Math.max(1.5, l.v * sc);
        const ys = cs[si].y + (usedS.get(si) || 0), yk = ck[ki].y + (usedK.get(ki) || 0);
        usedS.set(si, (usedS.get(si) || 0) + t); usedK.set(ki, (usedK.get(ki) || 0) + t);
        return { l, si, ki, t, ys, yk };
      });
      return { W, H, xL, xR, bw, cs, ck, L, fs, narrow };
    },
    _riverBand(G, o) {
      const x1 = G.xL + G.bw, x2 = G.xR, mx = (x1 + x2) / 2, f = v => v.toFixed(1);
      return `M ${x1} ${f(o.ys)} C ${f(mx)} ${f(o.ys)} ${f(mx)} ${f(o.yk)} ${x2} ${f(o.yk)} L ${x2} ${f(o.yk + o.t)} C ${f(mx)} ${f(o.yk + o.t)} ${f(mx)} ${f(o.ys + o.t)} ${x1} ${f(o.ys + o.t)} Z`;
    },
    _riverLine(G, o) {
      const x1 = G.xL + G.bw, x2 = G.xR, mx = (x1 + x2) / 2, a = o.ys + o.t / 2, b = o.yk + o.t / 2, f = v => v.toFixed(1);
      return `M ${x1} ${f(a)} C ${f(mx)} ${f(a)} ${f(mx)} ${f(b)} ${x2} ${f(b)}`;
    },
    _riverFlowStyle(o) {
      const dur = Math.max(0.5, Math.min(6, 2.4 * Math.sqrt(1000 / Math.max(50, o.l.v))));
      return `stroke-width:${Math.max(1.4, Math.min(5, o.t * 0.32)).toFixed(1)};animation-duration:${dur.toFixed(2)}s`;
    },
    _riverSumHTML(m) {
      const p = [this._t('Using {p}', { p: fmtPower(m.tot.use, m.unit) })];
      if (m.ss != null) p.push(this._t('{n}% self-powered', { n: m.ss }));
      return p.map(t => `<span>${esc(t)}</span>`).join('<span>·</span>');
    },
    _v_river(m) {
      const rd = m._rd || this._riverData(m), G = this._riverGeom(rd);
      if (!rd.links.length) return `${this._altHeadHTML()}<div class="rv-sum" data-rsum>${this._riverSumHTML(m)}</div><div class="alt-empty">🌙 ${esc(this._t('Nothing is flowing right now'))}</div>${this._altTodayHTML()}`;
      const grads = G.L.map((o, li) => `<linearGradient id="rvg${li}" gradientUnits="userSpaceOnUse" x1="${G.xL + G.bw}" y1="0" x2="${G.xR}" y2="0"><stop offset="0" stop-color="${o.l.s.color}"/><stop offset="1" stop-color="${o.l.k.color}"/></linearGradient>`).join('');
      const bands = G.L.map((o, li) => `<path class="rv-band" data-rl="${li}" fill="url(#rvg${li})" d="${this._riverBand(G, o)}"/>`).join('');
      const flows = G.L.map((o, li) => `<path class="rv-flow" data-rf="${li}" d="${this._riverLine(G, o)}" style="${this._riverFlowStyle(o)}"/>`).join('');
      const node = (s, o, side, k) => {
        const x = side === 's' ? G.xL : G.xR, tx = side === 's' ? G.xL - 12 : G.xR + G.bw + 12, anchor = side === 's' ? 'end' : 'start';
        const cy = o.top + o.slot / 2;
        const ent = s.x ? ` data-act="dev:${s.x.i}"` : '';
        return `<rect data-rn="${side}${k}" x="${x}" y="${o.y.toFixed(1)}" width="${G.bw}" height="${o.h.toFixed(1)}" rx="3" fill="${s.color}"/>`
          + `<g data-rt="${side}${k}"${ent} transform="translate(${tx} ${cy.toFixed(1)})"><text class="rv-nm" text-anchor="${anchor}" y="-4" font-size="${G.fs.n}">${esc(s.icon + ' ' + s.name)}</text><text class="rv-v" text-anchor="${anchor}" y="${G.fs.v - 2}" font-size="${G.fs.v}" data-rvv>${esc(fmtPower(s.v, m.unit))}</text></g>`;
      };
      const nodes = rd.S.map((s, k) => node(s, G.cs[k], 's', k)).join('') + rd.K.map((s, k) => node(s, G.ck[k], 'k', k)).join('');
      const heads = `<text class="rv-col" x="${G.xL + G.bw}" y="16" text-anchor="end">${esc(this._t('From'))}</text><text class="rv-col" x="${G.xR}" y="16">${esc(this._t('To'))}</text>`;
      return `${this._altHeadHTML()}<div class="rv-sum" data-rsum>${this._riverSumHTML(m)}</div><svg class="river-svg" viewBox="0 0 ${G.W} ${G.H.toFixed(0)}" preserveAspectRatio="xMidYMid meet"><defs>${grads}</defs>${heads}<g>${bands}</g><g>${flows}</g><g>${nodes}</g></svg>${this._altTodayHTML()}`;
    },
    _u_river(m) {
      const r = this.shadowRoot, rd = m._rd || this._riverData(m), G = this._riverGeom(rd);
      const sum = r.querySelector('[data-rsum]'); if (sum) { const h = this._riverSumHTML(m); if (sum.innerHTML !== h) sum.innerHTML = h; }
      const svg = r.querySelector('.river-svg'); if (!svg) return;
      this._setAttr(svg, 'viewBox', `0 0 ${G.W} ${G.H.toFixed(0)}`);
      G.L.forEach((o, li) => {
        this._setAttr(r.querySelector(`[data-rl="${li}"]`), 'd', this._riverBand(G, o));
        const fl = r.querySelector(`[data-rf="${li}"]`); if (fl) { this._setAttr(fl, 'd', this._riverLine(G, o)); this._setAttr(fl, 'style', this._riverFlowStyle(o)); }
      });
      const upd = (list, cols, side) => list.forEach((s, k) => {
        const o = cols[k];
        const rect = r.querySelector(`[data-rn="${side}${k}"]`); if (rect) { this._setAttr(rect, 'y', o.y.toFixed(1)); this._setAttr(rect, 'height', o.h.toFixed(1)); }
        const g = r.querySelector(`[data-rt="${side}${k}"]`); if (g) { const tx = side === 's' ? G.xL - 12 : G.xR + G.bw + 12; this._setAttr(g, 'transform', `translate(${tx} ${(o.top + o.slot / 2).toFixed(1)})`); this._setText(g.querySelector('[data-rvv]'), fmtPower(s.v, m.unit)); }
      });
      upd(rd.S, G.cs, 's'); upd(rd.K, G.ck, 'k');
    },

    // ======================= Schematic =======================
    _schSymbol(t) {
      switch (t) {
        case 'solar': return '<rect x="-24" y="-17" width="48" height="34"/><path d="M-8 -17 V17 M8 -17 V17 M-24 0 H24"/><path d="M-40 -36 L-28 -24 M-33 -24 H-28 V-29 M-30 -40 L-18 -28 M-23 -28 H-18 V-33"/>';
        case 'battery': return '<path d="M-30 0 H-17 M17 0 H30 M-17 -15 V15 M-7 -8 V8 M3 -15 V15 M13 -8 V8"/><text x="-17" y="-20" font-size="11">+</text><text x="13" y="-20" font-size="11">−</text>';
        case 'inverter': case 'gateway_inv': return '<rect x="-27" y="-27" width="54" height="54"/><path d="M-27 27 L27 -27 M-19 -15 H-5 M-19 -10 H-5 M3 14 q4 -7 8 0 t8 0"/>';
        case 'grid': return '<path d="M0 -28 L-15 26 M0 -28 L15 26 M-11 8 L11 8 M-8 -4 L8 -4 M-18 -18 H18 M-12 -18 L-12 -12 M12 -18 L12 -12 M-11 8 L9 26 M11 8 L-9 26"/>';
        case 'house': return '<path d="M-24 -1 L0 -23 L24 -1 M-18 -6 V22 H18 V-6 M-5 22 V9 H5 V22"/>';
        case 'ev': return '<path d="M-26 9 V1 L-17 -10 H14 L23 1 V9 Z"/><circle cx="-13" cy="11" r="5"/><circle cx="13" cy="11" r="5"/><path d="M3 -30 L-4 -20 H3 L-4 -10"/>';
        case 'generator': return '<circle r="22"/><text y="2" font-size="18">G</text><path d="M-8 12 q4 -6 8 0 t8 0"/>';
        case 'gateway': return '<rect x="-25" y="-22" width="50" height="44"/><path d="M-16 -10 H16 M-16 0 H16 M-16 10 H16 M-10 -22 V-28 M10 -22 V-28"/>';
        case 'water': return '<circle r="21"/><text y="5" font-size="11">H₂O</text>';
        case 'gas': return '<circle r="21"/><text y="5" font-size="11">GAS</text>';
        default: return '<path d="M-30 0 H-20 L-16 -9 L-8 9 L0 -9 L8 9 L16 -9 L20 0 H30"/>';
      }
    },
    _schGeom(m) {
      const n = m.devs.length, portrait = this._altWB === 0;
      let root = m.devs.findIndex(x => x.t === 'inverter'); if (root < 0) root = m.devs.findIndex(x => x.t === 'gateway');
      const adj = m.devs.map(() => []);
      m.edges.forEach(e => { adj[e.a].push(e.b); adj[e.b].push(e.a); });
      if (root < 0 && n) { root = 0; adj.forEach((a, i) => { if (a.length > adj[root].length) root = i; }); }
      const depth = new Array(n).fill(-1), parent = new Array(n).fill(-1);
      if (root >= 0) { depth[root] = 0; const q = [root]; while (q.length) { const u = q.shift(); for (const v of adj[u]) if (depth[v] < 0) { depth[v] = depth[u] + 1; parent[v] = u; q.push(v); } } }
      const loose = new Set();
      for (let i = 0; i < n; i++) if (depth[i] < 0) { depth[i] = 1; parent[i] = root; loose.add(i); }
      const DC = ['solar', 'battery', 'generator'];
      const side = new Array(n).fill(1);
      const sideOf = i => { if (i === root) return 0; let k = i; while (parent[k] !== root && parent[k] >= 0) k = parent[k]; return DC.includes(m.devs[k].t) ? -1 : 1; };
      for (let i = 0; i < n; i++) side[i] = sideOf(i);
      const colGap = portrait ? 170 : 205, rowGap = portrait ? 128 : 132;
      const ORDER = ['solar', 'generator', 'battery', 'grid', 'house', 'ev', 'load', 'gateway', 'inverter', 'water', 'gas'];
      const v = new Array(n).fill(0), maxD = Math.max(0, ...depth);
      for (const sd of [-1, 1]) {
        for (let dd = 1; dd <= maxD; dd++) {
          const ids = []; for (let i = 0; i < n; i++) if (depth[i] === dd && side[i] === sd) ids.push(i);
          if (!ids.length) continue;
          if (dd === 1) { ids.sort((a, b) => ORDER.indexOf(m.devs[a].t) - ORDER.indexOf(m.devs[b].t) || a - b); ids.forEach((i, k) => { v[i] = (k - (ids.length - 1) / 2) * rowGap; }); }
          else {
            const kids = {}; ids.forEach(i => (kids[parent[i]] ||= []).push(i));
            // Portrait: children sit beside their parent's column, so their wire
            // can leave the parent from the side and miss its labels.
            Object.entries(kids).forEach(([p, list]) => list.forEach((i, k) => { v[i] = v[p] + (portrait ? rowGap * 0.55 + k * rowGap : (k - (list.length - 1) / 2) * rowGap); }));
            ids.sort((a, b) => v[a] - v[b]);
            for (let k = 1; k < ids.length; k++) if (v[ids[k]] - v[ids[k - 1]] < rowGap) v[ids[k]] = v[ids[k - 1]] + rowGap;
          }
        }
      }
      const raw = m.devs.map((x, i) => { const u = side[i] * depth[i] * colGap; return portrait ? { x: v[i], y: u } : { x: u, y: v[i] }; });
      const mx = portrait ? 80 : 110, myT = portrait ? 104 : 56, myB = portrait ? 92 : 86;
      const xs = raw.map(p => p.x), ys = raw.map(p => p.y);
      const minX = Math.min(0, ...xs) - mx, maxX = Math.max(0, ...xs) + mx, minY = Math.min(0, ...ys) - myT, maxY = Math.max(0, ...ys) + myB;
      const W = Math.max(portrait ? 420 : 640, maxX - minX), H = Math.max(portrait ? 420 : 340, maxY - minY);
      const ox = (W - (maxX - minX)) / 2 - minX, oy = (H - (maxY - minY)) / 2 - minY;
      const pos = raw.map(p => ({ x: p.x + ox, y: p.y + oy }));
      return { W, H, pos, root, parent, depth, loose, portrait };
    },
    // Wire from a to b: out of the child's port, along a bus line halfway
    // between the columns, into the parent's port (a classic one-line
    // diagram). Points run a -> b so the flow animation direction matches.
    _schPath(g, e) {
      const a = e.a, b = e.b;
      let child = a, par = b;
      if (g.parent[a] === b) { child = a; par = b; } else if (g.parent[b] === a) { child = b; par = a; } else if (g.depth[a] < g.depth[b]) { child = b; par = a; }
      const C = g.pos[child], P = g.pos[par], hubR = par === g.root ? 32 : 30;
      let pts;
      if (!g.portrait) {
        const dir = Math.sign(P.x - C.x) || 1;
        const c1 = { x: C.x + dir * 30, y: C.y }, p1 = { x: P.x - dir * hubR, y: P.y }, bx = (c1.x + p1.x) / 2;
        pts = [c1, { x: bx, y: C.y }, { x: bx, y: P.y }, p1];
      } else if (par !== g.root && g.depth[child] > g.depth[par]) {
        // Portrait, deeper level: out of the parent's side, then down/up.
        const dir = Math.sign(C.y - P.y) || 1, sx = Math.sign(C.x - P.x) || 1;
        pts = [{ x: C.x, y: C.y - dir * 30 }, { x: C.x, y: P.y }, { x: P.x + sx * 34, y: P.y }];
      } else {
        const dir = Math.sign(P.y - C.y) || 1;
        const c1 = { x: C.x, y: C.y + dir * 30 }, p1 = { x: P.x, y: P.y - dir * hubR }, by = (c1.y + p1.y) / 2;
        pts = [c1, { x: C.x, y: by }, { x: P.x, y: by }, p1];
      }
      if (child === b) pts.reverse();
      return 'M ' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
    },
    _schSub(x) {
      if (x.t === 'battery') return [x.soc != null ? Math.round(x.soc) + '%' : '', x.battTime || this._altRole(x)].filter(Boolean).join(' · ');
      return this._altRole(x);
    },
    _schFlows(m, g) { return m.edges.filter(e => e.active && !e.hidden && !g.loose.has(e.a) && !g.loose.has(e.b)).map(e => this._altFlow(e, this._schPath(g, e), 'sf')).join(''); },
    _v_schematic(m) {
      const g = this._schGeom(m); this._schG = g;
      const wires = m.edges.filter(e => !e.hidden).map(e => `<path class="sch-wire" d="${this._schPath(g, e)}"/>`).join('');
      const syms = m.devs.map(x => {
        const p = g.pos[x.i], big = x.i === g.root;
        const sym = this._schSymbol(x.t);
        // Label position: below by default; above for nodes above the hub on
        // phones (their wire leaves from below); beside the hub on phones.
        const above = g.portrait && !big && p.y < g.pos[g.root]?.y;
        const beside = g.portrait && big;
        const Y = beside ? [-10, 8, 23] : above ? [-74, -56, -41] : big ? [50, 68, 83] : [46, 64, 79];
        const tx = beside ? ' x="44" style="text-anchor:start"' : '';
        return `<g class="sy ${x.role}${x.active ? ' on' : ''}" data-i="${x.i}" data-act="dev:${x.i}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" style="--c:${x.color}"><rect class="sy-bg" x="-34" y="-34" width="68" height="68"/><g class="sy-s"${big ? ' transform="scale(1.15)"' : ''}>${sym}</g><text class="sy-nm" y="${Y[0]}"${tx}>${esc(String(x.name).toUpperCase())}</text>${x.has || x.util ? `<text class="sy-v" y="${Y[1]}"${tx} data-sv>${esc(x.text)}</text>` : ''}<text class="sy-x" y="${Y[2]}"${tx} data-sx>${esc(this._schSub(x))}</text></g>`;
      }).join('');
      const c = this._config || {};
      const title = c.title === undefined || c.title === null ? this._t('Energy Flow') : String(c.title);
      const rows = this._statsRows();
      const cell = (k, v, attr = '', cls = '') => `<div class="tb-c${cls}"><span>${esc(k)}</span><b${attr}>${esc(v)}</b></div>`;
      const tb = `<div class="tb">${cell(this._t('Title'), title || '—', '', ' tb-t')}${cell(this._t('Date'), this._altDate(), ' data-alt-date')}${cell(this._t('Time'), this._altClock(), ' data-alt-clock')}`
        + `${cell(this._t('In use'), fmtPower(m.tot.use, m.unit), ' data-tbu')}${m.ss != null ? cell(this._t('Self-powered'), `${m.ss}%`, ' data-tbs') : ''}`
        + `${state(this._hass, c.weather_entity) ? cell(this._t('Weather'), this._altWx(), ' data-alt-wx') : ''}${c.updated_enabled === true ? `<div class="tb-c"><span>${esc(this._t('Updated'))}</span><b data-upd-text>${esc(this._updatedInfo().text)}</b></div>` : ''}`
        + rows.map((r, k) => cell(r.name, r.value, ` data-alt-stat="${k}"`)).join('') + `</div>`;
      const empty = m.devs.length ? '' : `<div class="alt-empty">${esc(this._t('Open the card editor and add Solar, Inverter, Battery, Grid or House.'))}</div>`;
      const sub = (c.subtitle ? `<div class="alt-sub" style="margin-bottom:6px">${esc(c.subtitle)}</div>` : '')
        + (this._binsOn() ? `<div class="alt-meta" style="justify-content:flex-start;margin-bottom:8px"><span class="alt-chip bins-chip ${this._binsState()}" data-alt-bins data-act="bins">${this._binsInner(true)}</span></div>` : '');
      return `${sub}${empty}${m.devs.length ? `<svg class="sch-svg" viewBox="0 0 ${g.W.toFixed(0)} ${g.H.toFixed(0)}" preserveAspectRatio="xMidYMid meet"><defs>${this._svgFilterDefs().replace(/^<defs>|<\/defs>$/g, '')}<pattern id="schg" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0 H0 V10" fill="none" stroke="var(--gridc)" stroke-width="1"/></pattern><pattern id="schG" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#schg)"/><path d="M50 0 H0 V50" fill="none" stroke="var(--gridc2)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#schG)"/><rect x="4" y="4" width="${(g.W - 8).toFixed(0)}" height="${(g.H - 8).toFixed(0)}" fill="none" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.5"/><g>${wires}</g><g class="alt-flows">${this._schFlows(m, g)}</g>${syms}</svg>` : ''}${tb}`;
    },
    _u_schematic(m, flowsChanged) {
      const r = this.shadowRoot, g = this._schG;
      m.devs.forEach(x => {
        const el = r.querySelector(`.sy[data-i="${x.i}"]`); if (!el) return;
        this._setAttr(el, 'class', `sy ${x.role}${x.active ? ' on' : ''}`);
        this._setText(el.querySelector('[data-sv]'), x.text); this._setText(el.querySelector('[data-sx]'), this._schSub(x));
      });
      this._setText(r.querySelector('[data-tbu]'), fmtPower(m.tot.use, m.unit));
      if (m.ss != null) this._setText(r.querySelector('[data-tbs]'), `${m.ss}%`);
      if (flowsChanged) { const fg = r.querySelector('.alt-flows'); if (fg) fg.innerHTML = this._schFlows(m, g); }
    },

  };

  const BinMethods = {
    _binsOn() { const c = this._config || {}; return c.bins_enabled === true && Array.isArray(c.bins) && c.bins.some(b => b && (b.calendar || b.start || b.extra)); },
    _binsList() { return (Array.isArray(this._config?.bins) ? this._config.bins : []).slice(0, BIN_MAX).filter(Boolean); },
    // Fetch calendar events (every 30 minutes, and straight away when the
    // day changes or the calendars change).
    _binsRefresh() {
      if (!this._binsOn() || !this._hass) return;
      const cals = [...new Set(this._binsList().filter(b => b.source !== 'manual' && b.calendar).map(b => b.calendar))].sort();
      const today = ymdLocal(new Date()), key = cals.join(',') + '|' + today;
      if (!cals.length) { this._binEvents = new Map(); this._binsUpdate(); return; }
      if (this._binBusy || (this._binKey === key && Date.now() - (this._binAt || 0) < 30 * 60 * 1000)) { this._binsUpdate(); return; }
      this._binBusy = true;
      binFetchEvents(this._hass, cals).then(map => { this._binEvents = map; this._binKey = key; this._binAt = Date.now(); })
        .catch(() => { this._binAt = Date.now(); this._binKey = key; })
        .finally(() => { this._binBusy = false; this._binsUpdate(); });
      this._binsUpdate();
    },
    // What to show: bins due today and/or tomorrow (or, in "always" mode,
    // the next collection, whenever it is).
    _binsInfo() {
      if (!this._binsOn()) return [];
      const today = ymdLocal(new Date()), tomorrow = ymdAdd(today, 1);
      const due = this._binsList().map(b => ({ b, date: binNextDate(b, this._binEvents, this._hass, today) })).filter(x => x.date);
      const groups = [];
      const byDate = d => due.filter(x => x.date === d).map(x => x.b);
      if (byDate(today).length) groups.push({ when: 'today', date: today, bins: byDate(today) });
      if (byDate(tomorrow).length) groups.push({ when: 'tomorrow', date: tomorrow, bins: byDate(tomorrow) });
      if (!groups.length && this._config?.bins_mode === 'always' && due.length) {
        const next = due.map(x => x.date).sort()[0];
        groups.push({ when: 'later', date: next, bins: byDate(next) });
      }
      return groups;
    },
    _binDateText(ymd) {
      const [y, m, d] = ymd.split('-').map(Number);
      try { return new Intl.DateTimeFormat(localeOf(this._hass), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d)); } catch (e) { return ymd; }
    },
    _binsInner(compact) {
      return this._binsInfo().map(g => {
        const icons = g.bins.map(b => binSVG(binColor(b), compact ? 18 : 24)).join('');
        const names = g.bins.map(b => b.name || this._t('Bin')).join(' & ');
        const when = g.when === 'today' ? this._t('Today') : g.when === 'tomorrow' ? this._t('Tomorrow') : this._binDateText(g.date);
        return `<span class="bin-seg ${g.when}"><span class="bin-icons">${icons}</span><span class="bin-txt"><b>${esc(names)}</b> · ${esc(when)}</span></span>`;
      }).join('');
    },
    _binsState() { const g = this._binsInfo(); return g.some(x => x.when === 'today') ? 'today' : g.length ? g[0].when : ''; },
    _binsEntity() { const b = this._binsList().find(x => x.source !== 'manual' && x.calendar); return b ? b.calendar : ''; },
    _binsBoxHTML() {
      if (!this._binsOn() || this._phoneHidden('bins')) return '';
      const p = this._panelPos('bins'), ent = this._binsEntity();
      return `<div class="bins ${this._binsState()}" data-act="bins" style="--bn-x:${p.x}%;--bn-y:${p.y}%">${this._binsInner(false)}</div>`;
    },
    _binsUpdate() {
      const r = this.shadowRoot; if (!r) return;
      r.querySelectorAll('.bins, [data-alt-bins]').forEach(el => {
        const compact = el.hasAttribute('data-alt-bins');
        const h = this._binsInner(compact); if (el.innerHTML !== h) el.innerHTML = h;
        const st = this._binsState();
        ['today', 'tomorrow', 'later'].forEach(k => el.classList.toggle(k, st === k));
      });
    },
  };
  Object.assign(HomePowerFlowCard.prototype, AltViews);
  Object.assign(HomePowerFlowCard.prototype, BinMethods);
  Object.assign(HomePowerFlowCard.prototype, FsMethods);
  Object.assign(HomePowerFlowCard.prototype, ActMethods);

  class HomePowerFlowEditor extends HTMLElement {
    constructor(){ super(); this._config={}; this._hass=null; this._extrasOpen=new Map(); this._devicesOpen=new Map(); this._statsOpen=new Map(); this._layoutMode='desktop'; this.attachShadow({mode:'open'}); }
    // Whether the device with this id has its editor body expanded. Keyed by
    // id (not index) so deleting an earlier device never scrambles which
    // other device appears open/closed. Defaults to closed for a clean list.
    _isDeviceOpen(id){ return this._devicesOpen.has(id) ? this._devicesOpen.get(id) : false; }
    // Whether the device with this id has its extras section open. Defaults
    // to open when the device already has extra entities, but an explicit
    // toggle always wins over that default so it can be collapsed even when
    // non-empty.
    _isExtrasOpen(id,extrasLen){ return this._extrasOpen.has(id) ? this._extrasOpen.get(id) : extrasLen>0; }
    setConfig(config){
      const next=JSON.parse(JSON.stringify(config||{}));
      next.devices ||= [];
      next.connections ||= [];
      next.statistics ||= {};
      migrateDeviceIdsAndLinks(next);
      migrateFlowThreshold(next);
      const nextStr=JSON.stringify(next);
      // Same as what we already have (usually Home Assistant echoing our own
      // change back): keep our object, so nothing in progress is lost.
      if(nextStr===JSON.stringify(this._config)){ if(!this.shadowRoot.firstElementChild) this._render(); return; }
      // An OLDER copy of something we sent a moment ago, arriving after a
      // newer change (e.g. a quick drag or reorder): keep the newer one and
      // send it again, otherwise the older order/position would be saved.
      const now=Date.now(); this._sent=(this._sent||[]).filter(x=>now-x.t<2500);
      const at=this._sent.findIndex(x=>x.s===nextStr);
      if(at>=0 && at<this._sent.length-1){ this._emit(false); return; }
      this._config=next;
      this._render();
    }
    set hass(h){
      this._hass=h;
      const lang=langOf(h);
      if(lang!==this._lang){ this._lang=lang; if(this.shadowRoot.firstElementChild){ this._render(); return; } }
      // Do not rebuild the editor on every HA state update. Rebuilding the
      // DOM destroys focus and closes entity pickers while the user is typing.
      this.shadowRoot.querySelectorAll('ha-entity-picker, ha-selector').forEach(el=>{ el.hass=h; });
      this._updateFlowLive();
      if(Date.now()-(this._warnAt||0)>5000){ this._warnAt=Date.now(); try { this._refreshWarnings(); } catch(e) {} }
      this._enlargeDialogPreview();
    }
    connectedCallback(){
      this._enlargeDialogPreview();
      if (!this._onResize) {
        // A maximised/resized browser window doesn't fire our hass setter, so
        // without this the preview only re-sizes on the next HA state update.
        this._onResize = () => this._enlargeDialogPreview();
        window.addEventListener('resize', this._onResize);
      }
    }
    disconnectedCallback(){
      if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize=null; }
      if (WX_FX_PREVIEW) { WX_FX_PREVIEW=null; try{window.dispatchEvent(new Event('hpf-wx-preview'));}catch(e){} }
    }
    // Recursively finds the first descendant matching selector, crossing
    // open shadow-root boundaries - HA's dialog preview structure differs
    // between dashboard types/versions (legacy hui-card wrapper vs. the
    // newer hui-section/hui-grid-section "Sections" layout), so searching
    // by fixed intermediate tag names is fragile. This only cares about
    // finding the actual target element, wherever it really lives.
    _deepFind(root, selector){
      if (!root) return null;
      const direct = root.querySelector ? root.querySelector(selector) : null;
      if (direct) return direct;
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) {
          const found = this._deepFind(el.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    // Walks up from el's REAL ancestor chain (crossing shadow-root
    // boundaries via the host element, since parentElement alone stops at
    // a shadow root's top) until it reaches stopAt, clearing width/height
    // constraints on every element actually on that path - whatever those
    // elements turn out to be. This is what actually fixes the preview not
    // stretching, regardless of which wrapper structure this HA version uses.
    _declampAncestors(el, stopAt){
      let node = el, guard = 0;
      while (node && node !== stopAt && guard < 25) {
        guard++;
        if (node.style && node !== el) {
          node.style.setProperty('width', '100%', 'important');
          node.style.setProperty('max-width', 'none', 'important');
          node.style.setProperty('min-width', '0', 'important');
          node.style.setProperty('box-sizing', 'border-box', 'important');
        }
        if (node.parentElement) { node = node.parentElement; continue; }
        const root = node.getRootNode ? node.getRootNode() : null;
        node = root && root.host ? root.host : null;
      }
    }
    _enlargeDialogPreview(){
      // Home Assistant renders custom card editors inside hui-dialog-edit-card.
      // The standard dialog gives the preview a fairly small card width and our
      // card's 700px minimum height makes it even narrower. When this editor is
      // opened, enlarge only the preview instance; dashboard cards are untouched.
      let root=this.getRootNode();
      let host=root && root.host;
      let dialog=null;
      for(let i=0;i<12 && host;i++){
        if(String(host.tagName||'').toLowerCase()==='hui-dialog-edit-card'){ dialog=host; break; }
        root=host.getRootNode?.();
        host=root?.host;
      }
      if(!dialog?.shadowRoot) return;
      const preview=dialog.shadowRoot.querySelector('.element-preview');
      if(!preview) return;
      // Find our actual card element wherever it lives - could be a direct
      // child of a legacy hui-card, or several shadow-root layers deep
      // inside hui-section/hui-grid-section on the newer Sections layout.
      const inner=this._deepFind(preview, 'home-power-flow-card');
      if(!inner) return;
      this._previewInner=inner;
      const wantPhone=this._layoutMode==='phone';
      if(inner._editorPhone!==wantPhone){ inner._editorPhone=wantPhone; inner._applyScale?.(); }

      // The settings column (the preview's flex sibling) defaults to
      // min-width:auto, the classic flexbox trap: it refuses to shrink below
      // its own content's natural width, which forces the whole row to
      // overflow (clipping input rows, showing a horizontal scrollbar) and
      // eats the space the preview should be growing into. Freeing it to
      // shrink is what actually lets the preview stretch on a wide dialog.
      const settingsCol = Array.from(preview.parentElement?.children || []).find(c => c !== preview);
      // Fixed-width settings column: don't let it flex-grow to soak up extra
      // dialog space (it has nothing that needs to - our editor's own
      // :host max-width already caps its content at 680px) so all the extra
      // room reliably goes to the preview instead, which now scales itself
      // correctly regardless of how much space it's given.
      if (settingsCol) { settingsCol.style.minWidth = '0'; settingsCol.style.flex = '0 0 auto'; settingsCol.style.boxSizing = 'border-box'; settingsCol.style.overflowX = 'hidden'; }
      if (preview.parentElement) preview.parentElement.style.minWidth = '0';

      // Widen the dialog surface itself too, so both columns actually have
      // extra room to grow into rather than fighting each other for a
      // capped width.
      const surface = dialog.shadowRoot.querySelector('ha-dialog')?.shadowRoot?.querySelector('.mdc-dialog__surface')
        || dialog.shadowRoot.querySelector('.mdc-dialog__surface');
      if (surface) { surface.style.maxWidth = 'min(96vw, 1700px)'; surface.style.width = 'min(96vw, 1700px)'; }

      // Make the preview column consume the available right-hand space via
      // flex-grow rather than a viewport-relative width, so it scales with
      // the dialog's actual available width instead of the browser window's.
      preview.style.minWidth='0';
      preview.style.width='auto';
      preview.style.maxWidth='none';
      preview.style.flex='2 1 420px';
      preview.style.overflow='auto';
      preview.style.boxSizing='border-box';
      // Clear width constraints on inner's REAL ancestor chain up to
      // preview - whatever elements that actually is on this HA version.
      this._declampAncestors(inner, preview);

      const applyInner=()=>{
        if(!inner?.shadowRoot) return;
        const card=inner.shadowRoot.querySelector('.card');
        if(card){ card.style.transform=''; card.style.transformOrigin=''; }
        // The card keeps a fixed 3:2 aspect ratio and scales its own contents
        // to its width, so fitting the preview only needs a width cap that
        // keeps the card's height inside the dialog.
        // Height available for the preview: from the preview's (fixed) top
        // edge to the bottom of the window, minus the dialog's button bar.
        // Measured once per window size and then kept, so editing boxes
        // (which changes the dialog's content height) never resizes it.
        const winKey=`${window.innerWidth}x${window.innerHeight}`;
        if(this._previewAvail?.key!==winKey){
          const top=preview.getBoundingClientRect?.().top||0;
          const h=top>0&&top<window.innerHeight*0.6 ? window.innerHeight-top-90 : window.innerHeight*0.6;
          this._previewAvail={key:winKey,h:Math.max(320,Math.round(h))};
        }
        const availH=this._previewAvail.h;
        inner.style.display='block';
        inner.style.height=''; inner.style.overflow='';
        inner.style.width='100%';
        inner.style.maxWidth=Math.floor(availH*(inner._phoneMode?0.6667:(inner._ratio||1.5)))+'px';
        inner.style.margin='0 auto';
      };
      applyInner();
      requestAnimationFrame(()=>{ applyInner(); requestAnimationFrame(applyInner); });
    }
    _render(){
      const c=this._config;
      this._tab ||= 'look'; this._secOpen ||= new Set();
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;width:100%;max-width:680px;min-width:0;box-sizing:border-box;overflow-x:hidden}.wrap{padding:4px 0;font-family:var(--primary-font-family,Arial)}h3{margin:18px 0 8px}.hint{opacity:.65;font-size:12px;margin-bottom:12px}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:8px 0}.row.compact{grid-template-columns:repeat(auto-fit,minmax(110px,1fr));align-items:end}.field{display:flex;flex-direction:column;gap:5px;min-width:0}.field.full{grid-column:1/-1}.entity-id{font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.72;word-break:break-all;margin-top:2px}.section{padding:14px 16px;margin:12px 0;border:1px solid var(--divider-color,#ddd);border-radius:14px}.section h3{margin-top:0}label{font-size:12px;opacity:.75}input,select{width:100%;box-sizing:border-box;min-width:0;padding:10px;border:1px solid var(--divider-color,#ddd);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#111)}.drag-handle{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:6px;flex:none;cursor:grab;touch-action:none;opacity:.7;border-radius:6px}.drag-handle:hover{opacity:1;background:rgba(127,127,127,.15)}.drag-handle ha-icon{--mdc-icon-size:18px;width:18px;height:18px}.sort-item.sorting{opacity:.85;box-shadow:0 8px 22px rgba(0,0,0,.35);border-color:var(--primary-color,#03a9f4);position:relative;z-index:5}.sort-item.sorting .drag-handle{cursor:grabbing}.device{padding:13px;margin:10px 0;border:1px solid var(--divider-color,#ddd);border-radius:12px;background:var(--secondary-background-color,rgba(0,0,0,.03))}.device-head{display:flex;justify-content:space-between;align-items:center;font-weight:700}.device-title{cursor:pointer;display:flex;align-items:center;gap:6px;flex:1;min-width:0;user-select:none}.device-sub{font:11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:400;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.device-head button{border:0;background:transparent;color:var(--error-color,#db4437);font-size:20px;cursor:pointer}.section-toggle{cursor:pointer;user-select:none;display:flex;align-items:baseline;gap:8px}.section-sub{font-size:12px;font-weight:400;opacity:.6}.section-body[hidden]{display:none}.device-actions{display:flex;align-items:center;gap:2px;flex:none}.device-head button.dup-btn{color:var(--primary-text-color,#fff);opacity:.7;display:inline-flex;align-items:center;padding:2px 4px}.device-head button.dup-btn:hover{opacity:1}.device-head button.dup-btn ha-icon{--mdc-icon-size:18px;width:18px;height:18px}.flow-live{font-size:11px;line-height:1.5;margin-top:4px;opacity:.85}.flow-live .fl-on{color:var(--success-color,#4caf50)}.flow-live .fl-off{opacity:.6}.btn{border:0;border-radius:10px;padding:11px 14px;background:var(--primary-color,#03a9f4);color:#fff;cursor:pointer;font-weight:700}.small{font-size:11px;opacity:.6}.layout-editor{position:relative;width:100%;aspect-ratio:1.5/1;min-height:420px;border-radius:16px;overflow:hidden;border:1px solid var(--divider-color,#ddd);background:#10202c;touch-action:none}.layout-bg{position:absolute;inset:0;background-size:cover;background-position:center}.layout-editor.phone{aspect-ratio:2/3;max-width:440px;min-height:0;margin:0 auto}.layout-editor.phone .layout-node{min-width:0;max-width:96px;padding:4px 6px;font-size:10px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-editor.phone .layout-node .ln-pos{display:none}.layout-node.dragging{z-index:50!important}.layout-node:hover{z-index:40}.seg{display:inline-flex;border:1px solid var(--divider-color,#ddd);border-radius:10px;overflow:hidden;margin:4px 0 8px}.seg button{border:0;padding:7px 14px;background:transparent;color:var(--primary-text-color,#111);cursor:pointer;font-size:13px}.seg button.on{background:var(--primary-color,#03a9f4);color:#fff}input[type="range"]{padding:0;border:0;background:transparent;min-height:28px}.layout-node.device-handle{box-sizing:border-box;overflow:hidden;padding:4px 6px;display:flex;flex-direction:column;justify-content:flex-start}.layout-node.device-handle.custom-size{border-color:var(--primary-color,#03a9f4)}.layout-node .rz{position:absolute;z-index:3;touch-action:none}.layout-node .rz-e{top:0;right:0;width:10px;height:100%;cursor:ew-resize}.layout-node .rz-s{left:0;bottom:0;width:100%;height:10px;cursor:ns-resize}.layout-node .rz-se{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.75) 50%);border-radius:0 0 8px 0}@media (pointer:coarse){.layout-node .rz-e{width:18px}.layout-node .rz-s{height:18px}.layout-node .rz-se{width:26px;height:26px}}.route-layer{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible}.route-line{fill:none;stroke:#ffd54f;stroke-width:2;stroke-dasharray:5 4;vector-effect:non-scaling-stroke;opacity:.9}.route-hit{fill:none;stroke:transparent;stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:copy}.route-pt{position:absolute;z-index:30;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#ffd54f;border:2px solid #222;cursor:move;touch-action:none}@media (pointer:coarse){.route-pt{width:22px;height:22px;margin:-11px 0 0 -11px}}.xbg{border:1px solid rgba(127,127,127,.25);border-radius:10px;padding:8px 10px}.xbg .tick{display:flex;align-items:center;justify-content:flex-start;gap:8px;cursor:pointer;font-weight:600;margin:2px 0}.xbg .tick input[type=checkbox]{width:18px;height:18px;margin:0;flex:0 0 auto}.xbg-grid{display:grid;justify-content:start;grid-template-columns:auto minmax(0,170px) minmax(0,170px);gap:6px 10px;align-items:start;margin:8px 0}.xbg-col{font-size:12px;opacity:.75;text-align:center}.xbg-label{font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap;align-self:center;margin-bottom:26px}.xbg-ic{font-size:16px}.xbg-cell{min-width:0}.xbg-tile{width:100%;aspect-ratio:16/9;border:1.5px dashed rgba(127,127,127,.55);border-radius:8px;background:rgba(127,127,127,.08) center/cover no-repeat;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:inherit;font:inherit;padding:0}.xbg-tile:hover{border-color:var(--primary-color,#03a9f4)}.xbg-tile.has{border-style:solid;border-color:var(--primary-color,#03a9f4)}.xbg-tile.fallback{border-style:dashed}.xbg-plus{font-size:22px;line-height:1;opacity:.7}.xbg-note{font-size:11px;opacity:.85}.xbg-tile.fallback .xbg-note{background:rgba(0,0,0,.55);color:#fff;padding:1px 7px;border-radius:8px;opacity:1}.xbg-tile.fallback{filter:saturate(.6);opacity:.75}.xbg-actions{display:flex;gap:4px;justify-content:center;margin-top:4px}.xbg-act{background:none;border:1px solid rgba(127,127,127,.35);border-radius:6px;cursor:pointer;font-size:12px;padding:2px 8px;color:inherit;line-height:1.4}.xbg-act:hover{border-color:var(--primary-color,#03a9f4)}.xbg-url{width:100%;margin-top:4px;box-sizing:border-box;font-size:12px}.xbg-status{font-size:11px;opacity:.75;text-align:center}.xbg-status:empty{display:none}.xbg-season{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:6px 0}.xbg-season label{margin:0}.xbg-season select{width:auto}.xbg-dates{font-size:12px;opacity:.75}.xbg-day{width:58px}.act-fold{border:1px dashed rgba(127,127,127,.38);border-radius:10px;margin:10px 0 2px}.act-fold.open{border-style:solid;border-color:rgba(127,127,127,.5)}.act-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;font-size:13.5px;user-select:none}.act-hd b{font-weight:600;white-space:nowrap}.act-ch{opacity:.6;width:12px}.act-sum{margin-left:auto;font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.act-bd{padding:0 10px 10px}.act-row{display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:start;margin-top:8px}.act-row>label{padding-top:9px;font-size:12.5px;opacity:.85}.act-simple{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.act-simple select,.act-simple input:not([type=checkbox]){flex:1 1 160px;min-width:0}.act-cf{display:flex;align-items:center;gap:5px;font-size:12.5px;white-space:nowrap}.act-cf input{width:auto;margin:0}@media (max-width:460px){.act-row{grid-template-columns:1fr}.act-row>label{padding-top:0}}.tabs{display:flex;gap:4px;margin:0 0 14px;padding:4px;border-radius:12px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.08);position:sticky;top:0;z-index:5;backdrop-filter:blur(8px)}.tab{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:9px 4px;border:0;border-radius:9px;background:none;color:inherit;font:inherit;font-size:14px;font-weight:650;cursor:pointer;opacity:.8;white-space:nowrap}.tab:hover{opacity:1;background:rgba(127,127,127,.12)}.tab.on{background:var(--primary-color,#03a9f4);color:var(--text-primary-color,#fff);opacity:1}.tab-warn{font-size:11px;color:#ffb74d}.tab.on .tab-warn{color:#fff}.tab-warn:empty{display:none}.sec{border:1px solid rgba(127,127,127,.32);border-radius:12px;margin:0 0 10px;background:rgba(127,127,127,.05)}.sec.open{border-color:var(--primary-color,#03a9f4);box-shadow:0 0 0 1px color-mix(in srgb,var(--primary-color,#03a9f4) 30%,transparent)}.sec-hd{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;user-select:none}.sec-ic{width:34px;height:34px;border-radius:9px;background:rgba(127,127,127,.16);display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}.sec-tt{font-size:16.5px;font-weight:650;white-space:nowrap}.sec-sum{margin-left:auto;font-size:12.5px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;text-align:right}.sec-ch{opacity:.6;width:14px;text-align:center;flex:none}.sec-bd{padding:2px 14px 14px;border-top:1px solid rgba(127,127,127,.22)}.sec-bd>.hint:first-child{margin-top:10px}.sec .dev-warn{margin-left:0}.sw{position:relative;width:38px;height:22px;flex:none;cursor:pointer}.sw input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}.sw span{position:absolute;inset:0;border-radius:999px;background:rgba(127,127,127,.45);transition:background .2s}.sw span:after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}.sw input:checked+span{background:var(--primary-color,#03a9f4)}.sw input:checked+span:after{transform:translateX(16px)}@media (max-width:460px){.tab{font-size:12px;gap:3px;padding:8px 2px}.sec-sum{display:none}.sec-tt{flex:1;font-size:15.5px}.sec-hd{gap:10px}}@media (max-width:340px){.tab span{display:none}}.bin-ed{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:8px 10px;margin:8px 0}.bin-ed.folded{display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 10px}.bin-ed.folded:hover{border-color:var(--primary-color,#03a9f4)}.bin-ed.folded .bin-next{margin:0 0 0 auto;text-align:right}.bin-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bin-arrow{cursor:pointer;opacity:.7;width:14px;flex:none;user-select:none}.bin-ed-head{display:flex;align-items:center;gap:8px}.bin-ed-head input[data-bin-field=name]{flex:1;min-width:0}.bin-ed-head input[type=color]{width:42px;height:32px;padding:2px;flex:none}.bin-ed-head .btn{flex:none;margin:0}.bin-ic{display:inline-flex;flex:none}.bin-next{font-size:12px;opacity:.8;margin-top:2px}.bin-next:empty{display:none}.vs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}.vs{border:1.5px solid rgba(127,127,127,.35);border-radius:10px;padding:6px;cursor:pointer;background:none;color:inherit;text-align:center;font:inherit}.vs:hover{border-color:var(--primary-color,#03a9f4)}.vs.on{border-color:var(--primary-color,#03a9f4);background:rgba(3,169,244,.14)}.vs svg{width:100%;height:auto;border-radius:6px;display:block}.vs span{display:block;font-size:12px;font-weight:600;margin-top:5px;line-height:1.25}.xbg+.xbg{margin-top:10px}.wxp-row{display:flex;flex-wrap:wrap;gap:6px}.wxp.on{border-color:var(--primary-color,#03a9f4);background:rgba(3,169,244,.18)}.dev-warn{color:#ffb74d;font-size:12px;font-weight:700;margin-left:6px;white-space:nowrap}.dev-warn:empty{display:none}.warn-list:empty{display:none}.warn-list{margin:6px 0 2px}.warn{background:rgba(255,183,77,.12);border-left:3px solid #ffb74d;padding:6px 8px;border-radius:4px;font-size:12px;margin:4px 0;line-height:1.4}.show-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;margin-top:4px}.show-item{display:flex;align-items:center;gap:6px;font-size:13px;opacity:1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.show-item input{width:auto}.layout-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.layout-node{position:absolute;transform:translate(-50%,-50%);min-width:112px;max-width:160px;padding:8px 10px;border-radius:11px;background:rgba(8,29,45,.9);border:1px solid rgba(255,255,255,.35);color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35);cursor:grab;user-select:none;touch-action:none;font-size:12px;z-index:2}.layout-node[data-layout-kind="header"]{transform:none}.layout-node.dragging{cursor:grabbing;box-shadow:0 10px 24px rgba(0,0,0,.5);border-color:var(--primary-color,#03a9f4)}.layout-node .ln-top{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-node .ln-pos{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.65;margin-top:2px}.secondary-btn{margin-bottom:8px;background:var(--secondary-text-color,#607d8b)}.flow-colours{grid-template-columns:repeat(3,minmax(0,1fr))}.color-row{display:grid;grid-template-columns:42px 1fr;gap:6px;align-items:center}.color-row input[type=color]{height:40px;padding:3px}.ha-color-box{display:flex;align-items:center;gap:10px}.ha-color-picker{width:56px!important;height:40px!important;padding:2px!important;border-radius:8px}.color-preview{width:80px;height:36px;border-radius:8px;border:1px solid var(--divider-color,#ddd);display:inline-block}.color-row input[type=text]{padding:9px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.upload-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.upload-row .btn{padding:9px 12px;font-size:12px}.upload-status{font-size:11px;opacity:.65;margin-bottom:6px}
      </style><div class="wrap">${this._tabsHTML()}<div class="tabpane" data-tab-pane="look" ${this._tab!=='look'?'hidden':''}>${this._sec('style','🎨','View style',this._viewStyleHTML(c))}${this._sec('title','🏷️','Title & clock',`<div class="row"><div class="field"><label>Title</label><input data-key="title" placeholder="Leave empty for no title" value="${esc(c.title===undefined||c.title===null?'Energy Flow':c.title)}"></div><div class="field"><label>Subtitle</label><input data-key="subtitle" placeholder="Optional" value="${esc(c.subtitle||'')}"></div><div class="field"><label>Title colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="title_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.title_color||''))?c.title_color:'#ffffff')}"><span class="color-preview" style="background:${esc(c.title_color||'#ffffff')}"></span></div></div><div class="field"><label>Time format</label><select data-key="time_format"><option value="24h" ${(c.time_format||'24h')==='24h'?'selected':''}>24 hour</option><option value="12h" ${c.time_format==='12h'?'selected':''}>12 hour</option></select></div><div class="field full"><label>Weather entity</label><ha-entity-picker data-editor-key="weather_entity" allow-custom-entity></ha-entity-picker></div></div>`)}${this._sec('bg','🖼️','Background',`<div class="row"><div class="field full">${this._bgUploadField('day','Day background')}</div><div class="field full">${this._bgUploadField('night','Night background')}</div><div class="field"><label>Background fit</label><select data-key="background_fit"><option value="cover" ${c.background_fit!=='contain'?'selected':''}>Fill (crop to card)</option><option value="contain" ${c.background_fit==='contain'?'selected':''}>Fit whole image (blurred edges)</option></select></div><div class="field full"><label>Sun entity (switches day/night background)</label><ha-entity-picker data-editor-key="sun_entity" allow-custom-entity></ha-entity-picker></div></div>${this._extraBgHTML(c)}${this._wxFxHTML(c)}`)}${this._sec('appearance','🌈','Appearance',`<div class="hint">Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.</div><div class="row"><div class="field"><label>Theme</label><select data-key="theme"><option value="auto" ${(c.theme||'dark')==='auto'?'selected':''}>Auto (follow Home Assistant)</option><option value="dark" ${(c.theme||'dark')==='dark'?'selected':''}>Dark</option><option value="light" ${(c.theme||'dark')==='light'?'selected':''}>Light</option><option value="midnight" ${(c.theme||'dark')==='midnight'?'selected':''}>Midnight</option><option value="ocean" ${(c.theme||'dark')==='ocean'?'selected':''}>Ocean</option><option value="forest" ${(c.theme||'dark')==='forest'?'selected':''}>Forest</option><option value="sunset" ${(c.theme||'dark')==='sunset'?'selected':''}>Sunset</option><option value="graphite" ${(c.theme||'dark')==='graphite'?'selected':''}>Graphite</option><option value="custom" ${(c.theme||'dark')==='custom'?'selected':''}>Custom colours</option></select></div><div class="field"><label>Card shape</label><select data-key="card_aspect"><option value="3:2" ${(c.card_aspect||'3:2')==='3:2'?'selected':''}>3:2 (default)</option><option value="4:3" ${(c.card_aspect||'3:2')==='4:3'?'selected':''}>4:3</option><option value="16:10" ${(c.card_aspect||'3:2')==='16:10'?'selected':''}>16:10</option><option value="16:9" ${(c.card_aspect||'3:2')==='16:9'?'selected':''}>16:9</option><option value="2:1" ${(c.card_aspect||'3:2')==='2:1'?'selected':''}>2:1</option><option value="21:9" ${(c.card_aspect||'3:2')==='21:9'?'selected':''}>21:9 (ultra-wide)</option><option value="32:9" ${(c.card_aspect||'3:2')==='32:9'?'selected':''}>32:9 (super ultra-wide)</option><option value="image" ${(c.card_aspect||'3:2')==='image'?'selected':''}>Match background image</option><option value="screen" ${(c.card_aspect||'3:2')==='screen'?'selected':''}>Fill the screen</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="fullscreen_button" style="width:auto" ${c.fullscreen_button!==false?'checked':''}> Show full-screen button</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="fullscreen_wake" style="width:auto" ${c.fullscreen_wake!==false?'checked':''}> Keep the screen on in full screen</label></div><div class="field"><label>Power units</label><select data-key="power_unit"><option value="auto" ${(c.power_unit||'auto')==='auto'?'selected':''}>Auto (W, kW from 1000 W)</option><option value="w" ${c.power_unit==='w'?'selected':''}>Always W</option><option value="kw" ${c.power_unit==='kw'?'selected':''}>Always kW</option></select></div><div class="field"><label>Box opacity <span class="small" data-range-val="box_opacity">${esc(c.box_opacity??1)}</span></label><input type="range" min="0" max="1.5" step="0.05" data-key="box_opacity" value="${esc(c.box_opacity??1)}"></div><div class="field"><label>History hours</label><select data-key="history_hours">${[6,12,24,48].map(h=>`<option value="${h}" ${Number(c.history_hours||24)===h?'selected':''}>${h} h</option>`).join('')}</select></div><div class="field"><label>History opacity <span class="small" data-range-val="history_opacity">${esc(c.history_opacity??0.35)}</span></label><input type="range" min="0.05" max="1" step="0.05" data-key="history_opacity" value="${esc(c.history_opacity??0.35)}"></div>${c.theme==='custom'?`<div class="field"><label>Panel colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="theme_panel_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.theme_panel_color||''))?c.theme_panel_color:'#081d34')}"><span class="color-preview" style="background:${esc(c.theme_panel_color||'#081d34')}"></span></div></div><div class="field"><label>Text colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="theme_text_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.theme_text_color||''))?c.theme_text_color:'#ffffff')}"><span class="color-preview" style="background:${esc(c.theme_text_color||'#ffffff')}"></span></div></div><div class="field"><label>Panel opacity <span class="small" data-range-val="theme_opacity">${esc(c.theme_opacity??0.8)}</span></label><input type="range" min="0.2" max="1" step="0.05" data-key="theme_opacity" value="${esc(c.theme_opacity??0.8)}"></div>`:''}</div>`)}${this._sec('flows','〰️','Flow lines',`<div class="hint">How the flow lines look and move. Speed is for 1000 W; busier lines move faster.</div><div class="row"><div class="field"><label>Flow line look (day)</label><select data-key="flow_look_day"><option value="classic" ${(c.flow_look_day||'classic')==='classic'?'selected':''}>Classic</option><option value="neon" ${(c.flow_look_day||'classic')==='neon'?'selected':''}>Neon</option><option value="stream" ${(c.flow_look_day||'classic')==='stream'?'selected':''}>Energy stream</option><option value="marching" ${(c.flow_look_day||'classic')==='marching'?'selected':''}>Marching</option><option value="minimal" ${(c.flow_look_day||'classic')==='minimal'?'selected':''}>Minimal</option><option value="blueprint" ${(c.flow_look_day||'classic')==='blueprint'?'selected':''}>Blueprint</option><option value="static" ${(c.flow_look_day||'classic')==='static'?'selected':''}>Static</option></select></div><div class="field"><label>Flow line look (night)</label><select data-key="flow_look_night"><option value="same" ${!c.flow_look_night||c.flow_look_night==='same'?'selected':''}>Same as day</option><option value="classic" ${c.flow_look_night==='classic'?'selected':''}>Classic</option><option value="neon" ${c.flow_look_night==='neon'?'selected':''}>Neon</option><option value="stream" ${c.flow_look_night==='stream'?'selected':''}>Energy stream</option><option value="marching" ${c.flow_look_night==='marching'?'selected':''}>Marching</option><option value="minimal" ${c.flow_look_night==='minimal'?'selected':''}>Minimal</option><option value="blueprint" ${c.flow_look_night==='blueprint'?'selected':''}>Blueprint</option><option value="static" ${c.flow_look_night==='static'?'selected':''}>Static</option></select></div><div class="field"><label>Flow line style</label><select data-key="flow_style"><option value="curved" ${c.flow_style!=='orthogonal'?'selected':''}>Curved</option><option value="orthogonal" ${c.flow_style==='orthogonal'?'selected':''}>Right angles (avoid boxes)</option><option value="manual" ${c.flow_style==='manual'?'selected':''}>Manual (draw your own)</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="show_idle_lines" style="width:auto" ${c.show_idle_lines===true?'checked':''}> Show idle connections</label></div><div class="field"><label>Flow threshold (W)</label><input type="number" min="0" step="0.1" data-key="flow_threshold_watts" value="${esc((Number(c.flow_threshold ?? 0.0005)*1000).toFixed(1))}"></div><div class="field"><label>Flow animation speed (seconds)</label><input type="number" min="3" max="30" step="0.5" data-key="flow_speed" value="${esc(c.flow_speed??8)}"></div><div class="field"><label>Particle stagger (seconds)</label><input type="number" min="0.15" max="1.5" step="0.05" data-key="flow_stagger" value="${esc(c.flow_stagger??0.55)}"></div></div>`)}${this._sec('sizing','📐','Sizing',`<div class="hint">1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.</div><div class="row compact"><div class="field"><label>Title</label><input type="number" min="0.3" max="3" step="0.05" data-key="title_scale" value="${esc(c.title_scale??1)}"></div><div class="field"><label>Device boxes</label><input type="number" min="0.5" max="2" step="0.05" data-key="device_scale" value="${esc(c.device_scale??1)}"></div><div class="field"><label>Weather box</label><input type="number" min="0.3" max="2" step="0.05" data-key="weather_scale" value="${esc(c.weather_scale??1)}"></div><div class="field"><label>Today panel</label><input type="number" min="0.3" max="1.5" step="0.05" data-key="stats_scale" value="${esc(c.stats_scale??0.8)}"></div><div class="field"><label>Small screen</label><input type="number" min="1" max="2.5" step="0.05" data-key="mobile_scale" value="${esc(c.mobile_scale??1.4)}"></div><div class="field"><label>Max width (px)</label><input type="number" min="0" step="10" data-key="max_width" value="${esc(c.max_width??0)}"></div><div class="field"><label>Grid mix</label><input type="number" min="0.3" max="2" step="0.05" data-key="grid_mix_scale" value="${esc(c.grid_mix_scale??1)}"></div><div class="field"><label>Updated box</label><input type="number" min="0.3" max="3" step="0.05" data-key="updated_scale" value="${esc(c.updated_scale??1)}"></div><div class="field"><label>Bins badge</label><input type="number" min="0.3" max="3" step="0.05" data-key="bins_scale" value="${esc(c.bins_scale??1)}"></div></div>
      `)}</div><div class="tabpane" data-tab-pane="devices" ${this._tab!=='devices'?'hidden':''}>${this._sec('devices','🔌','Devices',`<div id="device-list">${(c.devices||[]).map((d,i)=>this._device(d,i)).join('')}</div><button class="btn" id="add">＋ Add device</button>
      `,{warn:`<span class="dev-warn" data-warn-summary>${(()=>{const n=this._allWarnings().size;return n?'⚠ '+n:'';})()}</span>`})}${VIEW_STYLES[c.view_style]&&c.view_style!=='classic'?'':this._sec('layout','🖱️','Visual layout',this._layoutEditorHTML(c))}${this._sec('connections','🔗','Connections',`<div class="hint">Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.</div><div id="connections">${this._connectionsHTML()}</div><button class="btn" id="add-connection">＋ Add connection</button>`)}</div><div class="tabpane" data-tab-pane="panels" ${this._tab!=='panels'?'hidden':''}>${this._sec('stats','📊','Today statistics',`<div class="hint">Add up to 20 custom statistics. Choose your own name, entity and icon.</div><div id="stats-list">${this._statsEditorHTML()}</div><button class="btn" id="add-stat">＋ Add statistic</button><div class="hint">Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.</div><div class="row"><div class="field"><label>Today decimals</label><input type="number" min="0" max="3" step="1" data-key="stats_decimals" value="${esc(c.stats_decimals??2)}"></div><div class="field"><label>Today panel style</label><select data-key="stats_mode"><option value="floating" ${(c.stats_mode||'floating')==='floating'?'selected':''}>Floating (drag anywhere)</option><option value="docked" ${(c.stats_mode||'floating')==='docked'?'selected':''}>Docked to card edge</option></select></div>${c.stats_mode==='docked'?`<div class="field"><label>Dock edge</label><select data-key="stats_dock_edge"><option value="bottom" ${(c.stats_dock_edge||'bottom')==='bottom'?'selected':''}>Bottom</option><option value="top" ${(c.stats_dock_edge||'bottom')==='top'?'selected':''}>Top</option><option value="left" ${(c.stats_dock_edge||'bottom')==='left'?'selected':''}>Left</option><option value="right" ${(c.stats_dock_edge||'bottom')==='right'?'selected':''}>Right</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="stats_dock_autohide" style="width:auto" ${c.stats_dock_autohide!==false?'checked':''}> Auto-hide (slides out on hover or tap)</label></div>`:''}<div class="field"><label>On phone</label><select data-key="phone_stats_mode"><option value="same" ${(c.phone_stats_mode||'same')==='same'?'selected':''}>Same as desktop</option><option value="floating" ${(c.phone_stats_mode||'same')==='floating'?'selected':''}>Floating</option><option value="docked" ${(c.phone_stats_mode||'same')==='docked'?'selected':''}>Docked</option></select></div>${c.phone_stats_mode==='docked'?`<div class="field"><label>Phone dock edge</label><select data-key="phone_stats_dock_edge"><option value="bottom" ${(c.phone_stats_dock_edge||'bottom')==='bottom'?'selected':''}>Bottom</option><option value="top" ${(c.phone_stats_dock_edge||'bottom')==='top'?'selected':''}>Top</option><option value="left" ${(c.phone_stats_dock_edge||'bottom')==='left'?'selected':''}>Left</option><option value="right" ${(c.phone_stats_dock_edge||'bottom')==='right'?'selected':''}>Right</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="phone_stats_dock_autohide" style="width:auto" ${c.phone_stats_dock_autohide!==false?'checked':''}> Phone auto-hide</label></div>`:''}</div>
      `)}${this._sec('selfsuff','🏡','Self-sufficiency',`<div class="hint"><b>Self-sufficiency</b>: share of your home's electricity that didn't come from the grid. <b>Self-consumption</b>: share of your solar you used yourself instead of exporting. Shown at the top of the Today panel. <b>Now</b> is calculated automatically from your devices; <b>today</b> uses the daily energy sensors below.</div><div class="row"><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_live" style="width:auto" ${c.self_sufficiency_live===true?'checked':''}> Self-sufficiency now</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_today" style="width:auto" ${c.self_sufficiency_today===true?'checked':''}> Self-sufficiency today</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_consumption_live" style="width:auto" ${c.self_consumption_live===true?'checked':''}> Self-consumption now</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_consumption_today" style="width:auto" ${c.self_consumption_today===true?'checked':''}> Self-consumption today</label></div></div><div class="hint">Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.</div><div class="row"><div class="field full"><label>Grid import today</label><ha-entity-picker data-editor-key="self_sufficiency_import_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Grid export today</label><ha-entity-picker data-editor-key="energy_export_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Solar production today</label><ha-entity-picker data-editor-key="energy_solar_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Home consumption today</label><ha-entity-picker data-editor-key="self_sufficiency_consumption_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_calc_consumption" style="width:auto" ${c.self_sufficiency_calc_consumption===true?'checked':''}> Calculate consumption instead (import + solar − export + battery discharge − battery charge)</label></div><div class="field full"><label>Battery charge today (optional, for calculated consumption)</label><ha-entity-picker data-editor-key="energy_battery_charge_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Battery discharge today (optional, for calculated consumption)</label><ha-entity-picker data-editor-key="energy_battery_discharge_entity" allow-custom-entity></ha-entity-picker></div></div>`)}${this._sec('bins','🗑️','Bin collection',this._binsEditorHTML(c),{sw:'bins_enabled'})}${this._sec('updated','🕒','Last updated box',`<div class="hint">Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.</div><div class="row"><div class="field"><label>Label</label><input data-key="updated_label" placeholder="Leave empty for none" value="${esc(c.updated_label===undefined?'Updated':c.updated_label)}"></div><div class="field"><label>Warn after (minutes)</label><input type="number" min="1" step="1" data-key="updated_stale_minutes" value="${esc(c.updated_stale_minutes??10)}"></div><div class="field full"><label>Entity</label><ha-entity-picker data-editor-key="updated_entity" allow-custom-entity></ha-entity-picker></div></div>
      `,{sw:'updated_enabled'})}${this._sec('gridmix','🌍','UK grid mix',`<div class="hint">Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.</div><div class="row"><div class="field"><label>Postcode (optional)</label><input data-key="grid_mix_postcode" placeholder="e.g. SW1A, blank = all of GB" value="${esc(c.grid_mix_postcode||'')}"></div></div>
      `,{sw:'grid_mix_enabled'})}${this._sec('actions','👆','Tap actions',this._actPanelsHTML(c))}</div><div class="tabpane" data-tab-pane="more" ${this._tab!=='more'?'hidden':''}>${this._sec('backup','💾','Backup',`<div class="hint">Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.</div><div class="upload-row"><button class="btn secondary-btn" type="button" id="export-config">⬇ Export config</button><button class="btn secondary-btn" type="button" id="import-config-btn">⬆ Import config</button><input type="file" accept="application/json,.json" data-import-config-file style="display:none"></div><div class="upload-status" data-import-status></div>`)}${this._sec('about','ℹ️','About',`<div class="hint">Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.</div><div class="hint">Home Power Flow Card v${esc(VERSION)} · <a href="https://github.com/mimikm/Home-Power-Flow-Card" target="_blank" rel="noopener">GitHub</a></div>`)}</div>
      </div>`;
      this._translateDom();
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(el=>{
        el.hass=this._hass;
        if (el.hasAttribute('data-bin-cal')) {
          const k=Number(el.dataset.binCal);
          el.includeDomains=['calendar'];
          el.value=this._config.bins?.[k]?.calendar||'';
          el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return; if(!this._config.bins?.[k]) return; this._config.bins[k].calendar=e.detail.value||''; this._emit(); this._binsEditorPreview(); });
          return;
        }
        if (el.hasAttribute('data-extra-picker')) {
          const di=Number(el.dataset.deviceIndex), ei=Number(el.dataset.extraIndex);
          el.value = this._config.devices[di]?.extra_entities?.[ei]?.entity || '';
          el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return;
            this._config.devices[di].extra_entities[ei].entity = e.detail.value || '';
            const lab = el.parentElement?.querySelector('.entity-id');
            if (lab) lab.textContent = e.detail.value || 'Not selected';
            this._emit();
          });
          return;
        }
        el.value = el.dataset.editorKey ? (this._config[el.dataset.editorKey] || '') : el.dataset.devicePicker ? (this._config.devices[Number(el.dataset.devicePicker)][el.dataset.field] || '') : (this._config.statistics?.[el.dataset.stat] || '');
        el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return;
          if (el.dataset.editorKey) this._config[el.dataset.editorKey]=e.detail.value || '';
          else if (el.dataset.devicePicker) { const i=Number(el.dataset.devicePicker); this._config.devices[i][el.dataset.field]=e.detail.value || ''; const labels={power_entity:'[data-entity-label]'}; const lab=el.parentElement?.querySelector(labels[el.dataset.field] || '[data-entity-label]'); if(lab) lab.textContent=e.detail.value||'Not selected'; }
          else if (el.dataset.stat) { this._config.statistics ||= {}; this._config.statistics[el.dataset.stat]=e.detail.value || ''; }
          this._emit();
        });
      });
      this.shadowRoot.querySelectorAll('[data-extra-icon]').forEach(el=>{
        el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return;
          const di=Number(el.dataset.deviceIndex), ei=Number(el.dataset.extraIndex);
          this._config.devices[di].extra_entities[ei].icon = e.detail.value || '';
          this._emit(false);
        });
      });
      this.shadowRoot.querySelectorAll('[data-toggle-device]').forEach(el=>el.addEventListener('click',()=>{
        const id=el.dataset.toggleDevice;
        this._devicesOpen.set(id, !this._isDeviceOpen(id));
        this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-toggle-extras]').forEach(b=>b.addEventListener('click',()=>{
        const id=b.dataset.toggleExtras;
        const extrasLen=(this._config.devices.find(d=>d.id===id)?.extra_entities||[]).length;
        this._extrasOpen.set(id, !this._isExtrasOpen(id,extrasLen));
        this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-add-extra]').forEach(b=>b.addEventListener('click',()=>{
        const i=Number(b.dataset.addExtra);
        const d=this._config.devices[i];
        d.extra_entities = Array.isArray(d.extra_entities) ? d.extra_entities : [];
        if (d.extra_entities.length>=5) return;
        d.extra_entities.push({entity:'',icon:''});
        this._extrasOpen.set(d.id, true);
        this._emit(false);
        this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-remove-extra]').forEach(b=>b.addEventListener('click',()=>{
        const di=Number(b.dataset.removeExtra), ei=Number(b.dataset.extraIndex);
        this._config.devices[di].extra_entities.splice(ei,1);
        this._extrasOpen.set(this._config.devices[di].id, true);
        this._emit(false);
        this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return; const k=e.target.dataset.key; if(k==='flow_threshold_watts'){ const watts=Math.max(0,parseFloat(e.target.value)||0); this._config.flow_threshold=watts/1000; this._config.flow_threshold_watts=watts; } else { this._config[k]=e.target.value; if(['flow_threshold','flow_speed','flow_stagger','device_scale','mobile_scale','max_width','stats_scale','weather_scale','title_scale','grid_mix_scale','updated_scale','updated_stale_minutes','theme_opacity','phone_breakpoint','phone_bg_focus_x','phone_bg_focus_y','history_hours','history_opacity','box_opacity','stats_decimals','bins_scale','season_start_day','season_start_month','season_end_day','season_end_month'].includes(k))this._config[k]=parseFloat(e.target.value)||0; if(e.target.type==='checkbox'){this._config[k]=e.target.checked;} } if(['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].includes(k)){const sub=this.shadowRoot.querySelector('[data-sec-sum="selfsuff"]'); if(sub){const n=['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].filter(x=>this._config[x]===true).length; sub.textContent=n?(langOf(this._hass)==='pl'?`włączone: ${n} z 4`:langOf(this._hass)==='es'?`${n} de 4 activadas`:`${n} of 4 on`):this._t('off');}} if(['grid_mix_enabled','updated_enabled','theme','stats_mode','phone_stats_mode','card_aspect','background_fit','flow_style','weather_effects','seasonal_background','bins_enabled','season','season_start_day','season_start_month','season_end_day','season_end_month'].includes(k)||/^background_season_(day|night)$/.test(k)){this._emit(false);this._render();return;} if(e.target.type==='color'){const pv=e.target.parentElement?.querySelector('.color-preview'); if(pv) pv.style.background=e.target.value;} this._emit(false); }));
      this.shadowRoot.querySelector('#add')?.addEventListener('click',()=>{
        const id=genDeviceId();
        this._config.devices.push({id,type:'solar',name:`Device ${this._config.devices.length+1}`,power_entity:''});
        this._devicesOpen.set(id,true);
        this._emit(false);
        this._render();
      });
      this.shadowRoot.querySelectorAll('[data-duplicate]').forEach(b=>b.addEventListener('click',e=>{
        e.stopPropagation();
        const i=Number(b.dataset.duplicate); const src=this._config.devices[i]; if(!src) return;
        const copy=JSON.parse(JSON.stringify(src));
        const used=new Set(this._config.devices.map(d=>d.id)); let id; do { id=genDeviceId(); } while(used.has(id));
        copy.id=id;
        copy.name=`${src.name||LABELS[src.type]||'Device'} (copy)`;
        // Offset the copy slightly so it doesn't sit exactly on the original.
        if(src.position&&Number.isFinite(Number(src.position.x))&&Number.isFinite(Number(src.position.y))){
          copy.position={x:Math.max(5,Math.min(95,Number(src.position.x)+4)),y:Math.max(6,Math.min(94,Number(src.position.y)+4))};
        }
        this._config.devices.splice(i+1,0,copy);
        this._devicesOpen.set(id,true);
        this._emit(false); this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{this._config.devices.splice(Number(b.dataset.remove),1);this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-conn-remove]').forEach(b=>b.addEventListener('click',()=>{this._config.connections.splice(Number(b.dataset.connRemove),1);this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-conn]').forEach(el=>el.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return;
        const i=Number(el.dataset.conn),k=el.dataset.field;
        this._config.connections[i][k] = k==='direction' ? Number(e.target.value) : e.target.value;
        this._emit(false);
      }));
      this.shadowRoot.querySelector('#add-connection')?.addEventListener('click',()=>{if(this._config.devices.length<2)return;this._config.connections.push({from:this._config.devices[0].id,to:this._config.devices[1].id});this._emit(false);this._render();});
      this.shadowRoot.querySelector('#add-stat')?.addEventListener('click',()=>{this._config.statistics ||= {}; this._config.statistics.entities ||= []; if(this._config.statistics.entities.length<20){this._config.statistics.entities.push({name:'Statistic',entity:'',icon:'mdi:chart-line',custom_icon:''});this._statsOpen.set(this._config.statistics.entities.length-1,true);this._emit(false);this._render();}});
      this.shadowRoot.querySelector('#export-config')?.addEventListener('click',()=>{this._exportConfig();});
      this.shadowRoot.querySelector('#import-config-btn')?.addEventListener('click',()=>{this.shadowRoot.querySelector('[data-import-config-file]')?.click();});
      this.shadowRoot.querySelector('[data-import-config-file]')?.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return;const f=e.target.files?.[0]; if(f) this._importConfigFile(f); e.target.value='';});
      this.shadowRoot.querySelectorAll('[data-remove-stat]').forEach(b=>b.addEventListener('click',()=>{const r=Number(b.dataset.removeStat);this._config.statistics.entities.splice(r,1);this._remapStatsOpen(k=>k===r?null:(k>r?k-1:k));this._emit(false);this._render();}));
      this._enableSortable('#stats-list',(from,to)=>{
        const a=this._config.statistics.entities; const [m]=a.splice(from,1); a.splice(to,0,m);
        this._remapStatsOpen(k=>{ if(k===from) return to; if(from<to&&k>from&&k<=to) return k-1; if(from>to&&k>=to&&k<from) return k+1; return k; });
        this._emit(false); this._render();
      });
      this.shadowRoot.querySelectorAll('[data-toggle-section="selfsuff"]').forEach(h=>h.addEventListener('click',()=>{
        this._ssOpen=!this._ssOpen;
        const body=this.shadowRoot.querySelector('[data-section-body="selfsuff"]'); if(body) body.hidden=!this._ssOpen;
        h.firstChild.textContent=(this._ssOpen?'▾':'▸')+' '+(langOf(this._hass)==='pl'?'Samowystarczalność i autokonsumpcja':langOf(this._hass)==='es'?'Autosuficiencia y autoconsumo':'Self-sufficiency & self-consumption');
      }));
      this._updateFlowLive();
      this._enableSortable('#device-list',(from,to)=>{
        const a=this._config.devices; const [m]=a.splice(from,1); a.splice(to,0,m);
        this._emit(false); this._render();
      });
      this.shadowRoot.querySelectorAll('[data-toggle-stat]').forEach(el=>el.addEventListener('click',()=>{
        const i=Number(el.dataset.toggleStat); this._statsOpen.set(i,!(this._statsOpen.get(i)===true)); this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-stat-field]').forEach(el=>el.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return;const i=Number(el.dataset.index); const k=el.dataset.statField; this._config.statistics.entities[i][k]=e.target.value; this._emit(false);}));
      this.shadowRoot.querySelectorAll('[data-stat-icon]').forEach(el=>{el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return;const i=Number(el.dataset.index);this._config.statistics.entities[i].icon=e.detail.value||'mdi:chart-line';this._emit(false);});});
      this.shadowRoot.querySelectorAll('[data-stat-picker]').forEach(el=>{el.hass=this._hass; el.value=this._config.statistics.entities[Number(el.dataset.index)]?.entity||''; el.addEventListener('value-changed',e=>{ if(!e.currentTarget?.isConnected) return;this._config.statistics.entities[Number(el.dataset.index)].entity=e.detail.value||'';this._emit(false);});});
      this.shadowRoot.querySelectorAll('[data-device]').forEach(el=>el.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return;
        const i=Number(el.dataset.device),k=el.dataset.field;
        if (k==='connects_to') {
          const v=e.target.value;
          if (v==='') delete this._config.devices[i].connects_to;
          else this._config.devices[i].connects_to = v; // device id, not an index
        } else if (e.target.type==='checkbox') {
          this._config.devices[i][k]=e.target.checked;
        } else {
          this._config.devices[i][k]=e.target.value;
        }
        this._emit(false);
        if(k==='type'||k==='battery_time'||k==='power_mode'||k==='flow_color_mode')this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-invert-flow]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.invertFlow);this._config.devices[i].invert_flow=!this._config.devices[i].invert_flow;this._emit(false);this._render();}));
      this._enableLayoutDragging();
      this._enableRouteEditing();
      this._applyLayoutBg();
      this.shadowRoot.querySelectorAll('[data-bg-upload-btn]').forEach(b=>b.addEventListener('click',()=>{this.shadowRoot.querySelector(`[data-bg-file="${b.dataset.bgUploadBtn}"]`)?.click();}));
      this.shadowRoot.querySelectorAll('[data-bg-file]').forEach(inp=>inp.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return;const f=e.target.files?.[0];if(f)this._uploadBackground(f,inp.dataset.bgFile);}));
      this.shadowRoot.querySelectorAll('[data-bg-restore]').forEach(b=>b.addEventListener('click',()=>{const slot=b.dataset.bgRestore;delete this._config[slot==='day'?'background_upload_day':'background_upload_night'];this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-act-toggle]').forEach(h=>h.addEventListener('click',()=>{
        const path=h.dataset.actToggle, fold=h.closest('.act-fold'); this._actOpen ||= new Set();
        const open=!this._actOpen.has(path); if(open) this._actOpen.add(path); else this._actOpen.delete(path);
        fold.classList.toggle('open',open); fold.querySelector('.act-bd').hidden=!open; h.querySelector('.act-ch').textContent=open?'▾':'▸';
        if(open) this._actFillEditors();
      }));
      this._actFillEditors();
      this.shadowRoot.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
        this._tab=b.dataset.tab;
        this.shadowRoot.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('on',x===b));
        this.shadowRoot.querySelectorAll('[data-tab-pane]').forEach(p=>{ p.hidden=p.dataset.tabPane!==this._tab; });
        if(this._tab==='devices') this._applyLayoutBg();
        this._actFillEditors();
      }));
      this.shadowRoot.querySelectorAll('[data-sec-toggle]').forEach(h=>h.addEventListener('click',e=>{
        if(e.target.closest('.sw')) return;
        const id=h.dataset.secToggle, sec=h.closest('.sec'), open=!this._secOpen.has(id);
        if(open) this._secOpen.add(id); else this._secOpen.delete(id);
        sec.classList.toggle('open',open); sec.querySelector('.sec-bd').hidden=!open; h.querySelector('.sec-ch').textContent=open?'▾':'▸';
        if(open&&id==='layout') this._applyLayoutBg();
        if(open) this._actFillEditors();
      }));
      this.shadowRoot.querySelectorAll('.sec-hd .sw input').forEach(cb=>cb.addEventListener('change',()=>{ const id=cb.closest('.sec').dataset.sec; if(cb.checked) this._secOpen.add(id); }, true));
      this.shadowRoot.querySelector('[data-toggle-bins]')?.addEventListener('click',e=>{ this._binsSecOpen=!this._binsSecOpen; const body=this.shadowRoot.querySelector('[data-bins-body]'); if(body) body.hidden=!this._binsSecOpen; const a=e.currentTarget.querySelector('[data-bins-arrow]'); if(a) a.textContent=this._binsSecOpen?'▾':'▸'; });
      this.shadowRoot.querySelectorAll('[data-bin-toggle]').forEach(el=>el.addEventListener('click',e=>{ if(e.target.closest('input,select,button')) return; const k=Number(el.dataset.binToggle); this._binOpen ||= new Set(); if(this._binOpen.has(k)) this._binOpen.delete(k); else this._binOpen.add(k); this._render(); }));
      this.shadowRoot.querySelector('#add-bin')?.addEventListener('click',()=>{ const bins=(this._config.bins=Array.isArray(this._config.bins)?this._config.bins:[]); if(bins.length>=BIN_MAX) return; const used=new Set(bins.map(b=>b.name)); const def=BIN_DEFAULTS.find(d=>!used.has(d.name))||BIN_DEFAULTS[bins.length%BIN_DEFAULTS.length]; bins.push({name:def.name,color:def.color,source:'calendar',calendar:''}); (this._binOpen ||= new Set()).add(bins.length-1); this._emit(false); this._render(); });
      this.shadowRoot.querySelectorAll('[data-bin-del]').forEach(b=>b.addEventListener('click',()=>{ const k=Number(b.dataset.binDel); this._config.bins.splice(k,1); this._binOpen=new Set([...(this._binOpen||[])].filter(i=>i!==k).map(i=>i>k?i-1:i)); this._emit(false); this._render(); }));
      this.shadowRoot.querySelectorAll('[data-bin-field]').forEach(el=>el.addEventListener('change',e=>{ if(!e.currentTarget?.isConnected) return; const k=Number(el.dataset.bin), f=el.dataset.binField, b=this._config.bins?.[k]; if(!b) return; b[f]=f==='every'?Number(el.value):el.value; this._emit(false); if(f==='source'||f==='color') this._render(); else this._binsEditorPreview(); }));
      this._binsEditorPreview();
      this.shadowRoot.querySelectorAll('[data-view-style]').forEach(b=>b.addEventListener('click',()=>{ const v=b.dataset.viewStyle; if(v==='classic') delete this._config.view_style; else this._config.view_style=v; this._emit(false); this._render(); }));
      this.shadowRoot.querySelectorAll('[data-wx-preview]').forEach(b=>b.addEventListener('click',()=>{WX_FX_PREVIEW=b.dataset.wxPreview||null; this.shadowRoot.querySelectorAll('[data-wx-preview]').forEach(x=>x.classList.toggle('on',(x.dataset.wxPreview||null)===WX_FX_PREVIEW&&!!WX_FX_PREVIEW)); try{window.dispatchEvent(new Event('hpf-wx-preview'));}catch(e){}}));
      this.shadowRoot.querySelectorAll('[data-bg-clear]').forEach(b=>b.addEventListener('click',()=>{delete this._config[bgKeyFor(b.dataset.bgClear)];this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-bg-url-toggle]').forEach(b=>b.addEventListener('click',()=>{const slot=b.dataset.bgUrlToggle; this._bgUrlOpen ||= new Set(); const inp=b.closest('.xbg-cell')?.querySelector('.xbg-url'); if(!inp) return; if(this._bgUrlOpen.has(slot)){this._bgUrlOpen.delete(slot);inp.hidden=true;} else {this._bgUrlOpen.add(slot);inp.hidden=false;inp.focus();}}));
      this._paintBgThumbs();
      this.shadowRoot.querySelectorAll('[data-bg-preview]').forEach(b=>b.addEventListener('click',()=>{this._applyLayoutBg(b.dataset.bgPreview);}));
      this.shadowRoot.querySelector('#reset-layout')?.addEventListener('click',()=>{const ph=this._layoutMode==='phone';this._config.devices.forEach(d=>{delete d[ph?'phone_position':'position'];delete d[ph?'phone_box_w':'box_w'];delete d[ph?'phone_box_h':'box_h'];});Object.values(PANEL_POS).forEach(def=>delete this._config[ph?def.phone:def.key]);this._emit(false);this._render();});
      this.shadowRoot.querySelector('#copy-desktop-layout')?.addEventListener('click',()=>{const devices=this._config.devices||[];const desk=HomePowerFlowCard.prototype._desktopLayout.call(null,devices);devices.forEach((d,i)=>{d.phone_position={x:desk[i].x,y:desk[i].y};});Object.values(PANEL_POS).forEach(def=>{this._config[def.phone]=validPos(this._config[def.key])||{x:def.d[0],y:def.d[1]};});this._emit(false);this._render();});
      this.shadowRoot.querySelectorAll('[data-phone-show-panel]').forEach(cb=>cb.addEventListener('change',()=>{const k='phone_hide_'+cb.dataset.phoneShowPanel; if(cb.checked) delete this._config[k]; else this._config[k]=true; this._emit(false); this._render();}));
      this.shadowRoot.querySelectorAll('[data-phone-show-device]').forEach(cb=>cb.addEventListener('change',()=>{const d=this._config.devices[Number(cb.dataset.phoneShowDevice)]; if(!d) return; if(cb.checked) delete d.phone_hidden; else d.phone_hidden=true; this._emit(false); this._render();}));
      // live preview of the focus point while dragging a slider
      this.shadowRoot.querySelectorAll('input[data-key="phone_bg_focus_x"],input[data-key="phone_bg_focus_y"]').forEach(r=>r.addEventListener('input',()=>{const axis=r.dataset.key.endsWith('_x')?'x':'y'; const lab=this.shadowRoot.querySelector(`[data-focus-val="${axis}"]`); if(lab) lab.textContent=r.value+'%'; const bg=this.shadowRoot.querySelector('.layout-bg'); if(bg){ const fx=axis==='x'?r.value:(this._config.phone_bg_focus_x??50), fy=axis==='y'?r.value:(this._config.phone_bg_focus_y??50); bg.style.backgroundPosition=`${fx}% ${fy}%`; }}));
      this.shadowRoot.querySelectorAll('input[type="range"][data-key]').forEach(r=>{ const lab=this.shadowRoot.querySelector(`[data-range-val="${r.dataset.key}"]`); if(!lab) return;
        r.addEventListener('input',()=>{ lab.textContent=Number(r.value).toFixed(2).replace(/0$/,''); clearTimeout(this._rangeT); this._rangeT=setTimeout(()=>{ this._config[r.dataset.key]=parseFloat(r.value); this._emit(false); },150); }); });
      this.shadowRoot.querySelectorAll('[data-layout-mode]').forEach(b=>b.addEventListener('click',()=>{this._layoutMode=b.dataset.layoutMode;this._render();}));
      this._enlargeDialogPreview();
    }
    // Drag area shape on desktop: same as the card (uses the preview card's
    // measured shape for 'image' / 'screen').
    _editorRatio(){ const a=this._config?.card_aspect||'3:2'; if(CARD_RATIOS[a]) return CARD_RATIOS[a]; const r=this._previewInner?._ratio; return r?clampRatio(r):1.5; }
    _layoutEditorHTML(c){
      const phone=this._layoutMode==='phone';
      const seg=`<div class="seg"><button type="button" class="${phone?'':'on'}" data-layout-mode="desktop">🖥️ Desktop</button><button type="button" class="${phone?'on':''}" data-layout-mode="phone">📱 Phone</button></div>`;
      const hint=phone
        ? 'Phone layout: used when the card is narrower than the breakpoint. Drag boxes to arrange it; boxes you have not moved use an automatic arrangement. Your desktop layout is not affected.'
        : 'Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.';
      const settings=`<div class="row"><div class="field"><label>Phone layout</label><select data-key="phone_layout"><option value="auto" ${(c.phone_layout||'auto')==='auto'?'selected':''}>Auto (narrow screens)</option><option value="always" ${c.phone_layout==='always'?'selected':''}>Always</option><option value="never" ${c.phone_layout==='never'?'selected':''}>Never</option></select></div><div class="field"><label>Switch below (px)</label><input type="number" min="200" max="2000" step="10" data-key="phone_breakpoint" value="${esc(c.phone_breakpoint??600)}"></div></div>`;
      const panelList=[['header','Title','🔤',true],['weather','Weather','🌤️',true],['gridmix','Grid mix','🌍',c.grid_mix_enabled===true],['updated','Updated','🕒',c.updated_enabled===true],['bins','Bins','🗑️',c.bins_enabled===true],['stats','Daily Stats','📊',true]].filter(x=>x[3]);
      const specials=panelList.filter(([k])=>!(phone&&c['phone_hide_'+k]===true)&&!(k==='stats'&&statsDockFor(c,phone).mode==='docked')).map(([k,l,ic])=>this._layoutSpecial(k,l,ic)).join('');
      const actions=phone
        ? `<button class="btn secondary-btn" id="copy-desktop-layout">⧉ Copy desktop layout</button><button class="btn secondary-btn" id="reset-layout">↺ Reset phone layout</button>`
        : `<button class="btn secondary-btn" id="reset-layout">↺ Reset positions to automatic</button>`;
      const focus=phone?`<div class="row"><div class="field"><label>Background focus ↔ <span class="small" data-focus-val="x">${esc(c.phone_bg_focus_x??50)}%</span></label><input type="range" min="0" max="100" step="1" data-key="phone_bg_focus_x" value="${esc(c.phone_bg_focus_x??50)}"></div><div class="field"><label>Background focus ↕ <span class="small" data-focus-val="y">${esc(c.phone_bg_focus_y??50)}%</span></label><input type="range" min="0" max="100" step="1" data-key="phone_bg_focus_y" value="${esc(c.phone_bg_focus_y??50)}"></div></div>`:'';
      const cbx=(attr,checked,label)=>`<label class="show-item"><input type="checkbox" ${attr} ${checked?'checked':''}> ${label}</label>`;
      const showList=phone?`<div class="field full" style="margin-top:10px"><label>Show on phone</label><div class="show-list">${panelList.map(([k,l,ic])=>cbx(`data-phone-show-panel="${k}"`,c['phone_hide_'+k]!==true,`${ic} ${esc(l)}`)).join('')}${(c.devices||[]).map((d,i)=>cbx(`data-phone-show-device="${i}"`,d.phone_hidden!==true,`${esc(ICONS[d.type]||'⚙️')} ${esc(d.name||LABELS[d.type]||'Device')}`)).join('')}</div><span class="small" style="display:block">Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.</span></div>`:'';
      const manualHint=c.flow_style==='manual'?`<div class="hint">Manual lines: click a line to add a bend point, drag points to move them (they snap into line; hold Shift to place freely), double-click a point to remove it, double-click a line to make it straight again.</div>`:'';
      const resetLines=c.flow_style==='manual'?`<button class="btn secondary-btn" id="reset-lines">↺ Reset all lines</button>`:'';
      return `${seg}<div class="hint">${hint}</div>${manualHint}<div class="hint">Resize a device box by dragging its right or bottom edge or its corner; double-click the corner to reset its size. Text scales to fit.</div>${settings}${focus}<div class="layout-editor${phone?' phone':''}${c.flow_style==='manual'?' manual-lines':''}" id="layout-editor" style="${phone?'':`aspect-ratio:${this._editorRatio()};min-height:0`}"><div class="layout-bg" style="${phone?`background-position:${phoneBgFocus(c)}`:''}${c.background_fit==='contain'?';background-size:contain;background-repeat:no-repeat':''}"></div>${this._routeLayerHTML()}${(c.devices||[]).map((d,i)=>this._layoutNode(d,i)).join('')}${specials}${this._routePointsHTML()}</div><div class="layout-actions">${actions}${resetLines}</div>${showList}`;
    }
    // Current positions shown in the drag area (desktop or phone).
    _editorLayoutPositions(){
      const devices=this._config.devices||[];
      const desk=HomePowerFlowCard.prototype._desktopLayout.call(null,devices);
      if(this._layoutMode!=='phone') return desk;
      const auto=phoneAutoLayout(devices,desk).positions;
      return devices.map((d,i)=>validPos(d.phone_position)||auto[i]);
    }
    _editorPanelPos(kind){
      const c=this._config, def=PANEL_POS[kind];
      if(this._layoutMode!=='phone') return validPos(c[def.key])||{x:def.d[0],y:def.d[1]};
      const own=validPos(c[def.phone]); if(own) return own;
      if(kind==='stats'){ const devices=c.devices||[]; return {x:def.p[0],y:phoneAutoLayout(devices,HomePowerFlowCard.prototype._desktopLayout.call(null,devices)).statsY}; }
      return {x:def.p[0],y:def.p[1]};
    }
    // ---- Manual flow lines (editor) ----
    _routesKey(){ return this._layoutMode==='phone' ? 'phone_flow_routes' : 'flow_routes'; }
    // Connections shown in the layout being edited, as [key, fromPos, toPos].
    _editorEdges(){
      const c=this._config, devices=c.devices||[], pos=this._editorLayoutPositions(), seen=new Set(), out=[];
      let edges=[]; try { edges=HomePowerFlowCard.prototype._flowEdges.call({_config:c}, devices); } catch(e) {}
      for (const [a,b] of edges) {
        const key=`${devices[a]?.id}>${devices[b]?.id}`; if(seen.has(key)) continue; seen.add(key);
        if (devices[a]?.flow_lines===false||devices[b]?.flow_lines===false) continue;
        if (this._layoutMode==='phone'&&(devices[a]?.phone_hidden===true||devices[b]?.phone_hidden===true)) continue;
        if (pos[a]&&pos[b]) out.push([key,pos[a],pos[b]]);
      }
      return out;
    }
    _routePts(key){ const r=(this._config[this._routesKey()]||{})[key]; return Array.isArray(r)?r.map(validPos).filter(Boolean):[]; }
    _routeLayerHTML(){
      if(this._config.flow_style!=='manual') return '';
      const lines=this._editorEdges().map(([key,A,B])=>{ const pts=[A,...this._routePts(key),B].map(q=>`${q.x},${q.y}`).join(' ');
        return `<polyline class="route-line" points="${pts}"/><polyline class="route-hit" data-edge-key="${esc(key)}" points="${pts}"/>`; }).join('');
      return `<svg class="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>`;
    }
    _routePointsHTML(){
      if(this._config.flow_style!=='manual') return '';
      return this._editorEdges().map(([key])=>this._routePts(key).map((q,k)=>`<div class="route-pt" data-edge-key="${esc(key)}" data-pt-index="${k}" style="left:${q.x}%;top:${q.y}%"></div>`).join('')).join('');
    }
    _saveRoute(key,pts){ const rk=this._routesKey(); this._config[rk]={...(this._config[rk]||{})}; if(pts.length) this._config[rk][key]=pts.map(q=>({x:Number(q.x.toFixed(2)),y:Number(q.y.toFixed(2))})); else delete this._config[rk][key]; }
    _enableRouteEditing(){
      const area=this.shadowRoot.querySelector('#layout-editor'); if(!area||this._config.flow_style!=='manual') return;
      const pct=e=>{const r=area.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))};};
      const ends=key=>{const e=this._editorEdges().find(x=>x[0]===key);return e?[e[1],e[2]]:null;};
      // click a line: insert a bend point into the nearest segment
      area.querySelectorAll('.route-hit').forEach(hit=>{
        hit.addEventListener('click',e=>{ e.stopPropagation(); const key=hit.dataset.edgeKey, en=ends(key); if(!en) return; const P=pct(e), pts=this._routePts(key), chain=[en[0],...pts,en[1]];
          let best=0, bestD=Infinity;
          for(let i=0;i<chain.length-1;i++){ const A=chain[i],B=chain[i+1], dx=B.x-A.x, dy=B.y-A.y, L=dx*dx+dy*dy||1, t=Math.max(0,Math.min(1,((P.x-A.x)*dx+(P.y-A.y)*dy)/L)), qx=A.x+t*dx-P.x, qy=A.y+t*dy-P.y, dd=qx*qx+qy*qy; if(dd<bestD){bestD=dd;best=i;} }
          pts.splice(best,0,P); this._saveRoute(key,pts); this._emit(false); this._render(); });
        hit.addEventListener('dblclick',e=>{ e.stopPropagation(); this._saveRoute(hit.dataset.edgeKey,[]); this._emit(false); this._render(); });
      });
      // drag a point (snaps level/straight with its neighbours unless Shift is held)
      area.querySelectorAll('.route-pt').forEach(pt=>{
        const key=pt.dataset.edgeKey, k=Number(pt.dataset.ptIndex); let drag=null;
        const move=e=>{ if(!drag) return; const en=ends(key); if(!en) return; let P=pct(e);
          if(!e.shiftKey){ const chain=[en[0],...drag.pts,en[1]], prev=chain[k], next=chain[k+2], snap=1.5;
            for(const N of [prev,next]){ if(!N) continue; if(Math.abs(P.x-N.x)<snap) P.x=N.x; if(Math.abs(P.y-N.y)<snap) P.y=N.y; } }
          drag.pts[k]=P; pt.style.left=P.x+'%'; pt.style.top=P.y+'%';
          const pl=[en[0],...drag.pts,en[1]].map(q=>`${q.x},${q.y}`).join(' ');
          const hit=[...area.querySelectorAll('.route-hit')].find(h=>h.dataset.edgeKey===key); if(hit){ hit.setAttribute('points',pl); hit.previousElementSibling?.setAttribute('points',pl); } };
        const up=()=>{ if(!drag) return; const pts=drag.pts; drag=null; window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); this._saveRoute(key,pts); this._emit(false); };
        pt.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); drag={pts:this._routePts(key)}; pt.setPointerCapture?.(e.pointerId); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); });
        pt.addEventListener('dblclick',e=>{ e.stopPropagation(); const pts=this._routePts(key); pts.splice(k,1); this._saveRoute(key,pts); this._emit(false); this._render(); });
      });
      this.shadowRoot.querySelector('#reset-lines')?.addEventListener('click',()=>{ delete this._config[this._routesKey()]; this._emit(false); this._render(); });
    }
    // Stage size of the layout being edited (design px).
    _editorStage(){ return this._layoutMode==='phone' ? {w:800,h:1200} : {w:Math.round(800*this._editorRatio()),h:800}; }
    // Real size of a device box in the layout being edited: custom size, or
    // the size measured from the preview card, or the default estimate.
    _editorBoxSize(d,i){
      const phone=this._layoutMode==='phone', custom=boxSizeFor(d,phone);
      const ds=Number(this._config.device_scale); const scale=Number.isFinite(ds)&&ds>0?Math.max(0.5,Math.min(2,ds)):1;
      if(custom) return {w:custom.w*scale,h:custom.h*scale,custom:true};
      const n=this._previewInner?.shadowRoot?.querySelector(`.node[data-device-index="${i}"]`);
      if(n&&n.offsetWidth&&n.offsetHeight) return {w:n.offsetWidth*scale,h:n.offsetHeight*scale,custom:false};
      return {w:195*scale,h:100*scale,custom:false};
    }
    _layoutNode(d,i){ if(this._layoutMode==='phone'&&d.phone_hidden===true) return ''; const p=this._editorLayoutPositions()[i]; const st=this._editorStage(), bs=this._editorBoxSize(d,i);
      const wp=(bs.w/st.w*100).toFixed(2), hp=(bs.h/st.h*100).toFixed(2);
      return `<div class="layout-node device-handle${bs.custom?' custom-size':''}" data-layout-kind="device" data-layout-index="${i}" style="left:${p.x}%;top:${p.y}%;width:${wp}%;height:${hp}%;min-width:0;max-width:none"><div class="ln-top">${esc(ICONS[d.type] || '⚙️')} ${esc(d.name || LABELS[d.type] || 'Device')}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div><span class="rz rz-e" data-rz="e" title="Drag to resize, double-click to reset size"></span><span class="rz rz-s" data-rz="s" title="Drag to resize, double-click to reset size"></span><span class="rz rz-se" data-rz="se" title="Drag to resize, double-click to reset size"></span></div>`; }
    _layoutSpecial(kind,label,icon){ const p=this._editorPanelPos(kind); return `<div class="layout-node special" data-layout-kind="${kind}" style="left:${p.x}%;top:${p.y}%"><div class="ln-top">${icon} ${label}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div></div>`; }
    _autoPreviewPosition(d,i){ const zones={solar:[18,23],inverter:[56,39],battery:[58,65],gateway:[48,78],house:[28,82],grid:[82,84],generator:[18,62],water:[14,90],gas:[40,92],ev:[83,50],load:[76,67]}; const same=this._config.devices.filter(x=>(x.type||'load')===(d.type||'load')); const n=same.indexOf(d); const [cx,cy]=zones[d.type||'load']||[70,68]; const spacing=Math.min(15,70/Math.max(1,same.length)); let x=cx,y=cy;if(same.length>1)x=cx+(n-(same.length-1)/2)*spacing;if((d.type==='battery'&&same.length>3)){const col=n%3,row=Math.floor(n/3);x=48+col*12;y=64+row*12;}if(d.type==='solar'&&same.length>4){const col=n%4,row=Math.floor(n/4);x=33+col*12;y=22+row*11;}if(d.type==='ev'&&same.length>2){const col=n%2,row=Math.floor(n/2);x=78+col*10;y=45+row*13;}return{x,y}; }
    _enableLayoutDragging(){ const area=this.shadowRoot.querySelector('#layout-editor'); if(!area)return;
      area.querySelectorAll('.layout-node').forEach(node=>{
        let dragging=false, offX=0, offY=0;
        const pct=e=>{const r=area.getBoundingClientRect();return [((e.clientX-r.left)/r.width)*100,((e.clientY-r.top)/r.height)*100];};
        const move=e=>{ if(!dragging)return; let [x,y]=pct(e); x-=offX; y-=offY; const kind=node.dataset.layoutKind;
          if(kind==='header'){x=Math.max(0,Math.min(85,x));y=Math.max(0,Math.min(90,y));} else {x=Math.max(2,Math.min(98,x));y=Math.max(2,Math.min(98,y));}
          const phoneMode=this._layoutMode==='phone';
          if(kind==='device'){const i=Number(node.dataset.layoutIndex);this._config.devices[i][phoneMode?'phone_position':'position']={x,y};} else if(PANEL_POS[kind]) this._config[phoneMode?PANEL_POS[kind].phone:PANEL_POS[kind].key]={x,y};
          node.style.left=x+'%';node.style.top=y+'%';const pos=node.querySelector('.ln-pos');if(pos)pos.textContent=`${x.toFixed(1)}% × ${y.toFixed(1)}%`; };
        const up=()=>{ if(!dragging)return; dragging=false; node.classList.remove('dragging'); window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); this._emit(false); };
        node.addEventListener('pointerdown',e=>{ if(e.target.closest('.rz')) return; e.preventDefault(); dragging=true; node.classList.add('dragging');
          const [px,py]=pct(e); offX=px-parseFloat(node.style.left); offY=py-parseFloat(node.style.top); node.setPointerCapture?.(e.pointerId); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); });
      });
      // Resize grips (device boxes): right edge, bottom edge, corner.
      area.querySelectorAll('.device-handle .rz').forEach(grip=>{
        const node=grip.closest('.device-handle'), i=Number(node.dataset.layoutIndex), dir=grip.dataset.rz;
        let st=null;
        const move=e=>{ if(!st)return; const r=area.getBoundingClientRect();
          const dxp=(e.clientX-st.cx)/r.width*100, dyp=(e.clientY-st.cy)/r.height*100;
          const stage=this._editorStage(), sc=st.scale;
          let wp=st.wp+(dir!=='s'?dxp:0), hp=st.hp+(dir!=='e'?dyp:0);
          const minW=BOX_MIN_W*sc/stage.w*100, maxW=BOX_MAX_W*sc/stage.w*100, minH=BOX_MIN_H*sc/stage.h*100, maxH=BOX_MAX_H*sc/stage.h*100;
          wp=Math.max(minW,Math.min(maxW,wp)); hp=Math.max(minH,Math.min(maxH,hp));
          // keep the top-left corner where it was (box position is its centre)
          const x=st.left+wp/2, y=st.top+hp/2;
          node.style.width=wp+'%'; node.style.height=hp+'%'; node.style.left=x+'%'; node.style.top=y+'%';
          st.res={wp,hp,x,y}; };
        const up=()=>{ if(!st)return; const res=st.res, sc=st.scale; st=null; node.classList.remove('dragging'); window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
          if(!res) return; const stage=this._editorStage(), d=this._config.devices[i], ph=this._layoutMode==='phone';
          d[ph?'phone_box_w':'box_w']=Math.round(res.wp/100*stage.w/sc); d[ph?'phone_box_h':'box_h']=Math.round(res.hp/100*stage.h/sc);
          d[ph?'phone_position':'position']={x:Number(res.x.toFixed(2)),y:Number(res.y.toFixed(2))};
          this._emit(false); this._render(); };
        grip.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation();
          const wp=parseFloat(node.style.width), hp=parseFloat(node.style.height), x=parseFloat(node.style.left), y=parseFloat(node.style.top);
          const ds=Number(this._config.device_scale);
          st={cx:e.clientX,cy:e.clientY,wp,hp,left:x-wp/2,top:y-hp/2,scale:Number.isFinite(ds)&&ds>0?Math.max(0.5,Math.min(2,ds)):1,res:null};
          node.classList.add('dragging'); grip.setPointerCapture?.(e.pointerId); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); });
        grip.addEventListener('dblclick',e=>{ e.stopPropagation(); const d=this._config.devices[i], ph=this._layoutMode==='phone'; delete d[ph?'phone_box_w':'box_w']; delete d[ph?'phone_box_h':'box_h']; this._emit(false); this._render(); });
      });
    }

    // Shows, under each open device's Invert flow button, which way power is
    // flowing on its connections right now. Uses the card's own edge and
    // direction logic (same code the card animates with), so it always
    // matches the dots on the dashboard, including Invert flow and manual
    // connection overrides.
    _updateFlowLive(){
      const els=this.shadowRoot?.querySelectorAll('[data-flow-live]'); if(!els||!els.length) return;
      const devices=this._config.devices||[];
      if(!this._hass){ els.forEach(el=>{ el.textContent=''; }); return; }
      const logic=Object.create(HomePowerFlowCard.prototype);
      logic._config=this._config; logic._hass=this._hass;
      const values=devices.map(d=>devicePower(this._hass,d));
      let edges=[]; try { edges=logic._flowEdges(devices); } catch(e){ edges=[]; }
      const nm=d=>esc(d?.name||LABELS[d?.type]||'Device');
      els.forEach(el=>{
        const i=Number(el.dataset.flowLive);
        const mine=edges.filter(([a,b])=>a===i||b===i);
        if(!mine.length){ el.innerHTML=`<span class="fl-off">${esc(this._t('Not connected to anything'))}</span>`; return; }
        el.innerHTML=mine.map(([a,b,dir,child])=>{
          const info=logic._flowDirection(devices[a],devices[b],values[a],values[b],Number.isInteger(child)?devices[child]:null);
          if(!info.active) return `<div class="fl-off">◦ ${nm(devices[a])} – ${nm(devices[b])}: ${esc(this._t('idle'))}</div>`;
          let reverse=info.reverse; if(Number(dir)===1) reverse=false; if(Number(dir)===2) reverse=true;
          const from=reverse?devices[b]:devices[a], to=reverse?devices[a]:devices[b];
          const src=Number.isInteger(child)?devices[child]:null;
          const amount=logic._isUtility(src)?logic._utilityText(src):fmtPower(info.magnitude,this._config.power_unit);
          return `<div class="fl-on">▶ ${nm(from)} → ${nm(to)} · ${esc(amount)}</div>`;
        }).join('');
      });
    }
    _t(text,vars){ return tr(langOf(this._hass),text,vars); }
    // Translates the drawn editor: every text node and placeholder/title that
    // exactly matches a known English phrase (or a pattern with numbers) is
    // replaced. Unknown text - including your own names - stays as it is.
    _translateDom(){
      const lang=langOf(this._hass); if(lang==='en'||typeof document==='undefined'||!document.createTreeWalker) return;
      const dict=I18N[lang];
      const tw=document.createTreeWalker(this.shadowRoot, 4 /* NodeFilter.SHOW_TEXT */);
      let n;
      while((n=tw.nextNode())){
        if(n.parentNode?.nodeName==='STYLE') continue;
        const raw=n.nodeValue, t=raw.trim(); if(!t) continue;
        let r=dict[t];
        if(r===undefined){ for(const [re,f] of I18N_PATTERNS){ const m=t.match(re); if(m&&f[lang]){ r=f[lang](m); break; } } }
        if(r!==undefined) n.nodeValue=raw.replace(t,r);
      }
      this.shadowRoot.querySelectorAll('[placeholder],[title]').forEach(el=>{ for(const a of ['placeholder','title']){ const v=el.getAttribute(a); if(v&&dict[v]) el.setAttribute(a,dict[v]); } });
    }
    // Power entity field(s): Battery and Grid can switch between one signed
    // sensor and two separate positive sensors.
    _powerFields(d,i,entityField){
      if(!SPLIT_KEYS[d.type]) return entityField('power_entity',(d.type==='water'||d.type==='gas')?'Meter or flow entity':'Power entity','data-entity-label');
      const split=d.power_mode==='split';
      const bat=d.type==='battery';
      const hint=split?'Two sensors that both report positive values (e.g. Growatt). The card combines them into one value.'
        :(bat?'Positive = discharging, negative = charging. If yours is the other way round, use Flow direction.':'Positive = export, negative = import. If yours is the other way round, use Flow direction.');
      const sel=`<div class="field full"><label>Power sensors</label><select data-device="${i}" data-field="power_mode"><option value="single" ${split?'':'selected'}>One sensor (+ and −)</option><option value="split" ${split?'selected':''}>Separate sensors</option></select><span class="small" style="display:block">${hint}</span></div>`;
      if(!split) return sel+entityField('power_entity','Power entity','data-entity-label');
      const [pk,nk]=SPLIT_KEYS[d.type];
      return sel+entityField(nk,bat?'Charging power':'Import power','data-entity-label')+entityField(pk,bat?'Discharging power':'Export power','data-entity-label');
    }
    // ---- Configuration warnings ----
    // Plain-language problems per device: missing/unknown/unavailable
    // entities, a power sensor with a non-power unit, broken or looping
    // "Connects to" links, devices with no connection, incomplete battery
    // time remaining. Returns a Map: device index -> [messages].
    _allWarnings(){
      const c=this._config, devices=c.devices||[], states=this._hass?.states, out=new Map();
      let edges=[]; try { edges=HomePowerFlowCard.prototype._flowEdges.call({_config:c}, devices); } catch(e) {}
      const inEdge=new Set(); edges.forEach(([a,b])=>{ inEdge.add(a); inEdge.add(b); });
      const ids=new Set(devices.map(d=>d.id));
      const hub=t=>t==='inverter'||t==='gateway';
      devices.forEach((d,i)=>{
        const w=[], t=d.type||'load';
        const checkEntity=(e,isPower)=>{
          if(!e||!states) return;
          const st=states[e];
          if(!st){ w.push(this._t("{e} doesn't exist (renamed or removed?).",{e})); return; }
          if(st.state==='unavailable'||st.state==='unknown') w.push(this._t('{e} is currently unavailable.',{e}));
          const u=String(st.attributes?.unit_of_measurement||'').trim();
          if(isPower&&u&&!/^(w|kw|mw|gw)$/i.test(u)) w.push(this._t("{e} reports {u}, not watts. Pick a power sensor (W or kW); state of charge belongs in the battery's State of charge field.",{e,u}));
        };
        const utility=t==='water'||t==='gas';
        if(isSplit(d)){
          const [pk,nk]=SPLIT_KEYS[t];
          if(!d[pk]||!d[nk]) w.push(this._t('Separate sensors: pick both sensors.'));
          checkEntity(d[pk],true); checkEntity(d[nk],true);
        } else if(!hub(t)){
          if(!d.power_entity) w.push(this._t('No power sensor selected.'));
          else checkEntity(d.power_entity,!utility);
        } else if(d.power_entity) checkEntity(d.power_entity,true);
        if(d.connects_to&&!ids.has(d.connects_to)) w.push(this._t('Connects to a device that no longer exists, so Automatic is used.'));
        // loop: follow explicit links; coming back to this device = loop
        if(d.connects_to){
          const byId=new Map(devices.map(x=>[x.id,x])); let cur=byId.get(d.connects_to), seen=new Set([d.id]), names=[d.name||LABELS[t]];
          while(cur&&cur.connects_to&&!seen.has(cur.id)){ seen.add(cur.id); names.push(cur.name||LABELS[cur.type]); cur=byId.get(cur.connects_to); }
          if(cur&&cur.id===d.id) w.push(this._t('Connection loop: these devices connect to each other ({n}).',{n:names.join(' → ')}));
        }
        if(devices.length>1&&!inEdge.has(i)&&!hub(t)){
          if(utility&&!d.connects_to&&!devices.some(x=>x.type==='house')) w.push(this._t('Water and gas connect to a House device on Automatic: add a House device or set Connects to.'));
          else w.push(this._t('Not connected to anything: add an Inverter or Gateway, or set Connects to.'));
        }
        if(t==='battery'&&d.battery_time===true){
          const cap=parseFloat(d.battery_capacity);
          if(!d.battery_soc_entity||(!(cap>0)&&!d.battery_capacity_entity)) w.push(this._t('Time remaining needs a state of charge sensor and a capacity.'));
          checkEntity(d.battery_soc_entity,false); checkEntity(d.battery_capacity_entity,false);
        }
        (Array.isArray(d.extra_entities)?d.extra_entities:[]).forEach(x=>checkEntity(x?.entity,false));
        if(w.length) out.set(i,w);
      });
      return out;
    }
    _warnBadge(w){ return w&&w.length?`⚠ ${w.length}`:''; }
    _warnListHTML(w){ return (w||[]).map(x=>`<div class="warn">⚠ ${esc(x)}</div>`).join(''); }
    // Updates badges, lists and the Devices summary in place (no redraw, so
    // typing and open pickers are never interrupted).
    _refreshWarnings(){
      if(!this.shadowRoot) return;
      const all=this._allWarnings();
      this.shadowRoot.querySelectorAll('[data-warn-badge]').forEach(el=>{ const t=this._warnBadge(all.get(Number(el.dataset.warnBadge))); if(el.textContent!==t) el.textContent=t; });
      this.shadowRoot.querySelectorAll('[data-warn-list]').forEach(el=>{ const h=this._warnListHTML(all.get(Number(el.dataset.warnList))); if(el.innerHTML!==h) el.innerHTML=h; });
      const tw=this.shadowRoot.querySelector('[data-warn-tab]'); if(tw){ const t=all.size?'⚠ '+all.size:''; if(tw.textContent!==t) tw.textContent=t; }
      const sum=this.shadowRoot.querySelector('[data-warn-summary]');
      if(sum){ const t=all.size?'⚠ '+all.size:''; if(sum.textContent!==t) sum.textContent=t; sum.title=all.size?this._t('{n} device(s) need attention',{n:all.size}):''; }
    }
    _connectsToOptions(i){
      const cur = this._config.devices[i]?.connects_to;
      const opts=['<option value="">Automatic</option>'];
      this._config.devices.forEach((d,idx)=>{
        if (idx===i) return;
        opts.push(`<option value="${esc(d.id)}" ${cur===d.id?'selected':''}>${idx+1}. ${esc(d.name||LABELS[d.type]||'Device')}</option>`);
      });
      return opts.join('');
    }
    _device(d,i){
      const inverted=!!d.invert_flow;
      const entityField=(field,label,marker)=>`<div class="field full"><label>${label}</label><ha-entity-picker data-device-picker="${i}" data-field="${field}" allow-custom-entity></ha-entity-picker><div class="entity-id" ${marker}="${i}">${esc(d[field]||'Not selected')}</div></div>`;
      const extras=Array.isArray(d.extra_entities)?d.extra_entities:[];
      const expanded=this._isExtrasOpen(d.id,extras.length);
      const extrasBody = expanded ? `<div class="extras-editor">${extras.map((ex,ei)=>this._extraEntityField(i,ei,ex)).join('')}${extras.length<5?`<button class="btn secondary-btn" type="button" data-add-extra="${i}">＋ Add extra entity</button>`:'<div class="small">Maximum of 5 extra entities reached.</div>'}</div>` : '';
      const deviceOpen=this._isDeviceOpen(d.id);
      const connectsToField=`<div class="field full"><label>Connects to</label><select data-device="${i}" data-field="connects_to">${this._connectsToOptions(i)}</select><span class="small" style="display:block">Automatic = the (first) inverter, or a Gateway/Distribution Board device for extra inverters. Override this for multi-inverter or custom topologies.</span></div>`;
      const linesField = `<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="flow_lines" style="width:auto" ${d.flow_lines===false?'':'checked'}> Show flow lines</label><span class="small" style="display:block">Untick to hide this device's flow lines. Its box and values keep working.</span></div>`;
      const dirColourField = d.type==='battery'
        ? `<div class="field"><label>Flow colour by direction</label><select data-device="${i}" data-field="flow_color_mode"><option value="single" ${!d.flow_color_mode||d.flow_color_mode==='single'?'selected':''}>One colour</option><option value="glow" ${d.flow_color_mode==='glow'?'selected':''}>Glow colours (green charging, amber discharging)</option><option value="custom" ${d.flow_color_mode==='custom'?'selected':''}>Custom colours</option></select></div>${d.flow_color_mode==='custom'?`<div class="field"><label>Charging colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-device="${i}" data-field="flow_color_charge" value="${esc(/^#[0-9a-f]{6}$/i.test(String(d.flow_color_charge||''))?d.flow_color_charge:'#5aff7d')}"></div></div><div class="field"><label>Discharging colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-device="${i}" data-field="flow_color_discharge" value="${esc(/^#[0-9a-f]{6}$/i.test(String(d.flow_color_discharge||''))?d.flow_color_discharge:'#ff9628')}"></div></div>`:''}`
        : d.type==='grid'
        ? `<div class="field"><label>Flow colour by direction</label><select data-device="${i}" data-field="flow_color_mode"><option value="single" ${d.flow_color_mode!=='custom'?'selected':''}>One colour</option><option value="custom" ${d.flow_color_mode==='custom'?'selected':''}>Custom colours</option></select></div>${d.flow_color_mode==='custom'?`<div class="field"><label>Import colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-device="${i}" data-field="flow_color_import" value="${esc(/^#[0-9a-f]{6}$/i.test(String(d.flow_color_import||''))?d.flow_color_import:'#ff5c5c')}"></div></div><div class="field"><label>Export colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-device="${i}" data-field="flow_color_export" value="${esc(/^#[0-9a-f]{6}$/i.test(String(d.flow_color_export||''))?d.flow_color_export:'#66bb6a')}"></div></div>`:''}`
        : '';
      const histField = `<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="history_graph" style="width:auto" ${d.history_graph===true?'checked':''}> Show history graph</label><span class="small" style="display:block">Power history as a faint graph behind the box. Range and opacity are under Appearance.</span></div>`;
      const battTimeFields = d.type!=='battery' ? '' : `<div class="field full"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="battery_time" style="width:auto" ${d.battery_time===true?'checked':''}> Show time remaining</label><span class="small" style="display:block">Estimated time to full (charging) or to reserve (discharging), shown under the power value.</span></div>`+(d.battery_time!==true?'':`<div class="field full"><label>State of charge (%)</label><ha-entity-picker data-device-picker="${i}" data-field="battery_soc_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label>Capacity (kWh)</label><input type="number" min="0" step="0.1" data-device="${i}" data-field="battery_capacity" value="${esc(d.battery_capacity??'')}" placeholder="e.g. 13.5"></div><div class="field"><label>Reserve %</label><input type="number" min="0" max="99" step="1" data-device="${i}" data-field="battery_reserve" value="${esc(d.battery_reserve??0)}"></div><div class="field"><label>Charge limit %</label><input type="number" min="1" max="100" step="1" data-device="${i}" data-field="battery_charge_limit" value="${esc(d.battery_charge_limit??100)}"></div><div class="field full"><label>Capacity sensor (optional, overrides the number above)</label><ha-entity-picker data-device-picker="${i}" data-field="battery_capacity_entity" allow-custom-entity></ha-entity-picker></div>`);
      const utilityFields = d.type==='water' ? `<div class="field full"><span class="small">Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.</span></div>` : d.type==='gas' ? `<div class="field"><label>Show gas in</label><select data-device="${i}" data-field="utility_unit"><option value="m³" ${d.utility_unit!=='kWh'?'selected':''}>m³</option><option value="kWh" ${d.utility_unit==='kWh'?'selected':''}>kWh</option></select></div><div class="field"><label>Calorific value (MJ/m³)</label><input type="number" min="30" max="45" step="0.1" data-device="${i}" data-field="gas_cv" value="${esc(d.gas_cv??39.5)}"></div><div class="field full"><span class="small">Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.</span></div>` : '';
      const battGlowField = d.type==='battery' ? `<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="battery_glow" style="width:auto" ${d.battery_glow===false?'':'checked'}> Show charge/discharge glow</label><span class="small" style="display:block">Pulses the box when actively charging or discharging.</span></div>` : '';
      const body = deviceOpen ? `<div class="warn-list" data-warn-list="${i}">${this._warnListHTML(this._allWarnings().get(i))}</div><div class="row"><div class="field"><label>Type</label><select data-device="${i}" data-field="type">${TYPES.map(t=>`<option value="${t[0]}" ${d.type===t[0]?'selected':''}>${esc(t[1])}</option>`).join('')}</select></div><div class="field"><label>Name</label><input data-device="${i}" data-field="name" value="${esc(d.name||'')}"></div>${this._powerFields(d,i,entityField)}${connectsToField}<div class="field"><label>Flow colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" title="Choose flow colour" data-device="${i}" data-field="flow_color" value="${esc(d.flow_color || FLOW_COLORS[d.type] || FLOW_COLORS.neutral)}"><span class="color-preview" style="background:${esc(d.flow_color || FLOW_COLORS[d.type] || FLOW_COLORS.neutral)}"></span></div><span class="small" style="display:block">Only used if this device has its own power entity.</span></div><div class="field"><label>Flow direction</label><button class="btn ${inverted?'secondary-btn':''}" type="button" data-invert-flow="${i}">${inverted?'↔ Inverted':'↔ Normal'}<span class="small" style="display:block">Reverses the flow. For batteries and the grid it also swaps charging/discharging or import/export.</span></button><div class="flow-live" data-flow-live="${i}"></div></div>${dirColourField}${linesField}${histField}${battGlowField}${battTimeFields}${utilityFields}</div><button class="btn secondary-btn" type="button" data-toggle-extras="${esc(d.id)}">${expanded?'▾':'▸'} Extra entities${extras.length?` (${extras.length}/5)`:' (optional)'}</button>${extrasBody}${this._actFoldHTML('dev:'+i)}` : '';
      return `<div class="device sort-item" data-sort-index="${i}"><div class="device-head"><span class="drag-handle" data-sort-handle title="Drag to reorder"><ha-icon icon="mdi:drag-horizontal-variant"></ha-icon></span><span class="device-title" data-toggle-device="${esc(d.id)}">${deviceOpen?'▾':'▸'} ${esc(ICONS[d.type]||'⚙️')} ${esc(d.name||'Device')}${!deviceOpen && d.power_entity ? `<span class="device-sub">${esc(d.power_entity)}</span>`:''}</span><span class="dev-warn" data-warn-badge="${i}">${this._warnBadge(this._allWarnings().get(i))}</span><span class="device-actions"><button class="dup-btn" title="Duplicate device" data-duplicate="${i}"><ha-icon icon="mdi:content-copy"></ha-icon></button><button title="Remove" data-remove="${i}">×</button></span></div>${body}</div>`;
    }
    _extraEntityField(di,ei,ex){
      return `<div class="device" style="padding:10px"><div class="device-head"><span>🔎 Extra entity ${ei+1}</span><button title="Remove" data-remove-extra="${di}" data-extra-index="${ei}">×</button></div><div class="row"><div class="field full"><label>Entity</label><ha-entity-picker data-extra-picker data-device-index="${di}" data-extra-index="${ei}" allow-custom-entity></ha-entity-picker><div class="entity-id">${esc(ex?.entity||'Not selected')}</div></div><div class="field full"><label>Icon (Material Design Icons)</label><ha-icon-picker data-extra-icon data-device-index="${di}" data-extra-index="${ei}" value="${esc(ex?.icon||'')}"></ha-icon-picker></div></div></div>`;
    }
    _connectionsHTML(){
      const conns=this._config.connections||[];
      if(!conns.length) return '<div class="small" style="margin:8px 0">No custom connections — automatic topology is active.</div>';
      const opts=(selected)=>this._config.devices.map((d,i)=>`<option value="${esc(d.id)}" ${selected===d.id?'selected':''}>${i+1}. ${esc(d.name||LABELS[d.type]||'Device')}</option>`).join('');
      return conns.map((e,i)=>`<div class="device" style="padding:10px"><div class="row"><div class="field"><label>From</label><select data-conn="${i}" data-field="from">${opts(e.from)}</select></div><div class="field"><label>To</label><select data-conn="${i}" data-field="to">${opts(e.to)}</select></div><div class="field full"><label>Flow direction</label><select data-conn="${i}" data-field="direction"><option value="0" ${Number(e.direction||0)===0?'selected':''}>Auto — use live power signs</option><option value="1" ${Number(e.direction||0)===1?'selected':''}>From → To</option><option value="2" ${Number(e.direction||0)===2?'selected':''}>To → From</option></select></div></div><button class="btn" style="background:var(--error-color,#db4437);padding:7px 10px" data-conn-remove="${i}">Remove connection</button></div>`).join('');
    }

    _exportConfig(){
      const statusEl = this.shadowRoot.querySelector('[data-import-status]');
      try {
        const data = JSON.stringify(this._config, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const slug = String(this._config.title || 'home-power-flow-card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'home-power-flow-card';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}-config.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (statusEl) statusEl.textContent = this._t('Downloaded.');
      } catch (e) {
        console.error('Home Power Flow Card: export failed', e);
        if (statusEl) statusEl.textContent = this._t('Export failed - see the browser console for details.');
      }
    }
    async _importConfigFile(file){
      const statusEl = this.shadowRoot.querySelector('[data-import-status]');
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object');
        if (parsed.devices !== undefined && !Array.isArray(parsed.devices)) throw new Error('"devices" must be a list');
        parsed.type = parsed.type || 'custom:home-power-flow-card';
        // A fresh config means the old open/closed UI state (keyed by device
        // id) no longer applies to anything.
        this._devicesOpen.clear(); this._statsOpen.clear();
        this._extrasOpen.clear();
        this.setConfig(parsed);
        this._emit(false);
        if (statusEl) statusEl.textContent = this._t('Imported. Click Save below to keep it on this dashboard.');
      } catch (e) {
        console.error('Home Power Flow Card: import failed', e);
        if (statusEl) statusEl.textContent = this._t('Import failed - that file is not a valid Home Power Flow Card config.');
      }
    }
    _bgUploadField(slot,label){
      const key = slot==='day' ? 'background_upload_day' : 'background_upload_night';
      const urlKey = slot==='day' ? 'background' : 'background_night';
      const uploaded = this._config[key];
      const status = uploaded ? `Custom uploaded file: ${esc(uploaded.split('/').pop())}` : 'Using the default background';
      return `<label>${label}</label><div class="upload-row"><input type="file" accept="image/*" data-bg-file="${slot}" style="display:none"><button class="btn secondary-btn" type="button" data-bg-upload-btn="${slot}">📤 Upload image</button><button class="btn secondary-btn" type="button" data-bg-preview="${slot}">👁 Preview this background</button>${uploaded ? `<button class="btn secondary-btn" type="button" data-bg-restore="${slot}">↺ Restore default</button>` : ''}</div><div class="upload-status" data-bg-status="${slot}">${status}</div><input data-key="${urlKey}" placeholder="Or paste an image URL instead" value="${esc(this._config[urlKey]||'')}">`;
    }
    // ---- Weather & seasonal backgrounds: compact 3x2 picture grid ----
    _monthName(m){ try { return new Intl.DateTimeFormat(localeOf(this._hass),{month:'short'}).format(new Date(2000,m-1,1)); } catch(e) { return String(m); } }
    _seasonDatesText(c){
      const key=seasonKey(c);
      const r=seasonRange(c,new Date().getFullYear());
      const fmt=([m,d])=>`${d} ${this._monthName(m)}`;
      let txt=key==='easter'&&r?`${this._t('Palm Sunday to Easter Monday')} (${fmt(r[0])} – ${fmt(r[1])})`:r?`${fmt(r[0])} – ${fmt(r[1])}`:'';
      if(r&&seasonActive(c)) txt+=` · ${this._t('showing now')}`;
      return txt;
    }
    _bgTile(kind,time){
      const slot=`${kind}_${time}`, key=bgKeyFor(slot), val=this._config[key]||'';
      const fallback=time==='night'&&!val&&!!this._config[`background_${kind}_day`];
      const inner=val?'':fallback?`<span class="xbg-note">${esc(this._t('Uses day picture'))}</span>`:`<span class="xbg-plus">＋</span><span class="xbg-note">${esc(this._t('Upload'))}</span>`;
      return `<div class="xbg-cell"><input type="file" accept="image/*" data-bg-file="${slot}" hidden>`
        +`<button type="button" class="xbg-tile ${val?'has':fallback?'fallback':''}" data-bg-upload-btn="${slot}" data-bg-thumb="${val?slot:fallback?`${kind}_day`:''}" title="${esc(this._t('Tap to upload or replace the picture'))}">${inner}</button>`
        +`<div class="xbg-actions"><button type="button" class="xbg-act" data-bg-url-toggle="${slot}" title="${esc(this._t('Paste an image URL'))}">🔗</button>`
        +(val?`<button type="button" class="xbg-act" data-bg-preview="${slot}" title="${esc(this._t('Preview in the layout below'))}">👁</button><button type="button" class="xbg-act" data-bg-clear="${slot}" title="${esc(this._t('Remove'))}">✕</button>`:'')
        +`</div><input class="xbg-url" data-key="${key}" placeholder="${esc(this._t('Image URL'))}" value="${esc(val)}" ${this._bgUrlOpen?.has(slot)?'':'hidden'}>`
        +`<div class="xbg-status" data-bg-status="${slot}"></div></div>`;
    }
    // The section folds away (closed by default); each bin folds to one line.
    _binsEditorHTML(c){
      const on=c.bins_enabled===true, bins=Array.isArray(c.bins)?c.bins.slice(0,BIN_MAX):[];
      const secOpen=this._binsSecOpen===true;
      const sub=on?(bins.length===1?this._t('1 bin'):this._t('{n} bins',{n:bins.length})):this._t('off');
      let h=`<div class="hint" style="margin-top:4px">Shows which bins go out: all day before collection ("Tomorrow") and on collection day ("Today"). Give each bin its own calendar, or use match words when one calendar holds several bins. No calendar? Use a repeating schedule.</div><div class="row">${on?`<div class="field"><label>Show</label><select data-key="bins_mode"><option value="near" ${c.bins_mode!=='always'?'selected':''}>Day before and collection day</option><option value="always" ${c.bins_mode==='always'?'selected':''}>Always show the next collection</option></select></div>`:''}</div>`;
      const wrap=x=>x;
      if(!on) return wrap(h);
      this._binOpen ||= new Set();
      h+=bins.map((b,k)=>{
        const manual=b.source==='manual', col=binColor(b);
        // Folded: one line with the bin, its name and next collection date.
        if(!this._binOpen.has(k)) return `<div class="bin-ed folded" data-bin-toggle="${k}"><span class="bin-arrow">▸</span><span class="bin-ic">${binSVG(col,24)}</span><b class="bin-nm">${esc(b.name||this._t('Bin'))}</b><span class="bin-next" data-bin-next="${k}"></span></div>`;
        const weeks=[1,2,3,4,5,6,7,8].map(n=>`<option value="${n}" ${Number(b.every||1)===n?'selected':''}>${esc(n===1?this._t('Every week'):this._t('Every {n} weeks',{n}))}</option>`).join('');
        const src=manual
          ?`<div class="field"><label>A collection date</label><input type="date" data-bin-field="start" data-bin="${k}" value="${esc(b.start||'')}"></div><div class="field"><label>Repeats</label><select data-bin-field="every" data-bin="${k}">${weeks}</select></div><div class="field full"><label>Skip dates (optional)</label><input data-bin-field="skip" data-bin="${k}" placeholder="2026-12-25, 2027-01-01" value="${esc(b.skip||'')}"></div><div class="field full"><label>Extra dates (optional)</label><input data-bin-field="extra" data-bin="${k}" placeholder="2026-12-27" value="${esc(b.extra||'')}"></div>`
          :`<div class="field full"><label>Calendar</label><ha-entity-picker data-bin-cal="${k}" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Match words (optional)</label><input data-bin-field="match" data-bin="${k}" placeholder="Only if one calendar has several bins, e.g. recycling, blue" value="${esc(b.match||'')}"></div>`;
        return `<div class="bin-ed"><div class="bin-ed-head"><span class="bin-arrow" data-bin-toggle="${k}">▾</span><span class="bin-ic">${binSVG(col,26)}</span><input data-bin-field="name" data-bin="${k}" value="${esc(b.name||'')}" placeholder="Bin name"><input type="color" data-bin-field="color" data-bin="${k}" value="${esc(col)}"><button type="button" class="btn secondary-btn" data-bin-del="${k}" title="Remove">✕</button></div><div class="row"><div class="field"><label>Dates from</label><select data-bin-field="source" data-bin="${k}"><option value="calendar" ${!manual?'selected':''}>Calendar</option><option value="manual" ${manual?'selected':''}>Repeating schedule</option></select></div>${src}</div><div class="bin-next" data-bin-next="${k}"></div></div>`;
      }).join('');
      if(bins.length<BIN_MAX) h+=`<button class="btn" type="button" id="add-bin">＋ Add bin</button>`;
      return wrap(h);
    }
    // "Next: Thu 15 Oct" under each bin, so you can check the dates found.
    async _binsEditorPreview(){
      const bins=Array.isArray(this._config.bins)?this._config.bins.slice(0,BIN_MAX):[]; if(!bins.length) return;
      const cals=[...new Set(bins.filter(b=>b.source!=='manual'&&b.calendar).map(b=>b.calendar))].sort();
      const key=cals.join(',');
      if(cals.length&&(this._binPrevKey!==key||Date.now()-(this._binPrevAt||0)>5*60*1000)){ this._binPrevKey=key; this._binPrevAt=Date.now(); try{ this._binPrev=await binFetchEvents(this._hass,cals); }catch(e){ this._binPrev=new Map(); } }
      const today=ymdLocal(new Date()), tomorrow=ymdAdd(today,1);
      bins.forEach((b,k)=>{
        const el=this.shadowRoot.querySelector(`[data-bin-next="${k}"]`); if(!el) return;
        const d=binNextDate(b,this._binPrev,this._hass,today);
        let t;
        if(!d) t=b.source==='manual'?this._t('Set a collection date to see the next one.'):b.calendar?this._t('No collection found in the next 6 weeks.'):this._t('Choose a calendar.');
        else { const [y,m,dd]=d.split('-').map(Number); let ds=d; try{ ds=new Intl.DateTimeFormat(localeOf(this._hass),{weekday:'short',day:'numeric',month:'short'}).format(new Date(y,m-1,dd)); }catch(e){} t=`${this._t('Next collection')}: ${ds}${d===today?` (${this._t('Today')})`:d===tomorrow?` (${this._t('Tomorrow')})`:''}`; }
        el.textContent=t;
      });
    }
    // ---- Tap actions (editor) ----
    // Each target (a device, a Today row, a panel) gets ONE folded line:
    // "👆 Tap actions · <summary>". Opening it shows Tap / Hold / Double tap,
    // each using Home Assistant's own action picker when it's available.
    _actObj(path){ const [t,i]=path.split(':'); if(t==='dev') return this._config.devices?.[Number(i)]; if(t==='stat') return this._config.statistics?.entities?.[Number(i)]; return null; }
    _actGet(path,k){ const [t,i]=path.split(':'); if(t==='panel') return this._config[`${i}_${k}_action`]; return this._actObj(path)?.[k+'_action']; }
    _actSet(path,k,v){
      const [t,i]=path.split(':'), empty=!v||typeof v!=='object'||!v.action;
      if(t==='panel'){ const key=`${i}_${k}_action`; if(empty) delete this._config[key]; else this._config[key]=v; }
      else { const o=this._actObj(path); if(!o) return; if(empty) delete o[k+'_action']; else o[k+'_action']=v; }
      this._emit(false);
      const sum=this.shadowRoot.querySelector(`[data-act-sum="${path}"]`); if(sum) sum.textContent=this._actSummary(path);
    }
    _actLabel(a){
      const m={'more-info':'Details','navigate':'Go to page','toggle':'Toggle','perform-action':'Run action','call-service':'Run action','url':'Open link','none':'Nothing','assist':'Assist','fire-dom-event':'Custom'};
      return this._t(m[a?.action]||'Custom');
    }
    _actSummary(path){
      const L={tap:'Tap',hold:'Hold',double_tap:'Double tap'};
      const set=ACT_KINDS.filter(k=>this._actGet(path,k)?.action).map(k=>`${this._t(L[k])}: ${this._actLabel(this._actGet(path,k))}`);
      return set.length?set.join(' · '):this._t('Default');
    }
    _actFoldHTML(path,title){
      this._actOpen ||= new Set();
      const open=this._actOpen.has(path), L={tap:'Tap',hold:'Hold',double_tap:'Double tap'};
      return `<div class="act-fold${open?' open':''}"><div class="act-hd" data-act-toggle="${esc(path)}"><span class="act-ch">${open?'▾':'▸'}</span><span>👆</span><b>${esc(title||this._t('Tap actions'))}</b><span class="act-sum" data-act-sum="${esc(path)}">${esc(this._actSummary(path))}</span></div><div class="act-bd"${open?'':' hidden'}>${ACT_KINDS.map(k=>`<div class="act-row"><label>${esc(this._t(L[k]))}</label><div class="act-ed" data-act-ed="${esc(path)}|${k}"></div></div>`).join('')}</div></div>`;
    }
    _actPanelsHTML(c){
      const rows=[['weather','Weather box',true],['bins','Bin collection',c.bins_enabled===true],['updated','Last updated box',c.updated_enabled===true],['gridmix','UK grid mix',c.grid_mix_enabled===true]].filter(r=>r[2]);
      return `<div class="hint" style="margin-top:10px">What tapping, holding or double-tapping each panel does. Devices have their own tap actions in their settings (Devices tab), and so does each Today row.</div>${rows.map(([k,l])=>this._actFoldHTML('panel:'+k,this._t(l))).join('')}`;
    }
    // Fill each Tap / Hold / Double tap slot: Home Assistant's own action
    // picker if available, otherwise a simple built-in one.
    _actFillEditors(){
      const native=!!customElements.get('ha-selector');
      this.shadowRoot.querySelectorAll('[data-act-ed]').forEach(slot=>{
        if(slot.closest('[hidden]')||slot.firstChild) return;
        const [path,k]=slot.dataset.actEd.split('|');
        if(native){
          const el=document.createElement('ha-selector');
          el.hass=this._hass; el.selector={ui_action:{default_action:k==='tap'?'more-info':'none'}}; el.value=this._actGet(path,k); el.label='';
          el.addEventListener('value-changed',e=>{ e.stopPropagation(); this._actSet(path,k,e.detail.value); });
          slot.appendChild(el);
        } else this._actSimple(slot,path,k);
      });
    }
    _actSimple(slot,path,k){
      const a=this._actGet(path,k)||{}, type=a.action||'', t=x=>esc(this._t(x));
      const opts=[['','Default'],['none','Nothing'],['more-info','Details'],['navigate','Go to page'],['toggle','Toggle'],['perform-action','Run action'],['url','Open link']];
      const param={navigate:['navigation_path','/lovelace/battery'],url:['url_path','https://…'],'more-info':['entity','Entity (optional)'],toggle:['entity','Entity, e.g. switch.ev_charger'],'perform-action':['perform_action','Action, e.g. switch.turn_on']}[type==='call-service'?'perform-action':type];
      const target=type==='perform-action'||type==='call-service'?`<input data-actf="target" placeholder="${t('Target entity (optional)')}" value="${esc(a.target?.entity_id||a.data?.entity_id||'')}">`:'';
      const confirm=type==='toggle'||type==='perform-action'||type==='call-service'?`<label class="act-cf"><input type="checkbox" data-actf="confirm" ${a.confirmation?'checked':''}> ${t('Ask first')}</label>`:'';
      slot.innerHTML=`<div class="act-simple"><select data-actf="type">${opts.map(([v,l])=>`<option value="${v}" ${(type==='call-service'?'perform-action':type)===v?'selected':''}>${t(l)}</option>`).join('')}</select>${param?`<input data-actf="param" placeholder="${t(param[1])}" value="${esc(a[param[0]]||a.service||'')}">`:''}${target}${confirm}</div>`;
      const read=()=>{
        const ty=slot.querySelector('[data-actf="type"]').value; if(!ty) return null; if(ty==='none') return {action:'none'};
        const o={action:ty}, pv=slot.querySelector('[data-actf="param"]')?.value.trim()||'';
        const key={navigate:'navigation_path',url:'url_path','more-info':'entity',toggle:'entity','perform-action':'perform_action'}[ty]; if(key&&pv) o[key]=pv;
        const tg=slot.querySelector('[data-actf="target"]')?.value.trim(); if(tg) o.target={entity_id:tg};
        if(slot.querySelector('[data-actf="confirm"]')?.checked) o.confirmation=true;
        return o;
      };
      slot.querySelectorAll('[data-actf]').forEach(el=>el.addEventListener('change',()=>{ const v=read(); this._actSet(path,k,v); if(el.dataset.actf==='type') this._actSimple(slot,path,k); }));
    }
    // ---- Tabs and framed sections ----
    _tabsHTML(){
      const n=this._allWarnings().size;
      const tabs=[['look','🎨','Look'],['devices','🔌','Devices'],['panels','🧩','Panels'],['more','⚙️','More']];
      return `<div class="tabs">${tabs.map(([k,ic,l])=>`<button type="button" class="tab${this._tab===k?' on':''}" data-tab="${k}">${ic} <span>${esc(this._t(l))}</span>${k==='devices'?`<b class="tab-warn" data-warn-tab>${n?'⚠ '+n:''}</b>`:''}</button>`).join('')}</div>`;
    }
    _sec(id,icon,title,body,opt={}){
      const open=this._secOpen.has(id);
      const sw=opt.sw?`<label class="sw" title="${esc(this._t('On / off'))}"><input type="checkbox" data-key="${opt.sw}" ${this._config[opt.sw]===true?'checked':''}><span></span></label>`:'';
      return `<div class="sec${open?' open':''}" data-sec="${id}"><div class="sec-hd" data-sec-toggle="${id}"><span class="sec-ic">${icon}</span><span class="sec-tt">${esc(this._t(title))}</span>${opt.warn||''}<span class="sec-sum" data-sec-sum="${id}">${esc(this._secSummary(id))}</span>${sw}<span class="sec-ch">${open?'▾':'▸'}</span></div><div class="sec-bd"${open?'':' hidden'}>${body}</div></div>`;
    }
    // One-line summary on each section header, so you can see what's set
    // without opening it.
    _secSummary(id){
      const c=this._config, t=(x,v)=>this._t(x,v), on=k=>c[k]===true;
      const devs=c.devices||[];
      switch(id){
        case 'style': return t((VIEW_STYLES[c.view_style]||VIEW_STYLES.classic).label);
        case 'title': { const tt=c.title===undefined||c.title===null?t('Energy Flow'):String(c.title); return [tt.trim()||t('No title'),c.time_format==='12h'?t('12 hour'):t('24 hour')].join(' · '); }
        case 'bg': return [t('Day + night'),on('seasonal_background')?t('seasonal'):'',on('weather_effects')?t('rain & snow'):''].filter(Boolean).join(' · ');
        case 'appearance': { const th=c.theme||'dark'; const tl=th==='auto'?t('Auto'):th==='custom'?t('Custom colours'):t((THEMES[th]||THEMES.dark).label); return [tl,c.card_aspect==='image'?t('Match background image'):c.card_aspect==='screen'?t('Fill the screen'):(c.card_aspect||'3:2'),c.power_unit==='w'?'W':c.power_unit==='kw'?'kW':'W/kW'].join(' · '); }
        case 'flows': return [t((FLOW_LOOKS[c.flow_look_day]||FLOW_LOOKS.classic).label),c.flow_style==='orthogonal'?t('Right angles'):c.flow_style==='manual'?t('Manual'):t('Curved'),`${c.flow_speed??8} s`].join(' · ');
        case 'sizing': { const keys=['title_scale','device_scale','weather_scale','stats_scale','updated_scale','grid_mix_scale','bins_scale']; const changed=keys.some(k=>c[k]!==undefined&&Number(c[k])!==(k==='stats_scale'?0.8:1))||Number(c.max_width)>0; return changed?t('Custom'):t('Default'); }
        case 'devices': return devs.length===1?t('1 device'):t('{n} devices',{n:devs.length});
        case 'layout': return t('Desktop & phone');
        case 'connections': { const n=(c.connections||[]).length; return n?t('{n} connections',{n}):t('Automatic'); }
        case 'stats': { const n=(c.statistics?.entities||[]).length; return n===1?t('1 row'):t('{n} rows',{n}); }
        case 'selfsuff': { const n=['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].filter(on).length; return n?t('{n} of 4 on',{n}):t('off'); }
        case 'bins': { const n=(c.bins||[]).length; return on('bins_enabled')?(n===1?t('1 bin'):t('{n} bins',{n})):t('off'); }
        case 'updated': return on('updated_enabled')?(c.updated_entity||t('Choose an entity')):t('off');
        case 'gridmix': return on('grid_mix_enabled')?(String(c.grid_mix_postcode||'').trim().toUpperCase()||t('All of GB')):t('off');
        case 'actions': { const n=['weather','bins','updated','gridmix'].reduce((s,p)=>s+ACT_KINDS.filter(k=>c[`${p}_${k}_action`]?.action).length,0); return n?t('{n} set',{n}):t('Default'); }
        case 'backup': return t('Export / import');
        case 'about': return 'v'+VERSION;
      }
      return '';
    }
    _refreshSummaries(){
      this.shadowRoot?.querySelectorAll('[data-sec-sum]').forEach(el=>{ const v=this._secSummary(el.dataset.secSum); if(el.textContent!==v) el.textContent=v; });
    }
    _viewStyleHTML(c){
      const cur=VIEW_STYLES[c.view_style]?c.view_style:'classic';
      const cards=Object.entries(VIEW_STYLES).map(([k,v])=>`<button type="button" class="vs${k===cur?' on':''}" data-view-style="${k}" title="${esc(this._t(v.desc))}"><svg viewBox="0 0 96 60">${VIEW_THUMBS[k]||''}</svg><span>${v.icon} ${esc(this._t(v.label))}</span></button>`).join('');
      const note=cur==='classic'?'':`<div class="hint" style="margin:6px 0 0">Background pictures, box positions, box sizes and line shapes only apply to the Classic style. Devices, colours, theme, Today statistics and history graphs work in every style.</div>`;
      return `<div class="vs-grid">${cards}</div><div class="hint" style="margin:8px 0 0" data-vs-desc>${esc(this._t(VIEW_STYLES[cur].desc))}</div>${note}`;
    }
    _wxFxHTML(c){
      const on=c.weather_effects===true;
      let h=`<div class="field full xbg"><label class="tick"><input type="checkbox" data-key="weather_effects" ${on?'checked':''}> Animated rain &amp; snow</label><div class="hint" style="margin:4px 0 ${on?'6px':'0'}">Draws falling rain, snow, hail and lightning over your background whenever your weather entity reports them. Works with any background, no extra pictures needed. Wind from the weather entity tilts the rain.</div>`;
      if(!on) return h+`</div>`;
      const amt=Number(c.weather_effects_amount??1);
      h+=`<div class="xbg-season"><label>Amount</label><input type="range" min="0.25" max="2" step="0.05" data-key="weather_effects_amount" value="${esc(amt)}" style="flex:1;min-width:120px"><span data-range-val="weather_effects_amount" class="xbg-dates">${esc(String(amt))}</span></div>`;
      h+=`<label class="tick" style="font-weight:400"><input type="checkbox" data-key="weather_effects_lightning" ${c.weather_effects_lightning!==false?'checked':''}> Lightning flashes in thunderstorms</label>`;
      const btn=(cond,ic,lab)=>`<button type="button" class="xbg-act wxp${WX_FX_PREVIEW===cond?' on':''}" data-wx-preview="${cond}">${ic} ${esc(this._t(lab))}</button>`;
      h+=`<div class="xbg-season" style="margin-top:8px"><label>Try it on the card preview</label></div><div class="wxp-row">${btn('rainy','🌧️','Rain')}${btn('pouring','🌧️','Heavy rain')}${btn('lightning-rainy','⛈️','Storm')}${btn('snowy','❄️','Snow')}${btn('snowy-rainy','🌨️','Sleet')}${btn('hail','🧊','Hail')}${btn('','⏹','Stop')}</div><div class="hint" style="margin:4px 0 0">Preview only while the editor is open; the card then follows your real weather again.</div>`;
      if(!c.weather_entity) h+=`<div class="warn">⚠ ${esc(this._t('Animated rain and snow need a Weather entity (set above).'))}</div>`;
      return h+`</div>`;
    }
    _extraBgHTML(c){
      const on=seasonalOn(c);
      let h=`<div class="field full xbg"><label class="tick"><input type="checkbox" data-key="seasonal_background" ${on?'checked':''}> Seasonal background</label>`;
      if(!on) return h+`<div class="hint" style="margin:2px 0 0">A different picture for a time of year, such as Halloween or Christmas. It comes back by itself every year.</div></div>`;
      const sk=seasonKey(c), S=SEASONS[sk];
      const rows=[['season',S.icon,this._t(sk==='custom'?'Season':S.label)]];
      h+=`<div class="hint" style="margin:4px 0 6px">Tap a box to upload a picture. Leave Night empty to use the Day picture all the time. Animated rain and snow still show on top.</div>`;
      h+=`<div class="xbg-grid"><div></div><div class="xbg-col">☀️ <span>Day</span></div><div class="xbg-col">🌙 <span>Night</span></div>`
        +rows.map(([k,ic,lab])=>`<div class="xbg-label"><span class="xbg-ic">${ic}</span><span>${esc(lab)}</span></div>${this._bgTile(k,'day')}${this._bgTile(k,'night')}`).join('')+`</div>`;
      const opt=(k)=>`<option value="${k}" ${sk===k?'selected':''}>${SEASONS[k].icon} ${esc(this._t(SEASONS[k].label))}</option>`;
      h+=`<div class="xbg-season"><label>Season</label><select data-key="season">${Object.keys(SEASONS).map(opt).join('')}</select><span class="xbg-dates">${esc(this._seasonDatesText(c))}</span></div>`;
      if(sk==='custom'){
        const months=v=>Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(v)===i+1?'selected':''}>${esc(this._monthName(i+1))}</option>`).join('');
        const dd=(k,v)=>`<input type="number" min="1" max="31" step="1" data-key="${k}" value="${esc(v??'')}" class="xbg-day">`;
        h+=`<div class="xbg-season"><label>From</label>${dd('season_start_day',c.season_start_day??1)}<select data-key="season_start_month">${months(c.season_start_month??12)}</select><label>To</label>${dd('season_end_day',c.season_end_day??31)}<select data-key="season_end_month">${months(c.season_end_month??12)}</select></div>`;
      }
      return h+`</div>`;
    }
    // Picture address for any slot, with the same fallbacks the card uses.
    _slotBg(slot){
      const c=this._config;
      if(isExtraSlot(slot)){ const [kind,time]=slot.split('_'); return extraBgFor(c,kind,time==='night') || this._slotBg(time); }
      return slot==='night' ? (c.background_upload_night || c.background_night || DEFAULT_BG_NIGHT) : (c.background_upload_day || c.background || DEFAULT_BG);
    }
    // /media/ paths need the access token, so fetch them into blob URLs
    // (cached, so redraws don't download the picture again).
    async _bgDisplayUrl(path){
      if(!path) return '';
      if(!path.startsWith('/media/')) return path;
      this._bgBlobCache ||= new Map();
      if(this._bgBlobCache.has(path)) return this._bgBlobCache.get(path);
      const token=this._hass?.auth?.data?.access_token;
      const resp=await fetch(path,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const url=URL.createObjectURL(await resp.blob());
      this._bgBlobCache.set(path,url); return url;
    }
    _paintBgThumbs(){
      this.shadowRoot.querySelectorAll('[data-bg-thumb]').forEach(async el=>{
        const slot=el.dataset.bgThumb; if(!slot) return;
        try { const u=await this._bgDisplayUrl(this._config[bgKeyFor(slot)]); if(u) el.style.backgroundImage=`url('${u}')`; } catch(e) {}
      });
    }
    async _uploadBackground(file, slot){
      if (!file || !this._hass) return;
      const statusEl = this.shadowRoot.querySelector(`[data-bg-status="${slot}"]`);
      if (statusEl) statusEl.textContent = this._t('Uploading…');
      try {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g,'') || 'png';
        // A unique name for every upload: the old fixed name meant a new
        // picture had the same address as the previous one, so the card,
        // Home Assistant and the app kept showing the cached old picture.
        const filename = `home-power-flow-card-${slot}-${Date.now()}.${ext}`;
        const key = bgKeyFor(slot);
        const previous = this._config[key];
        const fd = new FormData();
        fd.append('media_content_id', 'media-source://media_source/local');
        fd.append('file', file, filename);
        const token = this._hass?.auth?.data?.access_token;
        const resp = await fetch('/api/media_source/local_source/upload', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const path = '/media/' + String(data.media_content_id).replace('media-source://media_source/', '');
        this._config[key] = path;
        this._emit(false);
        // Tidy up: remove this card's own previous upload for this slot.
        if (previous && previous !== path && /^\/media\/.*\/home-power-flow-card-(day|night|season_day|season_night)[^/]*$/.test(previous) && this._hass?.callWS) {
          this._hass.callWS({ type: 'media_source/local_source/remove', media_content_id: 'media-source://media_source/' + previous.replace(/^\/media\//, '') }).catch(() => {});
        }
        this._render();
        setTimeout(()=>this._applyLayoutBg(slot),200);
      } catch (e) {
        console.error('Home Power Flow Card: background upload failed', e);
        if (statusEl) statusEl.textContent = this._t('Upload failed - check that you are an admin user and try again.');
      }
    }
    // Mirrors the card's own _applyBackground: paths under /media/ need an
    // authenticated fetch, so the layout-editor preview background is loaded
    // the same way rather than embedded directly in CSS.
    async _applyLayoutBg(slot=null){
      const bgEl = this.shadowRoot.querySelector('.layout-bg');
      if (!bgEl) return;
      const bg = this._slotBg(slot || 'day');
      const grad = 'linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.25))';
      try {
        const url = await this._bgDisplayUrl(bg);
        if (url) bgEl.style.backgroundImage = `${grad},url('${url}')`;
      } catch (e) {
        console.error('Home Power Flow Card: failed to load uploaded background preview', e);
      }
    }
    _colorField(key,label){ const colors={...FLOW_COLORS,...(this._config.flow_colors||{})}; return `<div class="field color-field"><label>${label}</label><div class="color-row"><input type="color" data-flow-color="${key}" value="${esc(colors[key])}"><input type="text" data-flow-color-text="${key}" value="${esc(colors[key])}" maxlength="7" spellcheck="false"></div></div>`; }

    _statsEditorHTML(){
      const list=this._config.statistics?.entities || [];
      return list.map((r,i)=>{
        const open=this._statsOpen.get(i)===true;
        const icon=r.icon||'mdi:chart-line';
        const body=open?`<div class="row">
      <div class="field"><label>Name</label><input data-stat-field="name" data-index="${i}" value="${esc(r.name||'')}"></div>
      <div class="field full"><label>Material Design Icon</label><ha-icon-picker data-stat-icon data-index="${i}" value="${esc(icon)}"></ha-icon-picker></div>
      <div class="field"><label>Custom icon override</label><input data-stat-field="custom_icon" data-index="${i}" value="${esc(r.custom_icon||'')}"></div>
      <div class="field full"><label>Entity</label><ha-entity-picker data-stat-picker data-index="${i}" allow-custom-entity></ha-entity-picker></div>
      </div>${this._actFoldHTML('stat:'+i)}`:'';
        return `<div class="device sort-item" data-sort-index="${i}"><div class="device-head"><span class="drag-handle" data-sort-handle title="Drag to reorder"><ha-icon icon="mdi:drag-horizontal-variant"></ha-icon></span><span class="device-title" data-toggle-stat="${i}">${open?'▾':'▸'} <ha-icon icon="${esc(icon)}" style="--mdc-icon-size:18px"></ha-icon> ${esc(r.name||'Statistic '+(i+1))}${!open&&r.entity?`<span class="device-sub">${esc(r.entity)}</span>`:''}</span><button title="Remove" data-remove-stat="${i}">×</button></div>${body}</div>`;
      }).join('') || '<div class="small">No statistics added.</div>';
    }
    // Statistics have no ids, so their open/closed state is keyed by index
    // and explicitly remapped whenever rows are moved or removed.
    _remapStatsOpen(fn){
      const next=new Map();
      this._statsOpen.forEach((v,k)=>{ const n=fn(k); if(n!==null&&n!==undefined) next.set(n,v); });
      this._statsOpen=next;
    }
    // Pointer-based reordering from a drag handle: works with mouse and
    // touch, and only starts from the handle so inputs stay usable. The item
    // moves live in the list while dragging; the array is updated on release.
    _enableSortable(listSel, onMove){
      const list=this.shadowRoot.querySelector(listSel); if(!list) return;
      list.querySelectorAll(':scope > .sort-item [data-sort-handle]').forEach(h=>{
        h.addEventListener('pointerdown',e=>{
          const item=h.closest('.sort-item'); if(!item||item.parentElement!==list) return;
          e.preventDefault(); e.stopPropagation();
          const from=Number(item.dataset.sortIndex);
          item.classList.add('sorting');
          h.setPointerCapture?.(e.pointerId);
          const move=ev=>{
            const others=[...list.querySelectorAll(':scope > .sort-item')].filter(x=>x!==item);
            let before=null;
            for(const o of others){ const r=o.getBoundingClientRect(); if(ev.clientY<r.top+r.height/2){ before=o; break; } }
            if(before){ if(item.nextElementSibling!==before) list.insertBefore(item,before); }
            else { const last=others[others.length-1]; if(last&&last.nextElementSibling!==item) last.after(item); }
          };
          // Listen on the window, not the handle: moving the row in the page
          // makes the browser drop pointer capture, so the handle often never
          // saw the release and the new order was never saved.
          let done=false;
          const up=()=>{
            if(done) return; done=true;
            window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); window.removeEventListener('pointercancel',up);
            item.classList.remove('sorting');
            const to=[...list.querySelectorAll(':scope > .sort-item')].indexOf(item);
            if(to>=0&&to!==from) onMove(from,to); else this._render();
          };
          window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); window.addEventListener('pointercancel',up);
        });
      });
    }
    _statField(key,label){const s=this._config.statistics||{};return `<div class="field"><label>${label}</label><ha-entity-picker data-stat="${key}" allow-custom-entity></ha-entity-picker></div>`;}
    _emit(syncStats=true){
      this._config.statistics ||= {};
      if(syncStats) this.shadowRoot.querySelectorAll('[data-stat]').forEach(el=>this._config.statistics[el.dataset.stat]=el.value);
      // Emit the config without rebuilding this editor. Home Assistant may call
      // setConfig afterwards; setConfig now ignores identical configs.
      const sent=JSON.stringify(this._config);
      (this._sent ||= []).push({s:sent,t:Date.now()}); if(this._sent.length>20) this._sent.shift();
      fire(this,'config-changed',{config:JSON.parse(sent)});
      try { this._refreshWarnings(); } catch(e) {}
      try { this._refreshSummaries(); } catch(e) {}
      // Home Assistant swaps in a fresh preview card after a change: size it
      // straight away instead of waiting for the next update (no flash/jump).
      if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>this._enlargeDialogPreview());
      clearTimeout(this._previewT); this._previewT=setTimeout(()=>this._enlargeDialogPreview(),150);
    }
  }

  if(!customElements.get('home-power-flow-card')) customElements.define('home-power-flow-card',HomePowerFlowCard);
  if(!customElements.get('home-power-flow-card-editor')) customElements.define('home-power-flow-card-editor',HomePowerFlowEditor);
  window.customCards = window.customCards || [];
  if(!window.customCards.some(c=>c.type==='home-power-flow-card')) window.customCards.push({type:'home-power-flow-card',name:'Home Power Flow Card',description:'Configurable visual home energy flow card',preview:true,documentationURL:'https://github.com/mimikm/Home-Power-Flow-Card'});
  console.info(`%c Home Power Flow Card %c v${VERSION} `,'background:#173a55;color:#fff;padding:4px 8px','background:#62ff7b;color:#07130a;padding:4px 8px');
})();
