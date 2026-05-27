// Discovers widget *definitions* — both bundled with the extension and dropped
// into ~/.local/share/gnomebeautifier/widgets/UUID/. A definition is the type
// (e.g. "clock"), not an instance. The WidgetManager turns definitions into
// running instances.
//
// Built-in widgets:
//   imported statically below; cannot be uninstalled.
//
// User widgets:
//   directory layout under ~/.local/share/gnomebeautifier/widgets/UUID/:
//     ├── widget.json     manifest (see WIDGET-API.md)
//     └── widget.js       ESM module, default export = class extends WidgetBase
//
// Manifest schema (widget.json):
//   {
//     "uuid":          "com.example.MyWidget",   required, unique
//     "name":          "My Widget",              required
//     "description":   "Short summary",          required
//     "version":       1,                        required (integer)
//     "api-version":   1,                        required, must equal CURRENT_API_VERSION
//     "main":          "widget.js"               optional, default "widget.js"
//   }

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Built-in widget modules. New built-ins go here.
import ClockWidget from './builtin/clock.js';
import WeatherWidget from './builtin/weather.js';
import WallpaperInfoWidget from './builtin/wallpaper-info.js';
import SystemMonitorWidget from './builtin/system-monitor.js';

export const CURRENT_API_VERSION = 1;

const BUILTIN_DEFINITIONS = [
    {
        uuid: 'clock',
        name: 'Clock & Date',
        description: 'Floating clock with configurable format.',
        version: 1,
        builtin: true,
        widgetClass: ClockWidget,
    },
    {
        uuid: 'weather',
        name: 'Weather',
        description: 'Current temperature, condition, sunrise / sunset for your location.',
        version: 1,
        builtin: true,
        widgetClass: WeatherWidget,
    },
    {
        uuid: 'wallpaper-info',
        name: 'Wallpaper Info',
        description: 'Active weather bucket, current image filename, applied accent swatch.',
        version: 1,
        builtin: true,
        widgetClass: WallpaperInfoWidget,
    },
    {
        uuid: 'system-monitor',
        name: 'System Monitor',
        description: 'CPU and RAM usage from /proc, with a thin sparkline.',
        version: 1,
        builtin: true,
        widgetClass: SystemMonitorWidget,
    },
];

function userWidgetsRoot() {
    const dataHome = GLib.get_user_data_dir();
    return GLib.build_filenamev([dataHome, 'gnomebeautifier', 'widgets']);
}

function readManifest(dir) {
    const path = GLib.build_filenamev([dir, 'widget.json']);
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return null;
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return null;
        const text = new TextDecoder('utf-8').decode(contents);
        const json = JSON.parse(text);
        return json;
    } catch (e) {
        logError(e, `GnomeBeautifier: widget manifest parse failed at ${path}`);
        return null;
    }
}

function validateManifest(manifest, dir) {
    const required = ['uuid', 'name', 'description', 'version', 'api-version'];
    for (const key of required) {
        if (manifest[key] === undefined) {
            log(`GnomeBeautifier: widget at ${dir} missing required key "${key}"; ignored.`);
            return false;
        }
    }
    if (manifest['api-version'] !== CURRENT_API_VERSION) {
        log(`GnomeBeautifier: widget "${manifest.uuid}" wants api-version ${manifest['api-version']}, we provide ${CURRENT_API_VERSION}; ignored.`);
        return false;
    }
    return true;
}

async function importUserModule(dir, mainFile) {
    const path = GLib.build_filenamev([dir, mainFile ?? 'widget.js']);
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return null;
    // Dynamic import via file:// URI works in GJS ESM.
    try {
        const mod = await import(`file://${path}`);
        if (!mod?.default) {
            log(`GnomeBeautifier: widget at ${path} has no default export; ignored.`);
            return null;
        }
        return mod.default;
    } catch (e) {
        logError(e, `GnomeBeautifier: widget module load failed at ${path}`);
        return null;
    }
}

export class WidgetLoader {
    constructor() {
        this._definitions = new Map();
    }

    async discoverAll() {
        this._definitions.clear();
        for (const def of BUILTIN_DEFINITIONS)
            this._definitions.set(def.uuid, def);
        await this._discoverUserDir();
        return [...this._definitions.values()];
    }

    async _discoverUserDir() {
        const rootPath = userWidgetsRoot();
        const root = Gio.File.new_for_path(rootPath);
        if (!root.query_exists(null))
            return;

        let enumerator;
        try {
            enumerator = root.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null,
            );
        } catch (e) {
            logError(e, `GnomeBeautifier: cannot enumerate ${rootPath}`);
            return;
        }

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                continue;
            const widgetDir = GLib.build_filenamev([rootPath, info.get_name()]);
            const manifest = readManifest(widgetDir);
            if (!manifest || !validateManifest(manifest, widgetDir))
                continue;
            if (this._definitions.has(manifest.uuid)) {
                log(`GnomeBeautifier: user widget "${manifest.uuid}" shadows a built-in; user version wins.`);
            }
            const widgetClass = await importUserModule(widgetDir, manifest.main);
            if (!widgetClass)
                continue;
            this._definitions.set(manifest.uuid, {
                uuid: manifest.uuid,
                name: manifest.name,
                description: manifest.description,
                version: manifest.version,
                builtin: false,
                dir: widgetDir,
                widgetClass,
            });
        }
        enumerator.close(null);
    }

    get(uuid) {
        return this._definitions.get(uuid);
    }

    list() {
        return [...this._definitions.values()];
    }
}

export const _internal = { BUILTIN_DEFINITIONS, userWidgetsRoot };
