// Base class for every widget the user can drop on the desktop. Owns the
// outer St container, drag-to-position handling, lifecycle hook surface,
// and per-instance configuration access. Concrete widgets subclass this
// and override onMount() / onTick() / onUnmount() / onConfigChanged().

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

// Glassmorphism defaults applied to every widget container. The actual frosted
// effect comes from Shell.BlurEffect in BACKGROUND mode (blurs whatever is
// painted behind the actor — wallpaper, windows under the widget — while
// keeping the widget's own text/icons crisp). The CSS layer adds the
// translucent tint and the subtle light edge.
const GLASS_SIGMA = 24;
const GLASS_BRIGHTNESS = 1.0;

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 120;
const DRAG_THRESHOLD_PX = 4;

/**
 * Lifecycle (called by WidgetManager):
 *   constructor(ctx)   – cheap; never touch the stage here.
 *   mount(stageX, stageY) – attach to layoutManager, run onMount(), start tick.
 *   unmount()          – stop tick, run onUnmount(), detach from layoutManager.
 *
 * Subclasses MUST implement:
 *   - get displayName()   – human-readable, shown in menus / prefs.
 *   - get tickIntervalSeconds() – integer ≥ 1, or 0 to disable the tick.
 *   - onMount()           – build child actors inside this.body.
 *   - onTick()            – periodic refresh (no-op if tickIntervalSeconds=0).
 *   - onUnmount()         – release any per-instance resources you held.
 *
 * Subclasses MAY override:
 *   - onConfigChanged(key) – react to widget-config changes.
 *   - defaultSize()        – return {width, height} for first placement.
 *   - defaultConfig()      – return an object merged into instance.config on creation.
 */
export class WidgetBase {
    /**
     * @param {object} ctx  Shared context passed by WidgetManager.
     * @param {string} ctx.uuid                Widget type UUID (e.g. 'clock').
     * @param {string} ctx.instanceId          Per-instance UUID.
     * @param {object} ctx.config              Per-instance config object (mutable).
     * @param {(patch: object) => void} ctx.persistConfig   Save partial config patch.
     * @param {(x: number, y: number, monitor: number) => void} ctx.persistPosition
     * @param {() => void} ctx.requestRemove   Ask the manager to destroy this instance.
     * @param {object} ctx.services            Cross-cutting services (see WidgetManager.services()).
     */
    constructor(ctx) {
        this._ctx = ctx;
        this._tickId = 0;
        this._dragging = false;
        this._dragOffset = [0, 0];
        this._mounted = false;
        this._stagePos = { x: ctx.x ?? 80, y: ctx.y ?? 80, monitor: ctx.monitor ?? 0 };

        this.container = null;
        this.body = null;
    }

    // ---- Subclass surface -----------------------------------------------

    /** @abstract */
    get displayName() { return 'Widget'; }

    /** Seconds between onTick() calls. 0 disables the tick. @abstract */
    get tickIntervalSeconds() { return 0; }

    /** @abstract */
    onMount() {}

    /** @abstract */
    onTick() {}

    /** @abstract */
    onUnmount() {}

    onConfigChanged(_key) {}

    defaultSize() {
        return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }

    defaultConfig() {
        return {};
    }

    // ---- Public helpers exposed to subclasses ---------------------------

    /** @returns {object} The per-instance config (mutable; persist via setConfig). */
    get config() {
        return this._ctx.config;
    }

    setConfig(patch) {
        Object.assign(this._ctx.config, patch);
        this._ctx.persistConfig(patch);
        for (const key of Object.keys(patch))
            this.onConfigChanged(key);
    }

    /** Cross-cutting services (wallpaper, weather, accent, settings). */
    services() {
        return this._ctx.services;
    }

    // ---- Lifecycle invoked by WidgetManager -----------------------------

