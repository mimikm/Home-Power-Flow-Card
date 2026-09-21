# Home Power Flow Card

<p align="center">
<a href="https://github.com/mimikm/Home-Power-Flow-Card">
<img src="https://img.shields.io/badge/GitHub-Home%20Power%20Flow%20Card-black?logo=github">
</a>
<a href="https://buymeacoffee.com/mimikm">
<img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support%20Development-yellow?logo=buymeacoffee">
</a>
</p>

A custom Home Assistant Lovelace energy flow card for visualising solar, batteries, inverters, EV chargers, grid and home energy usage.

**Author:** Dom Martyniak

> ⚠️ Work in Progress. This project is actively developed. Features and functionality may change.

## Support Development

☕ https://buymeacoffee.com/mimikm

## Reporting Bugs and Requests

Please use GitHub Issues for:
- bugs
- feature requests
- improvements
- new device support

Include:
- Home Assistant version
- Card version
- screenshots
- entity configuration where possible

## Features

- Multiple solar arrays
- Multiple inverters
- Multiple batteries
- Grid monitoring
- EV charger support
- Extra loads
- Weather and time display
- Daily statistics
- Draggable layout
- Custom backgrounds
- Animated dotted energy flow
- Configurable flow colours
- Visual configuration editor

## Entities

### Battery
- Power
- SOC
- Voltage
- Temperature

### Inverter
- Power
- Temperature

### Grid
- Power
- Voltage
- Frequency

## Background

The card includes a default background image.

Users can replace it using the visual configuration editor.

Custom files can be stored in:

```
/config/www/community/home-power-flow-card/
```

Example:

```
/local/community/home-power-flow-card/my-background.png
```

## Installation

Install through HACS:

1. Add this repository as a custom frontend repository.
2. Install Home Power Flow Card.
3. Add the Lovelace resource automatically or manually.

Manual resource:

```
/hacsfiles/home-power-flow-card/home-power-flow-card.js
```

## Version

Current public release:

```
0.5.0
```

## Credits

Created and maintained by:

Dom Martyniak


## Device Flow Direction

All devices use the same flow direction logic.

Default:
- Positive power = output
- Negative power = input
- 0 W or unavailable = no flow

Each device can be individually inverted from the visual configuration panel.

This applies to:
- Solar arrays
- Inverters
- Batteries
- Grid
- EV chargers
- Extra loads
- Additional devices
