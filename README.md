# ⚡ Home Power Flow Card for Home Assistant

A beautiful animated energy flow card for Home Assistant Lovelace
dashboards.

Visualise your home's energy ecosystem with:

-   ☀️ Solar PV
-   ⚡ Inverter
-   🔋 Battery Storage
-   🏠 Home Consumption
-   🌐 Grid Import / Export
-   🚗 EV Charger
-   ⚙️ Additional Loads

------------------------------------------------------------------------

## ☕ Support the Project

If you enjoy this project and would like to support future development:

☕ https://buymeacoffee.com/mimikm

Your support helps me continue improving the card, adding features and
maintaining the project.

Thank you ❤️

------------------------------------------------------------------------

# 🚧 Work In Progress

Please note:

This is my **first open-source project** and it is actively being
developed.

The card is already usable, but it is still evolving. Features,
improvements and fixes are added based on my own Home Assistant setup
and feedback from the community.

Expect: - new features - UI improvements - bug fixes - ongoing
development

Feedback and suggestions are very welcome.

------------------------------------------------------------------------

# ✨ Features

## 🌊 Animated Energy Flows

Real-time animated power movement between your devices.

Supported: - Solar generation - Battery charging/discharging - Grid
import/export - House consumption - EV charging - Extra loads

------------------------------------------------------------------------

## 🔌 Inverter Junction Logic

The inverter acts as the central connection point.

The inverter: - connects energy sources and consumers - can display
inverter information - does not control flow direction

Flow direction is determined by connected devices such as: - solar -
battery - grid - house - EV - loads

------------------------------------------------------------------------

## 🔋 Battery Support

Battery devices support: - power flow direction - SOC display - voltage
display - temperature display

Different manufacturers report power direction differently, so devices
can have their own flow direction adjustment.

------------------------------------------------------------------------

## 🔄 Invert Flow Direction

Each device can invert its visual flow direction.

This changes only: - animation direction

It does not change: - sensor values - calculations - power readings

------------------------------------------------------------------------

## 🎨 Device Flow Colours

Each device can have its own flow colour.

Colours remain attached to the device regardless of flow direction.

Examples: - Solar → selected solar colour - Battery → selected battery
colour - Grid → selected grid colour - EV → selected EV colour

------------------------------------------------------------------------

## ⚙️ Visual Configurator

The built-in editor allows configuration of:

-   devices
-   Home Assistant entities
-   device layout
-   backgrounds
-   flow settings
-   device colours

Devices can be positioned using drag and drop.

------------------------------------------------------------------------

## 🖼️ Custom Backgrounds

Supports: - custom backgrounds - day/night backgrounds - uploaded Home
Assistant media images

------------------------------------------------------------------------

# 📦 Installation

## HACS

1.  Open HACS
2.  Go to Frontend
3.  Add this repository as a custom repository
4.  Install Home Power Flow Card
5.  Restart Home Assistant
6.  Add the card through Lovelace

------------------------------------------------------------------------

# ⚡ Flow Threshold

To avoid sensor noise:

Default threshold:

    1W

Behaviour:

  Power          Result
  -------------- --------------
  Below 1W       No flow line
  1W or higher   Flow visible

------------------------------------------------------------------------

# 🛠 Example Configuration

``` yaml
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
    soc_entity: sensor.battery_soc

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

------------------------------------------------------------------------

# 🤝 Contributions

Suggestions, bug reports and improvements are welcome.

When reporting issues please include: - Home Assistant version - card
version - configuration - affected entities

------------------------------------------------------------------------

# ❤️ Thanks

This project started as a personal Home Assistant dashboard improvement
and is growing into a community project.

Thank you to everyone testing, suggesting improvements and helping make
it better.
