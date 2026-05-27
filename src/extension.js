// Composition root.

import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
        this._timeBucketTimerId = 0;
        this._settingsHandlers = [];

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
        this._settingsHandlers.push(this._settings.connect('changed::time-of-day-enabled',
            () => this._applyTimeBucket()));
        this._settingsHandlers.push(this._settings.connect('changed::widgets-enabled',
            () => this._reconcileWidgets()));

        this._applyCurrent();
        this._restartWeatherTimer();
        this._restartRotationTimer();
        this._restartTimeBucketTimer();
        this._reconcileWidgets();
    }

    disable() {
        for (const id of [this._rotationTimerId, this._weatherTimerId, this._timeBucketTimerId]) {
            if (id) GLib.source_remove(id);
        }
        this._rotationTimerId = 0;
        this._weatherTimerId = 0;
        this._timeBucketTimerId = 0;

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
        const resolved = this._wallpaper.resolveCurrent();
        const total = resolved.images.length;
        const path = direction > 0 ? this._wallpaper.next() : this._wallpaper.previous();

        if (!path) {
            this._lastError =
                `No images in bucket "${this._wallpaper.currentBucket()}" / time "${this._wallpaper.currentTimeBucket() || '-'}". ` +
                `Drop images in ~/Pictures/Weather-Wallpapers or pick a folder in Settings.`;
            Main.notify('GNOME Beautifier', this._lastError);
            this._indicator?.refreshStatus();
            return;
        }

        this._wallpaper.apply(path);
        this._lastAccent = this._accent.apply(path);
        this._lastAppliedPath = path;
        this._lastError = null;
        this._settings.set_int64('last-rotation-timestamp',
            Math.floor(Date.now() / 1000));

        // Always notify so the action is perceivable even when the bucket has
        // only one image (so picture-uri is unchanged and the wallpaper
        // appears static).
        const filename = GLib.path_get_basename(path);
        const idx = this._settings.get_uint('current-index') + 1;
        const bucketLabel = resolved.time
            ? `${resolved.weather}/${resolved.time}`
            : resolved.weather;
        if (total <= 1) {
            Main.notify('GNOME Beautifier',
                `Only one image in "${bucketLabel}". Drop more wallpapers there to enable cycling. (${filename})`);
        } else {
            Main.notify('GNOME Beautifier',
                `${direction > 0 ? 'Next' : 'Previous'} → ${filename}  (${idx}/${total} in ${bucketLabel})`);
        }
        this._indicator?.refreshStatus();
    }

    _applyCurrent() {
        const path = this._wallpaper.currentPath();
        if (!path) {
            this._lastError =
                `No images in bucket "${this._wallpaper.currentBucket()}" / time "${this._wallpaper.currentTimeBucket() || '-'}". ` +
                `Run scripts/setup-wallpapers.sh or drop images yourself.`;
            this._indicator?.refreshStatus();
            return;
        }
        this._wallpaper.apply(path);
        this._lastAccent = this._accent.apply(path);
        this._lastAppliedPath = path;
        this._lastError = null;
        this._indicator?.refreshStatus();
    }

    /** Recompute the time bucket from the last weather result (or clock). */
    _applyTimeBucket() {
        if (!this._wallpaper) return;
        if (!this._settings.get_boolean('time-of-day-enabled')) {
            this._wallpaper.setTimeBucket('');
        } else {
            const tb = this._lastWeather?.timeBucket
                ?? this._timeBucketFromClock();
            this._wallpaper.setTimeBucket(tb);
        }
        this._applyCurrent();
    }

    _timeBucketFromClock() {
        const h = new Date().getHours();
        if (h < 6) return 'night';
        if (h < 11) return 'morning';
        if (h < 17) return 'afternoon';
        if (h < 20) return 'evening';
        return 'night';
    }

    async _refreshWeather(force = false) {
        if (!this._settings.get_boolean('weather-enabled')) {
            if (force) Main.notify('GNOME Beautifier', 'Weather mode is OFF — turn it on in Settings → Weather.');
            return;
        }
        try {
            const result = await this._weather.getCurrent();
            this._lastWeather = result;
            this._wallpaper.setBucket(result.bucket);
            if (this._settings.get_boolean('time-of-day-enabled'))
                this._wallpaper.setTimeBucket(result.timeBucket);
            else
                this._wallpaper.setTimeBucket('');
            if (force || !this._lastAppliedPath)
                this._applyCurrent();
            this._lastError = null;
            if (force) {
                const place = [result.city, result.country].filter(Boolean).join(', ') || 'your location';
                Main.notify('GNOME Beautifier',
                    `Weather refreshed: WMO ${result.code} (${result.isDay === 0 ? 'night' : 'day'}) at ${place}. Bucket → ${result.bucket}/${result.timeBucket}.`);
            }
        } catch (e) {
            this._lastError = `Weather lookup failed: ${e.message ?? e}`;
            Main.notify('GNOME Beautifier', this._lastError);
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
        if (!this._settings?.get_boolean('rotation-enabled')) {
            console.log('GnomeBeautifier: rotation disabled');
            return;
        }

        const minutes = this._settings.get_uint('rotation-interval-minutes');
        // Floor at 60s so users debugging with very short intervals still get
        // a meaningful refresh, but we don't spam.
        const seconds = Math.max(60, minutes * 60);
        console.log(`GnomeBeautifier: rotation timer scheduled every ${seconds}s ` +
                    `(rotation-interval-minutes=${minutes})`);

        this._rotationTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                console.log('GnomeBeautifier: rotation timer fired; advancing wallpaper');
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
        if (!this._settings?.get_boolean('weather-enabled')) return;

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

    _restartTimeBucketTimer() {
        if (this._timeBucketTimerId) {
            GLib.source_remove(this._timeBucketTimerId);
            this._timeBucketTimerId = 0;
        }
        // Recompute the time bucket every 10 minutes — enough to catch
        // morning→afternoon transitions without burning CPU.
        this._timeBucketTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            10 * 60,
            () => {
                if (this._settings?.get_boolean('time-of-day-enabled')) {
                    const tb = this._lastWeather?.timeBucket
                        ?? this._timeBucketFromClock();
                    const prev = this._wallpaper.currentTimeBucket();
                    this._wallpaper.setTimeBucket(tb);
                    if (prev !== tb) {
                        console.log(`GnomeBeautifier: time bucket changed ${prev || '-'} → ${tb}`);
                        this._applyCurrent();
                    }
                }
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    // ---------- Status string ----------

    _statusText() {
        if (this._lastError)
            return `⚠ ${this._lastError}`;

        const weatherBucket = this._wallpaper?.currentBucket() ?? '?';
        const timeBucket = this._wallpaper?.currentTimeBucket() || '-';
        const widgetCount = this._widgets?.listInstances?.()?.length ?? 0;
        const widgetsPart = widgetCount > 0 ? ` · ${widgetCount} widget${widgetCount === 1 ? '' : 's'}` : '';

        const parts = [];
        parts.push(`Bucket: ${weatherBucket}/${timeBucket}`);
        if (this._lastWeather) {
            const w = this._lastWeather;
            const dayWord = w.isDay === 0 ? 'night' : 'day';
            parts.push(`WMO ${w.code} (${dayWord})`);
            if (w.city) parts.push(w.city);
        }
        return parts.join(' · ') + widgetsPart;
    }
}
