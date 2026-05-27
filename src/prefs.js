// Adwaita preferences window. Runs in a separate GTK process, so we cannot
// reach into the running extension — every control is bound to a GSettings key
// and the extension reacts via its 'changed::' handlers.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnomeBeautifierPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ---- Page: Wallpaper rotation ----
        const wallpaperPage = new Adw.PreferencesPage({
            title: 'Wallpaper',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(wallpaperPage);

        const rotGroup = new Adw.PreferencesGroup({ title: 'Rotation' });
        wallpaperPage.add(rotGroup);

        const rotSwitch = new Adw.SwitchRow({
            title: 'Rotate wallpaper automatically',
            subtitle: 'Advance to the next image on a fixed interval',
        });
        settings.bind('rotation-enabled', rotSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        rotGroup.add(rotSwitch);

        const rotInterval = new Adw.SpinRow({
            title: 'Interval (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 1440, step_increment: 1, page_increment: 15,
            }),
        });
        settings.bind('rotation-interval-minutes', rotInterval, 'value', Gio.SettingsBindFlags.DEFAULT);
        rotGroup.add(rotInterval);

        const dirGroup = new Adw.PreferencesGroup({
            title: 'Wallpaper Library',
            description: 'Root folder holding the weather-bucket subfolders (clear, clouds, rain, storm, snow, fog, night, default). Leave blank to use ~/Pictures/Weather-Wallpapers.',
        });
        wallpaperPage.add(dirGroup);

        const dirRow = new Adw.EntryRow({ title: 'Wallpaper root' });
        settings.bind('wallpaper-root', dirRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        dirGroup.add(dirRow);

        // ---- Page: Weather ----
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

        const locGroup = new Adw.PreferencesGroup({
            title: 'Location',
            description: 'IP geolocation requires no setup. Manual is exact but you maintain it. GeoClue is reserved for a future release.',
        });
        weatherPage.add(locGroup);

        const locModel = Gtk.StringList.new(['IP geolocation', 'Manual coordinates', 'GeoClue (TODO)']);
        const locRow = new Adw.ComboRow({ title: 'Location source', model: locModel });
        const sourceToIndex = (src) => ({ ip: 0, manual: 1, geoclue: 2 }[src] ?? 0);
        const indexToSource = (i) => ['ip', 'manual', 'geoclue'][i] ?? 'ip';
        locRow.selected = sourceToIndex(settings.get_string('location-source'));
        locRow.connect('notify::selected', () => {
            settings.set_string('location-source', indexToSource(locRow.selected));
        });
        settings.connect('changed::location-source', () => {
            locRow.selected = sourceToIndex(settings.get_string('location-source'));
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

        // ---- Page: Appearance follow ----
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

        // ---- Page: Widgets ----
        const widgetsPage = new Adw.PreferencesPage({
            title: 'Widgets',
            icon_name: 'view-grid-symbolic',
        });
        window.add(widgetsPage);

        const widgetMasterGroup = new Adw.PreferencesGroup({
            title: 'Desktop widgets',
            description: 'Floating widgets on the desktop layer, occluded by windows. Drag to move; right-click on a widget to remove it. Add and remove from the desktop right-click menu.',
        });
        widgetsPage.add(widgetMasterGroup);

        const widgetsSwitch = new Adw.SwitchRow({
            title: 'Enable desktop widgets',
            subtitle: 'Master switch. Turning off unmounts all instances but preserves their saved positions.',
        });
        settings.bind('widgets-enabled', widgetsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        widgetMasterGroup.add(widgetsSwitch);

        const widgetInfoGroup = new Adw.PreferencesGroup({
            title: 'Community widgets',
            description: 'Drop a widget package under ~/.local/share/gnomebeautifier/widgets/UUID/ and re-toggle the master switch to load it. See WIDGET-API.md and the examples/ directory in the repository for the manifest + class contract.',
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
