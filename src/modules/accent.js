// Owns palette extraction from an image and writes to
// org.gnome.desktop.interface accent-color / color-scheme.
// Knows nothing about which wallpaper is current — the caller passes the path.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

const IFACE_SCHEMA = 'org.gnome.desktop.interface';
const ACCENT_KEY = 'accent-color';
const COLOR_SCHEME_KEY = 'color-scheme';

// GNOME 47 accent palette; values match the gschema enum used by gnome-shell.
// Approximate hue (degrees on the HSV wheel) and saturation floor used to pick
// from a wallpaper's dominant colour.
const ACCENTS = [
    { name: 'red',    hue:   0 },
    { name: 'orange', hue:  30 },
    { name: 'yellow', hue:  55 },
    { name: 'green',  hue: 130 },
    { name: 'teal',   hue: 175 },
    { name: 'blue',   hue: 220 },
    { name: 'purple', hue: 280 },
    { name: 'pink',   hue: 330 },
];

// Maximum thumbnail dimension used for pixel sampling. 96px keeps the work
// under ~10 ms while still capturing dominant hues.
const SAMPLE_MAX = 96;

// Pixels with saturation below this are considered greyscale and fall back to
// the 'slate' accent (which GNOME draws as a desaturated blue-grey).
const GREY_SAT_THRESHOLD = 0.18;

function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
        if (max === rn)
            h = ((gn - bn) / d) % 6;
        else if (max === gn)
            h = (bn - rn) / d + 2;
        else
            h = (rn - gn) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
}

function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

function nearestAccent(hue) {
    let best = ACCENTS[0];
    let bestDist = 360;
    for (const accent of ACCENTS) {
        const dist = hueDistance(hue, accent.hue);
        if (dist < bestDist) {
            bestDist = dist;
            best = accent;
        }
    }
    return best.name;
}

/**
 * Scan the pixbuf, return:
 *   { dominantHue, dominantSat, avgLuminance }
 * dominantHue is the hue bucket centre with the highest saturated-pixel count.
 */
function summarisePixbuf(pixbuf) {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const channels = pixbuf.get_n_channels();
    const rowstride = pixbuf.get_rowstride();
    const pixels = pixbuf.get_pixels();

    // 12 hue bins of 30 degrees.
    const HUE_BINS = 12;
    const bins = new Float64Array(HUE_BINS);
    const binSat = new Float64Array(HUE_BINS);

    let lumSum = 0;
    let lumCount = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const offset = y * rowstride + x * channels;
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];

            // Skip fully transparent pixels if present.
            if (channels === 4 && pixels[offset + 3] < 16)
                continue;

            // Perceived luminance (Rec. 601 weighting), 0..1.
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            lumSum += lum;
            lumCount++;

            const { h: hue, s: sat, v } = rgbToHsv(r, g, b);
            if (sat < GREY_SAT_THRESHOLD || v < 0.15)
                continue;

            // Weight by saturation × brightness so vivid pixels win.
            const weight = sat * v;
            const binIdx = Math.min(HUE_BINS - 1, Math.floor(hue / (360 / HUE_BINS)));
            bins[binIdx] += weight;
            binSat[binIdx] += sat * weight;
        }
    }

    let bestBin = 0;
    for (let i = 1; i < HUE_BINS; i++) {
        if (bins[i] > bins[bestBin]) bestBin = i;
    }
    const dominantWeight = bins[bestBin];
    const dominantHue = (bestBin + 0.5) * (360 / HUE_BINS);
    const dominantSat = dominantWeight > 0 ? binSat[bestBin] / dominantWeight : 0;
    const avgLuminance = lumCount > 0 ? lumSum / lumCount : 0.5;

    return { dominantHue, dominantSat, avgLuminance, dominantWeight };
}

export class AccentManager {
    constructor(settings) {
        this._settings = settings;
        this._ifaceSettings = new Gio.Settings({ schema_id: IFACE_SCHEMA });
    }

    destroy() {
        this._ifaceSettings = null;
        this._settings = null;
    }

    /**
     * Analyse `imagePath` and apply accent + color-scheme according to user prefs.
     * Returns { accent, scheme } actually applied, or null if disabled / failed.
     */
    apply(imagePath) {
        if (!imagePath)
            return null;

        const applyAccent = this._settings.get_boolean('accent-follow-enabled');
        const applyScheme = this._settings.get_boolean('color-scheme-follow-enabled');
        if (!applyAccent && !applyScheme)
            return null;

        let pixbuf;
        try {
            // Load + scale in one shot to avoid pulling the full image into memory.
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                imagePath, SAMPLE_MAX, SAMPLE_MAX, true,
            );
        } catch (e) {
            logError(e, 'GnomeBeautifier: pixbuf load failed');
            return null;
        }

        const summary = summarisePixbuf(pixbuf);

        let accent = null;
        if (applyAccent) {
            if (summary.dominantWeight === 0 || summary.dominantSat < GREY_SAT_THRESHOLD)
                accent = 'slate';
            else
                accent = nearestAccent(summary.dominantHue);

            try {
                this._ifaceSettings.set_string(ACCENT_KEY, accent);
            } catch (e) {
                logError(e, 'GnomeBeautifier: accent set failed (older GNOME?)');
                accent = null;
            }
        }

        let scheme = null;
        if (applyScheme) {
            scheme = summary.avgLuminance < 0.45 ? 'prefer-dark' : 'default';
            try {
                this._ifaceSettings.set_string(COLOR_SCHEME_KEY, scheme);
            } catch (e) {
                logError(e, 'GnomeBeautifier: color-scheme set failed');
                scheme = null;
            }
        }

        return { accent, scheme };
    }
}

// Exported for the prefs preview and for sanity testing.
export const _internal = { summarisePixbuf, nearestAccent, rgbToHsv };
