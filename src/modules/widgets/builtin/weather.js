// Built-in widget: Weather.
// Pulls the most recent WeatherClient result via services.weather.getCurrent().
// Reusing the same client means we don't double-hit Open-Meteo; the extension's
// own refresh schedule (weather-refresh-minutes GSetting) covers the freshness.

import St from 'gi://St';

import { WidgetBase } from '../widget-base.js';

// Compact WMO → icon-name + word table. Icons are GNOME standard symbolic
// weather icons; falling back to 'weather-clear-symbolic' if unmapped.
const WMO_PRESENTATION = new Map([
    [0,  { icon: 'weather-clear-symbolic',         word: 'Clear sky' }],
    [1,  { icon: 'weather-few-clouds-symbolic',    word: 'Mainly clear' }],
    [2,  { icon: 'weather-few-clouds-symbolic',    word: 'Partly cloudy' }],
    [3,  { icon: 'weather-overcast-symbolic',      word: 'Overcast' }],
    [45, { icon: 'weather-fog-symbolic',           word: 'Fog' }],
    [48, { icon: 'weather-fog-symbolic',           word: 'Rime fog' }],
    [51, { icon: 'weather-showers-scattered-symbolic', word: 'Light drizzle' }],
    [53, { icon: 'weather-showers-scattered-symbolic', word: 'Drizzle' }],
    [55, { icon: 'weather-showers-symbolic',       word: 'Heavy drizzle' }],
    [61, { icon: 'weather-showers-scattered-symbolic', word: 'Light rain' }],
    [63, { icon: 'weather-showers-symbolic',       word: 'Rain' }],
    [65, { icon: 'weather-showers-symbolic',       word: 'Heavy rain' }],
    [71, { icon: 'weather-snow-symbolic',          word: 'Light snow' }],
    [73, { icon: 'weather-snow-symbolic',          word: 'Snow' }],
    [75, { icon: 'weather-snow-symbolic',          word: 'Heavy snow' }],
    [80, { icon: 'weather-showers-scattered-symbolic', word: 'Rain showers' }],
    [81, { icon: 'weather-showers-symbolic',       word: 'Rain showers' }],
    [82, { icon: 'weather-showers-symbolic',       word: 'Violent showers' }],
    [95, { icon: 'weather-storm-symbolic',         word: 'Thunderstorm' }],
    [96, { icon: 'weather-storm-symbolic',         word: 'Thunderstorm + hail' }],
    [99, { icon: 'weather-storm-symbolic',         word: 'Severe storm' }],
]);

function presentationFor(code, isDay) {
    const base = WMO_PRESENTATION.get(code) ?? { icon: 'weather-clear-symbolic', word: `WMO ${code ?? '?'}` };
    if (isDay === 0 && (code === 0 || code === 1))
        return { icon: 'weather-clear-night-symbolic', word: 'Clear night' };
    return base;
}

export default class WeatherWidget extends WidgetBase {
    get displayName() { return 'Weather'; }
    get tickIntervalSeconds() { return 60; }

    defaultSize() { return { width: 260, height: 130 }; }

    onMount() {
        const row = new St.BoxLayout({
            style_class: 'gnomebeautifier-widget-weather-row',
            x_expand: true,
        });
        this._icon = new St.Icon({
            icon_name: 'weather-clear-symbolic',
            icon_size: 48,
            style_class: 'gnomebeautifier-widget-weather-icon',
        });
        const stack = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnomebeautifier-widget-weather-text',
        });
        this._wordLabel = new St.Label({ text: '…', style_class: 'gnomebeautifier-widget-weather-word' });
        this._bucketLabel = new St.Label({ text: '', style_class: 'gnomebeautifier-widget-weather-sub' });
        this._locationLabel = new St.Label({ text: '', style_class: 'gnomebeautifier-widget-weather-sub' });
        stack.add_child(this._wordLabel);
        stack.add_child(this._bucketLabel);
        stack.add_child(this._locationLabel);
        row.add_child(this._icon);
        row.add_child(stack);
        this.body.add_child(row);
    }

    onTick() {
        const last = this.services()?.getLastWeather?.();
        if (!last) {
            this._wordLabel.text = 'Weather not loaded yet';
            this._bucketLabel.text = '';
            this._locationLabel.text = '';
            return;
        }
        const pres = presentationFor(last.code, last.isDay);
        this._icon.icon_name = pres.icon;
        this._wordLabel.text = pres.word;
        this._bucketLabel.text = `Bucket: ${last.bucket}`;
        this._locationLabel.text = `${last.latitude.toFixed(2)}, ${last.longitude.toFixed(2)}`;
    }

    onUnmount() {
        this._icon = null;
        this._wordLabel = null;
        this._bucketLabel = null;
        this._locationLabel = null;
    }
}
