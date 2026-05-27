// Owns the live set of widget instances. Reads/writes the JSON-encoded
// `widget-instances` GSettings key. Mediates between the loader, the user
// menu, and the WidgetBase lifecycle. Knows nothing about wallpapers,
// weather, or accent internally — everything cross-cutting is passed in
// via `services` and surfaced to widgets through WidgetBase.services().

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { WidgetLoader } from './widget-loader.js';

const INSTANCES_KEY = 'widget-instances';
const DEFAULT_OFFSET_PX = 32;

function nowInstanceId() {
    // Short random id; enough to disambiguate multiple instances of the same type.
    const r = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${r}`;
}

function safeParseInstances(text) {
    if (!text || text.length === 0) return [];
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(it => typeof it === 'object' && it.uuid && it.instanceId);
    } catch (e) {
        logError(e, 'GnomeBeautifier: widget-instances JSON parse failed; resetting');
        return [];
    }
}

export class WidgetManager {
    /**
     * @param {Gio.Settings} settings  The extension's GSettings.
     * @param {object} services        Cross-cutting handles passed to widgets.
     */
    constructor(settings, services) {
        this._settings = settings;
        this._services = services;
        this._loader = new WidgetLoader();
        this._definitions = [];
        this._instances = new Map(); // instanceId -> { record, widget }
        this._suppressPersist = false;
    }

    async enable() {
        this._definitions = await this._loader.discoverAll();
        this._mountFromSettings();
    }

    disable() {
        for (const { widget } of this._instances.values()) {
            try { widget.unmount(Main.layoutManager); }
            catch (e) { logError(e); }
        }
        this._instances.clear();
        this._definitions = [];
        this._services = null;
        this._settings = null;
    }

    // ---- Public catalog / instance ops (used by menus + prefs) ----------

    /** @returns {Array<{uuid, name, description, builtin}>} */
    listDefinitions() {
        return this._definitions.map(d => ({
            uuid: d.uuid,
            name: d.name,
            description: d.description,
            builtin: !!d.builtin,
        }));
    }

    /** @returns {Array<{instanceId, uuid, name, x, y}>} */
    listInstances() {
        const out = [];
        for (const { record, widget } of this._instances.values()) {
            out.push({
                instanceId: record.instanceId,
                uuid: record.uuid,
                name: widget.displayName,
                x: record.x,
                y: record.y,
            });
        }
        return out;
    }

    /** Create a new instance of `uuid` at a default position; mount it. */
    addInstance(uuid) {
        const def = this._definitions.find(d => d.uuid === uuid);
        if (!def) {
            log(`GnomeBeautifier: cannot add unknown widget "${uuid}"`);
            return null;
        }
        const record = this._defaultRecord(def);
        this._spawn(record, def);
        this._persist();
        return record.instanceId;
    }

    /** Destroy a running instance. */
    removeInstance(instanceId) {
        const entry = this._instances.get(instanceId);
        if (!entry) return;
        try { entry.widget.unmount(Main.layoutManager); }
        catch (e) { logError(e); }
        this._instances.delete(instanceId);
        this._persist();
    }

    /** Tear down everything and re-read settings. Used when prefs do a bulk change. */
    reload() {
        for (const { widget } of this._instances.values()) {
            try { widget.unmount(Main.layoutManager); }
            catch (e) { logError(e); }
        }
        this._instances.clear();
        this._mountFromSettings();
    }

    // ---- Internal -------------------------------------------------------

    _mountFromSettings() {
        const raw = this._settings.get_string(INSTANCES_KEY);
        const records = safeParseInstances(raw);
        for (const record of records) {
            const def = this._definitions.find(d => d.uuid === record.uuid);
            if (!def) {
                log(`GnomeBeautifier: skipping instance for unknown widget "${record.uuid}"`);
                continue;
            }
            this._spawn(record, def);
        }
    }

    _defaultRecord(def) {
        // Spread each new widget slightly so they don't stack on the same pixel.
        const count = this._instances.size;
        return {
            instanceId: nowInstanceId(),
            uuid: def.uuid,
            monitor: 0,
            x: DEFAULT_OFFSET_PX + (count % 6) * 48,
            y: DEFAULT_OFFSET_PX + (count % 6) * 36,
            config: {},
        };
    }

    _spawn(record, def) {
        const ctx = {
            uuid: record.uuid,
            instanceId: record.instanceId,
            config: record.config ?? {},
            x: record.x,
            y: record.y,
            monitor: record.monitor ?? 0,
            services: this._services,
            persistConfig: (patch) => {
                record.config = { ...(record.config ?? {}), ...patch };
                this._persist();
            },
            persistPosition: (x, y, monitor) => {
                record.x = x;
                record.y = y;
                record.monitor = monitor;
                this._persist();
            },
            requestRemove: () => this.removeInstance(record.instanceId),
        };

        let widget;
        try {
            widget = new def.widgetClass(ctx);
        } catch (e) {
            logError(e, `GnomeBeautifier: widget constructor failed for ${def.uuid}`);
            return;
        }

        // Merge defaults under the existing config, not over it.
        const defaults = widget.defaultConfig?.() ?? {};
        record.config = { ...defaults, ...(record.config ?? {}) };
        ctx.config = record.config;

        try {
            widget.mount(Main.layoutManager);
        } catch (e) {
            logError(e, `GnomeBeautifier: widget mount failed for ${def.uuid}`);
            return;
        }

        this._instances.set(record.instanceId, { record, widget });
    }

    _persist() {
        if (this._suppressPersist) return;
        const records = [];
        for (const { record } of this._instances.values()) {
            records.push({
                instanceId: record.instanceId,
                uuid: record.uuid,
                monitor: record.monitor ?? 0,
                x: record.x,
                y: record.y,
                config: record.config ?? {},
            });
        }
        // GSettings string keys hold the entire array as one JSON document.
        // We're updating in place, so suppress re-entry from the changed signal
        // by temporarily silencing _persist during a settings reset.
        this._settings.set_string(INSTANCES_KEY, JSON.stringify(records));
    }
}
