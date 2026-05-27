// Open-Meteo client + WMO → bucket mapping + time-of-day computation.
//
// Returns { bucket, timeBucket, code, isDay, latitude, longitude, sunrise,
// sunset, city, region, country } from getCurrent(). Persists the resolved
// location into GSettings so the prefs window can display it.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const OPEN_METEO_URL =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=%LAT%&longitude=%LON%' +
    '&current=weather_code,is_day' +
    '&daily=sunrise,sunset' +
    '&timezone=auto';

const IPAPI_URL = 'https://ipapi.co/json/';

// WMO weather code → wallpaper bucket. Buckets match wallpaper.js.
function codeToBucket(code, isDay) {
    if (code === undefined || code === null) return 'default';
    const dayBucket = (b) => (isDay === 0 ? 'night' : b);
    if (code === 0) return dayBucket('clear');
    if (code === 1 || code === 2) return dayBucket('clouds');
    if (code === 3) return 'clouds';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'rain';
    if (code === 85 || code === 86) return 'snow';
    if (code === 95 || code === 96 || code === 99) return 'storm';
    return 'default';
}

/**
 * Time-of-day bucket from current local time + Open-Meteo sunrise/sunset.
 * Sunrise/sunset are ISO strings in local time (because timezone=auto).
 * Falls back to a simple fixed schedule if those fields are missing.
 */
function computeTimeBucket(nowDate, sunriseIso, sunsetIso) {
    const hour = nowDate.getHours();

    let sunriseHour = 6;
    let sunsetHour = 19;
    if (sunriseIso && sunsetIso) {
        const sr = new Date(sunriseIso);
        const ss = new Date(sunsetIso);
        if (!isNaN(sr.getTime())) sunriseHour = sr.getHours() + sr.getMinutes() / 60;
        if (!isNaN(ss.getTime())) sunsetHour = ss.getHours() + ss.getMinutes() / 60;
    }

    // Morning: from sunrise until 4h after sunrise (or 11:00, whichever is sooner).
    // Afternoon: until 2h before sunset.
    // Evening: until sunset.
    // Night: outside that window.
    const morningEnd = Math.min(sunriseHour + 4, 11);
    const afternoonEnd = sunsetHour - 2;
    const eveningEnd = sunsetHour;

    if (hour < sunriseHour) return 'night';
    if (hour < morningEnd) return 'morning';
    if (hour < afternoonEnd) return 'afternoon';
    if (hour < eveningEnd) return 'evening';
    return 'night';
}

function readBytesAsync(session, message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null,
            (s, result) => {
                try {
                    const bytes = s.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK) {
                        reject(new Error(`HTTP ${message.get_status()}`));
                        return;
                    }
                    resolve(new TextDecoder('utf-8').decode(bytes.get_data()));
                } catch (e) { reject(e); }
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
            const lat = this._settings.get_double('manual-latitude');
            const lon = this._settings.get_double('manual-longitude');
            return { latitude: lat, longitude: lon, city: '', region: '', country: '' };
        }

        // 'ip' (default) and 'geoclue' (TODO) both go through ipapi.co.
        const message = Soup.Message.new('GET', IPAPI_URL);
        const text = await readBytesAsync(this._session, message);
        const json = JSON.parse(text);
        if (typeof json.latitude !== 'number' || typeof json.longitude !== 'number')
            throw new Error('ipapi did not return numeric coordinates');

        const city = json.city ?? '';
        const region = json.region ?? '';
        const country = json.country_name ?? json.country ?? '';

        // Persist for the prefs window's "Current location" row.
        this._settings.set_double('last-resolved-latitude', json.latitude);
        this._settings.set_double('last-resolved-longitude', json.longitude);
        this._settings.set_string('last-resolved-city', city);
        this._settings.set_string('last-resolved-region', region);
        this._settings.set_string('last-resolved-country', country);

        return { latitude: json.latitude, longitude: json.longitude, city, region, country };
    }

    /**
     * Returns { bucket, timeBucket, code, isDay, latitude, longitude,
     *           sunrise, sunset, city, region, country }.
     * Throws on network error.
     */
    async getCurrent() {
        const loc = await this._resolveLocation();

        const url = OPEN_METEO_URL
            .replace('%LAT%', loc.latitude.toFixed(4))
            .replace('%LON%', loc.longitude.toFixed(4));

        const message = Soup.Message.new('GET', url);
        const text = await readBytesAsync(this._session, message);
        const json = JSON.parse(text);

        const code = json?.current?.weather_code;
        const isDay = json?.current?.is_day;
        const sunrise = json?.daily?.sunrise?.[0] ?? null;
        const sunset = json?.daily?.sunset?.[0] ?? null;

        const bucket = codeToBucket(code, isDay);
        const timeBucket = computeTimeBucket(new Date(), sunrise, sunset);

        return {
            bucket, timeBucket, code, isDay,
            latitude: loc.latitude, longitude: loc.longitude,
            sunrise, sunset,
            city: loc.city, region: loc.region, country: loc.country,
        };
    }
}

export const _internal = { codeToBucket, computeTimeBucket };
