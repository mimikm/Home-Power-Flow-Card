# ⚡ Home Power Flow Card

A beautiful, animated real-time energy flow card for Home Assistant Lovelace dashboards — built by **Dom** ([@mimikm](https://github.com/mimikm)).

Visualise your home's whole energy ecosystem — solar, battery, grid, EV, and even multi-inverter setups — as a living diagram, with power flowing between devices exactly as your sensors report it.

**Repository:** https://github.com/mimikm/Home-Power-Flow-Card

---

## 🧪 Public Test Release

This is a **public test release v0.7.3** — the card is feature-complete for most setups and I'd love for more people to try it on their own Home Assistant instance before calling it stable.

Please **back up your dashboard config before installing** (Settings → System → Backups, or just export your existing card config if you're replacing an older version — see [Backup & Restore](#-backup--restore) below).

If something looks wrong or breaks, please [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues) with:
- Home Assistant version
- Card version (shown in the browser console on load, and in your config)
- Your card configuration (the YAML, or an exported config file — see below)
- The affected entities and what you expected to see instead

This is my **first open-source project**, and it's actively developed based on my own setup and on feedback from testers like you. Thank you for helping shape it. ❤️

---

## ☕ Support the Project

If you enjoy this card and want to support future development:

**[☕ Buy me a coffee](https://buymeacoffee.com/mimikm)**

---

## ✨ Features

### 🌊 Animated Energy Flows
Real-time, animated power movement between every device on the diagram. A moving dot only appears once power exceeds your configured threshold, so idle connections stay quiet.

### 🔌 Multi-Inverter & Multi-Hub Support
Add as many inverters as you have, and wire them however your system is actually built:
- Each device gets an optional **"Connects to"** link, so you can say exactly what feeds what — Solar 2 → Inverter 2, a battery → a specific inverter, anything.
- Add a **Gateway / Distribution Board** device to act as the meeting point between multiple inverters, instead of forcing everything through one.
- Leave it on **Automatic** and it still works sensibly out of the box: every device falls back to the (first) inverter, and any extra inverter falls back to your Gateway if you've added one — nothing is ever silently dropped.
- A device with its own power sensor is correctly treated as genuinely metered (bidirectional, sign-aware) wherever it sits in the topology — not just when it's the "final" device on an edge.

### 🔗 Custom Connections
Prefer full manual control? Leave "Connects to" alone and define explicit From → To connections instead, each with its own direction mode (auto from live values, forced forward, or forced reverse).

### 🔋 Any Number of Devices, Any Type
☀️ Solar PV, ⚡ Inverter, 🔋 Battery, 🧠 Gateway, 🏠 House, 🌐 Grid, 🚗 EV Charger, or ⚙️ Extra Load — add as many of each as your setup needs. Every device has its own name, icon, power entity and flow colour.

### 🧩 Extra Entities *(optional, per device)*
Attach up to **5 extra entities** to any device — battery SOC, voltage, temperature, cost, anything you like. Each one:
- is picked from a native Home Assistant entity dropdown
- gets its own icon from the full Material Design Icon library
- is shown compactly, side-by-side, in a smaller font directly under the device's power value
- is purely informational — extras never affect flow direction, animation, or any calculation

The section is collapsible in the editor, so devices without extras stay tidy.

### 🔄 Per-Device Invert Flow
Every device can invert its own *visual* flow direction — useful since manufacturers report power direction differently. This only changes animation direction; it never touches sensor values, calculations, or readings.

### 🎨 Custom Flow Colours
Give each device its own flow colour, which stays attached to that device regardless of which way power is currently flowing — including a metered inverter in a multi-inverter setup.

### 🖱️ Drag-and-Drop Visual Layout
Position every device, the weather widget, and the daily-stats panel exactly where you want them by dragging them on a live preview. Positions save automatically, and a one-click reset restores the automatic layout.

### 🖼️ Custom Backgrounds
- Separate day and night background images
- Upload directly to your Home Assistant media library, or link any image URL
- Automatically switches between them based on a sun entity (defaults to `sun.sun`)

### 🌤️ Weather & Clock Header
An optional weather panel shows the date, time (12h or 24h), temperature and current conditions from any weather entity.

### 📊 Daily Statistics Panel
Add up to 20 custom statistic rows — daily solar yield, grid import/export, CO₂ saved, anything with a number — each with its own name, entity and Material Design icon, and drag-to-reorder.

### ⚙️ Fully Visual, No-YAML Configurator
Everything above is configurable through the built-in editor, using native Home Assistant pickers throughout (entity dropdowns, icon pickers, colour pickers):
- Device cards are **collapsed by default** for a clean list, showing just the icon, name and power entity — click to expand and edit
- Add, remove, and reorder devices, connections and statistics without writing YAML
- Flow animation speed, particle stagger, and the noise threshold are all adjustable fields

### 💾 Backup & Restore
Export your entire card configuration — devices, connections, layout, backgrounds, statistics, everything — as a JSON file with one click, and re-import it just as easily. Handy before a big topology change, or for sharing a working setup with someone else.

### 🖱️ Click-Through to Entities
Click any device on the card to open its Home Assistant "more info" dialog directly.

### 📱 Responsive
The layout is designed for larger screens. (mobile screen support in roadmap).

---

## 📦 Installation

### HACS (recommended)
1. Open **HACS**
2. Go to **Frontend**
3. Add this repository as a **custom repository**: `https://github.com/mimikm/Home-Power-Flow-Card`
4. Install **Home Power Flow Card**
5. Restart Home Assistant
6. Add the card through the Lovelace UI (search for "Home Power Flow Card")

### Manual
1. Download `home-power-flow-card.js` from the [latest release](https://github.com/mimikm/Home-Power-Flow-Card/releases)
2. Copy it into `/config/www/`
3. Add it as a Lovelace resource: **Settings → Dashboards → Resources** → `/local/home-power-flow-card.js`, type **JavaScript Module**
4. Add the card to a dashboard

If you don't see your changes after updating, browsers cache this file aggressively — hard-refresh (Ctrl/Cmd+Shift+R) or bump the `?v=` on the resource URL.

---

## ⚡ Flow Threshold

To avoid flow lines flickering from sensor noise, a device's power must exceed a configurable threshold before its flow line becomes visible.

| Power | Result |
|---|---|
| Below threshold | No flow line |
| At or above threshold | Flow visible, animated |

Default: **1 W**, adjustable in the editor. This is checked against each edge's own metered device — a device reading 0 W stays inactive even if whatever it's connected to is busy.

---

## 🔌 Multi-Inverter Setups

If you only have one inverter, you don't need to configure anything here — it just works, same as before.

If you have **two or more inverters**:

1. **Nothing wired manually?** Every device still auto-attaches to the first inverter, and any extra inverter auto-attaches to a **Gateway** device if you've added one (or to the first inverter if you haven't). Nothing is orphaned.
2. **Want it accurate to your real wiring?** Add a Gateway/Distribution Board device (type "🧠 Gateway"), and set each device's **"Connects to"** field to whatever it actually connects to — a specific inverter, or the Gateway.
3. **Direction looks backwards?** Use that device's **Invert Flow** toggle — it corrects for however your specific inverter or meter reports its sign.

---

## 🛠 Example Configuration

```yaml
type: custom:home-power-flow-card

title: Energy Flow

devices:
  - type: solar
    name: Solar PV
    power_entity: sensor.solar_power_1
    connects_to: inv1

  - type: inverter
    name: Inverter 1
    id: inv1

  - type: solar
    name: Solar PV 2
    power_entity: sensor.solar_power_2
    connects_to: inv2

  - type: inverter
    name: Inverter 2
    power_entity: sensor.inverter_2_power
    id: inv2

  - type: gateway
    name: Distribution Board
    id: gw1

  - type: battery
    name: Battery
    power_entity: sensor.battery_power
    connects_to: inv1
    extra_entities:
      - entity: sensor.battery_soc
        icon: mdi:battery-charging
      - entity: sensor.battery_voltage
        icon: mdi:lightning-bolt

  - type: grid
    name: Grid
    power_entity: sensor.grid_power

  - type: house
    name: House
    power_entity: sensor.house_power

  - type: ev
    name: EV Charger
    power_entity: sensor.ev_power
```

Everything above — devices, links, extra entities, colours, connections, layout, backgrounds and statistics — can also be configured entirely through the visual editor, without touching YAML. Every device is assigned a stable internal id automatically the first time you save; `connects_to` references that id, not a position in the list, so reordering or deleting devices later never silently rewires a connection onto the wrong one.

---

## 🤝 Contributing

Suggestions, bug reports and improvements are very welcome — please [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues).

Testing on real-world multi-inverter, gateway, or otherwise non-standard setups is especially valuable right now.

---

## 🗺️ Roadmap

Planned and possible future updates. Ideas and feedback are welcome, so feel free to [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues) if there's something you'd like to see.

### 🔧 Stability & polish
- Proper sizing support for Home Assistant's **Sections** dashboard layout
- Cross-platform testing before each release (Chrome, Safari, Firefox, iOS & Android apps)
- Editor warnings for misconfigured devices and broken "Connects to" links
- Respect the system "reduce motion" setting for traveling flow dots

### ⚙️ Editor improvements
- **Duplicate device** button for faster multi-inverter / multi-string setups
- **Drag to reorder** devices in the editor
- Live **flow direction indicator** next to each device's Invert Flow toggle

### ✨ New features
- Automatic **kW formatting** for large values (e.g. `3.2 kW` instead of `3200 W`)
- Configurable **tap actions** per device (more-info, navigate, toggle)
- **Battery time remaining** estimate based on current power and capacity
- **Self-sufficiency %** and other computed stats in the Today panel
- **Light theme** support

### 📦 Project
- Automated checks on GitHub (syntax + HACS validation)
- Tagged releases that match the card version, for reliable HACS updates
- **Translations** of the editor for non-English users


---

## ❤️ Thanks

This project started as a personal Home Assistant dashboard improvement and is growing into a community project. Thank you to everyone testing it, suggesting improvements, and helping make it better.

---

## 📄 License

MIT © [Dom (mimikm)](https://github.com/mimikm)
