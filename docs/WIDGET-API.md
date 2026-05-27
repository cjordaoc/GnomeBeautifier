# GNOME Beautifier — Widget API

This document is the public contract for building a third-party widget.
If you follow it, your widget loads alongside the built-ins, appears in the
"Add Widget" menu, persists its position and config across reboots, and
respects every lifecycle gate (enable / disable / fullscreen).

The contract is small on purpose — a widget is one manifest plus one ESM
JavaScript file.

> **Stability.** This document targets **API version 1**. Future breaking
> changes will bump that integer; the loader refuses to load widgets whose
> `api-version` does not match the version GNOME Beautifier ships.

---

## 1. Where widgets live

```
~/.local/share/gnomebeautifier/widgets/
└── com.example.MyWidget/        ← UUID directory; can be any unique slug
    ├── widget.json              ← manifest (required)
    └── widget.js                ← ESM module (required)
```

Built-in widgets ship with the extension and use the same contract — see
[`src/modules/widgets/builtin/clock.js`](../src/modules/widgets/builtin/clock.js)
as a reference implementation.

---

## 2. `widget.json` manifest

```json
{
  "uuid":        "com.example.MyWidget",
  "name":        "My Widget",
  "description": "Short single-line summary shown in the Add Widget menu.",
  "version":     1,
  "api-version": 1,
  "main":        "widget.js"
}
```

| Field         | Type    | Required | Notes |
|---------------|---------|----------|-------|
| `uuid`        | string  | yes      | Globally unique. Convention: reverse-DNS or short slug. Built-ins use short slugs (`clock`, `weather`). |
| `name`        | string  | yes      | Shown in the "Add Widget" submenu. |
| `description` | string  | yes      | One-line summary. |
| `version`     | integer | yes      | Bump on every release of your widget. |
| `api-version` | integer | yes      | Must equal the loader's `CURRENT_API_VERSION` (currently `1`). |
| `main`        | string  | no       | Defaults to `widget.js`. Path is relative to the UUID directory. |

The loader rejects manifests missing any required field or whose `api-version`
mismatches.

---

## 3. `widget.js` module

A widget is an ESM module whose **default export** is a class extending
`WidgetBase`. The class file lives **inside the user widget directory** and
imports `WidgetBase` from the extension's installed location:

```js
// ~/.local/share/gnomebeautifier/widgets/com.example.MyWidget/widget.js

import St from 'gi://St';
import GLib from 'gi://GLib';

// The extension is installed to a known path; import WidgetBase from there.
// See section 6 for why this path is stable.
import { WidgetBase }
    from 'file:///home/USER/.local/share/gnome-shell/extensions/gnomebeautifier@caio.jcalisto/modules/widgets/widget-base.js';

export default class MyWidget extends WidgetBase {
    get displayName() { return 'My Widget'; }
    get tickIntervalSeconds() { return 10; }   // 0 disables the periodic tick

    defaultSize() { return { width: 200, height: 90 }; }

    defaultConfig() {
        return { message: 'Hello, GNOME!' };
    }

    onMount() {
        this._label = new St.Label({
            text: this.config.message,
            x_expand: true,
        });
        this.body.add_child(this._label);
    }

    onTick() {
        this._label.text = `${this.config.message} — ${GLib.DateTime.new_now_local().format('%T')}`;
    }

    onConfigChanged(key) {
        if (key === 'message')
            this._label.text = this.config.message;
    }

    onUnmount() {
        this._label = null;
    }
}
```

A complete working example lives at
[`examples/widgets/com.example.hello-gnome/`](../examples/widgets/com.example.hello-gnome).
Copy it into `~/.local/share/gnomebeautifier/widgets/`, toggle the master
widget switch off and on in preferences, and it will appear in the "Add Widget"
menu.

---

## 4. Lifecycle

The manager invokes hooks in this order; **do not call them yourself**:

| Hook                  | When                                          | Override? |
|-----------------------|-----------------------------------------------|-----------|
| `constructor(ctx)`    | The instance is first created                 | No. Don't touch the stage here. |
| `defaultConfig()`     | Right after `constructor`, before `onMount`   | Optional. Return an object merged under saved config. |
| `defaultSize()`       | At mount, to pick the container size          | Optional. Default `{220, 120}`. |
| `onMount()`           | After the container is attached to the stage  | **Required.** Build child actors inside `this.body`. |
| `onTick()`            | Every `tickIntervalSeconds` (and once at mount) | Required if `tickIntervalSeconds > 0`. |
| `onConfigChanged(k)`  | After `setConfig({k: v})`                     | Optional. React to config changes without a full remount. |
| `onUnmount()`         | Before the container is destroyed             | **Required if** you held resources (timers, file monitors, signal handlers). |

Guarantees:

- `this.container` is a non-null `St.BoxLayout` between `onMount` and `onUnmount`.
- `this.body` is the inner container — **always add your widgets to `this.body`**, not to `this.container`.
- `onTick()` runs immediately after `onMount()` for the first render, then on the interval.
- If `tickIntervalSeconds` is 0, you receive no automatic ticks.
- Any throw inside a hook is caught and logged via `logError` — your widget will be unmounted; you won't crash the shell.

---

## 5. Per-instance config

Each widget instance has its own config object. Read it with `this.config`;
update it with `this.setConfig({key: value})`. Updates are persisted to
GSettings (`widget-instances`) immediately and trigger `onConfigChanged(key)`.

```js
// Read
const message = this.config.message;

// Write (persists + triggers onConfigChanged)
this.setConfig({ message: 'New text' });
```

`defaultConfig()` runs once on mount; saved values override its defaults. So
new releases of your widget can add keys to `defaultConfig()` without breaking
existing instances.

