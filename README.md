# ⚡ Home Power Flow Card

A beautiful, animated real-time energy flow card for Home Assistant Lovelace dashboards — built by **Dom** ([@mimikm](https://github.com/mimikm)).

Visualise your home's whole energy ecosystem — solar, battery, grid, EV and more — as a living diagram, with power flowing between devices exactly as your sensors report it.

**Repository:** https://github.com/mimikm/Home-Power-Flow-Card

---

## ☕ Support the Project

If you enjoy this card and want to support future development:

**[☕ Buy me a coffee](https://buymeacoffee.com/mimikm)**

Your support helps me keep improving the card, adding features, and maintaining the project. Thank you! ❤️

---

## 🚧 Work in Progress

This is my **first open-source project**, and it's actively developed. The card is already fully usable, but it's still evolving — features, improvements and fixes are added based on my own Home Assistant setup and feedback from the community.

Expect ongoing updates: new features, UI polish, and bug fixes. Feedback and suggestions are very welcome — see [Contributing](#-contributing) below.

---

## ✨ Features

### 🌊 Animated Energy Flows
Real-time, animated power movement between every device on the diagram — solar generation, battery charge/discharge, grid import/export, house consumption, EV charging and any extra loads you add. A moving dot only appears once power exceeds your configured threshold, so idle connections stay quiet.

### 🔌 Inverter Junction Logic
The inverter acts as the central hub connecting your sources and consumers. It doesn't need its own power entity and never controls flow direction itself — direction is always derived from the connected devices (solar, battery, grid, house, EV, loads).

### 🔋 Any Number of Devices, Any Type
Add as many devices as you like, of any type: ☀️ Solar PV, ⚡ Inverter, 🔋 Battery, 🧠 Gateway, 🏠 House, 🌐 Grid, 🚗 EV Charger, or ⚙️ Extra Load. Each device has its own name, icon, power entity and flow colour.

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
Give each device its own flow colour, which stays attached to that device regardless of which way power is currently flowing.

### 🔗 Custom Connections
Leave it on automatic topology, or take full control: define explicit From → To connections between any two devices, each with its own direction mode (auto from live values, forced forward, or forced reverse).

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
- Device cards are individually **collapsible**, showing just the icon and name (and entity, once collapsed) to keep long device lists tidy
- Add, remove, and reorder devices, connections and statistics without writing YAML
- Flow animation speed, particle stagger, and the noise threshold are all adjustable sliders/fields

### 🖱️ Click-Through to Entities
Click any device on the card to open its Home Assistant "more info" dialog directly.

### 📱 Responsive
The layout adapts down to mobile screen widths, scaling text, nodes and panels accordingly.

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

---

## ⚡ Flow Threshold

To avoid flow lines flickering from sensor noise, a device's power must exceed a configurable threshold before its flow line becomes visible.

| Power | Result |
|---|---|
| Below threshold | No flow line |
| At or above threshold | Flow visible, animated |

Default: **1 W**, adjustable in the editor.

---

## 🛠 Example Configuration

```yaml
type: custom:home-power-flow-card

title: Energy Flow

devices:
  - type: solar
    name: Solar PV
    power_entity: sensor.solar_power

  - type: inverter
    name: Inverter

  - type: battery
    name: Battery
    power_entity: sensor.battery_power
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

Everything in this example — devices, extra entities, colours, connections, layout, backgrounds and statistics — can also be configured entirely through the visual editor, without touching YAML.

---

## 🤝 Contributing

Suggestions, bug reports and improvements are very welcome — please [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues).

When reporting a problem, please include:
- Home Assistant version
- Card version
- Your card configuration
- The affected entities

---

## ❤️ Thanks

This project started as a personal Home Assistant dashboard improvement and is growing into a community project. Thank you to everyone testing it, suggesting improvements, and helping make it better.

---

## 📄 License

MIT © [Dom (mimikm)](https://github.com/mimikm)
