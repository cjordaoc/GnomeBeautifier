// Built-in widget: Clock & Date.
// Config:
//   timeFormat (string)   strftime-like format for the big line. Default '%H:%M'.
//   dateFormat (string)   strftime-like format for the small line. Default '%A, %B %-d'.

import GLib from 'gi://GLib';
import St from 'gi://St';

import { WidgetBase } from '../widget-base.js';

export default class ClockWidget extends WidgetBase {
    get displayName() { return 'Clock'; }
    get tickIntervalSeconds() { return 1; }

    defaultSize() { return { width: 220, height: 110 }; }
    defaultConfig() {
        return { timeFormat: '%H:%M', dateFormat: '%A, %B %-d' };
    }

    onMount() {
        this._timeLabel = new St.Label({
            text: '--:--',
            style_class: 'gnomebeautifier-widget-clock-time',
            x_expand: true,
        });
        this._dateLabel = new St.Label({
            text: '',
            style_class: 'gnomebeautifier-widget-clock-date',
            x_expand: true,
        });
        this.body.add_child(this._timeLabel);
        this.body.add_child(this._dateLabel);
    }

    onTick() {
        const now = GLib.DateTime.new_now_local();
        this._timeLabel.text = now.format(this.config.timeFormat) ?? '--:--';
        this._dateLabel.text = now.format(this.config.dateFormat) ?? '';
    }

    onUnmount() {
        this._timeLabel = null;
        this._dateLabel = null;
    }
}
