// KDE-style widget picker dialog. Opened from the "Add Widget…" item in the
// desktop right-click menu and the panel indicator. Shows every registered
// widget definition (built-ins + community widgets dropped into the user dir)
// as a searchable list of cards; clicking Add (or pressing Enter on a card)
// invokes the onAdd callback and closes the dialog.
//
// We intentionally use Shell's ModalDialog rather than a GTK window so the
// dialog appears in the Shell process (instant, no IPC), respects the
// fullscreen / lock-screen state, and inherits the system-modal lightbox.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const DIALOG_MIN_WIDTH = 520;
const DIALOG_MAX_HEIGHT = 480;

export class WidgetPicker {
    /**
     * @param {object} opts
     * @param {() => Array<{uuid, name, description, builtin}>} opts.listDefinitions
     * @param {(uuid: string) => void} opts.onAdd
     */
    constructor(opts) {
        this._opts = opts;
        this._dialog = null;
        this._search = null;
        this._listBox = null;
        this._cards = [];   // [{def, actor}]
    }

    /** Tear down any open dialog and drop references. */
    destroy() {
        this.close();
        this._opts = null;
    }

    /** Show (or re-show) the picker. Re-reads the definition list every time. */
    open() {
        if (this._dialog) {
            this.close();
        }

        this._dialog = new ModalDialog.ModalDialog({
            styleClass: 'gnomebeautifier-widget-picker',
            destroyOnClose: true,
        });
        this._build();
        this._dialog.open();
    }

    close() {
        if (!this._dialog)
            return;
        try { this._dialog.close(); } catch (_e) {}
        // destroyOnClose handles teardown; null our refs so a later open()
        // doesn't reuse stale actors.
        this._dialog = null;
        this._search = null;
        this._listBox = null;
        this._cards = [];
    }

    // ---- Build helpers --------------------------------------------------

    _build() {
        const content = this._dialog.contentLayout;
        content.style = `min-width: ${DIALOG_MIN_WIDTH}px;`;

        const title = new St.Label({
            text: 'Add Widget',
            style_class: 'gnomebeautifier-widget-picker-title',
            x_expand: true,
        });
        content.add_child(title);

        const subtitle = new St.Label({
            text: 'Pick a widget to drop on the desktop. Drag it to reposition; right-click on the widget itself to remove.',
            style_class: 'gnomebeautifier-widget-picker-subtitle',
            x_expand: true,
        });
        subtitle.clutter_text.line_wrap = true;
        content.add_child(subtitle);

        this._search = new St.Entry({
            hint_text: 'Search widgets…',
            x_expand: true,
            style_class: 'gnomebeautifier-widget-picker-search',
            can_focus: true,
        });
        this._search.clutter_text.connect('text-changed',
            () => this._applyFilter(this._search.get_text()));
        this._search.clutter_text.connect('activate',
            () => this._activateFirstVisibleCard());
        content.add_child(this._search);

        const scroll = new St.ScrollView({
            style_class: 'gnomebeautifier-widget-picker-scroll',
            x_expand: true,
            y_expand: true,
        });
        scroll.style = `max-height: ${DIALOG_MAX_HEIGHT}px;`;

        this._listBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'gnomebeautifier-widget-picker-list',
        });
        scroll.set_child(this._listBox);
        content.add_child(scroll);

        this._populate();

        // Cancel button (Esc also closes via the ModalDialog default handler).
        this._dialog.addButton({
            label: 'Close',
            action: () => this._dialog?.close(),
            key: Clutter.KEY_Escape,
            default: true,
        });

        this._dialog.setInitialKeyFocus(this._search);
    }

    _populate() {
        this._listBox.destroy_all_children();
        this._cards = [];

        const definitions = this._opts?.listDefinitions?.() ?? [];
        if (definitions.length === 0) {
            const empty = new St.Label({
                text: 'No widget definitions found. Built-in widgets ship with the extension; community widgets live under ~/.local/share/gnomebeautifier/widgets/.',
                style_class: 'gnomebeautifier-widget-picker-empty',
                x_expand: true,
            });
            empty.clutter_text.line_wrap = true;
            this._listBox.add_child(empty);
            return;
        }

        for (const def of definitions) {
            const card = this._buildCard(def);
            this._listBox.add_child(card);
            this._cards.push({ def, actor: card });
        }
    }

    _buildCard(def) {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'gnomebeautifier-widget-picker-card',
            x_expand: true,
            reactive: true,
            track_hover: true,
            can_focus: true,
        });

        const icon = new St.Icon({
            icon_name: this._iconForDefinition(def),
            icon_size: 32,
            style_class: 'gnomebeautifier-widget-picker-card-icon',
        });
        card.add_child(icon);

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'gnomebeautifier-widget-picker-card-text',
        });
        const name = new St.Label({
            text: def.name + (def.builtin ? '' : '  (community)'),
            style_class: 'gnomebeautifier-widget-picker-card-name',
        });
        const desc = new St.Label({
            text: def.description ?? '',
            style_class: 'gnomebeautifier-widget-picker-card-desc',
            x_expand: true,
        });
        desc.clutter_text.line_wrap = true;
        textBox.add_child(name);
        textBox.add_child(desc);
        card.add_child(textBox);

        const addButton = new St.Button({
            label: 'Add',
            style_class: 'gnomebeautifier-widget-picker-card-add',
            can_focus: true,
        });
        addButton.connect('clicked', () => this._activate(def));
        card.add_child(addButton);

        // Click anywhere on the card (not just the button) → activate.
        card.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this._activate(def);
            return Clutter.EVENT_STOP;
        });

        return card;
    }

    _activate(def) {
        try { this._opts?.onAdd?.(def.uuid); }
        catch (e) { logError(e, `GnomeBeautifier: onAdd threw for ${def.uuid}`); }
        this._dialog?.close();
    }

    _activateFirstVisibleCard() {
        for (const { def, actor } of this._cards) {
            if (actor.visible) {
                this._activate(def);
                return;
            }
        }
    }

    _applyFilter(query) {
        const needle = (query ?? '').trim().toLowerCase();
        for (const { def, actor } of this._cards) {
            const hay = `${def.name} ${def.description ?? ''} ${def.uuid}`.toLowerCase();
            actor.visible = needle.length === 0 || hay.includes(needle);
        }
    }

    /**
     * Pick a sensible symbolic icon for a definition. Built-ins get curated
     * icons; community widgets default to a generic placeholder unless the
     * definition supplied one via def.icon (future API extension).
     */
    _iconForDefinition(def) {
        if (def.icon) return def.icon;
        switch (def.uuid) {
            case 'clock':          return 'preferences-system-time-symbolic';
            case 'weather':        return 'weather-few-clouds-symbolic';
            case 'wallpaper-info': return 'preferences-desktop-wallpaper-symbolic';
            case 'system-monitor': return 'utilities-system-monitor-symbolic';
            default:               return 'application-x-addon-symbolic';
        }
    }
}
