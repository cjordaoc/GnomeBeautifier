// Reference community widget. Copy this directory into
//   ~/.local/share/gnomebeautifier/widgets/
// then toggle the "Enable desktop widgets" switch off and back on in the
// preferences. The widget will appear in the Add Widget menu.
//
// Replace YOURUSER below with your actual username, or change the import to
// point at /usr/share/gnome-shell/extensions/... if you installed system-wide.

import GLib from 'gi://GLib';
import St from 'gi://St';

import { WidgetBase }
    from 'file:///home/YOURUSER/.local/share/gnome-shell/extensions/gnomebeautifier@caio.jcalisto/modules/widgets/widget-base.js';

export default class HelloGnomeWidget extends WidgetBase {
    get displayName() { return 'Hello, GNOME!'; }
    get tickIntervalSeconds() { return 1; }

    defaultSize() { return { width: 220, height: 90 }; }
    defaultConfig() {
        return { greeting: 'Hello, GNOME!' };
    }

    onMount() {
        this._greeting = new St.Label({
            text: this.config.greeting,
            style: 'font-size: 1.1em; font-weight: 500;',
            x_expand: true,
        });
        this._clock = new St.Label({
            text: '',
            style: 'font-size: 0.85em; color: rgba(255,255,255,0.65);',
            x_expand: true,
        });
        this.body.add_child(this._greeting);
        this.body.add_child(this._clock);
    }

    onTick() {
        this._clock.text = GLib.DateTime.new_now_local().format('%A · %T');
    }

    onConfigChanged(key) {
        if (key === 'greeting')
            this._greeting.text = this.config.greeting;
    }

    onUnmount() {
        this._greeting = null;
        this._clock = null;
    }
}
