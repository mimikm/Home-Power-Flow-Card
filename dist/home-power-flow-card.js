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
  const VERSION = '0.7.9';
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
  const validPos = p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null;

  // ---- Translations ------------------------------------------------------
  // Card and editor follow the Home Assistant user's language (Polish and
  // Spanish so far); anything without a translation stays in English.
  // Keys are the English phrases; {x} placeholders are filled in by tr().
  const I18N = { pl: {"Today": "Dzisiaj", "Energy Flow": "Przepływ energii", "Self-sufficiency now": "Samowystarczalność teraz", "Self-sufficiency today": "Samowystarczalność dziś", "Self-consumption now": "Autokonsumpcja teraz", "Self-consumption today": "Autokonsumpcja dziś", "Updated": "Aktualizacja", "just now": "przed chwilą", "{n}s ago": "{n} s temu", "{m}m {s}s ago": "{m} min {s} s temu", "{h}h {m}m ago": "{h} godz. {m} min temu", "{d}d {h}h ago": "{d} dn. {h} godz. temu", "No data": "Brak danych", "Unknown": "Nieznane", "to full": "do pełna", "to empty": "do 0%", "to {p}%": "do {p}%", "at reserve": "na rezerwie", "at {p}%": "osiągnięto {p}%", "Grid": "Sieć", "Great Britain": "Wielka Brytania", "Loading grid data…": "Ładowanie danych sieci…", "Grid data unavailable": "Dane sieci niedostępne", "Showing last data (update failed)": "Ostatnie dane (aktualizacja nieudana)", "Wind": "Wiatr", "Solar": "Słońce", "Nuclear": "Jądrowa", "Hydro": "Wodna", "Biomass": "Biomasa", "Gas": "Gaz", "Coal": "Węgiel", "Imports": "Import", "Other": "Inne", "Very low": "Bardzo niska", "Low": "Niska", "Moderate": "Umiarkowana", "High": "Wysoka", "Very high": "Bardzo wysoka", "Add your first device": "Dodaj pierwsze urządzenie", "Open the card editor and add Solar, Inverter, Battery, Grid or House.": "Otwórz edytor karty i dodaj fotowoltaikę, falownik, baterię, sieć lub dom.", "☀️ Solar PV": "☀️ Fotowoltaika", "⚡ Inverter": "⚡ Falownik", "🔋 Battery": "🔋 Bateria", "🧠 Gateway": "🧠 Bramka", "🏠 House": "🏠 Dom", "⚡ Grid": "⚡ Sieć", "⛽ Generator": "⛽ Agregat", "💧 Water": "💧 Woda", "🔥 Gas": "🔥 Gaz", "🚗 EV Charger": "🚗 Ładowarka EV", "⚙️ Extra Load": "⚙️ Dodatkowe obciążenie", "Home Power Flow": "Home Power Flow", "Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.": "Dwukierunkowy przepływ energii na podstawie bieżących wartości dodatnich/ujemnych, kropkowane połączenia, poruszająca się kropka, odwracalny kierunek urządzeń, dynamiczne kolory przepływu i układ z przeciąganiem. Pełne identyfikatory encji są widoczne pod każdym polem wyboru.", "Backup": "Kopia zapasowa", "Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.": "Pobierz całą konfigurację karty jako plik albo przywróć wcześniej zapisaną. Import zastępuje wszystkie ustawienia poniżej (urządzenia, połączenia, układ, statystyki) - zmiany trafią na pulpit dopiero po kliknięciu Zapisz.", "⬇ Export config": "⬇ Eksportuj konfigurację", "⬆ Import config": "⬆ Importuj konfigurację", "Downloaded.": "Pobrano.", "Export failed - see the browser console for details.": "Eksport nieudany - szczegóły w konsoli przeglądarki.", "Import failed - that file is not a valid Home Power Flow Card config.": "Import nieudany - ten plik nie jest prawidłową konfiguracją Home Power Flow Card.", "Imported. Click Save below to keep it on this dashboard.": "Zaimportowano. Kliknij Zapisz poniżej, aby zachować na tym pulpicie.", "Title": "Tytuł", "Subtitle": "Podtytuł", "Title colour": "Kolor tytułu", "Time format": "Format czasu", "24 hour": "24-godzinny", "12 hour": "12-godzinny", "Weather entity": "Encja pogody", "Day background": "Tło dzienne", "Night background": "Tło nocne", "📤 Upload image": "📤 Prześlij obraz", "👁 Preview this background": "👁 Podgląd tła", "Restore default": "Przywróć domyślne", "Using the default background": "Używane jest domyślne tło", "Uploading…": "Przesyłanie…", "Upload failed - check that you are an admin user and try again.": "Przesyłanie nieudane - sprawdź, czy masz uprawnienia administratora i spróbuj ponownie.", "Sun entity (switches day/night background)": "Encja słońca (przełącza tło dzień/noc)", "Flow threshold (W)": "Próg przepływu (W)", "Flow animation speed (seconds)": "Szybkość animacji przepływu (sekundy)", "Particle stagger (seconds)": "Odstęp cząsteczek (sekundy)", "Not selected": "Nie wybrano", "Last updated box": "Ramka ostatniej aktualizacji", "Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.": "Opcjonalna mała ramka pokazująca, jak dawno zaktualizowano encję, np. dane falownika. Używa własnego znacznika czasu encji, jeśli go ma. Zmienia kolor na pomarańczowy, gdy dane są starsze niż czas ostrzeżenia.", "Show last updated box": "Pokaż ramkę ostatniej aktualizacji", "Label": "Etykieta", "Warn after (minutes)": "Ostrzeż po (minutach)", "Entity": "Encja", "UK grid mix": "Miks energetyczny UK", "Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.": "Opcjonalna ramka pokazująca, jak „zielona” jest teraz brytyjska sieć (emisyjność i miks wytwarzania), z API Carbon Intensity operatora National Grid ESO. Aktualizacja co 30 minut.", "Show grid mix box": "Pokaż ramkę miksu energetycznego", "Postcode (optional)": "Kod pocztowy (opcjonalnie)", "Appearance": "Wygląd", "Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.": "Motyw kolorystyczny ramek i paneli. Tło, kolory przepływu i kolor tytułu ustawia się osobno.", "Theme": "Motyw", "Auto (follow Home Assistant)": "Auto (jak w Home Assistant)", "Dark": "Ciemny", "Light": "Jasny", "Midnight": "Północ", "Ocean": "Ocean", "Forest": "Las", "Sunset": "Zachód słońca", "Graphite": "Grafit", "Custom colours": "Własne kolory", "Panel colour": "Kolor paneli", "Text colour": "Kolor tekstu", "Panel opacity": "Krycie paneli", "Flow line style": "Styl linii przepływu", "Curved": "Zaokrąglone", "Right angles (avoid boxes)": "Kąty proste (omijają ramki)", "Power units": "Jednostki mocy", "Auto (W, kW from 1000 W)": "Auto (W, kW od 1000 W)", "Always W": "Zawsze W", "Always kW": "Zawsze kW", "History hours": "Zakres historii", "History opacity": "Krycie historii", "6 h": "6 godz.", "12 h": "12 godz.", "24 h": "24 godz.", "48 h": "48 godz.", "Sizing": "Rozmiary", "1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.": "1 = rozmiar domyślny. Skala małego ekranu powiększa ramki na telefonach (stopniowo poniżej 900 px szerokości). Maks. szerokość 0 = cała dostępna szerokość; karta nigdy nie jest wyższa niż ekran. Panel Dzisiaj zmniejsza się automatycznie, jeśli byłby wyższy niż karta.", "Device boxes": "Ramki urządzeń", "Weather box": "Ramka pogody", "Today panel": "Panel Dzisiaj", "Small screen": "Mały ekran", "Max width (px)": "Maks. szerokość (px)", "Grid mix": "Miks energetyczny", "Updated box": "Ramka aktualizacji", "Visual layout": "Układ wizualny", "🖥️ Desktop": "🖥️ Komputer", "📱 Phone": "📱 Telefon", "Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.": "Przeciągaj ramki urządzeń na szablonie, aby ustawić je dokładnie tam, gdzie chcesz. Pozycje zapisują się automatycznie. Nowe urządzenia bez zapisanej pozycji używają układu automatycznego.", "Phone layout: used when the card is narrower than the breakpoint. Drag boxes to arrange it; boxes you have not moved use an automatic arrangement. Your desktop layout is not affected.": "Układ telefonu: używany, gdy karta jest węższa niż próg. Przeciągaj ramki, aby go ułożyć; nieprzesunięte ramki układają się automatycznie. Układ komputerowy pozostaje bez zmian.", "Phone layout": "Układ telefonu", "Auto (narrow screens)": "Auto (wąskie ekrany)", "Always": "Zawsze", "Never": "Nigdy", "Switch below (px)": "Przełącz poniżej (px)", "Background focus ↔": "Punkt skupienia tła ↔", "Background focus ↕": "Punkt skupienia tła ↕", "↺ Reset positions to automatic": "↺ Przywróć automatyczne pozycje", "⧉ Copy desktop layout": "⧉ Kopiuj układ komputerowy", "↺ Reset phone layout": "↺ Resetuj układ telefonu", "Show on phone": "Pokaż na telefonie", "Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.": "Odznaczone elementy są ukryte tylko w układzie telefonu. Ukrycie urządzenia ukrywa też jego linie przepływu.", "🔤 Title": "🔤 Tytuł", "🌤️ Weather": "🌤️ Pogoda", "🌍 Grid mix": "🌍 Miks energetyczny", "🕒 Updated": "🕒 Aktualizacja", "📊 Daily Stats": "📊 Statystyki dnia", "Devices": "Urządzenia", "＋ Add device": "＋ Dodaj urządzenie", "Type": "Typ", "Name": "Nazwa", "Power entity": "Encja mocy", "Meter or flow entity": "Encja licznika lub przepływu", "Connects to": "Połączone z", "Automatic": "Automatycznie", "Automatic = the (first) inverter, or a Gateway/Distribution Board device for extra inverters. Override this for multi-inverter or custom topologies.": "Automatycznie = (pierwszy) falownik albo bramka/rozdzielnica dla kolejnych falowników. Zmień to dla wielu falowników lub własnych topologii.", "Flow colour": "Kolor przepływu", "Only used if this device has its own power entity.": "Używany tylko, gdy urządzenie ma własną encję mocy.", "Flow direction": "Kierunek przepływu", "↔ Normal": "↔ Normalny", "↔ Inverted": "↔ Odwrócony", "Visual direction only": "Tylko kierunek wizualny", "Show history graph": "Pokaż wykres historii", "Power history as a faint graph behind the box. Range and opacity are under Appearance.": "Historia mocy jako delikatny wykres w tle ramki. Zakres i krycie ustawisz w sekcji Wygląd.", "Show charge/discharge glow": "Pokaż poświatę ładowania/rozładowania", "Pulses the box when actively charging or discharging.": "Ramka pulsuje podczas ładowania lub rozładowania.", "Show time remaining": "Pokaż pozostały czas", "Estimated time to full (charging) or to reserve (discharging), shown under the power value.": "Szacowany czas do pełna (ładowanie) lub do rezerwy (rozładowanie), wyświetlany pod wartością mocy.", "State of charge (%)": "Stan naładowania (%)", "Capacity (kWh)": "Pojemność (kWh)", "Reserve %": "Rezerwa %", "Charge limit %": "Limit ładowania %", "Capacity sensor (optional, overrides the number above)": "Czujnik pojemności (opcjonalnie, zastępuje liczbę powyżej)", "Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.": "Wyświetlane w litrach. Czujniki w m³ są przeliczane automatycznie. W trybie automatycznym woda łączy się z urządzeniem Dom.", "Show gas in": "Pokaż gaz w", "Calorific value (MJ/m³)": "Wartość opałowa (MJ/m³)", "Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.": "Służy do przeliczania m³ i kWh (zob. rachunek za gaz). W trybie automatycznym gaz łączy się z urządzeniem Dom.", "＋ Add extra entity": "＋ Dodaj dodatkową encję", "Maximum of 5 extra entities reached.": "Osiągnięto maksimum 5 dodatkowych encji.", "Icon (Material Design Icons)": "Ikona (Material Design Icons)", "Connections": "Połączenia", "Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.": "Opcjonalne. Zostaw puste, aby użyć topologii automatycznej. Dodaj połączenia, aby w pełni kontrolować, dokąd płynie energia.", "From": "Od", "To": "Do", "From → To": "Od → Do", "To → From": "Do → Od", "Auto — use live power signs": "Auto — według znaku bieżącej mocy", "Remove connection": "Usuń połączenie", "＋ Add connection": "＋ Dodaj połączenie", "Today statistics": "Statystyki dnia", "Add up to 20 custom statistics. Choose your own name, entity and icon.": "Dodaj do 20 własnych statystyk. Wybierz nazwę, encję i ikonę.", "Material Design Icon": "Ikona Material Design", "Custom icon override": "Własna ikona (zastępuje)", "＋ Add statistic": "＋ Dodaj statystykę", "No statistics added.": "Nie dodano statystyk.", "Statistic": "Statystyka", "Self-sufficiency": "Samowystarczalność", "Self-consumption": "Autokonsumpcja", ": share of your home's electricity that didn't come from the grid.": ": udział energii w domu, która nie pochodziła z sieci.", ": share of your solar you used yourself instead of exporting. Shown at the top of the Today panel.": ": udział energii słonecznej zużytej na miejscu zamiast oddanej do sieci. Wyświetlane na górze panelu Dzisiaj.", "Now": "Teraz", "is calculated automatically from your devices;": "jest obliczane automatycznie z twoich urządzeń;", "today": "dziś", "uses the daily energy sensors below.": "korzysta z dziennych czujników energii poniżej.", "Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.": "Dzienne czujniki energii (kWh lub Wh). Samowystarczalność dziś wymaga poboru i zużycia; autokonsumpcja dziś wymaga produkcji PV i oddania.", "Grid import today": "Pobór z sieci dziś", "Grid export today": "Oddanie do sieci dziś", "Solar production today": "Produkcja PV dziś", "Home consumption today": "Zużycie domu dziś", "Calculate consumption instead (import + solar − export + battery discharge − battery charge)": "Oblicz zużycie zamiast tego (pobór + PV − oddanie + rozładowanie baterii − ładowanie baterii)", "Battery charge today (optional, for calculated consumption)": "Ładowanie baterii dziś (opcjonalnie, do obliczania zużycia)", "Battery discharge today (optional, for calculated consumption)": "Rozładowanie baterii dziś (opcjonalnie, do obliczania zużycia)", "off": "wyłączone", "Choose flow colour": "Wybierz kolor przepływu", "Drag to reorder": "Przeciągnij, aby zmienić kolejność", "Duplicate device": "Duplikuj urządzenie", "Leave empty for no title": "Zostaw puste, aby nie było tytułu", "Leave empty for none": "Zostaw puste, aby nie było etykiety", "Optional": "Opcjonalnie", "Or paste an image URL instead": "Albo wklej adres URL obrazu", "Remove": "Usuń", "e.g. 13.5": "np. 13,5", "e.g. SW1A, blank = all of GB": "np. SW1A, puste = cała Wielka Brytania", "Not connected to anything": "Brak połączeń", "idle": "bezczynne", "Today panel style": "Styl panelu Dzisiaj", "Floating (drag anywhere)": "Pływający (przeciągnij w dowolne miejsce)", "Docked to card edge": "Przypięty do krawędzi karty", "Dock edge": "Krawędź", "Bottom": "Dół", "Top": "Góra", "Left": "Lewo", "Right": "Prawo", "Auto-hide (slides out on hover or tap)": "Autoukrywanie (wysuwa się po najechaniu lub dotknięciu)", "On phone": "Na telefonie", "Same as desktop": "Tak jak na komputerze", "Floating": "Pływający", "Docked": "Przypięty", "Phone dock edge": "Krawędź na telefonie", "Phone auto-hide": "Autoukrywanie na telefonie", "Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.": "Przypięty panel znajduje się przy krawędzi karty i nie da się go przeciągać. Autoukrywanie zwija panel do zakładki, która wysuwa się po najechaniu lub dotknięciu.", "Box opacity": "Krycie ramek", "Card shape": "Kształt karty", "3:2 (default)": "3:2 (domyślny)", "21:9 (ultra-wide)": "21:9 (ultraszeroki)", "32:9 (super ultra-wide)": "32:9 (superszeroki)", "Match background image": "Dopasuj do obrazu tła", "Fill the screen": "Wypełnij ekran", "Background fit": "Dopasowanie tła", "Fill (crop to card)": "Wypełnij (przytnij do karty)", "Fit whole image (blurred edges)": "Pokaż cały obraz (rozmyte krawędzie)"}, es: {"Today": "Hoy", "Energy Flow": "Flujo de energía", "Self-sufficiency now": "Autosuficiencia ahora", "Self-sufficiency today": "Autosuficiencia hoy", "Self-consumption now": "Autoconsumo ahora", "Self-consumption today": "Autoconsumo hoy", "Updated": "Actualizado", "just now": "ahora mismo", "{n}s ago": "hace {n} s", "{m}m {s}s ago": "hace {m} min {s} s", "{h}h {m}m ago": "hace {h} h {m} min", "{d}d {h}h ago": "hace {d} d {h} h", "No data": "Sin datos", "Unknown": "Desconocido", "to full": "hasta el 100%", "to empty": "hasta el 0%", "to {p}%": "hasta el {p}%", "at reserve": "en reserva", "at {p}%": "al {p}%", "Grid": "Red", "Great Britain": "Gran Bretaña", "Loading grid data…": "Cargando datos de la red…", "Grid data unavailable": "Datos de la red no disponibles", "Showing last data (update failed)": "Últimos datos (falló la actualización)", "Wind": "Eólica", "Solar": "Solar", "Nuclear": "Nuclear", "Hydro": "Hidráulica", "Biomass": "Biomasa", "Gas": "Gas", "Coal": "Carbón", "Imports": "Importaciones", "Other": "Otros", "Very low": "Muy baja", "Low": "Baja", "Moderate": "Moderada", "High": "Alta", "Very high": "Muy alta", "Add your first device": "Añade tu primer dispositivo", "Open the card editor and add Solar, Inverter, Battery, Grid or House.": "Abre el editor de la tarjeta y añade solar, inversor, batería, red o casa.", "☀️ Solar PV": "☀️ Solar FV", "⚡ Inverter": "⚡ Inversor", "🔋 Battery": "🔋 Batería", "🧠 Gateway": "🧠 Pasarela", "🏠 House": "🏠 Casa", "⚡ Grid": "⚡ Red", "⛽ Generator": "⛽ Generador", "💧 Water": "💧 Agua", "🔥 Gas": "🔥 Gas", "🚗 EV Charger": "🚗 Cargador VE", "⚙️ Extra Load": "⚙️ Carga adicional", "Home Power Flow": "Home Power Flow", "Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.": "Flujo de energía bidireccional a partir de valores positivos/negativos en directo, conexiones punteadas, un punto de energía en movimiento, dirección de dispositivo invertible, colores de flujo dinámicos y diseño arrastrable. Los ID de entidad completos se muestran bajo cada selector.", "Backup": "Copia de seguridad", "Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.": "Descarga toda la configuración de la tarjeta como archivo o restaura una guardada antes. Importar reemplaza todos los ajustes de abajo (dispositivos, conexiones, diseño, estadísticas); no se guarda en tu panel hasta que pulses Guardar.", "⬇ Export config": "⬇ Exportar configuración", "⬆ Import config": "⬆ Importar configuración", "Downloaded.": "Descargado.", "Export failed - see the browser console for details.": "Error al exportar: consulta la consola del navegador.", "Import failed - that file is not a valid Home Power Flow Card config.": "Error al importar: el archivo no es una configuración válida de Home Power Flow Card.", "Imported. Click Save below to keep it on this dashboard.": "Importado. Pulsa Guardar abajo para conservarlo en este panel.", "Title": "Título", "Subtitle": "Subtítulo", "Title colour": "Color del título", "Time format": "Formato de hora", "24 hour": "24 horas", "12 hour": "12 horas", "Weather entity": "Entidad del tiempo", "Day background": "Fondo de día", "Night background": "Fondo de noche", "📤 Upload image": "📤 Subir imagen", "👁 Preview this background": "👁 Vista previa del fondo", "Restore default": "Restaurar predeterminado", "Using the default background": "Usando el fondo predeterminado", "Uploading…": "Subiendo…", "Upload failed - check that you are an admin user and try again.": "Error al subir: comprueba que eres administrador e inténtalo de nuevo.", "Sun entity (switches day/night background)": "Entidad del sol (cambia el fondo día/noche)", "Flow threshold (W)": "Umbral de flujo (W)", "Flow animation speed (seconds)": "Velocidad de la animación (segundos)", "Particle stagger (seconds)": "Separación de partículas (segundos)", "Not selected": "Sin seleccionar", "Last updated box": "Recuadro de última actualización", "Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.": "Recuadro pequeño opcional que muestra cuánto hace que se actualizó una entidad, p. ej. los datos del inversor. Usa la marca de tiempo propia de la entidad si la tiene. Se vuelve ámbar cuando los datos superan el tiempo de aviso.", "Show last updated box": "Mostrar recuadro de última actualización", "Label": "Etiqueta", "Warn after (minutes)": "Avisar tras (minutos)", "Entity": "Entidad", "UK grid mix": "Mix eléctrico de Reino Unido", "Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.": "Recuadro opcional que muestra lo verde que es ahora la red eléctrica de Gran Bretaña (intensidad de carbono y mix de generación), desde la API Carbon Intensity de National Grid ESO. Se actualiza cada 30 minutos.", "Show grid mix box": "Mostrar recuadro del mix eléctrico", "Postcode (optional)": "Código postal (opcional)", "Appearance": "Apariencia", "Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.": "Tema de color para los recuadros y paneles. El fondo, los colores de flujo y el color del título se ajustan por separado.", "Theme": "Tema", "Auto (follow Home Assistant)": "Auto (según Home Assistant)", "Dark": "Oscuro", "Light": "Claro", "Midnight": "Medianoche", "Ocean": "Océano", "Forest": "Bosque", "Sunset": "Atardecer", "Graphite": "Grafito", "Custom colours": "Colores personalizados", "Panel colour": "Color de los paneles", "Text colour": "Color del texto", "Panel opacity": "Opacidad de los paneles", "Flow line style": "Estilo de las líneas", "Curved": "Curvas", "Right angles (avoid boxes)": "Ángulos rectos (evitan recuadros)", "Power units": "Unidades de potencia", "Auto (W, kW from 1000 W)": "Auto (W, kW desde 1000 W)", "Always W": "Siempre W", "Always kW": "Siempre kW", "History hours": "Horas de historial", "History opacity": "Opacidad del historial", "6 h": "6 h", "12 h": "12 h", "24 h": "24 h", "48 h": "48 h", "Sizing": "Tamaños", "1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.": "1 = tamaño predeterminado. La escala de pantalla pequeña agranda los recuadros en móviles (gradualmente por debajo de 900 px). Ancho máx. 0 = ocupar todo el ancho; la tarjeta nunca supera la altura de la pantalla. El panel Hoy también se reduce si fuera más alto que la tarjeta.", "Device boxes": "Recuadros de dispositivos", "Weather box": "Recuadro del tiempo", "Today panel": "Panel Hoy", "Small screen": "Pantalla pequeña", "Max width (px)": "Ancho máx. (px)", "Grid mix": "Mix eléctrico", "Updated box": "Recuadro de actualización", "Visual layout": "Diseño visual", "🖥️ Desktop": "🖥️ Escritorio", "📱 Phone": "📱 Móvil", "Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.": "Arrastra los recuadros de los dispositivos en la plantilla para colocarlos donde quieras. Las posiciones se guardan automáticamente. Los dispositivos nuevos sin posición guardada usan el diseño automático.", "Phone layout: used when the card is narrower than the breakpoint. Drag boxes to arrange it; boxes you have not moved use an automatic arrangement. Your desktop layout is not affected.": "Diseño móvil: se usa cuando la tarjeta es más estrecha que el punto de corte. Arrastra los recuadros para ordenarlo; los que no muevas se colocan automáticamente. El diseño de escritorio no cambia.", "Phone layout": "Diseño móvil", "Auto (narrow screens)": "Auto (pantallas estrechas)", "Always": "Siempre", "Never": "Nunca", "Switch below (px)": "Cambiar por debajo de (px)", "Background focus ↔": "Enfoque del fondo ↔", "Background focus ↕": "Enfoque del fondo ↕", "↺ Reset positions to automatic": "↺ Restablecer posiciones automáticas", "⧉ Copy desktop layout": "⧉ Copiar diseño de escritorio", "↺ Reset phone layout": "↺ Restablecer diseño móvil", "Show on phone": "Mostrar en el móvil", "Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.": "Los elementos desmarcados solo se ocultan en el diseño móvil. Ocultar un dispositivo también oculta sus líneas de flujo.", "🔤 Title": "🔤 Título", "🌤️ Weather": "🌤️ Tiempo", "🌍 Grid mix": "🌍 Mix eléctrico", "🕒 Updated": "🕒 Actualizado", "📊 Daily Stats": "📊 Estadísticas del día", "Devices": "Dispositivos", "＋ Add device": "＋ Añadir dispositivo", "Type": "Tipo", "Name": "Nombre", "Power entity": "Entidad de potencia", "Meter or flow entity": "Entidad de contador o caudal", "Connects to": "Conectado a", "Automatic": "Automático", "Automatic = the (first) inverter, or a Gateway/Distribution Board device for extra inverters. Override this for multi-inverter or custom topologies.": "Automático = el (primer) inversor, o una pasarela/cuadro eléctrico para inversores adicionales. Cámbialo para varios inversores o topologías personalizadas.", "Flow colour": "Color del flujo", "Only used if this device has its own power entity.": "Solo se usa si el dispositivo tiene su propia entidad de potencia.", "Flow direction": "Dirección del flujo", "↔ Normal": "↔ Normal", "↔ Inverted": "↔ Invertido", "Visual direction only": "Solo la dirección visual", "Show history graph": "Mostrar gráfico de historial", "Power history as a faint graph behind the box. Range and opacity are under Appearance.": "Historial de potencia como gráfico tenue detrás del recuadro. El rango y la opacidad están en Apariencia.", "Show charge/discharge glow": "Mostrar brillo de carga/descarga", "Pulses the box when actively charging or discharging.": "El recuadro pulsa al cargar o descargar.", "Show time remaining": "Mostrar tiempo restante", "Estimated time to full (charging) or to reserve (discharging), shown under the power value.": "Tiempo estimado hasta completar (carga) o hasta la reserva (descarga), mostrado bajo el valor de potencia.", "State of charge (%)": "Estado de carga (%)", "Capacity (kWh)": "Capacidad (kWh)", "Reserve %": "Reserva %", "Charge limit %": "Límite de carga %", "Capacity sensor (optional, overrides the number above)": "Sensor de capacidad (opcional, sustituye el número de arriba)", "Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.": "Se muestra en litros. Los sensores en m³ se convierten automáticamente. En Automático, el agua se conecta al dispositivo Casa.", "Show gas in": "Mostrar gas en", "Calorific value (MJ/m³)": "Poder calorífico (MJ/m³)", "Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.": "Se usa para convertir entre m³ y kWh (consulta tu factura de gas). En Automático, el gas se conecta al dispositivo Casa.", "＋ Add extra entity": "＋ Añadir entidad adicional", "Maximum of 5 extra entities reached.": "Se ha alcanzado el máximo de 5 entidades adicionales.", "Icon (Material Design Icons)": "Icono (Material Design Icons)", "Connections": "Conexiones", "Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.": "Opcional. Déjalo vacío para usar la topología automática. Añade conexiones para controlar por completo hacia dónde fluye la energía.", "From": "Desde", "To": "Hasta", "From → To": "Desde → Hasta", "To → From": "Hasta → Desde", "Auto — use live power signs": "Auto — según el signo de la potencia", "Remove connection": "Eliminar conexión", "＋ Add connection": "＋ Añadir conexión", "Today statistics": "Estadísticas de hoy", "Add up to 20 custom statistics. Choose your own name, entity and icon.": "Añade hasta 20 estadísticas propias. Elige tu nombre, entidad e icono.", "Material Design Icon": "Icono de Material Design", "Custom icon override": "Icono personalizado (sustituye)", "＋ Add statistic": "＋ Añadir estadística", "No statistics added.": "No hay estadísticas añadidas.", "Statistic": "Estadística", "Self-sufficiency": "Autosuficiencia", "Self-consumption": "Autoconsumo", ": share of your home's electricity that didn't come from the grid.": ": parte de la electricidad de tu casa que no vino de la red.", ": share of your solar you used yourself instead of exporting. Shown at the top of the Today panel.": ": parte de tu energía solar que usaste en lugar de exportarla. Se muestra arriba en el panel Hoy.", "Now": "Ahora", "is calculated automatically from your devices;": "se calcula automáticamente a partir de tus dispositivos;", "today": "hoy", "uses the daily energy sensors below.": "usa los sensores de energía diaria de abajo.", "Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.": "Sensores de energía diaria (kWh o Wh). La autosuficiencia de hoy necesita importación y consumo; el autoconsumo de hoy necesita solar y exportación.", "Grid import today": "Importación de red hoy", "Grid export today": "Exportación a red hoy", "Solar production today": "Producción solar hoy", "Home consumption today": "Consumo de la casa hoy", "Calculate consumption instead (import + solar − export + battery discharge − battery charge)": "Calcular el consumo (importación + solar − exportación + descarga de batería − carga de batería)", "Battery charge today (optional, for calculated consumption)": "Carga de batería hoy (opcional, para el consumo calculado)", "Battery discharge today (optional, for calculated consumption)": "Descarga de batería hoy (opcional, para el consumo calculado)", "off": "desactivado", "Choose flow colour": "Elige el color del flujo", "Drag to reorder": "Arrastra para reordenar", "Duplicate device": "Duplicar dispositivo", "Leave empty for no title": "Déjalo vacío para no mostrar título", "Leave empty for none": "Déjalo vacío para no mostrar nada", "Optional": "Opcional", "Or paste an image URL instead": "O pega la URL de una imagen", "Remove": "Eliminar", "e.g. 13.5": "p. ej. 13,5", "e.g. SW1A, blank = all of GB": "p. ej. SW1A, vacío = toda Gran Bretaña", "Not connected to anything": "No conectado a nada", "idle": "inactivo", "Today panel style": "Estilo del panel Hoy", "Floating (drag anywhere)": "Flotante (arrastrar a cualquier lugar)", "Docked to card edge": "Anclado al borde de la tarjeta", "Dock edge": "Borde", "Bottom": "Abajo", "Top": "Arriba", "Left": "Izquierda", "Right": "Derecha", "Auto-hide (slides out on hover or tap)": "Ocultar automáticamente (aparece al pasar el ratón o tocar)", "On phone": "En el móvil", "Same as desktop": "Igual que en escritorio", "Floating": "Flotante", "Docked": "Anclado", "Phone dock edge": "Borde en el móvil", "Phone auto-hide": "Ocultar automáticamente en el móvil", "Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.": "El panel anclado se sitúa en un borde de la tarjeta y no se puede arrastrar. Ocultar automáticamente lo reduce a una pestaña que aparece al pasar el ratón o tocar.", "Box opacity": "Opacidad de los recuadros", "Card shape": "Forma de la tarjeta", "3:2 (default)": "3:2 (predeterminado)", "21:9 (ultra-wide)": "21:9 (ultrapanorámico)", "32:9 (super ultra-wide)": "32:9 (superultrapanorámico)", "Match background image": "Ajustar a la imagen de fondo", "Fill the screen": "Llenar la pantalla", "Background fit": "Ajuste del fondo", "Fill (crop to card)": "Rellenar (recortar a la tarjeta)", "Fit whole image (blurred edges)": "Mostrar la imagen completa (bordes difuminados)"} };
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
      if (this._rendered) this._updatedTimer();
    }

    disconnectedCallback() {
      if (this._timer) clearInterval(this._timer);
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
      if (this._upTimer) { clearInterval(this._upTimer); this._upTimer = null; }
      if (this._onWinResize) { window.removeEventListener('resize', this._onWinResize); this._onWinResize = null; }
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
    }

    // Everything is laid out on a fixed 1200x800 design stage and scaled
    // uniformly to the card's real width, so the whole composition is always
    // visible and identical on any screen (desktop, tablet, phone, Sections
    // column, editor preview). On small cards, boxes and panels get an
    // extra per-element boost so text stays readable.
    _applyScale() {
      const card = this.shadowRoot?.querySelector('.card');
      const stage = this.shadowRoot?.querySelector('.stage');
      if (!card || !stage) return;
      // Switch between desktop and phone layout when needed (full redraw).
      const phone = this._computePhone();
      if (this._rendered && phone !== this._phoneMode) { this._render(); return; }
      if (this._rendered && !this._phoneMode && Math.abs(this._computeRatio() - (this._ratio || 1.5)) > 0.02) { this._render(); return; }
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
          .card { position:relative; width:100%; max-width:min(var(--hpf-max-width,100000px), calc((100vh - 96px) * var(--hpf-ratio,1.5))); margin:0 auto; aspect-ratio: var(--hpf-ratio,1.5); overflow:hidden; border-radius:22px; color:var(--hpf-text,#fff); font-family:var(--primary-font-family,Arial,sans-serif); background:#101820; box-shadow:0 12px 40px rgba(0,0,0,.28); }
          .bg { position:absolute; inset:0; background-size:cover; background-position:center; }
          .bg-fill { position:absolute; inset:-40px; background-size:cover; background-position:center; filter:blur(28px) brightness(.6); display:none; }
          .card.fit-contain .bg-fill { display:block; }
          .card.fit-contain .bg { background-size:contain; background-repeat:no-repeat; }
          .card.phone { aspect-ratio: 2 / 3; max-width:min(var(--hpf-max-width,100000px), calc((100vh - 96px) * 0.6667)); }
          .card.phone .stage { width:800px; height:1200px; }
          .stage { position:absolute; left:0; top:0; width:var(--hpf-stage-w,1200px); height:800px; transform-origin:top left; transform:scale(var(--hpf-scale,1)); }
          .vignette { position:absolute; inset:0; background:radial-gradient(circle at 55% 45%,transparent 25%,rgba(0,0,0,.12) 72%,rgba(0,0,0,.32)); pointer-events:none; }
          .header { position:absolute; left:var(--header-x,2.6%); top:var(--header-y,2.7%); z-index:20; transform-origin:top left; transform:scale(calc(var(--hpf-title-scale,1) * var(--hpf-boost,1))); color:var(--hpf-title-color,#fff); white-space:nowrap; }
          .title { font-size:42px; font-weight:700; letter-spacing:-.03em; text-shadow:0 2px 8px rgba(0,0,0,.4); }
          .subtitle { margin-top:4px; font-size:18px; opacity:.88; text-shadow:0 2px 8px rgba(0,0,0,.45); }
          .updated { position:absolute; z-index:19; left:var(--up-x,50%); top:var(--up-y,95%); transform:translate(-50%,-50%) scale(calc(var(--hpf-updated-scale,1) * var(--hpf-boost,1))); display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; background:var(--hpf-panel-bg,rgba(8,29,52,.78)); border:1px solid var(--hpf-border,rgba(255,255,255,.16)); box-shadow:0 6px 18px rgba(0,0,0,.25); backdrop-filter:blur(var(--hpf-blur,12px)); font-size:13px; white-space:nowrap; }
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
          .node.has-hist { overflow:hidden; }.node .hist { position:absolute; left:0; right:0; bottom:0; height:62%; pointer-events:none; z-index:0; }.node .hist svg { width:100%; height:100%; display:block; }.node > :not(.hist) { position:relative; z-index:1; }.node .top { display:flex; align-items:center; gap:8px; }.node .icon { font-size:24px; line-height:1; }.node .name { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.node .power { margin-top:5px; font-size:19px; font-weight:750; }.node .batt-time { margin-top:3px; display:flex; align-items:center; gap:4px; font-size:12px; font-weight:600; opacity:.9; }.node .batt-time:empty { display:none; }.node .batt-time ha-icon { --mdc-icon-size:13px; width:13px; height:13px; }.node .extras { margin-top:4px; display:flex; flex-wrap:wrap; gap:2px 8px; }.node .extras:empty { display:none; margin:0; }.node .extra-row { display:inline-flex; align-items:center; gap:3px; font-size:10px; line-height:1.3; opacity:.78; white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }.node .extra-row ha-icon { --mdc-icon-size:12px; width:12px; height:12px; flex:none; }.node.battery { border-color:rgba(123,255,158,.28); }.node.grid { border-color:rgba(93,191,255,.3); }.node.ev { border-color:rgba(151,255,103,.28); }
          @keyframes hpf-charge-pulse { 0%,100% { box-shadow:0 8px 22px rgba(0,0,0,.32), 0 0 0 0 var(--pulse-color); } 50% { box-shadow:0 8px 22px rgba(0,0,0,.32), 0 0 30px 8px var(--pulse-color); } }
          @media (prefers-reduced-motion: reduce) { .node[data-batt-state="charging"], .node[data-batt-state="discharging"] { animation:none !important; } }
          .empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:30; }.empty > div { padding:24px 30px; background:rgba(10,25,38,.82); border-radius:18px; border:1px solid var(--hpf-border,rgba(255,255,255,.16)); text-align:center; backdrop-filter:blur(var(--hpf-blur,10px)); }.empty b{display:block;font-size:20px;margin-bottom:6px}.empty span{opacity:.75}
        </style>
        <div class="card${this._phoneMode ? ' phone' : ''}${this._config?.background_fit === 'contain' ? ' fit-contain' : ''}" style="--hpf-max-width:${this._maxWidthCss()}${this._phoneMode ? '' : `;--hpf-ratio:${this._ratio};--hpf-stage-w:${this._stageW()}px`}">
          <div class="bg-fill"></div><div class="bg" style="${this._phoneMode ? `background-position:${phoneBgFocus(this._config)}` : ''}"></div><div class="vignette"></div>
          <div class="stage">
          ${this._headerHTML()}
          ${this._gridMixBoxHTML()}
          ${this._updatedBoxHTML()}
          ${this._phoneHidden('weather') ? '' : `<div class="weather" style="--weather-x:${this._panelPos('weather').x}%;--weather-y:${this._panelPos('weather').y}%"><div class="date">${esc(date)}</div><div class="clock">${esc(time)}</div><div class="wicon">${weatherIcon}</div><div class="temp">${weatherTemp != null ? esc(weatherTemp) + esc(weatherUnit) : '—'}</div><div class="wstate">${esc(weatherText)}</div></div>`}
          <div class="canvas"><svg class="flows" viewBox="0 0 ${this._vbW()} ${this._vbH()}" preserveAspectRatio="none">${this._svgFilterDefs()}${flows}</svg>${nodes}</div>
          ${stats && !this._phoneHidden('stats') ? this._statsPlaced(stats) : ''}
          ${devices.length ? '' : `<div class="empty"><div><b>${esc(this._t('Add your first device'))}</b><span>${esc(this._t('Open the card editor and add Solar, Inverter, Battery, Grid or House.'))}</span></div></div>`}
          </div>
        </div>`;

      this._rendered = true;
      this._applyBackground(bg);
      this._applyTheme();
      this._histRefresh();
      this._lastRouteW = null;
      this._applyScale();
      this._updatedTimer();
      this._bindDock();
      this._gridMixRefresh();
      // Clicking a device opens the corresponding Home Assistant entity dialog.
      this.shadowRoot.querySelectorAll('.node[data-entity-id]').forEach(node => {
        node.addEventListener('click', () => {
          const entityId = node.dataset.entityId;
          if (entityId) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
        });
      });
      if (!this._timer) this._timer = setInterval(() => this._updateLiveValues(), 30000);
    }

    _isNight() {
      const sunEntity = this._config?.sun_entity || 'sun.sun';
      const sunState = state(this._hass, sunEntity);
      return !!sunState && sunState.state === 'below_horizon';
    }

    _resolveBackground() {
      const c = this._config || {};
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
      return `<div class="updated${this._updatedInfo().stale ? ' stale' : ''}" style="--up-x:${p.x}%;--up-y:${p.y}%">${this._updatedInner()}</div>`;
    }
    _updatedRefresh() {
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
      return `<div class="gridmix" style="--gm-x:${p.x}%;--gm-y:${p.y}%">${this._gridMixInner()}</div>`;
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
        this._flowSnapshot[i] = powerValue(this._hass, d.power_entity);
      });
      this._flowVisualKey = this._flowStateKey(devices || [], this._flowSnapshot);
    }

    _updateLiveValues() {
      if (!this._hass || !this._config || !this._rendered) return;
      this._applyTheme();
      this._histRefresh();
      this._gridMixRefresh();
      this._updateStatsValues();
      this._updatedRefresh();
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
        const power = powerValue(this._hass, d.power_entity);
        const powerEl = node.querySelector('.power');
        if (powerEl) powerEl.textContent = this._isUtility(d) ? this._utilityText(d) : (power == null ? '—' : fmtPower(power, this._config?.power_unit));
        const extrasEl = node.querySelector('.extras');
        if (extrasEl) extrasEl.innerHTML = this._extraEntitiesRows(d);
        const histEl = node.querySelector('.hist');
        if (histEl && d.history_graph === true) { this._histAppend(d); const h = this._histSVG(d); if (histEl.innerHTML !== h) histEl.innerHTML = h; }
        const btEl = node.querySelector('.batt-time');
        if (btEl) { const h = this._batteryTimeHTML(d, power); if (btEl.innerHTML !== h) btEl.innerHTML = h; }
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
      devices.forEach((d, i) => { currentSnapshot[i] = powerValue(this._hass, d.power_entity); });
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
      if (s.includes('rain') || s.includes('drizzle')) return '🌧️';
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
      const a = this._config?.card_aspect || '3:2';
      if (CARD_RATIOS[a]) return CARD_RATIOS[a];
      if (a === 'image') return clampRatio(this._bgRatio || 1.5);
      if (a === 'screen') {
        const w = this.clientWidth || this.getBoundingClientRect?.().width || 0;
        const h = Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 900) - 96);
        return w > 0 ? clampRatio(w / h) : 1.5;
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
      const ents = [...new Set((this._config?.devices || []).filter(d => d.history_graph === true && d.power_entity).map(d => d.power_entity))].sort();
      if (!ents.length || !this._hass?.callWS) return;
      const key = ents.join(',') + '|' + this._histHours();
      if (this._histBusy || (this._histKey === key && Date.now() - (this._histAt || 0) < 15 * 60 * 1000)) return;
      this._histBusy = true;
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
      const pts = this._hist?.get(d.power_entity); if (!pts) return;
      const v = parseFloat(state(this._hass, d.power_entity)?.state); if (!Number.isFinite(v)) return;
      const now = Date.now(), last = pts[pts.length - 1];
      if (!last || now - last.t >= 30000 || last.v !== v) pts.push({ t: now, v });
      const from = now - this._histHours() * 3600 * 1000;
      while (pts.length > 2 && pts[1].t < from) pts.shift();
    }
    _histRedraw() {
      (this._config?.devices || []).forEach((d, i) => {
        if (d.history_graph !== true) return;
        const el = this.shadowRoot?.querySelector(`.node[data-device-index="${i}"] .hist`);
        if (el) el.innerHTML = this._histSVG(d);
      });
    }
    // Area graph (96 time buckets, each the average of its readings; empty
    // buckets hold the previous value). Signed data gets a zero line.
    _histSVG(d) {
      if (d.history_graph !== true || !d.power_entity) return '';
      const pts = this._hist?.get(d.power_entity);
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
      const power = powerValue(this._hass, d.power_entity);
      const powerText = this._isUtility(d) ? this._utilityText(d) : (power == null ? '—' : fmtPower(power, this._config?.power_unit));
      const battState = this._batteryState(d, power);
      return `<div class="node ${esc(d.type || 'load')}${d.history_graph === true && d.power_entity ? ' has-hist' : ''}" data-device-index="${i}" data-batt-state="${battState || ''}" data-entity-id="${esc(d.power_entity || '')}" title="${esc(d.power_entity ? 'Open ' + d.power_entity : '')}" style="left:${p.x}%;top:${p.y}%;${this._batteryGlowStyle(battState)}"><div class="hist">${this._histSVG(d)}</div><div class="top"><span class="icon">${esc(ICONS[d.type] || '⚙️')}</span><span class="name">${esc(d.name || LABELS[d.type] || 'Device')}</span></div><div class="power">${esc(powerText)}</div><div class="batt-time">${this._batteryTimeHTML(d, power)}</div><div class="extras">${this._extraEntitiesRows(d)}</div></div>`;
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

      const aHas = !!(a.power_entity && String(a.power_entity).trim());
      const bHas = !!(b.power_entity && String(b.power_entity).trim());
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
      return `<defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="dotglow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
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
        const A=pos[a],B=pos[b]; if(!A||!B)return ''; if(this._phoneHiddenDevice(devices[a])||this._phoneHiddenDevice(devices[b]))return '';
        const vw=this._vbW()/100, vh=this._vbH()/100, x1=A.x*vw,y1=A.y*vh,x2=B.x*vw,y2=B.y*vh;
        const path=this._edgePath(a,b,x1,y1,x2,y2);
        const da=devices[a],db=devices[b],va=this._flowSnapshot?.[a],vb=this._flowSnapshot?.[b];
        const childDevice = Number.isInteger(child) ? devices[child] : null;
        const info=this._flowDirection(da,db,va,vb,childDevice);
        // No valid entity value = no visible connection. Zero/below threshold
        // also remains completely hidden until meaningful power exists.
        if (!info.active) return '';
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
        const stroke=flowColor(da,db,reverse,true,this._config.flow_colors);
        const width=2.1;
        const delay=(idx*stagger).toFixed(2)+'s';
        return `<path id="${id}" class="flow-path" d="${path}" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="2 6" opacity=".92"></path><circle class="flow-dot" r="2.4" fill="${stroke}"><animateMotion dur="${duration}" begin="-${delay}" repeatCount="indefinite" rotate="auto" ${reverse?'keyPoints="1;0" keyTimes="0;1"':''}><mpath href="#${id}"/></animateMotion><animate attributeName="r" values="1.8;3.4;1.8" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".55;1;.55" dur="1.1s" repeatCount="indefinite"/></circle>`;
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
      list.forEach(r => rows.push({ icon: r.custom_icon || r.icon || 'mdi:chart-line', name: r.name || 'Statistic', value: this._energyEntity(r.entity) }));
      return rows;
    }

    // Share of home consumption NOT imported from the grid, right now:
    // 1 - import / consumption, from the Grid and House devices. Import is
    // decided with the exact same formula as the grid flow animation
    // (negative = import, flipped by Invert flow), so the percentage always
    // agrees with the direction the dots travel.
    _selfSufficiencyLive() {
      const devices = this._config?.devices || [];
      const grids = devices.filter(d => d.type === 'grid' && d.power_entity);
      const houses = devices.filter(d => d.type === 'house' && d.power_entity);
      if (!grids.length || !houses.length) return null;
      let imp = 0, cons = 0, seen = false;
      for (const g of grids) { const v = powerValue(this._hass, g.power_entity); if (v == null) continue; seen = true; let importing = v < 0; if (g.invert_flow) importing = !importing; if (importing) imp += Math.abs(v); }
      for (const h of houses) { const v = powerValue(this._hass, h.power_entity); if (v == null) continue; cons += Math.abs(v); }
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
      const solars = devices.filter(d => d.type === 'solar' && d.power_entity);
      if (!solars.length) return null;
      let solar = 0;
      for (const d of solars) { const v = powerValue(this._hass, d.power_entity); if (v != null) solar += Math.abs(v); }
      if (solar < 10) return null;
      let exp = 0;
      for (const g of devices.filter(d => d.type === 'grid' && d.power_entity)) {
        const v = powerValue(this._hass, g.power_entity); if (v == null) continue;
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
      return `<div class="stats"><h3>${esc(s.title || this._t('Today'))}</h3>${rows.map(r=>{
        const iconHtml = String(r.icon).startsWith('mdi:') ? `<ha-icon icon="${esc(r.icon)}"></ha-icon>` : esc(r.icon);
        return `<div class="stat"><span class="ico">${iconHtml}</span><span>${esc(r.name)}</span><span class="value">${esc(r.value)}</span></div>`;
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
      const s = state(this._hass, entity); if (!s) return '—'; const v = parseFloat(s.state); if (!Number.isFinite(v)) return s.state; return fmtEnergy(v).replace(' kWh',' ') + (s.attributes?.unit_of_measurement || 'kWh');
    }
  }

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
      const changed=JSON.stringify(next)!==JSON.stringify(this._config);
      this._config=next;
      if(changed || !this.shadowRoot.firstElementChild) this._render();
    }
    set hass(h){
      this._hass=h;
      const lang=langOf(h);
      if(lang!==this._lang){ this._lang=lang; if(this.shadowRoot.firstElementChild){ this._render(); return; } }
      // Do not rebuild the editor on every HA state update. Rebuilding the
      // DOM destroys focus and closes entity pickers while the user is typing.
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(el=>{ el.hass=h; });
      this._updateFlowLive();
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
        const heightCandidates=[window.innerHeight*0.6];
        if(surface?.clientHeight) heightCandidates.push(surface.clientHeight*0.62);
        const availH=Math.max(320, Math.min(...heightCandidates));
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
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;width:100%;max-width:680px;min-width:0;box-sizing:border-box;overflow-x:hidden}.wrap{padding:4px 0;font-family:var(--primary-font-family,Arial)}h3{margin:18px 0 8px}.hint{opacity:.65;font-size:12px;margin-bottom:12px}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:8px 0}.row.compact{grid-template-columns:repeat(auto-fit,minmax(110px,1fr));align-items:end}.field{display:flex;flex-direction:column;gap:5px;min-width:0}.field.full{grid-column:1/-1}.entity-id{font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.72;word-break:break-all;margin-top:2px}.section{padding:14px 16px;margin:12px 0;border:1px solid var(--divider-color,#ddd);border-radius:14px}.section h3{margin-top:0}label{font-size:12px;opacity:.75}input,select{width:100%;box-sizing:border-box;min-width:0;padding:10px;border:1px solid var(--divider-color,#ddd);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#111)}.drag-handle{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:6px;flex:none;cursor:grab;touch-action:none;opacity:.7;border-radius:6px}.drag-handle:hover{opacity:1;background:rgba(127,127,127,.15)}.drag-handle ha-icon{--mdc-icon-size:18px;width:18px;height:18px}.sort-item.sorting{opacity:.85;box-shadow:0 8px 22px rgba(0,0,0,.35);border-color:var(--primary-color,#03a9f4);position:relative;z-index:5}.sort-item.sorting .drag-handle{cursor:grabbing}.device{padding:13px;margin:10px 0;border:1px solid var(--divider-color,#ddd);border-radius:12px;background:var(--secondary-background-color,rgba(0,0,0,.03))}.device-head{display:flex;justify-content:space-between;align-items:center;font-weight:700}.device-title{cursor:pointer;display:flex;align-items:center;gap:6px;flex:1;min-width:0;user-select:none}.device-sub{font:11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:400;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.device-head button{border:0;background:transparent;color:var(--error-color,#db4437);font-size:20px;cursor:pointer}.section-toggle{cursor:pointer;user-select:none;display:flex;align-items:baseline;gap:8px}.section-sub{font-size:12px;font-weight:400;opacity:.6}.section-body[hidden]{display:none}.device-actions{display:flex;align-items:center;gap:2px;flex:none}.device-head button.dup-btn{color:var(--primary-text-color,#fff);opacity:.7;display:inline-flex;align-items:center;padding:2px 4px}.device-head button.dup-btn:hover{opacity:1}.device-head button.dup-btn ha-icon{--mdc-icon-size:18px;width:18px;height:18px}.flow-live{font-size:11px;line-height:1.5;margin-top:4px;opacity:.85}.flow-live .fl-on{color:var(--success-color,#4caf50)}.flow-live .fl-off{opacity:.6}.btn{border:0;border-radius:10px;padding:11px 14px;background:var(--primary-color,#03a9f4);color:#fff;cursor:pointer;font-weight:700}.small{font-size:11px;opacity:.6}.layout-editor{position:relative;width:100%;aspect-ratio:1.5/1;min-height:420px;border-radius:16px;overflow:hidden;border:1px solid var(--divider-color,#ddd);background:#10202c;touch-action:none}.layout-bg{position:absolute;inset:0;background-size:cover;background-position:center}.layout-editor.phone{aspect-ratio:2/3;max-width:440px;min-height:0;margin:0 auto}.layout-editor.phone .layout-node{min-width:0;max-width:96px;padding:4px 6px;font-size:10px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-editor.phone .layout-node .ln-pos{display:none}.layout-node.dragging{z-index:50!important}.layout-node:hover{z-index:40}.seg{display:inline-flex;border:1px solid var(--divider-color,#ddd);border-radius:10px;overflow:hidden;margin:4px 0 8px}.seg button{border:0;padding:7px 14px;background:transparent;color:var(--primary-text-color,#111);cursor:pointer;font-size:13px}.seg button.on{background:var(--primary-color,#03a9f4);color:#fff}input[type="range"]{padding:0;border:0;background:transparent;min-height:28px}.show-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;margin-top:4px}.show-item{display:flex;align-items:center;gap:6px;font-size:13px;opacity:1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.show-item input{width:auto}.layout-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.layout-node{position:absolute;transform:translate(-50%,-50%);min-width:112px;max-width:160px;padding:8px 10px;border-radius:11px;background:rgba(8,29,45,.9);border:1px solid rgba(255,255,255,.35);color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35);cursor:grab;user-select:none;touch-action:none;font-size:12px;z-index:2}.layout-node[data-layout-kind="header"]{transform:none}.layout-node.dragging{cursor:grabbing;box-shadow:0 10px 24px rgba(0,0,0,.5);border-color:var(--primary-color,#03a9f4)}.layout-node .ln-top{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-node .ln-pos{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.65;margin-top:2px}.secondary-btn{margin-bottom:8px;background:var(--secondary-text-color,#607d8b)}.flow-colours{grid-template-columns:repeat(3,minmax(0,1fr))}.color-row{display:grid;grid-template-columns:42px 1fr;gap:6px;align-items:center}.color-row input[type=color]{height:40px;padding:3px}.ha-color-box{display:flex;align-items:center;gap:10px}.ha-color-picker{width:56px!important;height:40px!important;padding:2px!important;border-radius:8px}.color-preview{width:80px;height:36px;border-radius:8px;border:1px solid var(--divider-color,#ddd);display:inline-block}.color-row input[type=text]{padding:9px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.upload-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.upload-row .btn{padding:9px 12px;font-size:12px}.upload-status{font-size:11px;opacity:.65;margin-bottom:6px}
      </style><div class="wrap"><h3>Home Power Flow</h3><div class="hint">Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.</div>
      <div class="section"><h3>Backup</h3><div class="hint">Download the whole card configuration as a file, or restore one saved earlier. Importing replaces every setting below (devices, connections, layout, statistics) - it does not save to your dashboard until you click Save.</div><div class="upload-row"><button class="btn secondary-btn" type="button" id="export-config">⬇ Export config</button><button class="btn secondary-btn" type="button" id="import-config-btn">⬆ Import config</button><input type="file" accept="application/json,.json" data-import-config-file style="display:none"></div><div class="upload-status" data-import-status></div></div>
      <div class="row"><div class="field"><label>Title</label><input data-key="title" placeholder="Leave empty for no title" value="${esc(c.title===undefined||c.title===null?'Energy Flow':c.title)}"></div><div class="field"><label>Subtitle</label><input data-key="subtitle" placeholder="Optional" value="${esc(c.subtitle||'')}"></div><div class="field"><label>Title colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="title_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.title_color||''))?c.title_color:'#ffffff')}"><span class="color-preview" style="background:${esc(c.title_color||'#ffffff')}"></span></div></div><div class="field"><label>Time format</label><select data-key="time_format"><option value="24h" ${(c.time_format||'24h')==='24h'?'selected':''}>24 hour</option><option value="12h" ${c.time_format==='12h'?'selected':''}>12 hour</option></select></div><div class="field full"><label>Weather entity</label><ha-entity-picker data-editor-key="weather_entity" allow-custom-entity></ha-entity-picker></div><div class="field full">${this._bgUploadField('day','Day background')}</div><div class="field full">${this._bgUploadField('night','Night background')}</div><div class="field full"><label>Sun entity (switches day/night background)</label><ha-entity-picker data-editor-key="sun_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label>Flow threshold (W)</label><input type="number" min="0" step="0.1" data-key="flow_threshold_watts" value="${esc((Number(c.flow_threshold ?? 0.0005)*1000).toFixed(1))}"></div><div class="field"><label>Flow animation speed (seconds)</label><input type="number" min="3" max="30" step="0.5" data-key="flow_speed" value="${esc(c.flow_speed??8)}"></div><div class="field"><label>Particle stagger (seconds)</label><input type="number" min="0.15" max="1.5" step="0.05" data-key="flow_stagger" value="${esc(c.flow_stagger??0.55)}"></div></div>
      <h3>Last updated box</h3><div class="hint">Optional small box showing how long ago an entity was updated, e.g. your inverter's data. Uses the entity's own timestamp if it has one. Turns amber when the data is older than the warning time.</div><div class="row"><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="updated_enabled" style="width:auto" ${c.updated_enabled===true?'checked':''}> Show last updated box</label></div><div class="field"><label>Label</label><input data-key="updated_label" placeholder="Leave empty for none" value="${esc(c.updated_label===undefined?'Updated':c.updated_label)}"></div><div class="field"><label>Warn after (minutes)</label><input type="number" min="1" step="1" data-key="updated_stale_minutes" value="${esc(c.updated_stale_minutes??10)}"></div><div class="field full"><label>Entity</label><ha-entity-picker data-editor-key="updated_entity" allow-custom-entity></ha-entity-picker></div></div>
      <h3>UK grid mix</h3><div class="hint">Optional box showing how green the GB electricity grid is right now (carbon intensity and generation mix), from the National Grid ESO Carbon Intensity API. Updates every 30 minutes.</div><div class="row"><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="grid_mix_enabled" style="width:auto" ${c.grid_mix_enabled===true?'checked':''}> Show grid mix box</label></div><div class="field"><label>Postcode (optional)</label><input data-key="grid_mix_postcode" placeholder="e.g. SW1A, blank = all of GB" value="${esc(c.grid_mix_postcode||'')}"></div></div>
      <h3>Appearance</h3><div class="hint">Colour theme for the boxes and panels. Your background, flow colours and title colour are set separately.</div><div class="row"><div class="field"><label>Theme</label><select data-key="theme"><option value="auto" ${(c.theme||'dark')==='auto'?'selected':''}>Auto (follow Home Assistant)</option><option value="dark" ${(c.theme||'dark')==='dark'?'selected':''}>Dark</option><option value="light" ${(c.theme||'dark')==='light'?'selected':''}>Light</option><option value="midnight" ${(c.theme||'dark')==='midnight'?'selected':''}>Midnight</option><option value="ocean" ${(c.theme||'dark')==='ocean'?'selected':''}>Ocean</option><option value="forest" ${(c.theme||'dark')==='forest'?'selected':''}>Forest</option><option value="sunset" ${(c.theme||'dark')==='sunset'?'selected':''}>Sunset</option><option value="graphite" ${(c.theme||'dark')==='graphite'?'selected':''}>Graphite</option><option value="custom" ${(c.theme||'dark')==='custom'?'selected':''}>Custom colours</option></select></div><div class="field"><label>Card shape</label><select data-key="card_aspect"><option value="3:2" ${(c.card_aspect||'3:2')==='3:2'?'selected':''}>3:2 (default)</option><option value="4:3" ${(c.card_aspect||'3:2')==='4:3'?'selected':''}>4:3</option><option value="16:10" ${(c.card_aspect||'3:2')==='16:10'?'selected':''}>16:10</option><option value="16:9" ${(c.card_aspect||'3:2')==='16:9'?'selected':''}>16:9</option><option value="2:1" ${(c.card_aspect||'3:2')==='2:1'?'selected':''}>2:1</option><option value="21:9" ${(c.card_aspect||'3:2')==='21:9'?'selected':''}>21:9 (ultra-wide)</option><option value="32:9" ${(c.card_aspect||'3:2')==='32:9'?'selected':''}>32:9 (super ultra-wide)</option><option value="image" ${(c.card_aspect||'3:2')==='image'?'selected':''}>Match background image</option><option value="screen" ${(c.card_aspect||'3:2')==='screen'?'selected':''}>Fill the screen</option></select></div><div class="field"><label>Background fit</label><select data-key="background_fit"><option value="cover" ${c.background_fit!=='contain'?'selected':''}>Fill (crop to card)</option><option value="contain" ${c.background_fit==='contain'?'selected':''}>Fit whole image (blurred edges)</option></select></div><div class="field"><label>Flow line style</label><select data-key="flow_style"><option value="curved" ${c.flow_style!=='orthogonal'?'selected':''}>Curved</option><option value="orthogonal" ${c.flow_style==='orthogonal'?'selected':''}>Right angles (avoid boxes)</option></select></div><div class="field"><label>Power units</label><select data-key="power_unit"><option value="auto" ${(c.power_unit||'auto')==='auto'?'selected':''}>Auto (W, kW from 1000 W)</option><option value="w" ${c.power_unit==='w'?'selected':''}>Always W</option><option value="kw" ${c.power_unit==='kw'?'selected':''}>Always kW</option></select></div><div class="field"><label>Box opacity <span class="small" data-range-val="box_opacity">${esc(c.box_opacity??1)}</span></label><input type="range" min="0" max="1.5" step="0.05" data-key="box_opacity" value="${esc(c.box_opacity??1)}"></div><div class="field"><label>History hours</label><select data-key="history_hours">${[6,12,24,48].map(h=>`<option value="${h}" ${Number(c.history_hours||24)===h?'selected':''}>${h} h</option>`).join('')}</select></div><div class="field"><label>History opacity <span class="small" data-range-val="history_opacity">${esc(c.history_opacity??0.35)}</span></label><input type="range" min="0.05" max="1" step="0.05" data-key="history_opacity" value="${esc(c.history_opacity??0.35)}"></div>${c.theme==='custom'?`<div class="field"><label>Panel colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="theme_panel_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.theme_panel_color||''))?c.theme_panel_color:'#081d34')}"><span class="color-preview" style="background:${esc(c.theme_panel_color||'#081d34')}"></span></div></div><div class="field"><label>Text colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" data-key="theme_text_color" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.theme_text_color||''))?c.theme_text_color:'#ffffff')}"><span class="color-preview" style="background:${esc(c.theme_text_color||'#ffffff')}"></span></div></div><div class="field"><label>Panel opacity <span class="small" data-range-val="theme_opacity">${esc(c.theme_opacity??0.8)}</span></label><input type="range" min="0.2" max="1" step="0.05" data-key="theme_opacity" value="${esc(c.theme_opacity??0.8)}"></div>`:''}</div>
      <h3>Sizing</h3><div class="hint">1 = default size. Small screen scale enlarges boxes on phones (eases in below 900px wide). Max width 0 = fill the available width; the card never grows taller than the screen. The Today panel also shrinks automatically if it would be taller than the card.</div><div class="row compact"><div class="field"><label>Title</label><input type="number" min="0.3" max="3" step="0.05" data-key="title_scale" value="${esc(c.title_scale??1)}"></div><div class="field"><label>Device boxes</label><input type="number" min="0.5" max="2" step="0.05" data-key="device_scale" value="${esc(c.device_scale??1)}"></div><div class="field"><label>Weather box</label><input type="number" min="0.3" max="2" step="0.05" data-key="weather_scale" value="${esc(c.weather_scale??1)}"></div><div class="field"><label>Today panel</label><input type="number" min="0.3" max="1.5" step="0.05" data-key="stats_scale" value="${esc(c.stats_scale??0.8)}"></div><div class="field"><label>Small screen</label><input type="number" min="1" max="2.5" step="0.05" data-key="mobile_scale" value="${esc(c.mobile_scale??1.4)}"></div><div class="field"><label>Max width (px)</label><input type="number" min="0" step="10" data-key="max_width" value="${esc(c.max_width??0)}"></div><div class="field"><label>Grid mix</label><input type="number" min="0.3" max="2" step="0.05" data-key="grid_mix_scale" value="${esc(c.grid_mix_scale??1)}"></div><div class="field"><label>Updated box</label><input type="number" min="0.3" max="3" step="0.05" data-key="updated_scale" value="${esc(c.updated_scale??1)}"></div></div>
      <h3>Visual layout</h3>${this._layoutEditorHTML(c)}
      <h3>Devices</h3><div id="device-list">${(c.devices||[]).map((d,i)=>this._device(d,i)).join('')}</div><button class="btn" id="add">＋ Add device</button>
      <h3>Connections</h3><div class="hint">Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.</div><div id="connections">${this._connectionsHTML()}</div><button class="btn" id="add-connection">＋ Add connection</button><h3>Today statistics</h3><div class="hint">Add up to 20 custom statistics. Choose your own name, entity and icon.</div><div id="stats-list">${this._statsEditorHTML()}</div><button class="btn" id="add-stat">＋ Add statistic</button><div class="hint">Docked panels sit on an edge of the card and can't be dragged. Auto-hide shrinks the panel to a tab that slides out on hover or tap.</div><div class="row"><div class="field"><label>Today panel style</label><select data-key="stats_mode"><option value="floating" ${(c.stats_mode||'floating')==='floating'?'selected':''}>Floating (drag anywhere)</option><option value="docked" ${(c.stats_mode||'floating')==='docked'?'selected':''}>Docked to card edge</option></select></div>${c.stats_mode==='docked'?`<div class="field"><label>Dock edge</label><select data-key="stats_dock_edge"><option value="bottom" ${(c.stats_dock_edge||'bottom')==='bottom'?'selected':''}>Bottom</option><option value="top" ${(c.stats_dock_edge||'bottom')==='top'?'selected':''}>Top</option><option value="left" ${(c.stats_dock_edge||'bottom')==='left'?'selected':''}>Left</option><option value="right" ${(c.stats_dock_edge||'bottom')==='right'?'selected':''}>Right</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="stats_dock_autohide" style="width:auto" ${c.stats_dock_autohide!==false?'checked':''}> Auto-hide (slides out on hover or tap)</label></div>`:''}<div class="field"><label>On phone</label><select data-key="phone_stats_mode"><option value="same" ${(c.phone_stats_mode||'same')==='same'?'selected':''}>Same as desktop</option><option value="floating" ${(c.phone_stats_mode||'same')==='floating'?'selected':''}>Floating</option><option value="docked" ${(c.phone_stats_mode||'same')==='docked'?'selected':''}>Docked</option></select></div>${c.phone_stats_mode==='docked'?`<div class="field"><label>Phone dock edge</label><select data-key="phone_stats_dock_edge"><option value="bottom" ${(c.phone_stats_dock_edge||'bottom')==='bottom'?'selected':''}>Bottom</option><option value="top" ${(c.phone_stats_dock_edge||'bottom')==='top'?'selected':''}>Top</option><option value="left" ${(c.phone_stats_dock_edge||'bottom')==='left'?'selected':''}>Left</option><option value="right" ${(c.phone_stats_dock_edge||'bottom')==='right'?'selected':''}>Right</option></select></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="phone_stats_dock_autohide" style="width:auto" ${c.phone_stats_dock_autohide!==false?'checked':''}> Phone auto-hide</label></div>`:''}</div>
      <h3 class="section-toggle" data-toggle-section="selfsuff">${this._ssOpen?'▾':'▸'} Self-sufficiency &amp; self-consumption<span class="section-sub">${(()=>{const n=['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].filter(k=>c[k]===true).length;return n?`${n} of 4 on`:'off';})()}</span></h3><div class="section-body" data-section-body="selfsuff" ${this._ssOpen?'':'hidden'}><div class="hint"><b>Self-sufficiency</b>: share of your home's electricity that didn't come from the grid. <b>Self-consumption</b>: share of your solar you used yourself instead of exporting. Shown at the top of the Today panel. <b>Now</b> is calculated automatically from your devices; <b>today</b> uses the daily energy sensors below.</div><div class="row"><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_live" style="width:auto" ${c.self_sufficiency_live===true?'checked':''}> Self-sufficiency now</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_today" style="width:auto" ${c.self_sufficiency_today===true?'checked':''}> Self-sufficiency today</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_consumption_live" style="width:auto" ${c.self_consumption_live===true?'checked':''}> Self-consumption now</label></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_consumption_today" style="width:auto" ${c.self_consumption_today===true?'checked':''}> Self-consumption today</label></div></div><div class="hint">Daily energy sensors (kWh or Wh). Self-sufficiency today needs import and consumption; self-consumption today needs solar and export.</div><div class="row"><div class="field full"><label>Grid import today</label><ha-entity-picker data-editor-key="self_sufficiency_import_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Grid export today</label><ha-entity-picker data-editor-key="energy_export_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Solar production today</label><ha-entity-picker data-editor-key="energy_solar_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Home consumption today</label><ha-entity-picker data-editor-key="self_sufficiency_consumption_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-key="self_sufficiency_calc_consumption" style="width:auto" ${c.self_sufficiency_calc_consumption===true?'checked':''}> Calculate consumption instead (import + solar − export + battery discharge − battery charge)</label></div><div class="field full"><label>Battery charge today (optional, for calculated consumption)</label><ha-entity-picker data-editor-key="energy_battery_charge_entity" allow-custom-entity></ha-entity-picker></div><div class="field full"><label>Battery discharge today (optional, for calculated consumption)</label><ha-entity-picker data-editor-key="energy_battery_discharge_entity" allow-custom-entity></ha-entity-picker></div></div></div>
      </div>`;
      this._translateDom();
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(el=>{
        el.hass=this._hass;
        if (el.hasAttribute('data-extra-picker')) {
          const di=Number(el.dataset.deviceIndex), ei=Number(el.dataset.extraIndex);
          el.value = this._config.devices[di]?.extra_entities?.[ei]?.entity || '';
          el.addEventListener('value-changed', e=>{
            this._config.devices[di].extra_entities[ei].entity = e.detail.value || '';
            const lab = el.parentElement?.querySelector('.entity-id');
            if (lab) lab.textContent = e.detail.value || 'Not selected';
            this._emit();
          });
          return;
        }
        el.value = el.dataset.editorKey ? (this._config[el.dataset.editorKey] || '') : el.dataset.devicePicker ? (this._config.devices[Number(el.dataset.devicePicker)][el.dataset.field] || '') : (this._config.statistics?.[el.dataset.stat] || '');
        el.addEventListener('value-changed', e=>{
          if (el.dataset.editorKey) this._config[el.dataset.editorKey]=e.detail.value || '';
          else if (el.dataset.devicePicker) { const i=Number(el.dataset.devicePicker); this._config.devices[i][el.dataset.field]=e.detail.value || ''; const labels={power_entity:'[data-entity-label]'}; const lab=el.parentElement?.querySelector(labels[el.dataset.field] || '[data-entity-label]'); if(lab) lab.textContent=e.detail.value||'Not selected'; }
          else if (el.dataset.stat) { this._config.statistics ||= {}; this._config.statistics[el.dataset.stat]=e.detail.value || ''; }
          this._emit();
        });
      });
      this.shadowRoot.querySelectorAll('[data-extra-icon]').forEach(el=>{
        el.addEventListener('value-changed', e=>{
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
      this.shadowRoot.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('change',e=>{ const k=e.target.dataset.key; if(k==='flow_threshold_watts'){ const watts=Math.max(0,parseFloat(e.target.value)||0); this._config.flow_threshold=watts/1000; this._config.flow_threshold_watts=watts; } else { this._config[k]=e.target.value; if(['flow_threshold','flow_speed','flow_stagger','device_scale','mobile_scale','max_width','stats_scale','weather_scale','title_scale','grid_mix_scale','updated_scale','updated_stale_minutes','theme_opacity','phone_breakpoint','phone_bg_focus_x','phone_bg_focus_y','history_hours','history_opacity','box_opacity'].includes(k))this._config[k]=parseFloat(e.target.value)||0; if(e.target.type==='checkbox'){this._config[k]=e.target.checked;} } if(['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].includes(k)){const sub=this.shadowRoot.querySelector('[data-toggle-section="selfsuff"] .section-sub'); if(sub){const n=['self_sufficiency_live','self_sufficiency_today','self_consumption_live','self_consumption_today'].filter(x=>this._config[x]===true).length; sub.textContent=n?(langOf(this._hass)==='pl'?`włączone: ${n} z 4`:langOf(this._hass)==='es'?`${n} de 4 activadas`:`${n} of 4 on`):this._t('off');}} if(['grid_mix_enabled','updated_enabled','theme','stats_mode','phone_stats_mode','card_aspect','background_fit'].includes(k)){this._emit(false);this._render();return;} if(e.target.type==='color'){const pv=e.target.parentElement?.querySelector('.color-preview'); if(pv) pv.style.background=e.target.value;} this._emit(false); }));
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
      this.shadowRoot.querySelectorAll('[data-conn]').forEach(el=>el.addEventListener('change',e=>{
        const i=Number(el.dataset.conn),k=el.dataset.field;
        this._config.connections[i][k] = k==='direction' ? Number(e.target.value) : e.target.value;
        this._emit(false);
      }));
      this.shadowRoot.querySelector('#add-connection')?.addEventListener('click',()=>{if(this._config.devices.length<2)return;this._config.connections.push({from:this._config.devices[0].id,to:this._config.devices[1].id});this._emit(false);this._render();});
      this.shadowRoot.querySelector('#add-stat')?.addEventListener('click',()=>{this._config.statistics ||= {}; this._config.statistics.entities ||= []; if(this._config.statistics.entities.length<20){this._config.statistics.entities.push({name:'Statistic',entity:'',icon:'mdi:chart-line',custom_icon:''});this._statsOpen.set(this._config.statistics.entities.length-1,true);this._emit(false);this._render();}});
      this.shadowRoot.querySelector('#export-config')?.addEventListener('click',()=>{this._exportConfig();});
      this.shadowRoot.querySelector('#import-config-btn')?.addEventListener('click',()=>{this.shadowRoot.querySelector('[data-import-config-file]')?.click();});
      this.shadowRoot.querySelector('[data-import-config-file]')?.addEventListener('change',e=>{const f=e.target.files?.[0]; if(f) this._importConfigFile(f); e.target.value='';});
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
      this.shadowRoot.querySelectorAll('[data-stat-field]').forEach(el=>el.addEventListener('change',e=>{const i=Number(el.dataset.index); const k=el.dataset.statField; this._config.statistics.entities[i][k]=e.target.value; this._emit(false);}));
      this.shadowRoot.querySelectorAll('[data-stat-icon]').forEach(el=>{el.addEventListener('value-changed',e=>{const i=Number(el.dataset.index);this._config.statistics.entities[i].icon=e.detail.value||'mdi:chart-line';this._emit(false);});});
      this.shadowRoot.querySelectorAll('[data-stat-picker]').forEach(el=>{el.hass=this._hass; el.value=this._config.statistics.entities[Number(el.dataset.index)]?.entity||''; el.addEventListener('value-changed',e=>{this._config.statistics.entities[Number(el.dataset.index)].entity=e.detail.value||'';this._emit(false);});});
      this.shadowRoot.querySelectorAll('[data-device]').forEach(el=>el.addEventListener('change',e=>{
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
        if(k==='type'||k==='battery_time')this._render();
      }));
      this.shadowRoot.querySelectorAll('[data-invert-flow]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.invertFlow);this._config.devices[i].invert_flow=!this._config.devices[i].invert_flow;this._emit(false);this._render();}));
      this._enableLayoutDragging();
      this._applyLayoutBg();
      this.shadowRoot.querySelectorAll('[data-bg-upload-btn]').forEach(b=>b.addEventListener('click',()=>{this.shadowRoot.querySelector(`[data-bg-file="${b.dataset.bgUploadBtn}"]`)?.click();}));
      this.shadowRoot.querySelectorAll('[data-bg-file]').forEach(inp=>inp.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)this._uploadBackground(f,inp.dataset.bgFile);}));
      this.shadowRoot.querySelectorAll('[data-bg-restore]').forEach(b=>b.addEventListener('click',()=>{const slot=b.dataset.bgRestore;delete this._config[slot==='day'?'background_upload_day':'background_upload_night'];this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-bg-preview]').forEach(b=>b.addEventListener('click',()=>{this._applyLayoutBg(b.dataset.bgPreview);}));
      this.shadowRoot.querySelector('#reset-layout')?.addEventListener('click',()=>{const ph=this._layoutMode==='phone';this._config.devices.forEach(d=>delete d[ph?'phone_position':'position']);Object.values(PANEL_POS).forEach(def=>delete this._config[ph?def.phone:def.key]);this._emit(false);this._render();});
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
      const panelList=[['header','Title','🔤',true],['weather','Weather','🌤️',true],['gridmix','Grid mix','🌍',c.grid_mix_enabled===true],['updated','Updated','🕒',c.updated_enabled===true],['stats','Daily Stats','📊',true]].filter(x=>x[3]);
      const specials=panelList.filter(([k])=>!(phone&&c['phone_hide_'+k]===true)&&!(k==='stats'&&statsDockFor(c,phone).mode==='docked')).map(([k,l,ic])=>this._layoutSpecial(k,l,ic)).join('');
      const actions=phone
        ? `<button class="btn secondary-btn" id="copy-desktop-layout">⧉ Copy desktop layout</button><button class="btn secondary-btn" id="reset-layout">↺ Reset phone layout</button>`
        : `<button class="btn secondary-btn" id="reset-layout">↺ Reset positions to automatic</button>`;
      const focus=phone?`<div class="row"><div class="field"><label>Background focus ↔ <span class="small" data-focus-val="x">${esc(c.phone_bg_focus_x??50)}%</span></label><input type="range" min="0" max="100" step="1" data-key="phone_bg_focus_x" value="${esc(c.phone_bg_focus_x??50)}"></div><div class="field"><label>Background focus ↕ <span class="small" data-focus-val="y">${esc(c.phone_bg_focus_y??50)}%</span></label><input type="range" min="0" max="100" step="1" data-key="phone_bg_focus_y" value="${esc(c.phone_bg_focus_y??50)}"></div></div>`:'';
      const cbx=(attr,checked,label)=>`<label class="show-item"><input type="checkbox" ${attr} ${checked?'checked':''}> ${label}</label>`;
      const showList=phone?`<div class="field full" style="margin-top:10px"><label>Show on phone</label><div class="show-list">${panelList.map(([k,l,ic])=>cbx(`data-phone-show-panel="${k}"`,c['phone_hide_'+k]!==true,`${ic} ${esc(l)}`)).join('')}${(c.devices||[]).map((d,i)=>cbx(`data-phone-show-device="${i}"`,d.phone_hidden!==true,`${esc(ICONS[d.type]||'⚙️')} ${esc(d.name||LABELS[d.type]||'Device')}`)).join('')}</div><span class="small" style="display:block">Unticked items are hidden in the phone layout only. Hiding a device also hides its flow lines.</span></div>`:'';
      return `${seg}<div class="hint">${hint}</div>${settings}${focus}<div class="layout-editor${phone?' phone':''}" id="layout-editor" style="${phone?'':`aspect-ratio:${this._editorRatio()};min-height:0`}"><div class="layout-bg" style="${phone?`background-position:${phoneBgFocus(c)}`:''}${c.background_fit==='contain'?';background-size:contain;background-repeat:no-repeat':''}"></div>${(c.devices||[]).map((d,i)=>this._layoutNode(d,i)).join('')}${specials}</div><div class="layout-actions">${actions}</div>${showList}`;
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
    _layoutNode(d,i){ if(this._layoutMode==='phone'&&d.phone_hidden===true) return ''; const p=this._editorLayoutPositions()[i]; return `<div class="layout-node" data-layout-kind="device" data-layout-index="${i}" style="left:${p.x}%;top:${p.y}%"><div class="ln-top">${esc(ICONS[d.type] || '⚙️')} ${esc(d.name || LABELS[d.type] || 'Device')}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div></div>`; }
    _layoutSpecial(kind,label,icon){ const p=this._editorPanelPos(kind); return `<div class="layout-node special" data-layout-kind="${kind}" style="left:${p.x}%;top:${p.y}%"><div class="ln-top">${icon} ${label}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div></div>`; }
    _autoPreviewPosition(d,i){ const zones={solar:[18,23],inverter:[56,39],battery:[58,65],gateway:[48,78],house:[28,82],grid:[82,84],generator:[18,62],water:[14,90],gas:[40,92],ev:[83,50],load:[76,67]}; const same=this._config.devices.filter(x=>(x.type||'load')===(d.type||'load')); const n=same.indexOf(d); const [cx,cy]=zones[d.type||'load']||[70,68]; const spacing=Math.min(15,70/Math.max(1,same.length)); let x=cx,y=cy;if(same.length>1)x=cx+(n-(same.length-1)/2)*spacing;if((d.type==='battery'&&same.length>3)){const col=n%3,row=Math.floor(n/3);x=48+col*12;y=64+row*12;}if(d.type==='solar'&&same.length>4){const col=n%4,row=Math.floor(n/4);x=33+col*12;y=22+row*11;}if(d.type==='ev'&&same.length>2){const col=n%2,row=Math.floor(n/2);x=78+col*10;y=45+row*13;}return{x,y}; }
    _enableLayoutDragging(){ const area=this.shadowRoot.querySelector('#layout-editor'); if(!area)return; area.querySelectorAll('.layout-node').forEach(node=>{ let dragging=false; const move=e=>{if(!dragging)return;const r=area.getBoundingClientRect();let x=((e.clientX-r.left)/r.width)*100;let y=((e.clientY-r.top)/r.height)*100;const kind=node.dataset.layoutKind; if(kind==='header'){x=Math.max(0,Math.min(85,x));y=Math.max(0,Math.min(90,y));} else {x=Math.max(5,Math.min(95,x));y=Math.max(6,Math.min(94,y));} const phoneMode=this._layoutMode==='phone'; if(kind==='device'){const i=Number(node.dataset.layoutIndex);this._config.devices[i][phoneMode?'phone_position':'position']={x,y};} else if(PANEL_POS[kind]) this._config[phoneMode?PANEL_POS[kind].phone:PANEL_POS[kind].key]={x,y}; node.style.left=x+'%';node.style.top=y+'%';const pos=node.querySelector('.ln-pos');if(pos)pos.textContent=`${x.toFixed(1)}% × ${y.toFixed(1)}%`;}; const up=()=>{if(!dragging)return;dragging=false;node.classList.remove('dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);this._emit(false);}; node.addEventListener('pointerdown',e=>{e.preventDefault();dragging=true;node.classList.add('dragging');node.setPointerCapture?.(e.pointerId);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}); }); }

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
      const values=devices.map(d=>powerValue(this._hass,d.power_entity));
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
      const histField = `<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="history_graph" style="width:auto" ${d.history_graph===true?'checked':''}> Show history graph</label><span class="small" style="display:block">Power history as a faint graph behind the box. Range and opacity are under Appearance.</span></div>`;
      const battTimeFields = d.type!=='battery' ? '' : `<div class="field full"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="battery_time" style="width:auto" ${d.battery_time===true?'checked':''}> Show time remaining</label><span class="small" style="display:block">Estimated time to full (charging) or to reserve (discharging), shown under the power value.</span></div>`+(d.battery_time!==true?'':`<div class="field full"><label>State of charge (%)</label><ha-entity-picker data-device-picker="${i}" data-field="battery_soc_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label>Capacity (kWh)</label><input type="number" min="0" step="0.1" data-device="${i}" data-field="battery_capacity" value="${esc(d.battery_capacity??'')}" placeholder="e.g. 13.5"></div><div class="field"><label>Reserve %</label><input type="number" min="0" max="99" step="1" data-device="${i}" data-field="battery_reserve" value="${esc(d.battery_reserve??0)}"></div><div class="field"><label>Charge limit %</label><input type="number" min="1" max="100" step="1" data-device="${i}" data-field="battery_charge_limit" value="${esc(d.battery_charge_limit??100)}"></div><div class="field full"><label>Capacity sensor (optional, overrides the number above)</label><ha-entity-picker data-device-picker="${i}" data-field="battery_capacity_entity" allow-custom-entity></ha-entity-picker></div>`);
      const utilityFields = d.type==='water' ? `<div class="field full"><span class="small">Shown in litres. Sensors reporting m³ are converted automatically. On Automatic, water connects to your House device.</span></div>` : d.type==='gas' ? `<div class="field"><label>Show gas in</label><select data-device="${i}" data-field="utility_unit"><option value="m³" ${d.utility_unit!=='kWh'?'selected':''}>m³</option><option value="kWh" ${d.utility_unit==='kWh'?'selected':''}>kWh</option></select></div><div class="field"><label>Calorific value (MJ/m³)</label><input type="number" min="30" max="45" step="0.1" data-device="${i}" data-field="gas_cv" value="${esc(d.gas_cv??39.5)}"></div><div class="field full"><span class="small">Used to convert between m³ and kWh (see your gas bill). On Automatic, gas connects to your House device.</span></div>` : '';
      const battGlowField = d.type==='battery' ? `<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" data-device="${i}" data-field="battery_glow" style="width:auto" ${d.battery_glow===false?'':'checked'}> Show charge/discharge glow</label><span class="small" style="display:block">Pulses the box when actively charging or discharging.</span></div>` : '';
      const body = deviceOpen ? `<div class="row"><div class="field"><label>Type</label><select data-device="${i}" data-field="type">${TYPES.map(t=>`<option value="${t[0]}" ${d.type===t[0]?'selected':''}>${esc(t[1])}</option>`).join('')}</select></div><div class="field"><label>Name</label><input data-device="${i}" data-field="name" value="${esc(d.name||'')}"></div>${entityField('power_entity',(d.type==='water'||d.type==='gas')?'Meter or flow entity':'Power entity','data-entity-label')}${connectsToField}<div class="field"><label>Flow colour</label><div class="ha-color-box"><input class="ha-color-picker" type="color" title="Choose flow colour" data-device="${i}" data-field="flow_color" value="${esc(d.flow_color || FLOW_COLORS[d.type] || FLOW_COLORS.neutral)}"><span class="color-preview" style="background:${esc(d.flow_color || FLOW_COLORS[d.type] || FLOW_COLORS.neutral)}"></span></div><span class="small" style="display:block">Only used if this device has its own power entity.</span></div><div class="field"><label>Flow direction</label><button class="btn ${inverted?'secondary-btn':''}" type="button" data-invert-flow="${i}">${inverted?'↔ Inverted':'↔ Normal'}<span class="small" style="display:block">Visual direction only</span></button><div class="flow-live" data-flow-live="${i}"></div></div>${histField}${battGlowField}${battTimeFields}${utilityFields}</div><button class="btn secondary-btn" type="button" data-toggle-extras="${esc(d.id)}">${expanded?'▾':'▸'} Extra entities${extras.length?` (${extras.length}/5)`:' (optional)'}</button>${extrasBody}` : '';
      return `<div class="device sort-item" data-sort-index="${i}"><div class="device-head"><span class="drag-handle" data-sort-handle title="Drag to reorder"><ha-icon icon="mdi:drag-horizontal-variant"></ha-icon></span><span class="device-title" data-toggle-device="${esc(d.id)}">${deviceOpen?'▾':'▸'} ${esc(ICONS[d.type]||'⚙️')} ${esc(d.name||'Device')}${!deviceOpen && d.power_entity ? `<span class="device-sub">${esc(d.power_entity)}</span>`:''}</span><span class="device-actions"><button class="dup-btn" title="Duplicate device" data-duplicate="${i}"><ha-icon icon="mdi:content-copy"></ha-icon></button><button title="Remove" data-remove="${i}">×</button></span></div>${body}</div>`;
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
    async _uploadBackground(file, slot){
      if (!file || !this._hass) return;
      const statusEl = this.shadowRoot.querySelector(`[data-bg-status="${slot}"]`);
      if (statusEl) statusEl.textContent = this._t('Uploading…');
      try {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g,'') || 'png';
        const filename = `home-power-flow-card-${slot}.${ext}`;
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
        this._config[slot === 'day' ? 'background_upload_day' : 'background_upload_night'] = path;
        this._emit(false);
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
      const bg = slot === 'night'
        ? (this._config.background_upload_night || this._config.background_night || DEFAULT_BG_NIGHT)
        : (this._config.background_upload_day || this._config.background || DEFAULT_BG);
      const grad = 'linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.25))';
      if (!bg.startsWith('/media/')) { bgEl.style.backgroundImage = `${grad},url('${bg}')`; return; }
      try {
        const token = this._hass?.auth?.data?.access_token;
        const resp = await fetch(bg, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        bgEl.style.backgroundImage = `${grad},url('${URL.createObjectURL(blob)}')`;
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
      </div>`:'';
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
          const up=()=>{
            h.removeEventListener('pointermove',move); h.removeEventListener('pointerup',up); h.removeEventListener('pointercancel',up);
            item.classList.remove('sorting');
            const to=[...list.querySelectorAll(':scope > .sort-item')].indexOf(item);
            if(to>=0&&to!==from) onMove(from,to); else this._render();
          };
          h.addEventListener('pointermove',move); h.addEventListener('pointerup',up); h.addEventListener('pointercancel',up);
        });
      });
    }
    _statField(key,label){const s=this._config.statistics||{};return `<div class="field"><label>${label}</label><ha-entity-picker data-stat="${key}" allow-custom-entity></ha-entity-picker></div>`;}
    _emit(syncStats=true){
      this._config.statistics ||= {};
      if(syncStats) this.shadowRoot.querySelectorAll('[data-stat]').forEach(el=>this._config.statistics[el.dataset.stat]=el.value);
      // Emit the config without rebuilding this editor. Home Assistant may call
      // setConfig afterwards; setConfig now ignores identical configs.
      fire(this,'config-changed',{config:JSON.parse(JSON.stringify(this._config))});
    }
  }

  if(!customElements.get('home-power-flow-card')) customElements.define('home-power-flow-card',HomePowerFlowCard);
  if(!customElements.get('home-power-flow-card-editor')) customElements.define('home-power-flow-card-editor',HomePowerFlowEditor);
  window.customCards = window.customCards || [];
  if(!window.customCards.some(c=>c.type==='home-power-flow-card')) window.customCards.push({type:'home-power-flow-card',name:'Home Power Flow Card',description:'Configurable visual home energy flow card',preview:true,documentationURL:'https://github.com/mimikm/Home-Power-Flow-Card'});
  console.info(`%c Home Power Flow Card %c v${VERSION} `,'background:#173a55;color:#fff;padding:4px 8px','background:#62ff7b;color:#07130a;padding:4px 8px');
})();