    mount(layoutManager) {
        if (this._mounted)
            return;

        const { width, height } = this.defaultSize();
        this.container = new St.BoxLayout({
            vertical: true,
            reactive: true,
            track_hover: true,
            style_class: 'gnomebeautifier-widget gnomebeautifier-widget-glass',
            width,
            height,
        });

        // Frosted-glass blur of whatever is painted behind the widget
        // (wallpaper, windows below). Subclasses can disable by setting
        // this.disableGlass = true before mount() — useful for opaque widgets.
        if (!this.disableGlass) {
            try {
                this._glassEffect = new Shell.BlurEffect({
                    sigma: GLASS_SIGMA,
                    brightness: GLASS_BRIGHTNESS,
                    mode: Shell.BlurMode.BACKGROUND,
                });
                this.container.add_effect_with_name('gnomebeautifier-glass', this._glassEffect);
            } catch (e) {
                // BlurEffect can fail on software-rendered sessions (no GL).
                // Fall back to the plain translucent CSS look; the widget is
                // still usable, just not frosted.
                logError(e, 'GnomeBeautifier: glass effect unavailable; falling back to flat translucent style');
                this.container.add_style_class_name('gnomebeautifier-widget-glass-fallback');
            }
        }

        // Inner header — drag handle area with the widget's display name. We
        // keep it inside the same reactive container so the whole widget is
        // draggable; the header just gives users a visual cue.
        const header = new St.BoxLayout({
            style_class: 'gnomebeautifier-widget-header',
            x_expand: true,
        });
        const title = new St.Label({
            text: this.displayName,
            style_class: 'gnomebeautifier-widget-title',
            x_expand: true,
        });
        header.add_child(title);

        this.body = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style_class: 'gnomebeautifier-widget-body',
        });

        this.container.add_child(header);
        this.container.add_child(this.body);

        this._wireDrag();

        layoutManager.addChrome(this.container, {
            trackFullscreen: true,
            affectsStruts: false,
        });
        this.container.set_position(this._stagePos.x, this._stagePos.y);

        try {
            this.onMount();
        } catch (e) {
            logError(e, `GnomeBeautifier widget mount failed: ${this._ctx.uuid}/${this._ctx.instanceId}`);
        }

        this._startTick();
        this._mounted = true;
    }

    unmount(layoutManager) {
        if (!this._mounted)
            return;
        this._mounted = false;
        this._stopTick();
        try {
            this.onUnmount();
        } catch (e) {
            logError(e, `GnomeBeautifier widget unmount failed: ${this._ctx.uuid}/${this._ctx.instanceId}`);
        }
        if (this.container) {
            if (this._glassEffect) {
                this.container.remove_effect(this._glassEffect);
                this._glassEffect = null;
            }
            layoutManager.removeChrome(this.container);
            this.container.destroy();
            this.container = null;
            this.body = null;
        }
    }

    // ---- Internal: drag + tick ------------------------------------------

    _wireDrag() {
        const c = this.container;
        // We implement drag manually rather than using Clutter.DragAction so
        // we can keep the widget anchored exactly under the cursor and persist
        // the position only on release. Threshold prevents accidental drag on
        // single clicks.
        c.connect('button-press-event', (_a, event) => {
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

        c.connect('motion-event', (_a, event) => {
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

        c.connect('button-release-event', (_a, event) => {
            if (!this._dragging)
                return Clutter.EVENT_PROPAGATE;
            this._dragging = false;
            if (this._dragMoved) {
                const [x, y] = c.get_position();
                this._stagePos.x = x;
                this._stagePos.y = y;
                this._ctx.persistPosition(x, y, this._stagePos.monitor);
            }
            // A press-without-drag on a right-click is the request-remove gesture.
            if (!this._dragMoved && event.get_button() === 3)
                this._ctx.requestRemove?.();
            return Clutter.EVENT_STOP;
        });
    }

    _startTick() {
        const seconds = this.tickIntervalSeconds | 0;
        if (seconds <= 0)
            return;
        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                try { this.onTick(); }
                catch (e) { logError(e, `GnomeBeautifier widget tick: ${this._ctx.uuid}`); }
                return GLib.SOURCE_CONTINUE;
            },
        );
        // Trigger an immediate tick so widgets render their first state without
        // waiting a full interval.
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
