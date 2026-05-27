// Owns Open-Meteo lookups and WMO code → bucket mapping.
// Knows nothing about wallpapers, palettes, or panels.
// Returns { bucket, code, isDay, latitude, longitude } via getCurrent().

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const OPEN_METEO_URL =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=%LAT%&longitude=%LON%' +
    '&current=weather_code,is_day' +
    '&timezone=auto';

// IP-based geolocation: ipapi.co returns JSON with latitude/longitude.
const IPAPI_URL = 'https://ipapi.co/json/';

// Map WMO weather codes (https://open-meteo.com/en/docs) to wallpaper buckets.
// Buckets must match wallpaper.js BUCKETS.
function codeToBucket(code, isDay) {
    if (code === undefined || code === null)
        return 'default';

    // Night overrides clear/cloud buckets when sun is down.
    const dayBucket = (b) => (isDay === 0 ? 'night' : b);

    if (code === 0) return dayBucket('clear');
    if (code === 1 || code === 2) return dayBucket('clouds');
    if (code === 3) return 'clouds';                         // overcast
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 67) return 'rain';             // drizzle + rain + freezing rain
    if (code >= 71 && code <= 77) return 'snow';             // snowfall + grains
    if (code >= 80 && code <= 82) return 'rain';             // rain showers
    if (code === 85 || code === 86) return 'snow';           // snow showers
    if (code === 95 || code === 96 || code === 99) return 'storm';
    return 'default';
}

function readBytesAsync(session, message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (s, result) => {
                try {
                    const bytes = s.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK) {
                        reject(new Error(`HTTP ${message.get_status()}`));
                        return;
                    }
                    const data = bytes.get_data();
                    const text = new TextDecoder('utf-8').decode(data);
                    resolve(text);
                } catch (e) {
                    reject(e);
                }
            },
        );
    });
}

export class WeatherClient {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session({
            user_agent: 'GnomeBeautifier/0.1 (gnome-shell-extension)',
            timeout: 15,
        });
    }

    destroy() {
        this._session.abort();
        this._session = null;
        this._settings = null;
    }

    async _resolveLocation() {
        const source = this._settings.get_string('location-source');

        if (source === 'manual') {
            return {
                latitude: this._settings.get_double('manual-latitude'),
                longitude: this._settings.get_double('manual-longitude'),
            };
        }

        // 'ip' (default) and 'geoclue' (not implemented yet) both fall through to IP.
        const message = Soup.Message.new('GET', IPAPI_URL);
        const text = await readBytesAsync(this._session, message);
        const json = JSON.parse(text);
        if (typeof json.latitude !== 'number' || typeof json.longitude !== 'number')
            throw new Error('ipapi did not return numeric coordinates');
        return { latitude: json.latitude, longitude: json.longitude };
    }

    /**
     * Returns { bucket, code, isDay, latitude, longitude }.
     * Throws on network error so the caller can decide whether to keep the
     * previous bucket or surface the failure.
     */
    async getCurrent() {
        const { latitude, longitude } = await this._resolveLocation();

        const url = OPEN_METEO_URL
            .replace('%LAT%', latitude.toFixed(4))
            .replace('%LON%', longitude.toFixed(4));

        const message = Soup.Message.new('GET', url);
        const text = await readBytesAsync(this._session, message);
        const json = JSON.parse(text);

        const code = json?.current?.weather_code;
        const isDay = json?.current?.is_day;
        const bucket = codeToBucket(code, isDay);

        return { bucket, code, isDay, latitude, longitude };
    }
}

// Exported for unit-style sanity checks and for the indicator's tooltip.
export const _internal = { codeToBucket };
