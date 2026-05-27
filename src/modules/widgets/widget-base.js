// Base class for every widget the user can drop on the desktop.
//
// Placement: widgets live as children of `global.window_group`, pinned just
// above `Main.layoutManager._backgroundGroup`. That puts them on the desktop
// layer — wallpaper sits below, but any opened window in the same group is
// stacked above and OCCLUDES the widget (the KDE Plasmoid behaviour, and
// what owners actually expect of a desktop widget). `addChrome` would put us
// on the panel/HUD layer instead, which is wrong for this use-case.
//
// Interaction:
//   - Header is the drag handle. Buttons and other reactive children inside
//     the body work normally because the body is not reactive at the
//     container level.
//   - Right-click anywhere on the widget opens a small context menu
//     (Remove). The popup is anchored via `layoutManager.dummyCursor` so it
//     appears at the click position (same trick `BackgroundMenu` uses).
//   - The bottom-right corner is a resize grip. Drag to resize; release
//     persists width/height into the widget's config.
//   - Fullscreen windows hide all widgets via the display signal — no
//     `trackFullscreen` from `addChrome`, so we have to do it ourselves.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 120;
const MIN_WIDTH = 140;
const MIN_HEIGHT = 80;
const DRAG_THRESHOLD_PX = 4;
const RESIZE_GRIP_SIZE = 18;

const GLASS_SIGMA = 24;
const GLASS_BRIGHTNESS = 1.0;

/**
 * Subclasses MUST implement:
 *   - get displayName()         human label.
 *   - get tickIntervalSeconds() integer ≥ 1, or 0 for no tick.
 *   - onMount()                 build child actors inside this.body.
 *   - onTick()                  periodic refresh.
 *   - onUnmount()               release per-instance resources.
 *
 * Subclasses MAY override:
 *   - onConfigChanged(key)
 *   - onResize(width, height)   notified after the user resizes the widget.
 *   - defaultSize()
 *   - defaultConfig()
 */
export class WidgetBase {
    constructor(ctx) {
        this._ctx = ctx;
        this._tickId = 0;
        this._mounted = false;

        this._dragging = false;
        this._dragOffset = [0, 0];
        this._dragMoved = false;

        this._resizing = false;
        this._resizeStart = null;

        this._stagePos = {
            x: ctx.x ?? 80,
            y: ctx.y ?? 80,
            monitor: ctx.monitor ?? 0,
        };

        this.container = null;
        this.body = null;
        this._header = null;
        this._resizeGrip = null;
        this._contextMenu = null;
        this._fullscreenSignal = 0;
    }

    // ---- Subclass surface -----------------------------------------------

