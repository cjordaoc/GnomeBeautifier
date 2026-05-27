# Hello, GNOME! — Reference community widget

This directory is a working community-widget example for **GNOME Beautifier**.

## Install

1. Copy this directory into your user widget folder:

   ```bash
   mkdir -p ~/.local/share/gnomebeautifier/widgets
   cp -r examples/widgets/com.example.hello-gnome \
         ~/.local/share/gnomebeautifier/widgets/
   ```

2. Open `widget.js` and replace `YOURUSER` in the `WidgetBase` import URL with
   your actual username (`whoami`):

   ```js
   import { WidgetBase }
       from 'file:///home/YOURUSER/.local/share/gnome-shell/extensions/gnomebeautifier@caio.jcalisto/modules/widgets/widget-base.js';
   ```

3. In GNOME Beautifier preferences, toggle **Enable desktop widgets** off and
   back on so the loader rescans the user directory.

4. Right-click the desktop → **Add Widget → Hello, GNOME!**.

You should see a small floating panel that greets you and updates the time
once a second. Drag it anywhere on the desktop; right-click on the widget
itself to remove it.

## What to read next

- [`../../../docs/WIDGET-API.md`](../../../docs/WIDGET-API.md) — full contract.
- [`../../../src/modules/widgets/widget-base.js`](../../../src/modules/widgets/widget-base.js) — the class you extend.
- [`../../../src/modules/widgets/builtin/`](../../../src/modules/widgets/builtin/) — four built-in widgets as a reference set.
