# GNOME Beautifier

A GNOME Shell extension (47+) that turns GNOME's static desktop into a live,
weather-aware, widget-friendly scene:

- **Dynamic wallpaper library** organised by weather bucket (`clear`, `clouds`, `rain`, `storm`, `snow`, `fog`, `night`, `default`).
- **Weather-driven bucket selection** based on the current weather at your location via the free [Open-Meteo](https://open-meteo.com/) API (no key required).
- **Desktop right-click menu** — cycle wallpaper, refresh weather, add / remove widgets, open settings — injected straight into GNOME's built-in background menu (the one with "Change Background…").
- **Accent colour follows the wallpaper** — the dominant hue is mapped to one of GNOME 47's nine accent colours (`blue`, `teal`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`, `slate`).
- **Light / dark theme follows the wallpaper** — bright images switch to `default`, dark images to `prefer-dark`.
- **Desktop widgets** — KDE-Plasmoid-style floating widgets on the desktop layer, occluded by windows, auto-hidden during fullscreen. Pluggable: drop a `widget.json` + `widget.js` into `~/.local/share/gnomebeautifier/widgets/` and your widget loads alongside the built-ins.

## Install

```bash
git clone https://github.com/caio-jcalisto/GnomeBeautifier
cd GnomeBeautifier
bash install.sh
```

`install.sh` packs the extension, installs it via `gnome-extensions`, enables it,
and runs [`scripts/setup-wallpapers.sh`](scripts/setup-wallpapers.sh) to populate
`~/Pictures/Weather-Wallpapers/{bucket}/` from your system's KDE / Plasma / GNOME
wallpaper packages.

After installation, **log out and back in** (or on X11, press `Alt+F2`, type `r`)
so GNOME Shell loads the extension.

## Usage

### Wallpaper & weather

Right-click on the desktop. The standard "Change Background… / Display Settings /
Settings" menu now has GNOME Beautifier items prepended:

```
Bucket: clear · WMO 0 (day) · 2 widgets
─────────────────
Next Wallpaper
Previous Wallpaper
Refresh Weather Now
─────────────────
Add Widget        ›
Remove Widget     ›
─────────────────
GNOME Beautifier Settings…
─────────────────
Change Background…        (stock GNOME)
─────────────────
Display Settings          (stock GNOME)
Settings                  (stock GNOME)
```

A small wallpaper icon also appears in the top panel with the same items.

### Widgets

Built-in widgets shipped with the extension:

| Widget          | What it shows |
|-----------------|---------------|
| Clock           | Time + date, configurable strftime format. |
| Weather         | Icon, condition word, current bucket, your location. |
| Wallpaper Info  | Active bucket, current image filename, accent colour swatch, "Next image" button. |
| System Monitor  | CPU % with a 30-sample sparkline, RAM % + used / total GiB. |

To place a widget: right-click the desktop → **Add Widget** → pick from the
submenu. To move a widget, drag it. To remove a widget, either right-click on
the widget itself, or use **Remove Widget** in the desktop menu.

Widget positions and per-instance config are saved across reboots in
GSettings (`widget-instances`). The master switch is in
preferences → **Widgets** → "Enable desktop widgets".

### Building your own widget

The widget API is a 200-line contract documented in
[`docs/WIDGET-API.md`](docs/WIDGET-API.md) with a working reference
implementation at [`examples/widgets/com.example.hello-gnome/`](examples/widgets/com.example.hello-gnome/).

Quick version:

```
~/.local/share/gnomebeautifier/widgets/
└── com.example.MyWidget/
    ├── widget.json       (manifest)
    └── widget.js         (ESM module exporting a WidgetBase subclass)
```

After dropping the files in, toggle the **Enable desktop widgets** switch off
and back on in preferences — the loader rescans the user directory and your
widget appears in the Add Widget menu.

## Project layout

```
.
├── AGENTS.md, CLAUDE.md       agent contract; root behavior rules
├── README.md                  this file
├── Makefile, install.sh       packaging
├── docs/
│   └── WIDGET-API.md          public contract for third-party widgets
├── examples/
│   └── widgets/
│       └── com.example.hello-gnome/   reference community widget
├── scripts/
│   └── setup-wallpapers.sh    one-shot, idempotent wallpaper installer
└── src/
    ├── metadata.json
    ├── extension.js           lifecycle + composition root
    ├── prefs.js               Adwaita preferences window
    ├── stylesheet.css
    ├── modules/
    │   ├── wallpaper.js       rotation, current/next, GSettings writes
    │   ├── weather.js         Open-Meteo client + WMO → bucket mapping
    │   ├── accent.js          GdkPixbuf sampling + accent / scheme apply
    │   ├── indicator.js       desktop-menu injection + panel button
    │   └── widgets/
    │       ├── widget-base.js     base class with drag + lifecycle
    │       ├── widget-manager.js  instance registry + persistence
    │       ├── widget-loader.js   builtin + user-dir discovery
    │       └── builtin/
    │           ├── clock.js
    │           ├── weather.js
    │           ├── wallpaper-info.js
    │           └── system-monitor.js
    └── schemas/
        └── org.gnome.shell.extensions.gnomebeautifier.gschema.xml
```

## Weather code → bucket mapping

Open-Meteo returns a WMO weather code in `current.weather_code`. Mapping (see
[`src/modules/weather.js`](src/modules/weather.js)):

| WMO codes              | Bucket   |
|------------------------|----------|
| 0                      | `clear`  (or `night` when `is_day=0`) |
| 1, 2                   | `clouds` (or `night`)                 |
| 3                      | `clouds` (overcast)                   |
| 45, 48                 | `fog`                                  |
| 51–67, 80–82           | `rain`                                 |
| 71–77, 85, 86          | `snow`                                 |
| 95, 96, 99             | `storm`                                |
| anything else          | `default`                              |

## Privacy

- The extension never sends location to anyone except Open-Meteo and (when
  `location-source=ip`) `ipapi.co`. Both calls happen from your machine; no
  third-party telemetry is added by the extension.
- Switch to `location-source=manual` and enter coordinates yourself if you want
  to avoid the IP lookup entirely.
- The extension never runs `sudo`; `scripts/setup-wallpapers.sh` does, and only
  when you launch it.

## Developing

```bash
make lint           # validate metadata.json + gschema
make pack           # build dist/<uuid>.shell-extension.zip
make install        # pack + install
make reinstall      # disable, install, enable

# Quick smoke test in a nested Shell (Wayland host):
dbus-run-session -- gnome-shell --nested --wayland
# In the nested Shell:
gnome-extensions enable gnomebeautifier@caio.jcalisto
journalctl --user -f -o cat /usr/bin/gnome-shell
```

See [`AGENTS.md`](AGENTS.md) for the agent / contributor contract.

## Credits & inspiration

GNOME Beautifier stands on the work of others. Many thanks to:

- The **GJS team** and **gjs.guide** — the GNOME Shell extension documentation
  and ESM patterns at <https://gjs.guide/extensions/> are the foundation this
  extension is built on.
- The **KDE Plasma team** — the Plasmoid model (free placement, per-instance
  config, library of widgets) is the design GNOME Beautifier's widget
  subsystem ports to GNOME.
- **Wartybix** and the [Auto Accent Colour](https://codeberg.org/Wartybix/GNOME-Auto-Accent-Colour)
  extension — the wallpaper → accent algorithm (HSV histogram, hue-nearest accent)
  is inspired by Auto Accent Colour. Auto Accent Colour delegates to ColorThief;
  GnomeBeautifier inlines a smaller histogram in pure GJS, but the idea is theirs.
- **jeffshee** and [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi) — the
  first extension to seriously show that you can run live, layered content on the
  GNOME desktop background. The desktop-layer placement pattern Hanabi
  pioneered is what makes widgets possible here.
- **NiffirgkcaJ** and [Desktop Widgets](https://github.com/NiffirgkcaJ/desktop-widgets) —
  prior art for floating widgets on GNOME. GnomeBeautifier ships a pluggable
  framework rather than a fixed widget set, but Desktop Widgets demonstrated
  that the concept is viable on modern GNOME Shell.
- The **Cinnamon / Linux Mint team** — the Desklets architecture (UUID per
  widget type, instance IDs, per-instance settings, lifecycle managed by a
  separate manager) is the design pattern adopted here. See the
  [`cinnamon-spices-desklets`](https://github.com/linuxmint/cinnamon-spices-desklets)
  repository for the Cinnamon equivalent.
- **[Open-Meteo](https://open-meteo.com/)** — free, no-key weather API used for
  the weather → bucket mapping. If GNOME Beautifier helps you, consider
  supporting Open-Meteo's open infrastructure.
- **[ipapi.co](https://ipapi.co/)** — free IP geolocation, used for the
  default location source.
- The authors of the **WMO weather code mapping** documented at
  <https://open-meteo.com/en/docs>.

If your project inspired or contributed to GNOME Beautifier and isn't listed
here, please open an issue — credit is required, not optional.
