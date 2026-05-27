// Owns wallpaper directory layout, rotation index, and writes to
// org.gnome.desktop.background. Knows nothing about weather, palette,
// or panels. Other modules drive it via setBucket(name) / next() / current().

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const BG_SCHEMA = 'org.gnome.desktop.background';
const BG_KEY_LIGHT = 'picture-uri';
const BG_KEY_DARK = 'picture-uri-dark';
const BG_KEY_OPTIONS = 'picture-options';

const BUCKETS = ['clear', 'clouds', 'rain', 'storm', 'snow', 'fog', 'night', 'default'];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function expandRoot(root) {
    if (root && root.length > 0)
        return root;
    return GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Weather-Wallpapers']);
}

function listImages(dirPath) {
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null))
        return [];

    const out = [];
    let enumerator;
    try {
        enumerator = dir.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
    } catch (_e) {
        return [];
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            continue;
        const name = info.get_name();
        const dotIdx = name.lastIndexOf('.');
        if (dotIdx < 0)
            continue;
        const ext = name.substring(dotIdx).toLowerCase();
        if (!IMAGE_EXTS.has(ext))
            continue;
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

    /** Resolve the active wallpaper root, with the user override or default. */
    root() {
        return expandRoot(this._settings.get_string('wallpaper-root'));
    }

    /** Absolute path to a bucket subdir; never creates it. */
    bucketDir(bucket) {
        return GLib.build_filenamev([this.root(), bucket]);
    }

    /** All known bucket names, in canonical order. */
    static buckets() {
        return [...BUCKETS];
    }

    /** Images inside the bucket, sorted; falls back to `default` then bucket=clear if empty. */
    imagesForBucket(bucket) {
        const direct = listImages(this.bucketDir(bucket));
        if (direct.length > 0)
            return { bucket, images: direct };

        const fallbackDefault = listImages(this.bucketDir('default'));
        if (fallbackDefault.length > 0)
            return { bucket: 'default', images: fallbackDefault };

        const fallbackClear = listImages(this.bucketDir('clear'));
        if (fallbackClear.length > 0)
            return { bucket: 'clear', images: fallbackClear };

        return { bucket, images: [] };
    }

    /** Active bucket as persisted in GSettings. */
    currentBucket() {
        return this._settings.get_string('current-bucket') || 'default';
    }

    /** Persist the active bucket; resets index to 0 if bucket changed. */
    setBucket(bucket) {
        if (!BUCKETS.includes(bucket))
            bucket = 'default';
        const prev = this.currentBucket();
        if (prev !== bucket) {
            this._settings.set_string('current-bucket', bucket);
            this._settings.set_uint('current-index', 0);
        }
        return bucket;
    }

    /** Path to the wallpaper that should currently be displayed; null if no images. */
    currentPath() {
        const bucket = this.currentBucket();
        const resolved = this.imagesForBucket(bucket);
        if (resolved.images.length === 0)
            return null;

        if (resolved.bucket !== bucket)
            this._settings.set_string('current-bucket', resolved.bucket);

        let idx = this._settings.get_uint('current-index');
        if (idx >= resolved.images.length) {
            idx = 0;
            this._settings.set_uint('current-index', 0);
        }
        return resolved.images[idx];
    }

    /** Advance to the next wallpaper in the active bucket. Returns the new path or null. */
    next() {
        const bucket = this.currentBucket();
        const resolved = this.imagesForBucket(bucket);
        if (resolved.images.length === 0)
            return null;

        const idx = this._settings.get_uint('current-index');
        const nextIdx = (idx + 1) % resolved.images.length;
        this._settings.set_uint('current-index', nextIdx);
        return resolved.images[nextIdx];
    }

    /** Step backwards in the active bucket. */
    previous() {
        const bucket = this.currentBucket();
        const resolved = this.imagesForBucket(bucket);
        if (resolved.images.length === 0)
            return null;

        const idx = this._settings.get_uint('current-index');
        const prevIdx = (idx - 1 + resolved.images.length) % resolved.images.length;
        this._settings.set_uint('current-index', prevIdx);
        return resolved.images[prevIdx];
    }

    /**
     * Push the given path (or the resolved current path) into GNOME's background
     * GSettings keys. Writes both picture-uri and picture-uri-dark so dark mode
     * tracks the same wallpaper unless the caller passes split URIs explicitly.
     */
    apply(path) {
        const target = path ?? this.currentPath();
        if (!target)
            return null;

        const uri = `file://${target}`;
        this._bgSettings.set_string(BG_KEY_LIGHT, uri);
        this._bgSettings.set_string(BG_KEY_DARK, uri);

        const opt = this._bgSettings.get_string(BG_KEY_OPTIONS);
        if (!opt || opt === 'none')
            this._bgSettings.set_string(BG_KEY_OPTIONS, 'zoom');

        return target;
    }
}
