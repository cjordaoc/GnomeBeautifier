// Owns wallpaper directory layout, rotation index, and writes to
// org.gnome.desktop.background. Knows nothing about weather, palette,
// or panels. Other modules drive it via setBucket(name) / next() / current().
//
// Directory resolution (NEW: layered with time-of-day):
//   <root>/<weather>/<time>/   primary — try this first
//   <root>/<weather>/          fall back if time subfolder is empty/missing
//   <root>/default/<time>/     fall back across weather buckets
//   <root>/default/            last resort
//
// Buckets:
//   weather: clear, clouds, rain, storm, snow, fog, night, default
//   time:    morning, afternoon, evening, night
//
// Existing users who don't have time subfolders keep their flat layout —
// `imagesForBucket()` automatically falls through to <weather>/.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const BG_SCHEMA = 'org.gnome.desktop.background';
const BG_KEY_LIGHT = 'picture-uri';
const BG_KEY_DARK = 'picture-uri-dark';
const BG_KEY_OPTIONS = 'picture-options';

const WEATHER_BUCKETS = ['clear', 'clouds', 'rain', 'storm', 'snow', 'fog', 'night', 'default'];
const TIME_BUCKETS = ['morning', 'afternoon', 'evening', 'night'];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function expandRoot(root) {
    if (root && root.length > 0) return root;
    return GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Weather-Wallpapers']);
}

function listImages(dirPath) {
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null)) return [];

    const out = [];
    let enumerator;
    try {
        enumerator = dir.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, null);
    } catch (_e) { return []; }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
        const name = info.get_name();
        const dot = name.lastIndexOf('.');
        if (dot < 0) continue;
        const ext = name.substring(dot).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        out.push(GLib.build_filenamev([dirPath, name]));
    }
    enumerator.close(null);
    out.sort();
    return out;
}

export class WallpaperManager {
    constructor(settings) {
        this._settings = settings;
        this._bgSettings = new Gio.Settings({ schema_id: BG_SCHEMA });
    }

    destroy() {
        this._bgSettings = null;
        this._settings = null;
    }

    root() { return expandRoot(this._settings.get_string('wallpaper-root')); }

    static buckets() { return [...WEATHER_BUCKETS]; }
    static timeBuckets() { return [...TIME_BUCKETS]; }

    /** Where the resolved (weather, time) pair currently lives on disk. */
    _resolvedDir(weather, time) {
        const root = this.root();
        // 1. <root>/<weather>/<time>/
        if (time) {
            const a = GLib.build_filenamev([root, weather, time]);
            if (listImages(a).length > 0) return a;
        }
        // 2. <root>/<weather>/
        const b = GLib.build_filenamev([root, weather]);
        if (listImages(b).length > 0) return b;
        // 3. <root>/default/<time>/
        if (time) {
            const c = GLib.build_filenamev([root, 'default', time]);
            if (listImages(c).length > 0) return c;
        }
        // 4. <root>/default/
        const d = GLib.build_filenamev([root, 'default']);
        if (listImages(d).length > 0) return d;
        // 5. <root>/clear/  (final fallback)
        const e = GLib.build_filenamev([root, 'clear']);
        return e;
    }

    /**
     * Returns { weather, time, dir, images } for the most-specific folder
     * that has at least one image. `dir` and `images` may be empty if the
     * library is completely empty.
     */
    resolveCurrent() {
        const weather = this.currentBucket();
        const time = this.currentTimeBucket();
        const dir = this._resolvedDir(weather, time);
        return { weather, time, dir, images: listImages(dir) };
    }

    currentBucket() {
        return this._settings.get_string('current-bucket') || 'default';
    }

    /** Persist the active weather bucket; resets index if it changed. */
    setBucket(weather) {
        if (!WEATHER_BUCKETS.includes(weather)) weather = 'default';
        const prev = this.currentBucket();
        if (prev !== weather) {
            this._settings.set_string('current-bucket', weather);
            this._settings.set_uint('current-index', 0);
        }
        return weather;
    }

    currentTimeBucket() {
        return this._settings.get_string('current-time-bucket') || '';
    }

    setTimeBucket(time) {
        if (time && !TIME_BUCKETS.includes(time)) time = '';
        const prev = this.currentTimeBucket();
        if (prev !== time) {
            this._settings.set_string('current-time-bucket', time);
            this._settings.set_uint('current-index', 0);
        }
        return time;
    }

    /** Absolute path to the currently-selected image. Null if library is empty. */
    currentPath() {
        const r = this.resolveCurrent();
        if (r.images.length === 0) return null;
        let idx = this._settings.get_uint('current-index');
        if (idx >= r.images.length) {
            idx = 0;
            this._settings.set_uint('current-index', 0);
        }
        return r.images[idx];
    }

    next() {
        const r = this.resolveCurrent();
        if (r.images.length === 0) return null;
        const idx = this._settings.get_uint('current-index');
        const nextIdx = (idx + 1) % r.images.length;
        this._settings.set_uint('current-index', nextIdx);
        return r.images[nextIdx];
    }

    previous() {
        const r = this.resolveCurrent();
        if (r.images.length === 0) return null;
        const idx = this._settings.get_uint('current-index');
        const prevIdx = (idx - 1 + r.images.length) % r.images.length;
        this._settings.set_uint('current-index', prevIdx);
        return r.images[prevIdx];
    }

    /** Push the given path (or resolved current) into the desktop background. */
    apply(path) {
        const target = path ?? this.currentPath();
        if (!target) return null;
        const uri = `file://${target}`;
        this._bgSettings.set_string(BG_KEY_LIGHT, uri);
        this._bgSettings.set_string(BG_KEY_DARK, uri);
        const opt = this._bgSettings.get_string(BG_KEY_OPTIONS);
        if (!opt || opt === 'none')
            this._bgSettings.set_string(BG_KEY_OPTIONS, 'zoom');
        return target;
    }
}
