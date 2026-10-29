# ⚡ Home Power Flow Card

[![HACS Default](https://img.shields.io/badge/HACS-Default-41BDF5.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/mimikm/Home-Power-Flow-Card)](https://github.com/mimikm/Home-Power-Flow-Card/releases)
[![Downloads](https://img.shields.io/github/downloads/mimikm/Home-Power-Flow-Card/total?label=downloads)](https://github.com/mimikm/Home-Power-Flow-Card/releases)
[![Validate](https://github.com/mimikm/Home-Power-Flow-Card/actions/workflows/validate.yml/badge.svg)](https://github.com/mimikm/Home-Power-Flow-Card/actions/workflows/validate.yml)

An animated, real-time energy flow card for Home Assistant dashboards, built by **Dom** ([@mimikm](https://github.com/mimikm)).

Show your whole home energy system (solar, batteries, grid, EV chargers, even multi-inverter setups) as a living picture of your home, with power flowing between devices exactly as your sensors report it.

![Home Power Flow Card](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/preview2.png)

**Available in the HACS default store**: search for *Home Power Flow Card* in HACS, no custom repository needed ([install](#-installation)).

**New in 0.9:** a redesigned editor with tabs and fold-away sections, plus a [bin collection](#️-bin-collection) badge. Since 0.8: five more [view styles](#-view-styles) to choose from (compact rings, an energy river, tiles, an at-a-glance headline and a technical schematic).

---

## 🚧 Work in progress, fully functioning

The card is **fully functional** and ready to use on your dashboard. It's also a **work in progress**: new features and improvements arrive regularly, often based on what users ask for. It's my **first open-source project**, and it keeps getting better thanks to your feedback.

Tip: before big changes, export your card config as a backup (see [Backup & Restore](#-backup--restore)).

Found a problem or have an idea? [Open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues). For bugs, please include:
- Home Assistant version
- Card version (shown in the browser console on load)
- Your card configuration (YAML or an exported config file)
- The affected entities and what you expected to see

Don't worry if your issue comes in as ticket #195,941. I'll get through them all. Eventually. Possibly with coffee. ☕

---

## ☕ Support the project

If you enjoy the card and want to support its development:

**[☕ Buy me a coffee](https://buymeacoffee.com/mimikm)**

---

## 📦 Installation

### HACS (recommended)

Home Power Flow Card is in the **HACS default store**, so there's no custom repository to add.

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mimikm&repository=Home-Power-Flow-Card&category=plugin)

Click the button above, or:
1. Open **HACS** in Home Assistant
2. Search for **Home Power Flow Card**
3. Open it and click **Download**
4. Reload your browser when asked
5. Add the card to a dashboard: **Edit dashboard → Add card** and search for "Home Power Flow Card"

HACS adds the dashboard resource for you, and shows new versions under **HACS → Updates** (or in **Settings** next to other updates).

> **Added it earlier as a custom repository?** Nothing to do: it's the same repository, so it keeps updating as usual.

### Manual

1. Download `home-power-flow-card.js` from the [latest release](https://github.com/mimikm/Home-Power-Flow-Card/releases)
2. Copy it into `/config/www/`
3. Add a dashboard resource: **Settings → Dashboards → ⋮ → Resources** → `/local/home-power-flow-card.js`, type **JavaScript module**
4. Add the card to a dashboard

> **Built-in backgrounds** load from this GitHub repository, so there's nothing extra to copy. If your Home Assistant has no internet access, download the two pictures from the [`images`](https://github.com/mimikm/Home-Power-Flow-Card/tree/main/images) folder into `/config/www/` and set them as your day and night backgrounds (e.g. `/local/smart-home-energy-background.png`).

> **Not seeing an update?** Browsers cache card files aggressively. Hard-refresh (Ctrl/Cmd+Shift+R), and on phones fully close and reopen the Home Assistant app.

---

## 🎨 View styles

Pick a style under **View style** at the top of the editor. All styles use the same devices, sensors, colours, theme and Today statistics, so you can switch at any time without setting anything up again.

| | |
|---|---|
| ![Compact rings](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/style-rings.png) **⭕ Compact rings**<br>Round icons around a hub, with battery level and self-sufficiency as rings. Small and tidy, great for phones and Sections dashboards. | ![Energy river](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/style-river.png) **🌊 Energy river**<br>Where your power comes from and where it goes, as flowing bands as wide as the power they carry. |
| ![Tiles](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/style-tiles.png) **🔲 Tiles**<br>Big numbers in tidy tiles with history graphs behind them, a self-sufficiency ring and battery bars. Ideal for wall tablets. | ![At a glance](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/style-glance.png) **👀 At a glance**<br>One plain-language headline, like "Running on sunshine" or "Running on battery", that you can read from across the room. The colour changes with the situation. Each battery with a state of charge sensor gets a small tile with its charge, a fill bar, power and what it's doing (switch **Battery tiles** off for plain chips instead). |
| ![Schematic](https://github.com/mimikm/Home-Power-Flow-Card/raw/main/images/style-schematic.png) **📐 Schematic**<br>A technical one-line diagram with electrical symbols on grid paper, Blueprint arrows and an engineering title block. | |

**🖼️ Classic**, the original style with your own background picture and freely placed boxes, stays the default and works exactly as before.

- Every style is **responsive**: layouts adapt to narrow screens, and text is enlarged on small cards.
- Tap any device to open its Home Assistant details, in every style, or set your own [tap actions](#-tap-actions).
- **Classic only:** background pictures (including seasonal), animated rain & snow, box positions and sizes, line shapes (curved, right angles, manual), the UK grid mix box and the phone layout settings.
- **Tiles** shows history graphs for every device by default. Untick *Show history graph* on a device to hide its graph.
- **Schematic** uses Blueprint arrows unless you choose another flow line look.

---

## ✨ Features

### 🌊 Animated energy flows
- Live animated flow lines between every device, with a moving, softly pulsing dot showing the direction of power
- Dots move **faster on high-power connections** and slower on light ones
- Evenly spaced flow lines, whatever the distance between devices
- **Seven flow line looks**: Classic, Neon (glowing comet), Energy stream (more particles and thicker lines with more power), Marching dashes, Minimal, Blueprint (travelling arrows) and Static, with **separate looks for day and night**
- Respects your device's **reduce motion** setting (lines become static)
- Optionally keep **idle connections** visible as faint lines
- Switch off flow lines **per device** with a simple tick box
- Choose **curved** lines, **right-angle** lines that route around every box on the card (running side by side in parallel lanes instead of overlapping), or **manual** lines you shape yourself
- **Manual lines**: click a line in the layout editor to add bend points, drag them where you want (they snap into line for clean right angles), double-click to remove. Separate shapes for desktop and phone
- A configurable **noise threshold** keeps idle connections quiet

### 🔌 Any setup, including multi-inverter
- Device types: ☀️ Solar, ⚡ Inverter, 🔋 Battery, 🧠 Gateway / distribution board, 🏠 House, 🌐 Grid, ⛽ Generator, 💧 Water, 🔥 Gas, 🚗 EV charger, ♨️ Heat pump and ⚙️ Extra load, as many of each as you need
- **"Connects to"** links let you describe your real wiring (e.g. Solar 2 → Inverter 2)
- A **Gateway** device can act as the meeting point between several inverters
- Left on **Automatic**, everything still connects sensibly out of the box
- Optional **manual connections** for full control over what flows where

### 🎨 Per-device customisation
- Own name, power entity and **flow colour** for every device
- **Flow colour by direction**: batteries can use the glow colours (green charging, amber discharging) or your own charging/discharging colours; the grid can use your own import/export colours
- **Batteries and grid work with one or two sensors**: a single sensor with positive/negative values, or **separate** charge/discharge (import/export) sensors as provided by e.g. Growatt. **Three-phase** grid, inverter, house, EV, generator and loads can use one sensor per phase
- **History graph** (optional, per device): a faint graph of the device's power history behind its box, in the device's flow colour, with a zero line for signed values like batteries and the grid
- Power shown in **W or kW**: automatically switches to kW from 1000 W (e.g. `3.20 kW`), or set it to always W / always kW
- **Invert flow** per device, for sensors that report power the other way round
- Up to **10 extra entities** per device (SoC, voltage, temperature...) with their own icons, shown in small text under the power value. Values use **Home Assistant's own rounding** (the entity's display precision) unless you pick a number of **decimals**; reorder them with ↑ ↓ in the editor. Their **text size** is adjustable for the whole card (Sizing) or per device, without changing the box
- **No house sensor?** The House can **calculate its load** from your other devices ([Calculated house load](#-calculated-house-load))
- **Battery glow**: batteries pulse green when charging and amber when discharging (can be turned off per battery)
- **Battery time remaining** (optional): e.g. `⏳ 2h 40m to 4%` or `⏳ 1h 15m to full`, from the battery's state of charge and capacity, with its own reserve and charge limit

### 🖱️ Flexible layout
- **Resize any device box** like a window: drag its right or bottom edge or corner in the layout editor. The text scales so everything (value, extras, battery time) always fits. Separate sizes for desktop and phone; double-click the corner to reset
- **Drag and drop** devices, the title, the weather box, the Today panel, the grid mix box and the last updated box to exactly where you want them
- **Custom backgrounds**: separate day and night images, switched automatically by the sun
- **Seasonal background**: a day and night picture for Halloween, Christmas, Easter or your own dates, coming back by itself every year
- **Animated rain & snow**: falling rain, snow, sleet, hail and lightning drawn live over any background whenever your weather entity reports them
- **Any card shape**, including ultra-wide: 3:2, 4:3, 16:10, 16:9, 2:1, 21:9 and 32:9, **match your background image**, or **fill the screen** for an almost full-screen dashboard
- **Fit whole image**: show the entire background picture, with soft blurred edges filling any gaps
- **Title and subtitle** with your own text and colour, or leave them blank
- **Box opacity**: make every box and panel more see-through (down to fully transparent) or more solid, on any theme
- **Colour themes** for the boxes and panels: Auto (follows Home Assistant's light/dark mode), Dark, Light, Midnight, Ocean, Forest, Sunset and Graphite, or pick your own panel and text colours
- **Sizing controls** for the title, device boxes, weather box, Today panel, grid mix box and last updated box

### 📱 Fits every screen
- The whole card scales to the available width, so it looks the same on a monitor, a tablet or a phone
- A separate **phone layout** (portrait) switches on automatically on narrow screens, with its own box positions
- It never grows taller than your screen
- Text is boosted automatically on phones so it stays readable
- Full support for Home Assistant's **Sections** dashboards
- **⛶ Full screen** for wall tablets and room displays: tap the button in the corner and the card fills the whole screen with no corners or borders, and keeps the screen awake. Where a device doesn't allow true full screen, the card fills the whole app window instead (covering Home Assistant's header and sidebar). Portrait screens use the portrait layout. Tap the button again, or press Esc, to leave
- Tested on desktop browsers and the iOS app

### 🗑️ Bin collection
- Shows which bins go out **all day before collection** ("Tomorrow") and **on collection day** ("Today"), with a coloured wheelie bin for each
- Dates from **your Home Assistant calendars** (one per bin, or one shared calendar with match words) or a simple **repeating schedule**

### 🌤️ Weather, stats and grid
- **Weather & clock** box from any weather entity (12 or 24 hour)
- **Today panel** with up to 20 statistics (solar yield, grid import/export, anything with a number), each with its own icon, updating live
- **Dock the Today panel** to any edge of the card like a taskbar: always visible, or **auto-hide** as a small tab that slides out on hover or tap (separately for the phone layout)
- **Self-sufficiency & self-consumption** (optional): how much of your electricity didn't come from the grid, and how much of your solar you used yourself, both live and for today
- **Last updated** box (optional): a small pill counting live how long ago an entity was updated (e.g. `🕒 Updated 3m 05s ago`), turning amber when data goes stale, so you can spot a stalled integration at a glance. Understands date-time, time-only and Unix timestamp sensors
- **UK grid mix** box (optional): live carbon intensity with a colour-coded rating, plus the current generation mix by source, for your region or all of Great Britain

### ⚙️ Fully visual editor
- Everything is configurable without YAML, using Home Assistant's own entity, icon and colour pickers
- A tidy editor with four tabs (**🎨 Look**, **🔌 Devices**, **🧩 Panels** and **⚙️ More**) and framed sections that fold away. Each section header shows a short summary of its settings, and optional features have an on/off switch right in the header
- **Built-in warnings** that spot common mistakes: missing or misspelled sensors, unavailable entities, a power sensor with the wrong unit (e.g. `%`), broken or looping *Connects to* links, devices not connected to anything, and incomplete battery settings
- Collapsible, **drag-to-reorder** devices and statistics
- **Duplicate** any device with one click, handy for multi-inverter or multi-string setups
- A **live direction readout** under each device's Invert flow toggle (e.g. `▶ Solar PV → Inverter · 450 W`), so you can check flow directions before saving
- A live preview that always shows the whole card
- Tap any device to open its Home Assistant details, or choose your own **tap, hold and double-tap actions** per device and panel

### 🌐 Languages
The card and its editor are available in **English**, **Polish** and **Spanish**, and automatically follow the language set in your Home Assistant profile. Your own names and titles are never changed. Other languages fall back to English.

### 💾 Backup & Restore
Export your whole card configuration as a JSON file with one click, and import it again later. Handy before big changes, or to share a working setup.

---

## ⚡ Flow threshold

A device's power must reach the threshold before its flow line appears, so sensor noise doesn't cause flickering. Default: **1 W**, adjustable in the editor.

Each line is judged by its own device: a device reading 0 W stays quiet even if whatever it's connected to is busy.

---

## 🏡 Self-sufficiency & self-consumption

Two optional figures shown at the top of the Today panel. Turn them on in the editor's **Self-sufficiency & self-consumption** section.

| Figure | What it tells you | Formula |
|---|---|---|
| **Self-sufficiency** | How much of your home's electricity **didn't** come from the grid | 1 − grid import ÷ home consumption |
| **Self-consumption** | How much of your solar you **used yourself** instead of exporting | (solar − grid export) ÷ solar |

- **Now** is calculated automatically from your devices: **Grid** and **House** for self-sufficiency, **Solar** and **Grid** for self-consumption. No extra setup needed.
- **Today** uses your daily energy sensors (kWh or Wh, converted automatically).
- **No reliable consumption sensor?** Tick *Calculate consumption instead* and the card works it out: import + solar − export + battery discharge − battery charge (battery sensors optional).
- Both follow the same direction as your Grid flow line. If the grid dots flow the wrong way, tick **Invert flow** on the Grid device to fix both.

---

## 🔌 One sensor, two or three phases?

Batteries and the grid can be set up either way (device setting **Power sensors**):

- **One sensor (+ and −)**, the default: battery positive = discharging, negative = charging; grid positive = export, negative = import. If yours is the other way round, use **Flow direction**.
- **Separate sensors**: two sensors that both report positive values, e.g. Growatt's *Charge W* and *Discharge W*. The card combines them, so flow direction, battery glow, time remaining, self-sufficiency and the history graph all work as usual.
- **Three phases (L1, L2, L3)** for the grid: one sensor per phase, e.g. from a Shelly 3EM, each positive = export and negative = import. The card adds them up for the flow, self-sufficiency and history graph, and shows each phase in the grid box with ↓ for import and ↑ for export (e.g. `L1 ↓1.50 kW  L2 ↓300 W  L3 ↑200 W`). Turn off **Show each phase in the box** to show just the total. The phases appear in the Classic and Tiles styles; the other styles show the total.

```yaml
- type: grid
  name: Grid
  power_mode: phases
  grid_l1_power_entity: sensor.grid_l1_power
  grid_l2_power_entity: sensor.grid_l2_power
  grid_l3_power_entity: sensor.grid_l3_power
```

**Three-phase devices:** the **Inverter**, **House**, **EV charger**, **Generator**, **Heat pump** and **Extra load** can also use **Three phases (L1, L2, L3)** under *Power sensors*. The card adds the phases up and shows each one in the box (e.g. `L1 600 W  L2 700 W  L3 500 W`). Batteries, solar, water and gas stay single-sensor.

```yaml
- type: ev
  name: EV charger
  power_mode: phases
  l1_power_entity: sensor.wallbox_l1_power
  l2_power_entity: sensor.wallbox_l2_power
  l3_power_entity: sensor.wallbox_l3_power
```

Put **state of charge (%)** in the battery's *State of charge* field (under *Show time remaining*) or as an extra entity, not as the power sensor.

---

## 🏠 Calculated house load

No sensor for your home's consumption? Set the House device's **Power sensors** to **Calculate from other devices**. The card works it out live:

> **House = solar + generator + battery discharging + grid import − battery charging − grid export − loads that aren't connected to the House**

- It updates with every reading and drives the flow lines, self-sufficiency and every view style, just like a real sensor. The box shows a small *calculated* note.
- Works with one or two battery/grid sensors, three-phase devices and **Flow direction**, so set those up correctly first.
- **Loads beside the House** (an EV charger, heat pump or extra load on Automatic or connected to the inverter) are taken off, because they aren't part of the house.
- **Loads connected to the House** count as part of it. Tick **Leave out devices connected to the House** to show just the rest of the house.
- Needs a Grid device with a power sensor. The history graph needs a real sensor, so it isn't shown for a calculated House.

```yaml
- type: house
  name: House
  power_mode: calc
  calc_exclude_connected: false   # true = leave out loads connected to the House
```

---

## 🔋 Battery time remaining

Open a Battery device in the editor, tick **Show time remaining**, then pick its **state of charge** sensor and enter its **capacity** (or pick a capacity sensor).

- **Discharging:** time until the battery reaches its **reserve** (e.g. the 4% many batteries stop at). Default: empty.
- **Charging:** time until it reaches its **charge limit**. Default: full.
- Power is averaged over roughly the last two minutes, so the estimate stays steady instead of jumping with every reading.
- The line hides when the battery is idle, and follows the same direction as the battery's flow line (including Invert flow).

---

## 💧 Water & 🔥 Gas

Add water and gas meters as devices, using a usage sensor (e.g. litres or m³ today) or a flow-rate sensor (e.g. L/min, m³/h).

- **Water** is always shown in **litres**; sensors reporting m³ are converted automatically.
- **Gas** can be shown in **m³ or kWh**. Conversion uses the standard UK billing formula: kWh = m³ × 1.02264 × calorific value ÷ 3.6. The calorific value (default 39.5 MJ/m³) is on your gas bill.
- On **Automatic**, both connect to your **House** device and flow into it whenever usage is above zero. Use **Connects to** to link them elsewhere.
- The watt-based flow threshold and load-based dot speed don't apply to water and gas.

---

## 📱 Phone layout

On narrow screens the card switches to a **portrait layout** with its own box positions, so everything is bigger and easier to read on a phone. Your desktop layout is never changed.

- **Automatic:** when the card is narrower than **600 px** (adjustable), or set it to **Always** / **Never**.
- **Ready out of the box:** boxes you haven't placed are arranged automatically in rows, keeping your desktop's top-to-bottom order.
- **Arrange it yourself:** in the editor's **Visual layout**, switch to **📱 Phone** and drag boxes. The preview shows the phone layout while you edit.
- **Copy desktop layout** starts from your desktop positions; **Reset phone layout** goes back to the automatic arrangement.
- **Background focus:** two sliders choose which part of your background stays in view in the portrait crop.
- **Show on phone:** untick any device or panel to hide it in the phone layout only. Hiding a device also hides its flow lines.

---

## 🎃 Seasonal background

Tick **Seasonal background** under your day and night backgrounds to add a picture for a time of year:

| Season | Shown |
|---|---|
| 🎃 Halloween | 25 Oct – 1 Nov |
| 🎄 Christmas | 1 Dec – 6 Jan |
| 🐣 Easter | Palm Sunday – Easter Monday (calculated each year) |
| 📅 Custom dates | Any range you choose; it can cross New Year |

- **Day and night pictures:** tap a tile to upload, or use 🔗 to paste an image URL. 👁 previews it in the layout editor, ✕ removes it.
- **Leave Night empty** to use the Day picture all the time.
- It comes back by itself every year; outside the dates your normal day/night background shows.
- **Animated rain & snow** still play over it.
- Unticking the box keeps your pictures for next time.

## 🌧️ Animated rain & snow

Tick **Animated rain & snow** under the backgrounds and the card draws the weather live over whatever background is showing. No extra pictures needed. Your boxes and flow lines always stay on top.

| Weather entity reports | Effect |
|---|---|
| rainy | Rain |
| pouring | Heavy rain |
| lightning-rainy | Heavy rain with lightning flashes |
| lightning | Lightning flashes only |
| hail | Hail with some rain |
| snowy | Snow |
| snowy-rainy | Sleet (snow and rain together) |

- **Amount** slider from light drizzle to a downpour.
- **Wind:** the rain tilts with the wind speed and direction from your weather entity.
- **Lightning flashes** can be switched off.
- **Try it:** preview buttons in the editor show each effect on the card, even on a dry day.
- **Light on your device:** it eases in and out as the weather changes, and stops completely when it's dry, when the card is off screen, or when the app is in the background. It's off if your device is set to reduce motion.
- Shows over every background, including your seasonal pictures.

---

## 👆 Tap actions

Every device, every Today row and the weather, bins, last updated and grid mix panels can have their own **tap**, **hold** and **double-tap** actions:

| Action | What it does |
|---|---|
| **Details** | Opens the Home Assistant details pop-up (the default for tap) |
| **Go to page** | Opens another dashboard or view, e.g. `/lovelace/battery` |
| **Toggle** | Switches something on or off, e.g. an EV charger switch |
| **Run action** | Runs any Home Assistant action, e.g. force a battery charge or change a Predbat mode |
| **Open link** | Opens a web page |
| **Nothing** | Does nothing, handy for a look-only wall display |

- Set them in the editor: in each device's settings (Devices tab), in each Today row's settings, and under **Panels → Tap actions**. Each one is a single folded line until you open it.
- **Ask first** adds an "Are you sure?" confirmation, recommended for toggles and actions on a wall display.
- Hold for half a second; the item brightens as you hold. Sliding your finger (scrolling) never triggers anything.
- The card uses Home Assistant's own action format (`tap_action`, `hold_action`, `double_tap_action`), the same as built-in cards, so YAML examples from elsewhere work too.
- Unset actions keep today's behaviour: a tap opens the details, while hold and double tap do nothing.

```yaml
devices:
  - type: ev
    name: EV charger
    power_entity: sensor.ev_power
    hold_action:
      action: toggle
      entity: switch.ev_charger
      confirmation: true
    double_tap_action:
      action: navigate
      navigation_path: /lovelace/ev
weather_tap_action:
  action: url
  url_path: https://www.metoffice.gov.uk
```

## 🗑️ Bin collection

Turn on **Show bin collection** in the editor and add up to 5 bins. Each bin has a name and a colour, and gets its dates from either:

- **A calendar:** pick the Home Assistant calendar for that bin. If one calendar holds several bins, add **match words** (e.g. `recycling, blue`) so each bin only picks its own events. Works with any calendar, including the [Waste Collection Schedule](https://github.com/mampfes/hacs_waste_collection_schedule) integration. Bank holiday changes in your calendar come through automatically.
- **A repeating schedule:** enter any one collection date and how often it repeats (every 1 to 8 weeks). For bins that alternate fortnightly, give both "every 2 weeks" with dates a week apart. Optional **skip dates** and **extra dates** handle holiday changes.

What you see:
- A small badge with coloured wheelie bins, e.g. **General waste & Recycling · Tomorrow**, shown all day before collection and all day on collection day. On collection day it gets an amber border.
- Or choose **Always show the next collection** to see the next date, e.g. "Garden waste · Thu 22 Oct", the rest of the week too.
- In **Classic** the badge is draggable in the visual layout (🗑️ handle) and can be resized under Sizing. In the other styles it appears as a chip in the header.
- Tap the badge to open the calendar.
- The editor shows each bin's **next collection date**, so you can check the right events are found. The section and each bin fold away, so the editor stays short.

---

## 🔌 Multi-inverter setups

With a single inverter there is nothing to configure.

With two or more inverters:
1. **Nothing wired manually?** Devices attach to the first inverter, and extra inverters attach to a Gateway device if you have one. Nothing is left disconnected.
2. **Want it to match your real wiring?** Add a **Gateway** device and set each device's **Connects to** field.
3. **Direction backwards?** Use that device's **Invert flow** toggle. The live readout under it shows the current direction straight away.

> Devices set to Automatic connect to the *first* inverter in the list, so reordering inverters changes which one is the main hub.

---

## 🛠 Example configuration

Everything below can also be set up in the visual editor.

```yaml
type: custom:home-power-flow-card
title: Energy Flow
subtitle: Live power
devices:
  - type: solar
    name: Solar PV
    power_entity: sensor.solar_power
    connects_to: inv1
  - type: inverter
    name: Inverter
    id: inv1
  - type: battery
    name: Battery
    power_entity: sensor.battery_power
    connects_to: inv1
    extra_entities:
      - entity: sensor.battery_soc
        icon: mdi:battery-charging
  - type: grid
    name: Grid
    power_entity: sensor.grid_power
  - type: house
    name: House
    power_entity: sensor.house_power
  - type: ev
    name: EV Charger
    power_entity: sensor.ev_power
statistics:
  entities:
    - name: Solar today
      entity: sensor.solar_energy_today
      icon: mdi:solar-power
grid_mix_enabled: true
grid_mix_postcode: SW1A
```

### Advanced example

A bigger home: two inverters joined by a gateway, two batteries (one with separate charge and discharge sensors), two solar arrays, a grid meter with separate import and export sensors, an EV charger, a heat pump and gas, plus the Today panel, bin collection, weather effects, a seasonal background and tap actions. It's also in the repo as [`example/advanced-config.yaml`](https://github.com/mimikm/Home-Power-Flow-Card/blob/main/example/advanced-config.yaml).

<details>
<summary>Show the advanced example</summary>

```yaml
# Home Power Flow Card - advanced example
#
# A bigger home: two inverters joined by a gateway, two batteries (one
# with separate charge/discharge sensors), two solar arrays, a grid meter
# with separate import/export sensors, an EV charger, a heat pump, gas,
# the Today panel, bin collection, weather effects and tap actions.
#
# Replace the entity ids with your own. Everything here can also be set up
# in the visual editor; device positions and sizes are easiest to set by
# dragging in the editor's Visual layout, so they are left out.

type: custom:home-power-flow-card
title: Home Energy
subtitle: Live power
view_style: classic          # classic, rings, river, tiles, glance or schematic
glance_battery_tiles: true   # At a glance: a small tile per battery
theme: auto                  # follows Home Assistant's light/dark mode
card_aspect: "16:9"
power_unit: auto             # W below 1 kW, kW above
flow_look_day: classic
flow_look_night: neon
flow_style: curved
flow_threshold_watts: 20     # hide flows below 20 W (sensor noise)
show_idle_lines: true
history_hours: 24
time_format: 24h
extra_entities_scale: 1.2    # slightly bigger text for extra readings

# ---------- Background, weather and seasons ----------
weather_entity: weather.home
sun_entity: sun.sun
weather_effects: true
weather_effects_amount: 1
weather_effects_lightning: true
seasonal_background: true
season: christmas            # 1 Dec to 6 Jan
background_season_day: /local/christmas-day.jpg
background_season_night: /local/christmas-night.jpg

# ---------- Devices ----------
devices:
  # The gateway joins both inverters to the house and grid.
  - type: gateway
    id: gw
    name: Gateway

  # Inverter 1 with its own solar array and battery.
  - type: inverter
    id: inv1
    name: Inverter 1
    power_entity: sensor.inverter_1_power
    connects_to: gw

  - type: solar
    id: pv_south
    name: Solar South
    power_entity: sensor.pv_south_power
    connects_to: inv1
    flow_color: "#ffd54f"
    history_graph: true
    extra_entities:
      - entity: sensor.pv_south_energy_today
        icon: mdi:solar-power-variant

  - type: battery
    id: bat1
    name: Battery 1
    power_entity: sensor.battery_1_power      # one sensor: + discharging, - charging
    connects_to: inv1
    battery_soc_entity: sensor.battery_1_soc
    battery_capacity: 9.5
    battery_reserve: 4
    battery_time: true
    flow_color_mode: custom
    flow_color_charge: "#3ddc84"
    flow_color_discharge: "#ff9800"
    hold_action:
      action: navigate
      navigation_path: /lovelace/battery

  # Inverter 2 (an all-in-one) with the second array and battery.
  - type: inverter
    id: inv2
    name: AiO
    power_entity: sensor.inverter_2_power
    connects_to: gw

  - type: solar
    id: pv_west
    name: Solar West
    power_entity: sensor.pv_west_power
    connects_to: inv2
    flow_color: "#ffb74d"

  - type: battery
    id: bat2
    name: AiO Battery
    power_mode: split                          # two sensors, both positive
    battery_charge_power_entity: sensor.aio_battery_charge_power
    battery_discharge_power_entity: sensor.aio_battery_discharge_power
    connects_to: inv2
    battery_soc_entity: sensor.aio_battery_soc
    battery_capacity_entity: sensor.aio_battery_capacity
    battery_charge_limit: 100
    battery_time: true
    flow_color_mode: glow
    double_tap_action:
      action: perform-action
      perform_action: select.select_option
      target:
        entity_id: select.predbat_mode
      data:
        option: Control charge
      confirmation: true

  - type: grid
    id: grid
    name: Grid
    power_mode: split
    grid_import_power_entity: sensor.grid_import_power
    grid_export_power_entity: sensor.grid_export_power
    connects_to: gw
    flow_color_mode: custom
    flow_color_import: "#ef5350"
    flow_color_export: "#42a5f5"
    extra_entities:
      - entity: sensor.grid_voltage
        icon: mdi:sine-wave
      - entity: sensor.electricity_price
        icon: mdi:currency-gbp

  - type: house
    id: house
    name: House
    power_entity: sensor.house_load_power
    connects_to: gw
    history_graph: true

  - type: ev
    id: ev
    name: EV Charger
    power_entity: sensor.ev_charger_power
    connects_to: house
    phone_hidden: true                         # hide on narrow screens
    hold_action:
      action: toggle
      entity: switch.ev_charger
      confirmation: true

  - type: heatpump                             # three-phase heat pump
    id: heat_pump
    name: Heat Pump
    power_mode: phases
    l1_power_entity: sensor.heat_pump_l1_power
    l2_power_entity: sensor.heat_pump_l2_power
    l3_power_entity: sensor.heat_pump_l3_power
    connects_to: house
    extra_entities:
      - entity: sensor.heat_pump_flow_temperature
        icon: mdi:thermometer
        decimals: 1                            # override Home Assistant's rounding

  - type: gas
    id: gas
    name: Gas
    power_entity: sensor.gas_meter_rate
    utility_unit: kWh
    gas_cv: 39.5

# ---------- Today panel ----------
self_sufficiency_live: true
self_sufficiency_today: true
self_consumption_today: true
self_sufficiency_import_entity: sensor.grid_import_today
self_sufficiency_consumption_entity: sensor.house_consumption_today
energy_export_entity: sensor.grid_export_today
energy_solar_entity: sensor.solar_energy_today
stats_mode: docked
stats_dock_edge: bottom
stats_dock_autohide: false
stats_decimals: 2
statistics:
  entities:
    - name: Solar today
      entity: sensor.solar_energy_today
      icon: mdi:solar-power
    - name: Imported
      entity: sensor.grid_import_today
      icon: mdi:transmission-tower-import
    - name: Exported
      entity: sensor.grid_export_today
      icon: mdi:transmission-tower-export
      tap_action:
        action: navigate
        navigation_path: /energy
    - name: Cost today
      entity: sensor.electricity_cost_today
      icon: mdi:cash

# ---------- Panels ----------
updated_enabled: true
updated_entity: sensor.inverter_1_last_updated
updated_stale_minutes: 5

grid_mix_enabled: true
grid_mix_postcode: SW1A

bins_enabled: true
bins_mode: near                # the day before and on collection day
bins:
  - name: General waste
    color: "#3a3f45"
    source: calendar
    calendar: calendar.bin_general
  - name: Recycling
    color: "#1e73d2"
    source: calendar
    calendar: calendar.bins
    match: recycling, blue      # one calendar holding several bins
  - name: Garden waste
    color: "#2e9e4f"
    source: manual
    start: "2026-10-08"
    every: 2
    skip: "2026-12-24"
    extra: "2026-12-27"

weather_tap_action:
  action: url
  url_path: https://www.metoffice.gov.uk
bins_tap_action:
  action: more-info
  entity: calendar.bin_general

# ---------- Phones and wall displays ----------
phone_layout: auto
phone_breakpoint: 600
phone_hide_gridmix: true
fullscreen_button: true
fullscreen_wake: true
```

</details>

Each device gets a stable internal `id` automatically. `connects_to` refers to that id rather than a position in the list, so reordering or deleting devices never rewires a connection by mistake.

---

## 📋 Configuration options

### Card

| Option | Default | Description |
|---|---|---|
| `title` | `Energy Flow` | Card title. Set to `""` for no title |
| `subtitle` | — | Optional second line under the title |
| `title_color` | `#ffffff` | Colour of the title and subtitle |
| `bins_enabled` | `false` | Shows the bin collection badge |
| `bins_mode` | `near` | `near` (all day before and on collection day) or `always` (always show the next collection) |
| `bins` | — | Up to 5 bins: `name`, `color`, `source` (`calendar` or `manual`); calendar: `calendar`, optional `match` (comma-separated words); manual: `start` (YYYY-MM-DD), `every` (weeks, 1–8), optional `skip` and `extra` (comma-separated dates) |
| `bins_scale` | `1` | Size of the bins badge (Classic) |
| `fullscreen_button` | `true` | Shows the full-screen button in the bottom-right corner |
| `fullscreen_wake` | `true` | Keeps the screen on while in full screen (needs Home Assistant over HTTPS) |
| `weather_tap_action` (and `_hold_action`, `_double_tap_action`) | | Optional. Actions for the weather box; the same for `bins_`, `updated_` and `gridmix_` |
| `view_style` | `classic` | `classic`, `rings`, `river`, `tiles`, `glance` or `schematic` (see [View styles](#-view-styles)) |
| `glance_battery_tiles` | `true` | At a glance: a tile for each battery with a state of charge sensor; `false` shows batteries as chips with their charge level |
| `theme` | `dark` | `auto`, `dark`, `light`, `midnight`, `ocean`, `forest`, `sunset`, `graphite` or `custom` |
| `card_aspect` | `3:2` | Card shape: `3:2`, `4:3`, `16:10`, `16:9`, `2:1`, `21:9`, `32:9`, `image` (match background) or `screen` (fill screen) |
| `background_fit` | `cover` | `cover` (fill, cropping the image) or `contain` (whole image, blurred edges) |
| `box_opacity` | `1` | Box and panel opacity: `0` (transparent) to `1.5` (more solid); `1` = theme default |
| `theme_panel_color` | `#081d34` | Custom theme: panel colour |
| `theme_text_color` | `#ffffff` | Custom theme: text colour |
| `theme_opacity` | `0.8` | Custom theme: panel opacity (`0.2` to `1`) |
| `history_hours` | `24` | History graph range: `6`, `12`, `24` or `48` hours |
| `history_opacity` | `0.35` | History graph opacity (`0.05` to `1`) |
| `show_idle_lines` | `false` | Keep idle connections visible as faint lines |
| `power_unit` | `auto` | `auto` (kW from 1000 W), `w` (always W) or `kw` (always kW) |
| `flow_look_day` | `classic` | Flow line look: `classic`, `neon`, `stream`, `marching`, `minimal`, `blueprint` or `static` |
| `flow_look_night` | `same` | Look at night (sun below the horizon): `same` as day or any look above |
| `flow_style` | `curved` | `curved`, `orthogonal` (right-angle lines that avoid boxes) or `manual` (your own bend points) |
| `flow_routes` / `phone_flow_routes` | — | Manual line bend points per connection (set in the layout editor) |
| `time_format` | `24h` | `24h` or `12h` for the clock |
| `weather_entity` | — | Weather entity for the weather box |
| `sun_entity` | `sun.sun` | Switches between the day and night backgrounds |
| `background` | built-in | Day background image URL (the built-in pictures load from this GitHub repository) |
| `background_night` | built-in | Night background image URL |
| `weather_effects` | `false` | Animated rain, snow, hail and lightning over the background |
| `weather_effects_amount` | `1` | How much rain/snow, `0.25` to `2` |
| `weather_effects_lightning` | `true` | Lightning flashes in thunderstorms |
| `seasonal_background` | `false` | Turns on the seasonal background |
| `background_season_day` / `background_season_night` | | Seasonal pictures (night falls back to day) |
| `season` | `halloween` | `halloween`, `christmas`, `easter` or `custom` |
| `season_start_day` / `season_start_month` / `season_end_day` / `season_end_month` | | Dates for `season: custom` (the range can cross New Year) |
| `flow_threshold_watts` | `1` | Minimum power (W) before a flow line shows |
| `flow_speed` | `8` | Base animation duration in seconds (at 1 kW) |
| `updated_enabled` | `false` | Show the last updated box |
| `updated_entity` | — | Entity to watch (uses its own timestamp if its state is one: date-time, time-only or Unix) |
| `updated_label` | `Updated` | Text before the time; `""` for none |
| `updated_stale_minutes` | `10` | Minutes before the box turns amber |
| `grid_mix_enabled` | `false` | Show the UK grid mix box |
| `grid_mix_postcode` | — | Outward postcode for regional data (e.g. `SW1A`); blank = all of GB |
| `self_sufficiency_live` | `false` | Show live self-sufficiency (needs a Grid and a House device) |
| `self_sufficiency_today` | `false` | Show today's self-sufficiency |
| `self_consumption_live` | `false` | Show live self-consumption (needs a Solar and a Grid device) |
| `self_consumption_today` | `false` | Show today's self-consumption |
| `self_sufficiency_import_entity` | — | Grid import today sensor |
| `self_sufficiency_consumption_entity` | — | Home consumption today sensor |
| `energy_export_entity` | — | Grid export today sensor |
| `energy_solar_entity` | — | Solar production today sensor |
| `self_sufficiency_calc_consumption` | `false` | Calculate consumption from import, solar, export and battery sensors |
| `energy_battery_charge_entity` | — | Battery charge today sensor (optional) |
| `energy_battery_discharge_entity` | — | Battery discharge today sensor (optional) |

### Sizing

| Option | Default | Description |
|---|---|---|
| `title_scale` | `1` | Title and subtitle size |
| `device_scale` | `1` | Device box size |
| `extra_entities_scale` | `1` | Text size of the extra entities (and phase readout) under the power value, `0.5` to `3`; the box size stays the same |
| `weather_scale` | `1` | Weather box size |
| `stats_decimals` | `2` | Decimal places for Today panel values (`0` to `3`) |
| `stats_mode` | `floating` | Today panel: `floating` (draggable) or `docked` to a card edge |
| `stats_dock_edge` | `bottom` | Docked edge: `bottom`, `top`, `left` or `right` |
| `stats_dock_autohide` | `true` | Docked panel hides to a tab and slides out on hover/tap |
| `phone_stats_mode` | `same` | Phone layout: `same` as desktop, `floating` or `docked` |
| `phone_stats_dock_edge` / `phone_stats_dock_autohide` | `bottom` / `true` | Dock settings for the phone layout |
| `stats_scale` | `0.8` | Today panel size (also shrinks automatically if too tall) |
| `grid_mix_scale` | `1` | Grid mix box size |
| `updated_scale` | `1` | Last updated box size |
| `mobile_scale` | `1.4` | Extra size for boxes on phones |
| `max_width` | `0` | Maximum card width in px (`0` = fill the available width) |
| `phone_layout` | `auto` | `auto` (narrow screens), `always` or `never` |
| `phone_breakpoint` | `600` | Card width in px below which the phone layout is used |
| `phone_bg_focus_x` / `phone_bg_focus_y` | `50` | Background focus point for the phone layout (0–100 %) |
| `phone_hide_header` / `_weather` / `_stats` / `_gridmix` / `_updated` | `false` | Hide that panel in the phone layout |

### Devices

| Option | Description |
|---|---|
| `type` | `solar`, `inverter`, `battery`, `gateway`, `house`, `grid`, `generator`, `water`, `gas`, `ev`, `heatpump` or `load` |
| `tap_action` / `hold_action` / `double_tap_action` | Optional. What tapping, holding or double-tapping the device does (Home Assistant's standard action format) |
| `name` | Display name |
| `power_entity` | Power sensor (W) |
| `power_mode` | `single` (one sensor; default); Battery/Grid: `split` (two separate sensors); Grid, Inverter, House, EV, Generator, Heat pump, Load: `phases` (three-phase); House: `calc` ([calculated](#-calculated-house-load)) |
| `grid_l1_power_entity` / `grid_l2_power_entity` / `grid_l3_power_entity` | Grid with `phases`: power sensor for each phase (+ export, − import) |
| `l1_power_entity` / `l2_power_entity` / `l3_power_entity` | Inverter, House, EV, Generator, Heat pump or Load with `power_mode: phases`: power sensor for each phase |
| `show_phases` | With `phases`: `false` to hide the per-phase readout in the box (default `true`) |
| `battery_charge_power_entity` / `battery_discharge_power_entity` | Battery with `split`: charging and discharging power sensors (both positive) |
| `grid_import_power_entity` / `grid_export_power_entity` | Grid with `split`: import and export power sensors (both positive) |
| `connects_to` | `id` of the device it's wired to (blank = Automatic) |
| `flow_color` | Flow line colour, e.g. `#ffd54f` |
| `invert_flow` | `true` to reverse the flow direction (for batteries and the grid this also swaps charging/discharging or import/export) |
| `box_w` / `box_h` | Custom box width/height (design px, min 110×60); set by resizing in the layout editor |
| `phone_box_w` / `phone_box_h` | Custom box size for the phone layout |
| `flow_color_mode` | Battery: `single` (default), `glow` or `custom`; Grid: `single` or `custom` |
| `flow_color_charge` / `flow_color_discharge` | Battery with `custom`: line colours when charging / discharging |
| `flow_color_import` / `flow_color_export` | Grid with `custom`: line colours when importing / exporting |
| `flow_lines` | `false` to hide this device's flow lines (the box and values stay) |
| `battery_glow` | Batteries only: `false` to turn off the charge/discharge glow |
| `battery_time` | Batteries only: `true` to show time remaining |
| `battery_soc_entity` | Batteries only: state of charge sensor (%) |
| `battery_capacity` | Batteries only: capacity in kWh (e.g. `13.5`) |
| `battery_capacity_entity` | Batteries only: capacity sensor, overrides `battery_capacity` |
| `battery_reserve` | Batteries only: reserve % where discharging stops (default `0`) |
| `battery_charge_limit` | Batteries only: charge limit % (default `100`) |
| `utility_unit` | Gas only: `m³` (default) or `kWh` |
| `gas_cv` | Gas only: calorific value in MJ/m³ for m³ ↔ kWh conversion (default `39.5`) |
| `extra_entities` | Up to 10 extra readings, each with `entity`, `icon` and optional `decimals` (`0`–`4`; default: Home Assistant's display precision) |
| `extra_entities_scale` | Text size of this device's extra entities; overrides the card-wide setting |
| `calc_exclude_connected` | House with `power_mode: calc`: `true` leaves out loads connected to the House |
| `phone_hidden` | `true` to hide this device (and its flow lines) in the phone layout |
| `history_graph` | `true` to show a power history graph behind the box |

Positions and sizes are easiest to set by dragging in the editor's **Visual layout**.

---

## 🗺️ Roadmap

Ideas and feedback are welcome, so [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues) if there's something you'd like to see.

**Project**
- More languages (contributions welcome!)

---

## 🤝 Contributing

Suggestions, bug reports and improvements are very welcome, so please [open an issue](https://github.com/mimikm/Home-Power-Flow-Card/issues). Testing on multi-inverter, gateway or other unusual setups is especially valuable.

---

## ❤️ Thanks

This project started as a personal dashboard improvement and is growing into a community project. Thank you to everyone testing it, suggesting improvements and helping make it better.

Grid mix data: [Carbon Intensity API](https://carbonintensity.org.uk/) by the National Energy System Operator (NESO).

---

## 📄 License

MIT © [Dom (mimikm)](https://github.com/mimikm)
