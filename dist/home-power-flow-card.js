/* Home Power Flow Card V1 - standalone Lovelace custom element */
(() => {
  const VERSION = '0.5.7';
  const DEFAULT_BG = '/hacsfiles/Home-Power-Flow-Card/smart-home-energy-background.png';
  const DEFAULT_BG_NIGHT = '/hacsfiles/Home-Power-Flow-Card/smart-home-energy-background2.png';
  const TYPES = [
    ['solar', '☀️ Solar PV'],
    ['inverter', '⚡ Inverter'],
    ['battery', '🔋 Battery'],
    ['gateway', '🧠 Gateway'],
    ['house', '🏠 House'],
    ['grid', '⚡ Grid'],
    ['ev', '🚗 EV Charger'],
    ['load', '⚙️ Extra Load'],
  ];

  const ICONS = {
    solar: '☀️', inverter: '⚡', battery: '🔋', gateway: '🧠', house: '🏠', grid: '⚡', ev: '🚗', load: '⚙️'
  };

  const LABELS = Object.fromEntries(TYPES);

  const FLOW_COLORS = {
    solar: '#63ff7d',
    inverter: '#a78bfa',
    battery: '#ff5c5c',
    gateway: '#b98cff',
    house: '#ffb52e',
    grid: '#43a5ff',
    ev: '#ffd43b',
    load: '#ff9f2d',
    neutral: '#aab7c4'
  };

  function flowColor(a, b, reverse, active, customColors = {}) {
    const colors = { ...FLOW_COLORS, ...(customColors || {}) };
    if (!active) return colors.neutral || FLOW_COLORS.neutral;
    const source = reverse ? b : a;
    return colors[source?.type || 'neutral'] || colors.neutral || FLOW_COLORS.neutral;
  }

  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const fmtPower = v => { const n = num(v); return `${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)} W`; };
  const fmtEnergy = v => {
    const n = num(v);
    return `${n.toFixed(n >= 100 ? 0 : 1)} kWh`;
  };

  function fire(el, type, detail) {
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
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
          { type: 'inverter', name: 'Inverter 1', power_entity: '', temp_entity: '' },
          { type: 'battery', name: 'Battery 1', power_entity: '', soc_entity: '', voltage_entity: '', temp_entity: '' },
          { type: 'house', name: 'House', power_entity: '' },
          { type: 'grid', name: 'Grid', power_entity: '', voltage_entity: '', frequency_entity: '' }
        ],
        statistics: {},
        connections: [],
        flow_speed: 8,
        flow_stagger: 0.55,
        flow_threshold: 0.0005,
        flow_colors: { ...FLOW_COLORS }
      };
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
      this._config = JSON.parse(JSON.stringify(config));
      this._flowSnapshot = null;
      if (!Array.isArray(this._config.devices)) this._config.devices = [];
      if (!Array.isArray(this._config.connections)) this._config.connections = [];
      this._config.devices = this._config.devices.map(d => { const copy={...d}; copy.invert_flow = Boolean(copy.invert_flow || copy.power_sign === 'negative_output'); delete copy.power_sign; return copy; });
      this._config.flow_colors = { ...FLOW_COLORS, ...(this._config.flow_colors || {}) };
      // V4.3.10 stores the threshold canonically in watts. Migrate older configs
      // where flow_threshold was stored in kW.
      if (!Number.isFinite(Number(this._config.flow_threshold_watts))) {
        const legacy = Number(this._config.flow_threshold);
        this._config.flow_threshold_watts = Number.isFinite(legacy) ? legacy * 1000 : 0.5;
      }
      this._config.flow_threshold = Number(this._config.flow_threshold_watts) / 1000;
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

    getCardSize() { return 8; }

    disconnectedCallback() {
      if (this._timer) clearInterval(this._timer);
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
      const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
      const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: c.time_format === '12h' }).format(now);

      const devices = c.devices || [];
      if (!this._flowSnapshot) this._captureFlowSnapshot(devices);
      const groups = {};
      for (const d of devices) {
        const type = d.type || 'load';
        (groups[type] ||= []).push(d);
      }

      const layout = this._layout(devices);
      const nodes = devices.map((d, i) => this._deviceHTML(d, i, layout[i])).join('');
      const flows = this._flows(devices, layout);
      const stats = this._statsHTML(c.statistics || {});

      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; width:100%; }
          * { box-sizing:border-box; }
          .card { position:relative; width:100%; min-height:700px; aspect-ratio: 1.5 / 1; overflow:hidden; border-radius:22px; color:#fff; font-family:var(--primary-font-family,Arial,sans-serif); background:#101820; box-shadow:0 12px 40px rgba(0,0,0,.28); }
          .bg { position:absolute; inset:0; background-size:cover; background-position:center; }
          .vignette { position:absolute; inset:0; background:radial-gradient(circle at 55% 45%,transparent 25%,rgba(0,0,0,.12) 72%,rgba(0,0,0,.32)); pointer-events:none; }
          .header { position:absolute; left:2.6%; top:2.7%; z-index:20; }
          .title { font-size:clamp(24px,3vw,44px); font-weight:700; letter-spacing:-.03em; text-shadow:0 2px 8px rgba(0,0,0,.4); }
          .subtitle { margin-top:4px; font-size:clamp(12px,1.25vw,19px); opacity:.88; text-shadow:0 2px 8px rgba(0,0,0,.45); }
          .weather { position:absolute; z-index:20; left:var(--weather-x,82%); top:var(--weather-y,10%); transform:translate(-50%,-50%); min-width:250px; max-width:31%; padding:13px 17px; border-radius:17px; background:rgba(8,29,52,.78); border:1px solid rgba(255,255,255,.15); box-shadow:0 8px 28px rgba(0,0,0,.25); backdrop-filter:blur(12px); display:grid; grid-template-columns:1fr auto; gap:4px 14px; }
          .date { font-size:14px; opacity:.82; align-self:end; }.clock { font-size:26px; font-weight:700; }.wicon { grid-row:1/3; grid-column:2; font-size:35px; align-self:center; }.temp { font-size:23px; font-weight:600; }.wstate { font-size:13px; opacity:.85; }
          .stats { position:absolute; z-index:18; left:var(--stats-x,17%); top:var(--stats-y,86%); transform:translate(-50%,-50%); width:min(360px,30%); padding:18px 20px; border-radius:21px; background:linear-gradient(145deg,rgba(45,38,33,.74),rgba(18,25,31,.74)); border:1px solid rgba(255,255,255,.18); box-shadow:0 10px 30px rgba(0,0,0,.24); backdrop-filter:blur(12px); }
          .stats h3 { margin:0 0 14px; font-size:20px; }.stat { display:grid; grid-template-columns:28px 1fr auto; align-items:center; gap:7px; padding:8px 0; font-size:14px; }.stat .ico{font-size:19px}.stat .value{font-weight:700;font-size:15px}.co2{border-top:1px solid rgba(255,255,255,.18);margin-top:7px;padding-top:12px;color:#d6f5d0}
          .canvas { position:absolute; inset:0; z-index:5; }
          svg.flows { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
          .flow-path { fill:none; stroke-linecap:round; filter:url(#glow); opacity:.92; }
          .flow-dot { filter:url(#dotglow); }
          .node { position:absolute; transform:translate(-50%,-50%); width:clamp(135px,13vw,205px); min-height:74px; padding:11px 13px; border-radius:15px; z-index:10; background:linear-gradient(145deg,rgba(9,25,40,.87),rgba(15,30,44,.73)); border:1px solid rgba(255,255,255,.17); box-shadow:0 8px 22px rgba(0,0,0,.32); backdrop-filter:blur(10px); }
          .node .top { display:flex; align-items:center; gap:8px; }.node .icon { font-size:24px; line-height:1; }.node .name { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.node .power { margin-top:5px; font-size:19px; font-weight:750; }.node .secondary { margin-top:2px; font-size:11px; opacity:.76; }.node.battery { border-color:rgba(123,255,158,.28); }.node.grid { border-color:rgba(93,191,255,.3); }.node.ev { border-color:rgba(151,255,103,.28); }
          .legend { position:absolute; right:2.6%; bottom:3.2%; z-index:18; padding:9px 12px; border-radius:12px; background:rgba(4,15,25,.55); font-size:11px; opacity:.8; backdrop-filter:blur(8px); }
          .empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:30; }.empty > div { padding:24px 30px; background:rgba(10,25,38,.82); border-radius:18px; border:1px solid rgba(255,255,255,.18); text-align:center; backdrop-filter:blur(10px); }.empty b{display:block;font-size:20px;margin-bottom:6px}.empty span{opacity:.75}
          @media (max-width: 800px) { .card{aspect-ratio:auto; min-height:760px}.weather{min-width:190px;padding:10px 12px}.header{top:2%;left:2%}.stats{width:46%;min-width:260px}.node{width:130px}.legend{display:none} }
          @media (max-width: 560px) { .card{min-height:900px}.title{font-size:27px}.subtitle{font-size:12px}.weather{max-width:45%;min-width:150px}.date{font-size:10px}.clock{font-size:19px}.temp{font-size:17px}.wicon{font-size:25px}.stats{width:62%;min-width:230px}.node{width:120px;padding:9px}.node .power{font-size:16px}.node .name{font-size:12px} }
        </style>
        <div class="card">
          <div class="bg"></div><div class="vignette"></div>
          <div class="header"><div class="title">${esc(c.title || 'Energy Flow')}</div><div class="subtitle">${esc(c.subtitle || 'Live • Efficient • Sustainable')}</div></div>
          <div class="weather" style="--weather-x:${this._uiPosition(c.weather_position, 82, 10).x}%;--weather-y:${this._uiPosition(c.weather_position, 82, 10).y}%"><div class="date">${esc(date)}</div><div class="clock">${esc(time)}</div><div class="wicon">${weatherIcon}</div><div class="temp">${weatherTemp != null ? esc(weatherTemp) + esc(weatherUnit) : '—'}</div><div class="wstate">${esc(weatherText)}</div></div>
          <div class="canvas"><svg class="flows" viewBox="0 0 1000 667" preserveAspectRatio="none">${flows}</svg>${nodes}</div>
          ${stats ? stats.replace('<div class="stats">', `<div class="stats" style="--stats-x:${this._uiPosition(c.stats_position, 17, 86).x}%;--stats-y:${this._uiPosition(c.stats_position, 17, 86).y}%">`) : ''}
          <div class="legend">Single moving dot = active power &nbsp;•&nbsp; Flow color follows source</div>
          ${devices.length ? '' : '<div class="empty"><div><b>Add your first device</b><span>Open the card editor and add Solar, Inverter, Battery, Grid or House.</span></div></div>'}
        </div>`;

      this._rendered = true;
      this._applyBackground(bg);
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
    async _applyBackground(bg) {
      const bgEl = this.shadowRoot?.querySelector('.bg');
      if (!bgEl || !bg) return;
      const grad = 'linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.22))';
      if (!bg.startsWith('/media/')) {
        bgEl.style.backgroundImage = `${grad},url('${bg}')`;
        return;
      }
      this._bgBlobUrls ||= {};
      if (this._bgBlobUrls[bg]) {
        bgEl.style.backgroundImage = `${grad},url('${this._bgBlobUrls[bg]}')`;
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
          if (el) el.style.backgroundImage = `${grad},url('${url}')`;
        }
      } catch (e) {
        console.error('Home Power Flow Card: failed to load uploaded background', bg, e);
      }
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
        const st = state(this._hass, d.power_entity);
        const power = powerValue(this._hass, d.power_entity);
        const soc = entityValue(this._hass, d.soc_entity);
        const voltage = entityValue(this._hass, d.voltage_entity);
        const temp = entityValue(this._hass, d.temp_entity);
        const frequency = entityValue(this._hass, d.frequency_entity);
        const powerEl = node.querySelector('.power');
        const secEl = node.querySelector('.secondary');
        if (powerEl) powerEl.textContent = power == null ? '—' : fmtPower(power);
        if (secEl) {
          if (d.type === 'battery') {
            const parts=[];
            if (soc != null) parts.push(`${soc.toFixed(0)}% SOC`);
            if (voltage != null) parts.push(`${voltage.toFixed(1)} V`);
            if (temp != null) parts.push(`${temp.toFixed(1)} °C`);
            secEl.innerHTML = parts.map(esc).join('<br>') || 'Battery';
          } else if (d.type === 'inverter') {
            secEl.textContent = temp != null ? `${temp.toFixed(1)} °C` : 'Inverter';
          } else if (d.type === 'grid') {
            const parts=[]; if (voltage != null) parts.push(`${voltage.toFixed(1)} V`); if (frequency != null) parts.push(`${frequency.toFixed(2)} Hz`); secEl.innerHTML = parts.map(esc).join('<br>') || 'Grid';
          } else secEl.textContent = st?.attributes?.unit_of_measurement || 'Power';
        }
      });
      const c = this._config;
      const weather = state(this._hass, c.weather_entity);
      const weatherTemp = weather?.attributes?.temperature;
      const weatherUnit = weather?.attributes?.temperature_unit || '°C';
      const weatherText = weather ? (weather.attributes?.friendly_name || weather.state || 'Weather') : '';
      const weatherIcon = weather ? this._weatherIcon(weather.state) : '☀️';
      const now = new Date();
      const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
      const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: c.time_format === '12h' }).format(now);
      const dateEl=this.shadowRoot.querySelector('.date'), timeEl=this.shadowRoot.querySelector('.clock'), tempEl=this.shadowRoot.querySelector('.temp'), stateEl=this.shadowRoot.querySelector('.wstate'), iconEl=this.shadowRoot.querySelector('.wicon');
      if(dateEl) dateEl.textContent=date; if(timeEl) timeEl.textContent=time; if(tempEl) tempEl.textContent=weatherTemp != null ? `${weatherTemp}${weatherUnit}` : '—'; if(stateEl) stateEl.textContent=weatherText; if(iconEl) iconEl.textContent=weatherIcon;

      // Flow direction/activity is derived from the CURRENT entity values.
      // Rebuild only when active/inactive state or direction changes, so normal
      // value changes do not restart the travelling-dot animation.
      const currentSnapshot = {};
      devices.forEach((d, i) => { currentSnapshot[i] = powerValue(this._hass, d.power_entity); });
      const nextFlowKey = this._flowStateKey(devices, currentSnapshot);
      if (nextFlowKey !== this._flowVisualKey) {
        this._flowSnapshot = currentSnapshot;
        this._flowVisualKey = nextFlowKey;
        const svg = this.shadowRoot.querySelector('svg.flows');
        if (svg) {
          const layout = this._layout(devices);
          svg.innerHTML = this._flows(devices, layout);
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

    _layout(devices) {
      const zones = {
        solar: [18, 23], inverter: [56, 39], battery: [58, 65], gateway: [48, 78], house: [28, 82], grid: [82, 84], ev: [83, 50], load: [76, 67]
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

    _deviceHTML(d, i, p) {
      const s = state(this._hass, d.power_entity);
      const power = powerValue(this._hass, d.power_entity);
      const soc = entityValue(this._hass, d.soc_entity);
      const voltage = entityValue(this._hass, d.voltage_entity);
      const temp = entityValue(this._hass, d.temp_entity);
        const frequency = entityValue(this._hass, d.frequency_entity);
      const powerText = power == null ? '—' : fmtPower(power);
      let secHtml = '';
      if (d.type === 'battery') {
        const parts=[];
        if (soc != null) parts.push(`${soc.toFixed(0)}% SOC`);
        if (voltage != null) parts.push(`${voltage.toFixed(1)} V`);
        if (temp != null) parts.push(`${temp.toFixed(1)} °C`);
        secHtml = parts.length ? parts.map(esc).join('<br>') : 'Battery';
      } else if (d.type === 'inverter') {
        secHtml = temp != null ? `${temp.toFixed(1)} °C` : 'Inverter';
      } else if (d.type === 'grid') {
        const frequency = entityValue(this._hass, d.frequency_entity); const parts=[]; if (voltage != null) parts.push(`${voltage.toFixed(1)} V`); if (frequency != null) parts.push(`${frequency.toFixed(2)} Hz`); secHtml = parts.length ? parts.map(esc).join('<br>') : 'Grid';
      } else {
        secHtml = s?.attributes?.unit_of_measurement || 'Power';
      }
      return `<div class="node ${esc(d.type || 'load')}" data-device-index="${i}" data-entity-id="${esc(d.power_entity || '')}" title="${esc(d.power_entity ? 'Open ' + d.power_entity : '')}" style="left:${p.x}%;top:${p.y}%"><div class="top"><span class="icon">${esc(d.icon || ICONS[d.type] || '⚙️')}</span><span class="name">${esc(d.name || LABELS[d.type] || 'Device')}</span></div><div class="power">${esc(powerText)}</div><div class="secondary">${secHtml}</div></div>`;
    }

    _flowDirection(a, b, va, vb) {
      const ta = a.type || 'load', tb = b.type || 'load';
      const threshold = Math.max(0, Number.isFinite(Number(this._config.flow_threshold_watts)) ? Number(this._config.flow_threshold_watts) : 0.5);

      // A connection is active only when BOTH endpoint entities have a
      // meaningful non-zero power value. This is important for loads such as
      // Zappi: if the Zappi reports 0 W, its flow must disappear even when
      // the upstream inverter still has power available.
      if (va == null || vb == null || !Number.isFinite(Number(va)) || !Number.isFinite(Number(vb))) return {active:false, reverse:false, magnitude:0};
      const aa = Math.abs(Number(va)), ab = Math.abs(Number(vb));
      if (aa < threshold || ab < threshold) return {active:false, reverse:false, magnitude:0};

      // Universal rule: positive = output, negative = input. Each device can invert it.
      const output = (d, v) => {
        if (v == null) return null;
        const positiveIsOutput = Number(v) > 0;
        return d && d.invert_flow ? !positiveIsOutput : positiveIsOutput;
      };

      let reverse = false;
      const oa = output(a, va), ob = output(b, vb);
      if (oa === true && ob === false) reverse = false;
      else if (ob === true && oa === false) reverse = true;
      else if (oa === true && ob !== true) reverse = false;
      else if (ob === true && oa !== true) reverse = true;
      else {
        if (ta === 'grid') reverse = va > 0;
        else if (tb === 'grid') reverse = vb > 0;
        else if (ta === 'battery' && va > 0) reverse = true;
        else if (tb === 'battery' && vb > 0) reverse = false;
        else if (ta === 'house' || ta === 'load' || ta === 'ev') reverse = true;
      }

      return {active:true, reverse, magnitude:Math.max(aa,ab)};
    }

    _flowEdges(devices) {
      const edges = [];
      const valid = e => e && Number.isInteger(Number(e.from)) && Number.isInteger(Number(e.to)) && devices[e.from] && devices[e.to] && Number(e.from) !== Number(e.to);
      if (Array.isArray(this._config.connections) && this._config.connections.length) {
        this._config.connections.forEach(e => { if (valid(e)) edges.push([Number(e.from), Number(e.to), Number(e.direction || 0)]); });
      } else {
        const by = type => devices.map((d,i) => ({d,i})).filter(x => (x.d.type || 'load') === type);
        const solar=by('solar'), inv=by('inverter'), bat=by('battery'), gw=by('gateway'), house=by('house'), grid=by('grid'), ev=by('ev'), loads=by('load');
        const add=(a,b)=>{ if(a&&b) edges.push([a.i,b.i,0]); };
        solar.forEach((s,j)=>add(s,inv[j%inv.length]||inv[0]||house[0]));
        inv.forEach(i=>{ bat.forEach(b=>add(i,b)); ev.forEach(e=>add(i,e)); loads.forEach(l=>add(i,l)); if(house[0]) add(i,house[0]); });
        const hub=gw[0]||inv[0]; if(hub){ if(house[0]&&!inv.length)add(hub,house[0]); if(grid[0])add(hub,grid[0]); if(ev.length&&!inv.length)ev.forEach(e=>add(hub,e)); }
        if(!hub&&house[0]&&grid[0])add(house[0],grid[0]);
      }
      return edges;
    }

    _flowStateKey(devices, snapshot) {
      if (!devices.length) return '';
      const seen = new Set();
      return this._flowEdges(devices).map(([a,b,dir]) => {
        const key=`${a}-${b}`;
        if (seen.has(key)) return '';
        seen.add(key);
        const info=this._flowDirection(devices[a], devices[b], snapshot?.[a], snapshot?.[b]);
        let reverse=info.reverse;
        if(Number(dir)===1) reverse=false;
        if(Number(dir)===2) reverse=true;
        return `${key}:${info.active?1:0}:${info.active?Number(reverse):0}`;
      }).join('|');
    }

    _flows(devices, pos) {
      if (!devices.length) return '';
      const edges = this._flowEdges(devices);
      const seen=new Set();
      const speed=Math.max(3,Math.min(30,num(this._config.flow_speed)||8));
      const stagger=Math.max(.15,Math.min(1.5,num(this._config.flow_stagger)||.55));
      return edges.map(([a,b,dir],idx)=>{
        const key=`${a}-${b}`; if(seen.has(key))return ''; seen.add(key);
        const A=pos[a],B=pos[b]; if(!A||!B)return '';
        const x1=A.x*10,y1=A.y*6.67,x2=B.x*10,y2=B.y*6.67,dx=(x2-x1)*.38;
        const path=`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
        const da=devices[a],db=devices[b],va=this._flowSnapshot?.[a],vb=this._flowSnapshot?.[b];
        const info=this._flowDirection(da,db,va,vb);
        // No valid entity value = no visible connection. Zero/below threshold
        // also remains completely hidden until meaningful power exists.
        if (!info.active) return '';
        let reverse=info.reverse;
        if(Number(dir)===1)reverse=false; if(Number(dir)===2)reverse=true;
        const id=`flow${a}_${b}_${idx}`,duration=speed.toFixed(2)+'s';
        const stroke=flowColor(da,db,reverse,true,this._config.flow_colors);
        const width=2.1;
        const delay=(idx*stagger).toFixed(2)+'s';
        return `<path id="${id}" class="flow-path" d="${path}" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="0.12 1.75" pathLength="100" opacity=".92"></path><circle class="flow-dot" r="2.4" fill="${stroke}"><animateMotion dur="${duration}" begin="-${delay}" repeatCount="indefinite" rotate="auto" ${reverse?'keyPoints="1;0" keyTimes="0;1"':''}><mpath href="#${id}"/></animateMotion></circle>`;
      }).join('');
    }

    _statsHTML(s) {
      const rows = [
        ['☀️','Solar Generation',s.solar_energy],
        ['🏠','House Consumption',s.house_energy],
        ['⚡','Exported to Grid',s.grid_export],
        ['🔋','Battery Charge',s.battery_charge],
      ].filter(r => r[2]);
      if (!rows.length && !s.co2_saved) return '';
      return `<div class="stats"><h3>${esc(s.title || 'Today')}</h3>${rows.map(r=>`<div class="stat"><span class="ico">${r[0]}</span><span>${esc(r[1])}</span><span class="value">${esc(this._energyEntity(r[2]))}</span></div>`).join('')}${s.co2_saved ? `<div class="stat co2"><span class="ico">🌿</span><span>CO₂ Saved</span><span class="value">${esc(this._energyEntity(s.co2_saved))}</span></div>`:''}</div>`;
    }

    _energyEntity(entity) {
      const s = state(this._hass, entity); if (!s) return '—'; const v = parseFloat(s.state); if (!Number.isFinite(v)) return s.state; return fmtEnergy(v).replace(' kWh',' ') + (s.attributes?.unit_of_measurement || 'kWh');
    }
  }

  class HomePowerFlowEditor extends HTMLElement {
    constructor(){ super(); this._config={}; this._hass=null; this.attachShadow({mode:'open'}); }
    setConfig(config){
      const next=JSON.parse(JSON.stringify(config||{}));
      next.devices ||= [];
      next.connections ||= [];
      next.statistics ||= {};
      const changed=JSON.stringify(next)!==JSON.stringify(this._config);
      this._config=next;
      if(changed || !this.shadowRoot.firstElementChild) this._render();
    }
    set hass(h){
      this._hass=h;
      // Do not rebuild the editor on every HA state update. Rebuilding the
      // DOM destroys focus and closes entity pickers while the user is typing.
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(el=>{ el.hass=h; });
      this._enlargeDialogPreview();
    }
    connectedCallback(){ this._enlargeDialogPreview(); }
    _enlargeDialogPreview(){
      // Home Assistant renders custom card editors inside hui-dialog-edit-card.
      // The standard dialog gives the preview a fairly small card width and our
      // card's 700px minimum height makes it even narrower. When this editor is
      // opened, enlarge only the preview instance; dashboard cards are untouched.
      let root=this.getRootNode();
      let host=root && root.host;
      let dialog=null;
      for(let i=0;i<8 && host;i++){
        if(String(host.tagName||'').toLowerCase()==='hui-dialog-edit-card'){ dialog=host; break; }
        root=host.getRootNode?.();
        host=root?.host;
      }
      if(!dialog?.shadowRoot) return;
      const preview=dialog.shadowRoot.querySelector('.element-preview');
      const previewCard=preview?.querySelector('hui-card');
      if(!preview || !previewCard) return;
      // The HA editor dialog can be resized, but its preview column/card keeps
      // a conservative max-width unless we explicitly override the layout.
      // Make the preview column and card consume the available right-hand space.
      preview.style.minWidth='0';
      preview.style.width='min(62vw, 980px)';
      preview.style.maxWidth='none';
      preview.style.flex='1 1 0';
      preview.style.overflow='auto';
      preview.style.boxSizing='border-box';
      previewCard.style.maxWidth='none';
      previewCard.style.width='100%';
      previewCard.style.minWidth='0';
      previewCard.style.margin='0';
      previewCard.style.boxSizing='border-box';
      const dialogStyle=dialog.shadowRoot.querySelector('style[data-home-power-flow-preview]') || document.createElement('style');
      dialogStyle.setAttribute('data-home-power-flow-preview','');
      dialogStyle.textContent=`
        .element-preview { flex:1 1 0 !important; width:min(62vw,980px) !important; max-width:none !important; min-width:0 !important; }
        .element-preview > * { width:100% !important; max-width:none !important; min-width:0 !important; box-sizing:border-box !important; }
        .element-preview hui-card { display:block !important; width:100% !important; max-width:none !important; min-width:0 !important; }
      `;
      if(!dialogStyle.parentNode) dialog.shadowRoot.appendChild(dialogStyle);
      const applyInner=()=>{
        const inner=previewCard.querySelector('home-power-flow-card');
        if(inner?.shadowRoot){
          const card=inner.shadowRoot.querySelector('.card');
          if(card){ card.style.minHeight='0'; card.style.height='auto'; }
        }
      };
      applyInner();
      requestAnimationFrame(()=>{ applyInner(); requestAnimationFrame(applyInner); });
    }
    _render(){
      const c=this._config;
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;width:min(680px,calc(100vw - 24px));max-width:680px}.wrap{padding:4px 0;font-family:var(--primary-font-family,Arial)}h3{margin:18px 0 8px}.hint{opacity:.65;font-size:12px;margin-bottom:12px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:8px 0}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}.entity-id{font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.72;word-break:break-all;margin-top:2px}.section{padding:14px 16px;margin:12px 0;border:1px solid var(--divider-color,#ddd);border-radius:14px}.section h3{margin-top:0}label{font-size:12px;opacity:.75}input,select{width:100%;padding:10px;border:1px solid var(--divider-color,#ddd);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#111)}.device{padding:13px;margin:10px 0;border:1px solid var(--divider-color,#ddd);border-radius:12px;background:var(--secondary-background-color,rgba(0,0,0,.03))}.device-head{display:flex;justify-content:space-between;align-items:center;font-weight:700}.device-head button{border:0;background:transparent;color:var(--error-color,#db4437);font-size:20px;cursor:pointer}.btn{border:0;border-radius:10px;padding:11px 14px;background:var(--primary-color,#03a9f4);color:#fff;cursor:pointer;font-weight:700}.small{font-size:11px;opacity:.6}.layout-editor{position:relative;width:100%;aspect-ratio:1.5/1;min-height:420px;border-radius:16px;overflow:hidden;border:1px solid var(--divider-color,#ddd);background:#10202c;touch-action:none}.layout-bg{position:absolute;inset:0;background-size:cover;background-position:center}.layout-node{position:absolute;transform:translate(-50%,-50%);min-width:112px;max-width:160px;padding:8px 10px;border-radius:11px;background:rgba(8,29,45,.9);border:1px solid rgba(255,255,255,.35);color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35);cursor:grab;user-select:none;touch-action:none;font-size:12px;z-index:2}.layout-node.dragging{cursor:grabbing;box-shadow:0 10px 24px rgba(0,0,0,.5);border-color:var(--primary-color,#03a9f4)}.layout-node .ln-top{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-node .ln-pos{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;opacity:.65;margin-top:2px}.secondary-btn{margin-bottom:8px;background:var(--secondary-text-color,#607d8b)}.flow-colours{grid-template-columns:repeat(3,minmax(0,1fr))}.color-row{display:grid;grid-template-columns:42px 1fr;gap:6px;align-items:center}.color-row input[type=color]{height:40px;padding:3px}.color-row input[type=text]{padding:9px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.upload-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.upload-row .btn{padding:9px 12px;font-size:12px}.upload-status{font-size:11px;opacity:.65;margin-bottom:6px}
      </style><div class="wrap"><h3>Home Power Flow V0.5.7</h3><div class="hint">Bidirectional power flow from live positive/negative values, dotted connections, single moving power dot, invertible device direction, dynamic flow colors and draggable layout. Entity IDs are shown in full below each picker.</div>
      <div class="row"><div class="field"><label>Title</label><input data-key="title" value="${esc(c.title||'Energy Flow')}"></div><div class="field"><label>Time format</label><select data-key="time_format"><option value="24h" ${(c.time_format||'24h')==='24h'?'selected':''}>24 hour</option><option value="12h" ${c.time_format==='12h'?'selected':''}>12 hour</option></select></div><div class="field full"><label>Weather entity</label><ha-entity-picker data-editor-key="weather_entity" allow-custom-entity></ha-entity-picker></div><div class="field full">${this._bgUploadField('day','Day background')}</div><div class="field full">${this._bgUploadField('night','Night background')}</div><div class="field full"><label>Sun entity (switches day/night background)</label><ha-entity-picker data-editor-key="sun_entity" allow-custom-entity></ha-entity-picker></div><div class="field"><label>Flow threshold (W)</label><input type="number" min="0" step="0.1" data-key="flow_threshold_watts" value="${esc((Number(c.flow_threshold ?? 0.0005)*1000).toFixed(1))}"></div><div class="field"><label>Flow animation speed (seconds)</label><input type="number" min="3" max="30" step="0.5" data-key="flow_speed" value="${esc(c.flow_speed??8)}"></div><div class="field"><label>Particle stagger (seconds)</label><input type="number" min="0.15" max="1.5" step="0.05" data-key="flow_stagger" value="${esc(c.flow_stagger??0.55)}"></div></div>
      <h3>Flow colours</h3><div class="hint">Choose the colour used by the dotted flow path and its travelling power dot. Changes apply immediately.</div><div class="row flow-colours">${this._colorField('solar','Solar')}${this._colorField('inverter','Inverter')}${this._colorField('battery','Battery')}${this._colorField('gateway','Gateway')}${this._colorField('house','House / Load')}${this._colorField('grid','Grid')}${this._colorField('ev','EV Charger')}${this._colorField('load','Extra Load')}${this._colorField('neutral','Inactive')}</div>
      <h3>Visual layout</h3><div class="hint">Drag the device boxes on the template to place them exactly where you want. Positions are saved automatically. New devices without a saved position use the automatic layout.</div><div class="layout-editor" id="layout-editor"><div class="layout-bg"></div>${(c.devices||[]).map((d,i)=>this._layoutNode(d,i)).join('')}${this._layoutSpecial('weather','Weather','🌤️',c.weather_position,82,10)}${this._layoutSpecial('stats','Daily Stats','📊',c.stats_position,17,86)}<button class="btn secondary-btn" id="reset-layout" style="position:absolute;right:10px;bottom:10px;z-index:5">Reset positions</button></div><button class="btn secondary-btn" id="reset-layout">↺ Reset positions to automatic</button>
      <h3>Devices</h3>${(c.devices||[]).map((d,i)=>this._device(d,i)).join('')}<button class="btn" id="add">＋ Add device</button>
      <h3>Connections</h3><div class="hint">Optional. Leave empty to use the automatic topology. Add connections to take full control of where power flows.</div><div id="connections">${this._connectionsHTML()}</div><button class="btn" id="add-connection">＋ Add connection</button><h3>Today statistics</h3><div class="hint">Optional energy entities. Leave blank to hide the panel.</div><div class="row">${this._statField('solar_energy','Solar Generation')}${this._statField('house_energy','House Consumption')}${this._statField('grid_export','Exported to Grid')}${this._statField('battery_charge','Battery Charge')}${this._statField('co2_saved','CO₂ Saved')}</div>
      </div>`;
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(el=>{
        el.hass=this._hass;
        el.value = el.dataset.editorKey ? (this._config[el.dataset.editorKey] || '') : el.dataset.devicePicker ? (this._config.devices[Number(el.dataset.devicePicker)][el.dataset.field] || '') : (this._config.statistics?.[el.dataset.stat] || '');
        el.addEventListener('value-changed', e=>{
          if (el.dataset.editorKey) this._config[el.dataset.editorKey]=e.detail.value || '';
          else if (el.dataset.devicePicker) { const i=Number(el.dataset.devicePicker); this._config.devices[i][el.dataset.field]=e.detail.value || ''; const labels={power_entity:'[data-entity-label]',soc_entity:'[data-soc-label]',voltage_entity:'[data-voltage-label]',temp_entity:'[data-temp-label]',frequency_entity:'[data-frequency-label]'}; const lab=el.parentElement?.querySelector(labels[el.dataset.field] || '[data-entity-label]'); if(lab) lab.textContent=e.detail.value||'Not selected'; }
          else if (el.dataset.stat) { this._config.statistics ||= {}; this._config.statistics[el.dataset.stat]=e.detail.value || ''; }
          this._emit();
        });
      });
      this.shadowRoot.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('change',e=>{ const k=e.target.dataset.key; if(k==='flow_threshold_watts'){ const watts=Math.max(0,parseFloat(e.target.value)||0); this._config.flow_threshold=watts/1000; this._config.flow_threshold_watts=watts; } else { this._config[k]=e.target.value; if(['flow_threshold','flow_speed','flow_stagger'].includes(k))this._config[k]=parseFloat(e.target.value)||0; } this._emit(false); }));
      this.shadowRoot.querySelectorAll('[data-flow-color]').forEach(el=>el.addEventListener('input',e=>{this._config.flow_colors ||= {...FLOW_COLORS};this._config.flow_colors[e.target.dataset.flowColor]=e.target.value;this._emit(false);}));
      this.shadowRoot.querySelectorAll('[data-flow-color-text]').forEach(el=>el.addEventListener('change',e=>{let v=String(e.target.value||'').trim();if(!/^#[0-9a-fA-F]{6}$/.test(v)) return;const k=e.target.dataset.flowColorText;this._config.flow_colors ||= {...FLOW_COLORS};this._config.flow_colors[k]=v;const picker=this.shadowRoot.querySelector(`[data-flow-color=\"${k}\"]`);if(picker)picker.value=v;this._emit(false);}));
      this.shadowRoot.querySelector('#add')?.addEventListener('click',()=>{this._config.devices.push({type:'solar',name:`Device ${this._config.devices.length+1}`,power_entity:''});this._emit(false);this._render();});
      this.shadowRoot.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{this._config.devices.splice(Number(b.dataset.remove),1);this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-conn-remove]').forEach(b=>b.addEventListener('click',()=>{this._config.connections.splice(Number(b.dataset.connRemove),1);this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-conn]').forEach(el=>el.addEventListener('change',e=>{const i=Number(el.dataset.conn),k=el.dataset.field;this._config.connections[i][k]=Number(e.target.value);this._emit(false);}));
      this.shadowRoot.querySelector('#add-connection')?.addEventListener('click',()=>{if(this._config.devices.length<2)return;this._config.connections.push({from:0,to:1});this._emit(false);this._render();});
      this.shadowRoot.querySelectorAll('[data-device]').forEach(el=>el.addEventListener('change',e=>{const i=Number(el.dataset.device),k=el.dataset.field;this._config.devices[i][k]=e.target.value;this._emit(false);if(k==='type')this._render();}));this.shadowRoot.querySelectorAll('[data-invert-flow]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.invertFlow);this._config.devices[i].invert_flow=!this._config.devices[i].invert_flow;this._emit(false);this._render();}));
      this._enableLayoutDragging();
      this._applyLayoutBg();
      this.shadowRoot.querySelectorAll('[data-bg-upload-btn]').forEach(b=>b.addEventListener('click',()=>{this.shadowRoot.querySelector(`[data-bg-file="${b.dataset.bgUploadBtn}"]`)?.click();}));
      this.shadowRoot.querySelectorAll('[data-bg-file]').forEach(inp=>inp.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)this._uploadBackground(f,inp.dataset.bgFile);}));
      this.shadowRoot.querySelectorAll('[data-bg-restore]').forEach(b=>b.addEventListener('click',()=>{const slot=b.dataset.bgRestore;delete this._config[slot==='day'?'background_upload_day':'background_upload_night'];this._emit(false);this._render();}));
      this.shadowRoot.querySelectorAll('[data-bg-preview]').forEach(b=>b.addEventListener('click',()=>{this._applyLayoutBg(b.dataset.bgPreview);}));
      this.shadowRoot.querySelector('#reset-layout')?.addEventListener('click',()=>{this._config.devices.forEach(d=>delete d.position);delete this._config.weather_position;delete this._config.stats_position;this._emit(false);this._render();});
      this._enlargeDialogPreview();
    }
    _layoutNode(d,i){ const p=d.position && Number.isFinite(Number(d.position.x)) && Number.isFinite(Number(d.position.y)) ? d.position : this._autoPreviewPosition(d,i); return `<div class="layout-node" data-layout-kind="device" data-layout-index="${i}" style="left:${p.x}%;top:${p.y}%"><div class="ln-top">${esc(d.icon || ICONS[d.type] || '⚙️')} ${esc(d.name || LABELS[d.type] || 'Device')}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div></div>`; }
    _layoutSpecial(kind,label,icon,pos,dx,dy){ const p=pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y)) ? pos : {x:dx,y:dy}; return `<div class="layout-node special" data-layout-kind="${kind}" style="left:${p.x}%;top:${p.y}%"><div class="ln-top">${icon} ${label}</div><div class="ln-pos">${Number(p.x).toFixed(1)}% × ${Number(p.y).toFixed(1)}%</div></div>`; }
    _autoPreviewPosition(d,i){ const zones={solar:[18,23],inverter:[56,39],battery:[58,65],gateway:[48,78],house:[28,82],grid:[82,84],ev:[83,50],load:[76,67]}; const same=this._config.devices.filter(x=>(x.type||'load')===(d.type||'load')); const n=same.indexOf(d); const [cx,cy]=zones[d.type||'load']||[70,68]; const spacing=Math.min(15,70/Math.max(1,same.length)); let x=cx,y=cy;if(same.length>1)x=cx+(n-(same.length-1)/2)*spacing;if((d.type==='battery'&&same.length>3)){const col=n%3,row=Math.floor(n/3);x=48+col*12;y=64+row*12;}if(d.type==='solar'&&same.length>4){const col=n%4,row=Math.floor(n/4);x=33+col*12;y=22+row*11;}if(d.type==='ev'&&same.length>2){const col=n%2,row=Math.floor(n/2);x=78+col*10;y=45+row*13;}return{x,y}; }
    _enableLayoutDragging(){ const area=this.shadowRoot.querySelector('#layout-editor'); if(!area)return; area.querySelectorAll('.layout-node').forEach(node=>{ let dragging=false; const move=e=>{if(!dragging)return;const r=area.getBoundingClientRect();let x=((e.clientX-r.left)/r.width)*100;let y=((e.clientY-r.top)/r.height)*100;x=Math.max(5,Math.min(95,x));y=Math.max(6,Math.min(94,y));const kind=node.dataset.layoutKind; if(kind==='device'){const i=Number(node.dataset.layoutIndex);this._config.devices[i].position={x,y};} else if(kind==='weather') this._config.weather_position={x,y}; else if(kind==='stats') this._config.stats_position={x,y}; node.style.left=x+'%';node.style.top=y+'%';const pos=node.querySelector('.ln-pos');if(pos)pos.textContent=`${x.toFixed(1)}% × ${y.toFixed(1)}%`;}; const up=()=>{if(!dragging)return;dragging=false;node.classList.remove('dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);this._emit(false);}; node.addEventListener('pointerdown',e=>{e.preventDefault();dragging=true;node.classList.add('dragging');node.setPointerCapture?.(e.pointerId);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}); }); }

    _device(d,i){ const inverted=!!d.invert_flow; const entityField=(field,label,marker)=>`<div class="field full"><label>${label}</label><ha-entity-picker data-device-picker="${i}" data-field="${field}" allow-custom-entity></ha-entity-picker><div class="entity-id" ${marker}="${i}">${esc(d[field]||'Not selected')}</div></div>`; return `<div class="device"><div class="device-head"><span>${esc(ICONS[d.type]||'⚙️')} ${esc(d.name||'Device')}</span><button title="Remove" data-remove="${i}">×</button></div><div class="row"><div class="field"><label>Type</label><select data-device="${i}" data-field="type">${TYPES.map(t=>`<option value="${t[0]}" ${d.type===t[0]?'selected':''}>${esc(t[1])}</option>`).join('')}</select></div><div class="field"><label>Name</label><input data-device="${i}" data-field="name" value="${esc(d.name||'')}"></div>${entityField('power_entity','Power entity','data-entity-label')}${d.type==='battery'?entityField('soc_entity','Battery SOC entity','data-soc-label'):''}${d.type==='battery'?entityField('voltage_entity','Battery voltage entity','data-voltage-label'):''}${(d.type==='battery'||d.type==='inverter')?entityField('temp_entity',d.type==='battery'?'Battery temperature entity':'Inverter temperature entity','data-temp-label'):''}${d.type==='grid'?entityField('voltage_entity','Grid voltage entity','data-voltage-label'):''}${d.type==='grid'?entityField('frequency_entity','Grid frequency entity','data-frequency-label'):''}<div class="field"><label>Flow direction</label><button class="btn ${inverted?'secondary-btn':''}" type="button" data-invert-flow="${i}">${inverted?'↔ Inverted':'↔ Normal'}<span class="small" style="display:block">${inverted?'Negative = output':'Positive = output'}</span></button></div><div class="field"><label>Custom icon</label><input data-device="${i}" data-field="icon" value="${esc(d.icon||'')}" placeholder="Automatic"></div></div></div>`; }
    _connectionsHTML(){
      const conns=this._config.connections||[];
      if(!conns.length) return '<div class="small" style="margin:8px 0">No custom connections — automatic topology is active.</div>';
      const opts=(selected)=>this._config.devices.map((d,i)=>`<option value="${i}" ${Number(selected)===i?'selected':''}>${i+1}. ${esc(d.name||LABELS[d.type]||'Device')}</option>`).join('');
      return conns.map((e,i)=>`<div class="device" style="padding:10px"><div class="row"><div class="field"><label>From</label><select data-conn="${i}" data-field="from">${opts(e.from)}</select></div><div class="field"><label>To</label><select data-conn="${i}" data-field="to">${opts(e.to)}</select></div><div class="field full"><label>Flow direction</label><select data-conn="${i}" data-field="direction"><option value="0" ${Number(e.direction||0)===0?'selected':''}>Auto — use live power signs</option><option value="1" ${Number(e.direction||0)===1?'selected':''}>From → To</option><option value="2" ${Number(e.direction||0)===2?'selected':''}>To → From</option></select></div></div><button class="btn" style="background:var(--error-color,#db4437);padding:7px 10px" data-conn-remove="${i}">Remove connection</button></div>`).join('');
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
      if (statusEl) statusEl.textContent = 'Uploading…';
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
        if (statusEl) statusEl.textContent = 'Upload failed - check that you are an admin user and try again.';
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
  if(!window.customCards.some(c=>c.type==='home-power-flow-card')) window.customCards.push({type:'home-power-flow-card',name:'Home Power Flow Card',description:'Configurable visual home energy flow card',preview:true});
  console.info(`%c Home Power Flow Card %c v${VERSION} `,'background:#173a55;color:#fff;padding:4px 8px','background:#62ff7b;color:#07130a;padding:4px 8px');
})();
