// Built-in widget: Wallpaper Info.
// Shows the active bucket, current file name, and a swatch of the accent
// colour the extension applied. A "Next image" button cycles the wallpaper.

import GLib from 'gi://GLib';
import St from 'gi://St';

import { WidgetBase } from '../widget-base.js';

const ACCENT_HEX = {
    blue:   '#3584e4',
    teal:   '#2190a4',
    green:  '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red:    '#e62d42',
    pink:   '#d56199',
    purple: '#9141ac',
    slate:  '#6f8396',
};

export default class WallpaperInfoWidget extends WidgetBase {
    get displayName() { return 'Wallpaper'; }
    get tickIntervalSeconds() { return 5; }

    defaultSize() { return { width: 280, height: 140 }; }

    onMount() {
        const top = new St.BoxLayout({ x_expand: true });
        this._swatch = new St.Bin({
            style_class: 'gnomebeautifier-widget-wallpaper-swatch',
            width: 28, height: 28,
        });
        const stack = new St.BoxLayout({
            vertical: true, x_expand: true,
            style_class: 'gnomebeautifier-widget-wallpaper-text',
        });
        this._bucketLabel = new St.Label({
            text: '…', style_class: 'gnomebeautifier-widget-wallpaper-bucket',
        });
        this._fileLabel = new St.Label({
            text: '', style_class: 'gnomebeautifier-widget-wallpaper-file',
        });
        stack.add_child(this._bucketLabel);
        stack.add_child(this._fileLabel);
        top.add_child(this._swatch);
        top.add_child(stack);
        this.body.add_child(top);

        const buttonRow = new St.BoxLayout({
            style_class: 'gnomebeautifier-widget-wallpaper-buttons',
            x_expand: true,
        });
        const next = new St.Button({
            label: 'Next image',
            style_class: 'gnomebeautifier-widget-button',
            x_expand: true,
        });
        next.connect('clicked', () => this.services()?.onNext?.());
        buttonRow.add_child(next);
        this.body.add_child(buttonRow);
    }

    onTick() {
        const services = this.services();
        const wallpaper = services?.wallpaper;
        const last = services?.getLastWeather?.();
        if (!wallpaper) return;

        const path = wallpaper.currentPath();
        const bucket = wallpaper.currentBucket();
        this._bucketLabel.text = `Bucket: ${bucket}`;
        this._fileLabel.text = path ? GLib.path_get_basename(path) : '(no image)';
        if (last && last.code !== undefined)
            this._fileLabel.text += `  •  WMO ${last.code}`;

        const accentName = services?.getLastAccent?.()?.accent ?? 'slate';
        const hex = ACCENT_HEX[accentName] ?? ACCENT_HEX.slate;
        this._swatch.style = `background-color: ${hex}; border-radius: 6px;`;
    }

    onUnmount() {
        this._swatch = null;
        this._bucketLabel = null;
        this._fileLabel = null;
    }
}