    get displayName() { return 'Widget'; }
    get tickIntervalSeconds() { return 0; }
    onMount() {}
    onTick() {}
    onUnmount() {}
    onConfigChanged(_key) {}
    onResize(_width, _height) {}
    defaultSize() { return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }; }
    defaultConfig() { return {}; }

    // ---- Helpers --------------------------------------------------------

    get config() { return this._ctx.config; }
    services() { return this._ctx.services; }

    setConfig(patch) {
        Object.assign(this._ctx.config, patch);
        this._ctx.persistConfig(patch);
        for (const key of Object.keys(patch))
            this.onConfigChanged(key);
    }

    // ---- Lifecycle ------------------------------------------------------

    mount(_unusedLayoutManager) {
        if (this._mounted)
            return;

        // Size: persisted dimensions in config win; otherwise subclass default.
        const ds = this.defaultSize();
        const width = this.config.__width ?? ds.width;
        const height = this.config.__height ?? ds.height;

        // Outer container uses BinLayout so the resize grip can overlay the
        // inner content at the corner.
        this.container = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width,
            height,
            reactive: true,           // captures right-click for context menu
            track_hover: true,
            style_class: 'gnomebeautifier-widget gnomebeautifier-widget-glass',
        });

        // Glassmorphism blur of whatever is painted behind (wallpaper, etc.).
        if (!this.disableGlass) {
            try {
                this._glassEffect = new Shell.BlurEffect({
                    sigma: GLASS_SIGMA,
                    brightness: GLASS_BRIGHTNESS,
                    mode: Shell.BlurMode.BACKGROUND,
                });
                this.container.add_effect_with_name('gnomebeautifier-glass', this._glassEffect);
            } catch (e) {
                logError(e, 'GnomeBeautifier: glass effect unavailable; flat fallback');
                this.container.add_style_class_name('gnomebeautifier-widget-glass-fallback');
            }
        }

        const inner = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._header = new St.BoxLayout({
            style_class: 'gnomebeautifier-widget-header',
            x_expand: true,
            reactive: true,           // drag-to-move handle
            track_hover: true,
        });
        const title = new St.Label({
            text: this.displayName,
            style_class: 'gnomebeautifier-widget-title',
            x_expand: true,
        });
        this._header.add_child(title);

        this.body = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style_class: 'gnomebeautifier-widget-body',
        });

        inner.add_child(this._header);
        inner.add_child(this.body);

        this._resizeGrip = new St.Widget({
            width: RESIZE_GRIP_SIZE,
            height: RESIZE_GRIP_SIZE,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: false,
            y_expand: false,
            reactive: true,
            track_hover: true,
            style_class: 'gnomebeautifier-widget-resize-grip',
        });

        this.container.add_child(inner);
        this.container.add_child(this._resizeGrip);

        this._buildContextMenu();
        this._wireHeaderDrag();
        this._wireResize();
        this._wireRightClickMenu();

        // Place on the desktop layer: a child of global.window_group, stacked
        // just above the background group. Windows occlude us automatically.
        global.window_group.add_child(this.container);
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (bgGroup && bgGroup.get_parent() === global.window_group)
            global.window_group.set_child_above_sibling(this.container, bgGroup);
        else
            global.window_group.set_child_at_index(this.container, 0);

        this.container.set_position(this._stagePos.x, this._stagePos.y);

        // Auto-hide when something goes fullscreen on this monitor.
        this._fullscreenSignal = global.display.connect('in-fullscreen-changed',
            () => this._refreshFullscreenVisibility());
        this._refreshFullscreenVisibility();

        try { this.onMount(); }
        catch (e) { logError(e, `GnomeBeautifier widget mount: ${this._ctx.uuid}`); }

        this._startTick();
        this._mounted = true;
    }

    unmount(_unusedLayoutManager) {
        if (!this._mounted)
            return;
        this._mounted = false;
        this._stopTick();

        try { this.onUnmount(); }
        catch (e) { logError(e, `GnomeBeautifier widget unmount: ${this._ctx.uuid}`); }

        if (this._fullscreenSignal) {
            global.display.disconnect(this._fullscreenSignal);
            this._fullscreenSignal = 0;
        }

        if (this._contextMenu) {
            try { this._contextMenu.destroy(); } catch (_e) {}
            this._contextMenu = null;
        }
        if (this._menuManager) {
            this._menuManager = null;
        }

        if (this.container) {
            if (this._glassEffect) {
                this.container.remove_effect(this._glassEffect);
                this._glassEffect = null;
            }
            const parent = this.container.get_parent();
            if (parent)
                parent.remove_child(this.container);
            this.container.destroy();
            this.container = null;
            this.body = null;
            this._header = null;
            this._resizeGrip = null;
        }
    }

    // ---- Drag (header only) --------------------------------------------

    _wireHeaderDrag() {
        const c = this.container;
        const h = this._header;

        h.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [eventX, eventY] = event.get_coords();
            const [actorX, actorY] = c.get_position();
            this._dragOffset = [eventX - actorX, eventY - actorY];
            this._dragOrigin = [actorX, actorY];
            this._dragging = true;
            this._dragMoved = false;
            return Clutter.EVENT_STOP;
        });

        h.connect('motion-event', (_a, event) => {
            if (!this._dragging)
                return Clutter.EVENT_PROPAGATE;
            const [eventX, eventY] = event.get_coords();
            const newX = Math.round(eventX - this._dragOffset[0]);
            const newY = Math.round(eventY - this._dragOffset[1]);
            const [origX, origY] = this._dragOrigin;
            if (!this._dragMoved &&
                Math.abs(newX - origX) < DRAG_THRESHOLD_PX &&
                Math.abs(newY - origY) < DRAG_THRESHOLD_PX)
                return Clutter.EVENT_STOP;
            this._dragMoved = true;
            c.set_position(newX, newY);
            return Clutter.EVENT_STOP;
        });

        h.connect('button-release-event', (_a, _event) => {
            if (!this._dragging)
                return Clutter.EVENT_PROPAGATE;
            this._dragging = false;
            if (this._dragMoved) {
                const [x, y] = c.get_position();
                this._stagePos.x = x;
                this._stagePos.y = y;
                this._ctx.persistPosition(x, y, this._stagePos.monitor);
            }
            return Clutter.EVENT_STOP;
        });
    }

    // ---- Resize (bottom-right grip) ------------------------------------

    _wireResize() {
        const g = this._resizeGrip;
        const c = this.container;

        g.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [eventX, eventY] = event.get_coords();
            this._resizing = true;
            this._resizeStart = {
                pointerX: eventX,
                pointerY: eventY,
                width: c.width,
                height: c.height,
            };
            return Clutter.EVENT_STOP;
        });

        g.connect('motion-event', (_a, event) => {
            if (!this._resizing) return Clutter.EVENT_PROPAGATE;
            const [eventX, eventY] = event.get_coords();
            const dx = eventX - this._resizeStart.pointerX;
            const dy = eventY - this._resizeStart.pointerY;
            const newW = Math.max(MIN_WIDTH, this._resizeStart.width + dx);
            const newH = Math.max(MIN_HEIGHT, this._resizeStart.height + dy);
            c.set_size(newW, newH);
            return Clutter.EVENT_STOP;
        });

        g.connect('button-release-event', (_a, _event) => {
            if (!this._resizing) return Clutter.EVENT_PROPAGATE;
            this._resizing = false;
            this._resizeStart = null;
            const w = c.width;
            const h = c.height;
            this._ctx.persistConfig({ __width: w, __height: h });
            this._ctx.config.__width = w;
            this._ctx.config.__height = h;
            try { this.onResize(w, h); }
            catch (e) { logError(e, `GnomeBeautifier widget onResize: ${this._ctx.uuid}`); }
            return Clutter.EVENT_STOP;
        });
    }

    // ---- Right-click context menu --------------------------------------

    _buildContextMenu() {
        this._contextMenu = new PopupMenu.PopupMenu(
            Main.layoutManager.dummyCursor, 0, St.Side.TOP);
        Main.layoutManager.uiGroup.add_child(this._contextMenu.actor);
        this._contextMenu.actor.hide();

        const header = new PopupMenu.PopupMenuItem(this.displayName);
        header.setSensitive(false);
        this._contextMenu.addMenuItem(header);
        this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const removeItem = new PopupMenu.PopupMenuItem('Remove this widget');
        removeItem.connect('activate', () => {
            try { this._ctx.requestRemove?.(); }
            catch (e) { logError(e, 'GnomeBeautifier widget remove failed'); }
        });
        this._contextMenu.addMenuItem(removeItem);

        this._menuManager = new PopupMenu.PopupMenuManager(this.container);
        this._menuManager.addMenu(this._contextMenu);
    }

    _wireRightClickMenu() {
        const c = this.container;
        c.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 3)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
            this._contextMenu.open(BoxPointer.PopupAnimation.FULL);
            return Clutter.EVENT_STOP;
        });
    }

    // ---- Fullscreen handling -------------------------------------------

    _refreshFullscreenVisibility() {
        // Hide if ANY monitor has fullscreen. Multi-monitor refinement could
        // hide only the widget on the affected monitor; v1 keeps it simple.
        const nMonitors = global.display.get_n_monitors();
        let anyFs = false;
        for (let i = 0; i < nMonitors; i++) {
            if (global.display.get_monitor_in_fullscreen(i)) {
                anyFs = true;
                break;
            }
        }
        if (this.container)
            this.container.visible = !anyFs;
    }

    // ---- Tick ----------------------------------------------------------

    _startTick() {
        const seconds = this.tickIntervalSeconds | 0;
        if (seconds <= 0) return;
        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                try { this.onTick(); }
                catch (e) { logError(e, `GnomeBeautifier widget tick: ${this._ctx.uuid}`); }
                return GLib.SOURCE_CONTINUE;
            },
        );
        try { this.onTick(); }
        catch (e) { logError(e, `GnomeBeautifier widget initial tick: ${this._ctx.uuid}`); }
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }
}