---

## 6. Cross-cutting services

`this.services()` returns an object exposing GNOME Beautifier's own state.
Use it to keep your widget honest — for example, never hit the weather API
yourself; read the cached result from `services.getLastWeather()` so all
widgets share the same refresh schedule.

| Service                          | Returns / signature                                                | Use for |
|----------------------------------|--------------------------------------------------------------------|---------|
| `services.settings`              | `Gio.Settings` for the extension's gschema                         | Reading non-widget prefs (rotation interval etc.) |
| `services.wallpaper`             | `WallpaperManager` (see `src/modules/wallpaper.js`)                | `.currentPath()`, `.currentBucket()`, `.imagesForBucket()` |
| `services.weather`               | `WeatherClient` (see `src/modules/weather.js`)                     | Direct API access **only if** you accept the cost of an extra HTTP call. |
| `services.accent`                | `AccentManager` (see `src/modules/accent.js`)                      | Re-running the accent algorithm yourself |
| `services.getLastWeather()`      | `{bucket, code, isDay, latitude, longitude} \| null`               | Cached weather; updates on the extension's refresh schedule |
| `services.getLastAccent()`       | `{accent, scheme} \| null`                                         | The accent and color-scheme currently applied |
| `services.getCurrentPath()`      | `string \| null`                                                   | Absolute path to the active wallpaper |
| `services.onNext()`              | `() => void`                                                       | Cycle the wallpaper forward |
| `services.onPrevious()`          | `() => void`                                                       | Cycle the wallpaper backward |
| `services.onRefreshWeather()`    | `() => Promise<void>`                                              | Force a weather refresh now |

---

## 7. Importing `WidgetBase`

Your widget runs inside the GNOME Shell process, **not** inside the extension's
module graph — so the loader uses a `file://` dynamic import. That means
relative imports (`../widget-base.js`) do **not** work from the user widget
directory. Import `WidgetBase` by absolute file URL:

```js
import { WidgetBase }
    from 'file:///home/YOURUSER/.local/share/gnome-shell/extensions/gnomebeautifier@caio.jcalisto/modules/widgets/widget-base.js';
```

This path is stable: the extension's UUID is fixed (`gnomebeautifier@caio.jcalisto`)
and GNOME Shell always installs user extensions under
`~/.local/share/gnome-shell/extensions/`.

If you publish a community widget, **document the install path in your
widget's README** — users with system-wide extension installs will need to
point the import at `/usr/share/gnome-shell/extensions/...` instead.

---

## 8. Styling

**Glassmorphism is the default.** Every widget gets a `Shell.BlurEffect` in
`BACKGROUND` mode applied to its outer container by the base class — the
wallpaper (and any windows under the widget) is blurred behind the widget,
while your text and icons stay crisp. The CSS layer adds a low-alpha tint,
a 1px light edge, and a soft drop shadow. You do not need to opt in.

**Opting out.** If your widget needs an opaque background (for example, you're
embedding video or a high-contrast canvas), set `this.disableGlass = true` in
the constructor **before** calling `super`-equivalent state — concretely, set
it in your own constructor before any call that would trigger `mount()`. The
base class checks the flag at mount time and skips the BlurEffect.

**Fallback.** On software-rendered sessions (no GL — rare but possible), the
BlurEffect throws. The base class catches it, logs once, and adds the class
`gnomebeautifier-widget-glass-fallback` to your container, which boosts the
background opacity so the widget remains legible without blur.

**Reusable CSS classes** you can attach via `style_class`:

- `gnomebeautifier-widget-button` — pill button matching the widget chrome.
- `gnomebeautifier-widget-title` — small-caps label, suitable for section headers inside your widget body.

You can also attach an inline style string (`actor.style = 'color: #fff;'`)
for one-off tweaks. **Don't** override the container's background — the glass
look depends on the low-alpha tint.

---

## 9. Lifecycle invariants for community widgets

Treat these as required, not advice:

1. **Never `Main.layoutManager.addChrome` your own actor.** The base class owns the chrome registration; doing it yourself will leak the container on disable.
2. **Never start your own timers without storing the source id** and removing it in `onUnmount()`. The base class's tick is the safe path for periodic work.
3. **Never make synchronous network calls.** Use the cached `services.getLastWeather()` if at all possible; if you must call the network, do it through `Soup.Session.send_and_read_async()` and store the cancellable so you can abort it in `onUnmount`.
4. **Never call `sudo` or `Gio.Subprocess` for privileged work.** Widgets run inside the Shell process; a hang takes the desktop down with it.
5. **Never write outside `~/.cache/gnomebeautifier/`** without explicit user consent surfaced through your own config UI.

---

## 10. Reference list of GI imports

Widgets typically need only these:

```js
import St      from 'gi://St';        // labels, boxes, icons, buttons
import Clutter from 'gi://Clutter';   // events, alignments, colors
import GLib    from 'gi://GLib';      // time, file paths, timers (rare)
import Gio     from 'gi://Gio';       // file reads (e.g. /proc), GSettings
import Soup    from 'gi://Soup';      // async HTTP (Soup 3 only on GNOME 45+)
import GdkPixbuf from 'gi://GdkPixbuf';  // image loading (e.g. icons)
```

The full list of available libraries is the GJS surface — see
<https://gjs-docs.gnome.org/> for the bindings shipped with your GNOME version.

---

## 11. Reporting bugs / suggesting API changes

Open an issue on the GnomeBeautifier repository with:
- Your widget's manifest (`widget.json`).
- The smallest `widget.js` that reproduces the problem.
- `journalctl --user -f -o cat /usr/bin/gnome-shell` output around the failure.
