// Owns the desktop right-click background-menu injection AND a tiny panel
// indicator that mirrors the same actions (useful when the user clicks the
// panel rather than the desktop). Wires user intent to callbacks; never
// reaches into the other modules' state directly.

import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BackgroundMenu from 'resource:///org/gnome/shell/ui/backgroundMenu.js';

import { WidgetPicker } from './widget-picker.js';

// One tag string we use to mark the menu items we inject, so we can find and
// remove them again on disable without nuking GNOME's own items.
const TAG = '__gnomebeautifier_item';

export class IndicatorManager {
    /**
     * @param {object} opts
     * @param {() => void} opts.onNext                       Cycle to next wallpaper.
     * @param {() => void} opts.onPrevious                   Cycle to previous wallpaper.
     * @param {() => Promise<void>} opts.onRefreshWeather    Re-fetch weather and re-pick bucket.
     * @param {() => void} opts.onOpenPrefs                  Open the extension preferences window.
     * @param {() => string} opts.statusText                 Build a one-line status string for the menu header.
     * @param {() => Array<{uuid,name,description,builtin}>} opts.listWidgetDefinitions
     * @param {() => Array<{instanceId,uuid,name}>} opts.listWidgetInstances
     * @param {(uuid: string) => void} opts.onAddWidget
     * @param {(instanceId: string) => void} opts.onRemoveWidget
     */
    constructor(opts) {
        this._opts = opts;
        this._panelIndicator = null;
        this._panelStatusLabel = null;
        this._originalAddBackgroundMenu = null;
        this._patchedMenus = new Set();
        this._picker = null;
    }

    enable() {
        this._installPanelIndicator();
        this._installDesktopMenuPatch();
    }

    disable() {
        this._removeDesktopMenuPatch();
        this._removePanelIndicator();
        this._picker?.destroy();
        this._picker = null;
        this._opts = null;
    }

    /** Lazy: only construct the picker the first time the user opens it. */
    _openPicker() {
        if (!this._picker) {
            this._picker = new WidgetPicker({
                listDefinitions: () => this._opts?.listWidgetDefinitions?.() ?? [],
                onAdd: (uuid) => this._opts?.onAddWidget?.(uuid),
            });
        }
        this._picker.open();
    }

    /** Called by extension.js whenever state changes so labels can refresh. */
    refreshStatus() {
        if (this._panelStatusLabel && this._opts?.statusText) {
            this._panelStatusLabel.text = this._opts.statusText();
        }
        for (const menu of this._patchedMenus) {
            const label = menu.__gnomebeautifier_statusLabel;
            if (label && this._opts?.statusText)
                label.text = this._opts.statusText();
        }
        // The "Remove Widget" submenu's contents change as widgets come and go;
        // rebuild it on every status refresh so the menu always matches reality.
        this._refreshWidgetSubmenus();
    }

    _refreshWidgetSubmenus() {
        const o = this._opts;
        if (!o) return;
        const rebuildRemove = (submenu) => {
            if (!submenu) return;
            submenu.menu.removeAll();
            const instances = o.listWidgetInstances?.() ?? [];
            if (instances.length === 0) {
                const empty = new PopupMenu.PopupMenuItem('(no widgets on desktop)');
                empty.setSensitive(false);
                submenu.menu.addMenuItem(empty);
                submenu.actor.visible = true;
                return;
            }
            for (const inst of instances) {
                const item = new PopupMenu.PopupMenuItem(`${inst.name}  —  ${inst.instanceId.slice(0, 6)}`);
                item.connect('activate', () => o.onRemoveWidget?.(inst.instanceId));
                submenu.menu.addMenuItem(item);
            }
        };
        if (this._panelRemoveSubmenu) rebuildRemove(this._panelRemoveSubmenu);
        for (const menu of this._patchedMenus) {
            rebuildRemove(menu.__gnomebeautifier_removeSubmenu);
        }
    }

    // ---------- Panel indicator (always-visible fallback surface) ----------

    _installPanelIndicator() {
        this._panelIndicator = new PanelMenu.Button(0.0, 'GNOME Beautifier', false);
        const icon = new St.Icon({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            style_class: 'system-status-icon gnomebeautifier-panel-icon',
        });
        this._panelIndicator.add_child(icon);

        this._buildMenuItems(this._panelIndicator.menu, /* isPanel */ true);

        Main.panel.addToStatusArea('gnomebeautifier-indicator', this._panelIndicator);
        this._refreshWidgetSubmenus();
    }

    _removePanelIndicator() {
        this._panelIndicator?.destroy();
        this._panelIndicator = null;
        this._panelStatusLabel = null;
    }

    // ---------- Desktop background-menu monkey-patch ----------

    _installDesktopMenuPatch() {
        // Save and wrap addBackgroundMenu so any future background actor gets
        // our items appended after GNOME builds the menu.
        this._originalAddBackgroundMenu = BackgroundMenu.addBackgroundMenu;

        const self = this;
        BackgroundMenu.addBackgroundMenu = function (actor, layoutManager) {
            self._originalAddBackgroundMenu(actor, layoutManager);
            const menu = actor._backgroundMenu;
            if (menu) {
                self._injectInto(menu);
                self._refreshWidgetSubmenus();
            }
        };

        // Retro-patch background actors that were created before we loaded.
        const layout = Main.layoutManager;
        const monitors = layout?.monitors ?? [];
        for (const monitor of monitors) {
            // GNOME stores the actor on the BackgroundManager; walk its actor tree.
            const actor = monitor.actor ?? null;
            if (actor && actor._backgroundMenu)
                this._injectInto(actor._backgroundMenu);
        }
        if (layout?._bgManagers) {
            for (const mgr of layout._bgManagers) {
                const actor = mgr.backgroundActor ?? mgr._backgroundActor ?? null;
                if (actor && actor._backgroundMenu)
                    this._injectInto(actor._backgroundMenu);
            }
        }
    }

