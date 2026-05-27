// Composition root: instantiate modules, wire them together, and own the
// extension lifecycle (timers, GSettings change handlers, teardown).

import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WallpaperManager } from './modules/wallpaper.js';
import { WeatherClient } from './modules/weather.js';
import { AccentManager } from './modules/accent.js';
import { IndicatorManager } from './modules/indicator.js';
import { WidgetManager } from './modules/widgets/widget-manager.js';

export default class GnomeBeautifierExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._wallpaper = new WallpaperManager(this._settings);
        this._weather = new WeatherClient(this._settings);
        this._accent = new AccentManager(this._settings);

        this._lastWeather = null;
        this._lastAccent = null;
        this._lastAppliedPath = null;
        this._lastError = null;

        // Cross-cutting handles visible to widgets via services().
        const services = {
            settings: this._settings,
            wallpaper: this._wallpaper,
            accent: this._accent,
            weather: this._weather,
            getLastWeather: () => this._lastWeather,
            getLastAccent: () => this._lastAccent,
            getCurrentPath: () => this._lastAppliedPath,
            onNext: () => this._cycleAndApply(+1),
            onPrevious: () => this._cycleAndApply(-1),
            onRefreshWeather: () => this._refreshWeather(/* force */ true),
        };
        this._services = services;

        this._widgets = new WidgetManager(this._settings, services);

        this._indicator = new IndicatorManager({
            onNext: () => this._cycleAndApply(+1),
            onPrevious: () => this._cycleAndApply(-1),
            onRefreshWeather: () => this._refreshWeather(/* force */ true),
            onOpenPrefs: () => this.openPreferences(),
            statusText: () => this._statusText(),
            listWidgetDefinitions: () => this._widgets?.listDefinitions() ?? [],
            listWidgetInstances: () => this._widgets?.listInstances() ?? [],
            onAddWidget: (uuid) => this._widgets?.addInstance(uuid),
            onRemoveWidget: (instanceId) => this._widgets?.removeInstance(instanceId),
        });
        this._indicator.enable();

        this._rotationTimerId = 0;
        this._weatherTimerId = 0;
        this._settingsHandlers = [];

        // React to changes the user makes in prefs immediately.
        this._settingsHandlers.push(this._settings.connect('changed::rotation-interval-minutes',
            () => this._restartRotationTimer()));
        this._settingsHandlers.push(this._settings.connect('changed::rotation-enabled',
            () => this._restartRotationTimer()));
        this._settingsHandlers.push(this._settings.connect('changed::weather-refresh-minutes',
            () => this._restartWeatherTimer()));
        this._settingsHandlers.push(this._settings.connect('changed::weather-enabled',
            () => this._refreshWeather(/* force */ true)));
        this._settingsHandlers.push(this._settings.connect('changed::wallpaper-root',
            () => this._applyCurrent()));
        this._settingsHandlers.push(this._settings.connect('changed::widgets-enabled',
            () => this._reconcileWidgets()));

        // Apply once immediately, then schedule periodic work + spawn widgets.
        this._applyCurrent();
        this._restartWeatherTimer();
        this._restartRotationTimer();
        this._reconcileWidgets();
    }

    disable() {
        if (this._rotationTimerId) {
            GLib.source_remove(this._rotationTimerId);
            this._rotationTimerId = 0;
        }
        if (this._weatherTimerId) {
            GLib.source_remove(this._weatherTimerId);
            this._weatherTimerId = 0;
        }

        if (this._settings && this._settingsHandlers) {
            for (const id of this._settingsHandlers)
                this._settings.disconnect(id);
        }
        this._settingsHandlers = null;

        this._widgets?.disable();
        this._widgets = null;

        this._indicator?.disable();
        this._indicator = null;

        this._accent?.destroy();
        this._accent = null;

        this._weather?.destroy();
        this._weather = null;

        this._wallpaper?.destroy();
        this._wallpaper = null;

        this._settings = null;
        this._services = null;
        this._lastWeather = null;
        this._lastAccent = null;
        this._lastAppliedPath = null;
        this._lastError = null;
    }

    // ---------- Actions ----------

    _cycleAndApply(direction) {
        const path = direction > 0 ? this._wallpaper.next() : this._wallpaper.previous();
        if (!path) {
            this._lastError = `No images in bucket "${this._wallpaper.currentBucket()}"`;
            this._indicator?.refreshStatus();
            return;
        }
        this._wallpaper.apply(path);
        this._lastAccent = this._accent.apply(path);
        this._lastAppliedPath = path;
        this._lastError = null;
        this._indicator?.refreshStatus();
    }

    _applyCurrent() {
        const path = this._wallpaper.currentPath();
        if (!path) {
            this._lastError = `No images in bucket "${this._wallpaper.currentBucket()}". Run scripts/setup-wallpapers.sh.`;
            this._indicator?.refreshStatus();
            return;
        }
        this._wallpaper.apply(path);
        this._lastAccent = this._accent.apply(path);
        this._lastAppliedPath = path;
        this._lastError = null;
        this._indicator?.refreshStatus();
    }

    async _refreshWeather(force = false) {
        if (!this._settings.get_boolean('weather-enabled'))
            return;
        try {
            const result = await this._weather.getCurrent();
            this._lastWeather = result;
            const newBucket = this._wallpaper.setBucket(result.bucket);
            if (force || newBucket !== this._wallpaper.currentBucket() || !this._lastAppliedPath)
                this._applyCurrent();
            this._lastError = null;
        } catch (e) {
            this._lastError = `Weather lookup failed: ${e.message ?? e}`;
            logError(e, 'GnomeBeautifier: weather refresh failed');
        }
        this._indicator?.refreshStatus();
    }

    // ---------- Widget lifecycle ----------

    async _reconcileWidgets() {
        if (!this._widgets) return;
        const enabled = this._settings.get_boolean('widgets-enabled');
        if (enabled) {
            try { await this._widgets.enable(); }
            catch (e) { logError(e, 'GnomeBeautifier: widget enable failed'); }
        } else {
            this._widgets.disable();
            // Reconstruct so a later flip-on still works.
            this._widgets = new WidgetManager(this._settings, this._services);
        }
        this._indicator?.refreshStatus();
    }

    // ---------- Timers ----------

    _restartRotationTimer() {
        if (this._rotationTimerId) {
            GLib.source_remove(this._rotationTimerId);
            this._rotationTimerId = 0;
        }
        if (!this._settings?.get_boolean('rotation-enabled'))
            return;

        const minutes = this._settings.get_uint('rotation-interval-minutes');
        const seconds = Math.max(60, minutes * 60);
        this._rotationTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                this._cycleAndApply(+1);
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _restartWeatherTimer() {
        if (this._weatherTimerId) {
            GLib.source_remove(this._weatherTimerId);
            this._weatherTimerId = 0;
        }
        if (!this._settings?.get_boolean('weather-enabled'))
            return;

        const minutes = this._settings.get_uint('weather-refresh-minutes');
        const seconds = Math.max(15 * 60, minutes * 60);

        this._refreshWeather(/* force */ true);

        this._weatherTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                this._refreshWeather(/* force */ false);
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    // ---------- Status string ----------

    _statusText() {
        if (this._lastError)
            return `⚠ ${this._lastError}`;

        const bucket = this._wallpaper?.currentBucket() ?? '?';
        const widgetCount = this._widgets?.listInstances?.()?.length ?? 0;
        const widgetsPart = widgetCount > 0 ? ` · ${widgetCount} widget${widgetCount === 1 ? '' : 's'}` : '';
        if (this._lastWeather) {
            const { code, isDay } = this._lastWeather;
            const dayWord = isDay === 0 ? 'night' : 'day';
            return `Bucket: ${bucket} · WMO ${code} (${dayWord})${widgetsPart}`;
        }
        return `Bucket: ${bucket}${widgetsPart}`;
    }
}
