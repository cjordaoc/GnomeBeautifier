// Adwaita preferences window.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SOURCE_TO_INDEX = { ip: 0, manual: 1, geoclue: 2 };
const INDEX_TO_SOURCE = ['ip', 'manual', 'geoclue'];

export default class GnomeBeautifierPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ==== Wallpaper page =================================================
        const wallpaperPage = new Adw.PreferencesPage({
            title: 'Wallpaper',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(wallpaperPage);

        // ---- Rotation
        const rotGroup = new Adw.PreferencesGroup({ title: 'Rotation' });
        wallpaperPage.add(rotGroup);

        const rotSwitch = new Adw.SwitchRow({
            title: 'Rotate wallpaper automatically',
            subtitle: 'Advance to the next image in the active bucket on a fixed interval',
        });
        settings.bind('rotation-enabled', rotSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        rotGroup.add(rotSwitch);

        const rotInterval = new Adw.SpinRow({
            title: 'Interval (minutes)',
            subtitle: 'Minimum 1; values below 1 minute floor to 1',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 1440, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('rotation-interval-minutes', rotInterval, 'value', Gio.SettingsBindFlags.DEFAULT);
        rotGroup.add(rotInterval);

        const lastRotRow = new Adw.ActionRow({
            title: 'Last rotation',
            subtitle: 'Refreshes whenever the extension advances the wallpaper',
        });
        const refreshLastRot = () => {
            const ts = settings.get_int64('last-rotation-timestamp');
            lastRotRow.subtitle = ts === 0
                ? 'Never (waiting for first rotation)'
                : `${new Date(Number(ts) * 1000).toLocaleString()}`;
        };
        refreshLastRot();
        settings.connect('changed::last-rotation-timestamp', refreshLastRot);
        rotGroup.add(lastRotRow);

        // ---- Library
        const dirGroup = new Adw.PreferencesGroup({
            title: 'Wallpaper Library',
            description: 'Root folder holding the weather-bucket subfolders. Each bucket can optionally contain morning / afternoon / evening / night subfolders for time-of-day variants.',
        });
        wallpaperPage.add(dirGroup);

        const dirRow = new Adw.ActionRow({
            title: 'Library root',
            subtitle: settings.get_string('wallpaper-root') || `${GLib.get_home_dir()}/Pictures/Weather-Wallpapers (default)`,
        });
        const chooseBtn = new Gtk.Button({
            label: 'Choose…',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        chooseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Select wallpaper library root',
                modal: true,
            });
            const currentPath = settings.get_string('wallpaper-root')
                || `${GLib.get_home_dir()}/Pictures/Weather-Wallpapers`;
            const initial = Gio.File.new_for_path(currentPath);
            if (initial.query_exists(null))
                dialog.set_initial_folder(initial);
            dialog.select_folder(window, null, (_dialog, result) => {
                try {
                    const folder = dialog.select_folder_finish(result);
                    if (folder) {
                        const path = folder.get_path();
                        settings.set_string('wallpaper-root', path);
                        dirRow.subtitle = path;
                    }
                } catch (_e) { /* user cancelled */ }
            });
        });
        dirRow.add_suffix(chooseBtn);

        const openBtn = new Gtk.Button({
            label: 'Open',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Open the library root in the file manager so you can curate per-bucket folders',
            css_classes: ['flat'],
        });
        openBtn.connect('clicked', () => {
            const path = settings.get_string('wallpaper-root')
                || `${GLib.get_home_dir()}/Pictures/Weather-Wallpapers`;
            Gio.AppInfo.launch_default_for_uri_async(`file://${path}`, null, null, null);
        });
        dirRow.add_suffix(openBtn);

        settings.connect('changed::wallpaper-root', () => {
            dirRow.subtitle = settings.get_string('wallpaper-root')
                || `${GLib.get_home_dir()}/Pictures/Weather-Wallpapers (default)`;
        });
        dirGroup.add(dirRow);

        const todToggle = new Adw.SwitchRow({
            title: 'Match wallpaper to time of day',
            subtitle: 'When ON, the extension prefers <bucket>/<morning|afternoon|evening|night>/ under the active weather bucket. Falls back to <bucket>/ when the time subfolder is empty.',
        });
        settings.bind('time-of-day-enabled', todToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        dirGroup.add(todToggle);

        const helpGroup = new Adw.PreferencesGroup({
            title: 'Curating buckets',
            description: 'The bundled scripts/setup-wallpapers.sh seeds each bucket round-robin from your KDE/GNOME wallpaper packages — it does NOT know which image looks like rain or snow. For best results, replace the auto-seeded contents with images whose subject matches each bucket. Click "Open" above to navigate.',
        });
        wallpaperPage.add(helpGroup);

        // ==== Weather page ===================================================
        const weatherPage = new Adw.PreferencesPage({
            title: 'Weather',
            icon_name: 'weather-few-clouds-symbolic',
        });
        window.add(weatherPage);

        const weatherGroup = new Adw.PreferencesGroup({ title: 'Weather-driven bucket' });
        weatherPage.add(weatherGroup);

        const weatherSwitch = new Adw.SwitchRow({
            title: 'Pick bucket from current weather',
            subtitle: 'When off, rotation cycles inside the bucket you last chose',
        });
        settings.bind('weather-enabled', weatherSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        weatherGroup.add(weatherSwitch);

        const weatherInterval = new Adw.SpinRow({
            title: 'Refresh interval (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 720, step_increment: 5, page_increment: 30,
            }),
        });
        settings.bind('weather-refresh-minutes', weatherInterval, 'value', Gio.SettingsBindFlags.DEFAULT);
        weatherGroup.add(weatherInterval);

        // ---- Location
        const locGroup = new Adw.PreferencesGroup({
            title: 'Location',
            description: 'IP geolocation requires no setup but is approximate. Manual is exact. GeoClue is reserved for a future release.',
        });
        weatherPage.add(locGroup);

        // Current location (derived from last IP lookup; updates live).
        const currentLocRow = new Adw.ActionRow({
            title: 'Current location',
            subtitle: '(no lookup completed yet)',
        });
        const refreshLoc = () => {
            const lat = settings.get_double('last-resolved-latitude');
            const lon = settings.get_double('last-resolved-longitude');
            const city = settings.get_string('last-resolved-city');
            const region = settings.get_string('last-resolved-region');
            const country = settings.get_string('last-resolved-country');
            if (lat === 0.0 && lon === 0.0 && !city) {
                currentLocRow.subtitle = '(no lookup completed yet — toggle Weather on, or click "Refresh Weather Now" in the desktop menu)';
                return;
            }
            const place = [city, region, country].filter(Boolean).join(', ');
            const coords = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            currentLocRow.subtitle = place ? `${place}  ·  ${coords}` : coords;
        };
        refreshLoc();
        for (const key of ['last-resolved-latitude', 'last-resolved-longitude',
                           'last-resolved-city', 'last-resolved-region', 'last-resolved-country']) {
            settings.connect(`changed::${key}`, refreshLoc);
        }
        locGroup.add(currentLocRow);

        const locModel = Gtk.StringList.new(['IP geolocation', 'Manual coordinates', 'GeoClue (TODO)']);
        const locRow = new Adw.ComboRow({ title: 'Location source', model: locModel });
        locRow.selected = SOURCE_TO_INDEX[settings.get_string('location-source')] ?? 0;
        locRow.connect('notify::selected', () => {
            settings.set_string('location-source', INDEX_TO_SOURCE[locRow.selected] ?? 'ip');
        });
        settings.connect('changed::location-source', () => {
            locRow.selected = SOURCE_TO_INDEX[settings.get_string('location-source')] ?? 0;
        });
        locGroup.add(locRow);

        const latRow = new Adw.SpinRow({
            title: 'Manual latitude',
            adjustment: new Gtk.Adjustment({
                lower: -90, upper: 90, step_increment: 0.1, page_increment: 1,
            }),
            digits: 4,
        });
        settings.bind('manual-latitude', latRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        locGroup.add(latRow);

        const lonRow = new Adw.SpinRow({
            title: 'Manual longitude',
            adjustment: new Gtk.Adjustment({
                lower: -180, upper: 180, step_increment: 0.1, page_increment: 1,
            }),
            digits: 4,
        });
        settings.bind('manual-longitude', lonRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        locGroup.add(lonRow);

        // ==== Appearance page ================================================
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);

        const accentGroup = new Adw.PreferencesGroup({
            title: 'Follow wallpaper',
            description: 'Drive GNOME accent colour and light/dark theme from the active wallpaper.',
        });
        appearancePage.add(accentGroup);

        const accentSwitch = new Adw.SwitchRow({
            title: 'Match accent colour to wallpaper',
            subtitle: 'GNOME 47+ only; mapped to the nearest of the 9 built-in accents',
        });
        settings.bind('accent-follow-enabled', accentSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        accentGroup.add(accentSwitch);

        const schemeSwitch = new Adw.SwitchRow({
            title: 'Switch light/dark based on wallpaper luminance',
            subtitle: 'Dark wallpaper → prefer-dark; bright → default',
        });
        settings.bind('color-scheme-follow-enabled', schemeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        accentGroup.add(schemeSwitch);

        // ==== Widgets page ===================================================
        const widgetsPage = new Adw.PreferencesPage({
            title: 'Widgets',
            icon_name: 'view-grid-symbolic',
        });
        window.add(widgetsPage);

        const widgetMasterGroup = new Adw.PreferencesGroup({
            title: 'Desktop widgets',
            description: 'Glassmorphism widgets on the desktop layer, occluded by windows. Drag the title bar to move; drag the bottom-right grip to resize; right-click for the Remove menu. Add and remove from the desktop right-click menu.',
        });
        widgetsPage.add(widgetMasterGroup);

        const widgetsSwitch = new Adw.SwitchRow({
            title: 'Enable desktop widgets',
            subtitle: 'Master switch. Turning off unmounts all instances; positions are preserved.',
        });
        settings.bind('widgets-enabled', widgetsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        widgetMasterGroup.add(widgetsSwitch);

        const widgetInfoGroup = new Adw.PreferencesGroup({
            title: 'Community widgets',
            description: 'Drop a widget package under ~/.local/share/gnomebeautifier/widgets/UUID/ and re-toggle the master switch to load it. See WIDGET-API.md and the examples/ directory.',
        });
        widgetsPage.add(widgetInfoGroup);

        const resetRow = new Adw.ActionRow({
            title: 'Reset all widget instances',
            subtitle: 'Removes every widget from the desktop. Cannot be undone.',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetButton.connect('clicked', () => {
            settings.set_string('widget-instances', '[]');
        });
        resetRow.add_suffix(resetButton);
        widgetInfoGroup.add(resetRow);
    }
}