    _removeDesktopMenuPatch() {
        if (this._originalAddBackgroundMenu) {
            BackgroundMenu.addBackgroundMenu = this._originalAddBackgroundMenu;
            this._originalAddBackgroundMenu = null;
        }

        for (const menu of this._patchedMenus) {
            this._stripFrom(menu);
        }
        this._patchedMenus.clear();
    }

    _injectInto(menu) {
        if (this._patchedMenus.has(menu))
            return;
        this._buildMenuItems(menu, /* isPanel */ false);
        this._patchedMenus.add(menu);

        // Drop the menu from our set when it's destroyed so we don't leak refs.
        menu.connect('destroy', () => this._patchedMenus.delete(menu));
    }

    _stripFrom(menu) {
        const items = menu._getMenuItems?.() ?? [];
        for (const item of items) {
            if (item[TAG]) item.destroy();
        }
        if (menu.__gnomebeautifier_statusLabel) {
            menu.__gnomebeautifier_statusLabel = null;
        }
        menu.__gnomebeautifier_removeSubmenu = null;
    }

    // ---------- Shared menu builder ----------

    _buildMenuItems(menu, isPanel) {
        const o = this._opts;
        if (!o) return;

        // Status header — first item, non-clickable.
        const statusItem = new PopupMenu.PopupMenuItem(o.statusText?.() ?? '');
        statusItem.setSensitive(false);
        statusItem.label.style_class = 'gnomebeautifier-menu-status';
        statusItem[TAG] = true;
        if (isPanel)
            this._panelStatusLabel = statusItem.label;
        else
            menu.__gnomebeautifier_statusLabel = statusItem.label;

        // For the desktop menu, insert at the very top so our items appear
        // above "Change Background…". For the panel menu, just append.
        if (isPanel) {
            menu.addMenuItem(statusItem);
        } else {
            menu.addMenuItem(statusItem, 0);
        }

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        sep[TAG] = true;

        const nextItem = new PopupMenu.PopupMenuItem('Next Wallpaper');
        nextItem[TAG] = true;
        nextItem.connect('activate', () => { try { o.onNext?.(); } catch (e) { logError(e); } });

        const prevItem = new PopupMenu.PopupMenuItem('Previous Wallpaper');
        prevItem[TAG] = true;
        prevItem.connect('activate', () => { try { o.onPrevious?.(); } catch (e) { logError(e); } });

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Weather Now');
        refreshItem[TAG] = true;
        refreshItem.connect('activate', () => {
            Promise.resolve(o.onRefreshWeather?.()).catch(e => logError(e));
        });

        const prefsItem = new PopupMenu.PopupMenuItem('GNOME Beautifier Settings…');
        prefsItem[TAG] = true;
        prefsItem.connect('activate', () => { try { o.onOpenPrefs?.(); } catch (e) { logError(e); } });

        // ---- Widget items ----
        //
        // "Add Widget…" opens the KDE-style picker dialog (WidgetPicker /
        // ModalDialog) — a centered window with search, descriptions and
        // icons, not an inline submenu. Single click → dialog opens; clicks
        // anywhere outside or Escape closes it.
        const addItem = new PopupMenu.PopupMenuItem('Add Widget…');
        addItem[TAG] = true;
        addItem.connect('activate', () => {
            try { this._openPicker(); }
            catch (e) { logError(e, 'GnomeBeautifier: widget picker open failed'); }
        });

        // "Remove Widget" still uses an inline submenu since the list of
        // running instances is short, dynamic, and benefits from instance
        // IDs in the label so users can disambiguate duplicates.
        const removeSubmenu = new PopupMenu.PopupSubMenuMenuItem('Remove Widget');
        removeSubmenu[TAG] = true;
        // Populated lazily by _refreshWidgetSubmenus so it always matches reality.

        if (isPanel) {
            this._panelRemoveSubmenu = removeSubmenu;
            menu.addMenuItem(sep);
            menu.addMenuItem(nextItem);
            menu.addMenuItem(prevItem);
            menu.addMenuItem(refreshItem);
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            menu.addMenuItem(addItem);
            menu.addMenuItem(removeSubmenu);
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            menu.addMenuItem(prefsItem);
        } else {
            menu.__gnomebeautifier_removeSubmenu = removeSubmenu;
            let idx = 1;
            menu.addMenuItem(sep, idx++);
            menu.addMenuItem(nextItem, idx++);
            menu.addMenuItem(prevItem, idx++);
            menu.addMenuItem(refreshItem, idx++);
            const midSep = new PopupMenu.PopupSeparatorMenuItem();
            midSep[TAG] = true;
            menu.addMenuItem(midSep, idx++);
            menu.addMenuItem(addItem, idx++);
            menu.addMenuItem(removeSubmenu, idx++);
            const tailSep = new PopupMenu.PopupSeparatorMenuItem();
            tailSep[TAG] = true;
            menu.addMenuItem(tailSep, idx++);
            menu.addMenuItem(prefsItem, idx++);
        }
    }
}
