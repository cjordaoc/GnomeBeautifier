// Built-in widget: System Monitor.
// CPU usage from /proc/stat (delta of the first line each tick).
// RAM usage from /proc/meminfo (MemTotal, MemAvailable).
// No external deps; reads sync (the files are kernel-virtual and tiny).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import { WidgetBase } from '../widget-base.js';

function readFirstLine(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [ok, contents] = file.load_contents(null);
        if (!ok) return null;
        const text = new TextDecoder('utf-8').decode(contents);
        return text;
    } catch (_e) {
        return null;
    }
}

function readCpuTotals() {
    const text = readFirstLine('/proc/stat');
    if (!text) return null;
    const firstLine = text.split('\n', 1)[0];
    const parts = firstLine.trim().split(/\s+/);
    if (parts[0] !== 'cpu' || parts.length < 5) return null;
    const nums = parts.slice(1).map(Number);
    const idle = nums[3] + (nums[4] ?? 0);
    const total = nums.reduce((a, b) => a + b, 0);
    return { idle, total };
}

function readMemory() {
    const text = readFirstLine('/proc/meminfo');
    if (!text) return null;
    const map = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)/);
        if (m) map[m[1]] = Number(m[2]);
    }
    const total = map.MemTotal ?? 0;
    const available = map.MemAvailable ?? map.MemFree ?? 0;
    if (total === 0) return null;
    return { total, available, used: total - available };
}

const HISTORY_LEN = 30;

export default class SystemMonitorWidget extends WidgetBase {
    get displayName() { return 'System'; }
    get tickIntervalSeconds() { return 2; }

    defaultSize() { return { width: 240, height: 140 }; }

    onMount() {
        this._cpuHistory = new Array(HISTORY_LEN).fill(0);
        this._prevCpu = null;

        const cpuRow = new St.BoxLayout({ x_expand: true, style_class: 'gnomebeautifier-widget-sys-row' });
        const cpuLeft = new St.Label({ text: 'CPU', style_class: 'gnomebeautifier-widget-sys-label' });
        this._cpuPct = new St.Label({ text: '–', x_expand: true, style_class: 'gnomebeautifier-widget-sys-value' });
        cpuRow.add_child(cpuLeft);
        cpuRow.add_child(this._cpuPct);
        this.body.add_child(cpuRow);

        // Tiny sparkline: a row of HISTORY_LEN narrow bars.
        this._sparkRow = new St.BoxLayout({
            style_class: 'gnomebeautifier-widget-sys-spark',
            x_expand: true, y_expand: false,
        });
        this._sparkBars = [];
        for (let i = 0; i < HISTORY_LEN; i++) {
            const bar = new St.Bin({
                style_class: 'gnomebeautifier-widget-sys-bar',
                width: 6, height: 1,
                y_align: 2,  // BOTTOM
            });
            this._sparkBars.push(bar);
            this._sparkRow.add_child(bar);
        }
        this.body.add_child(this._sparkRow);

        const memRow = new St.BoxLayout({ x_expand: true, style_class: 'gnomebeautifier-widget-sys-row' });
        const memLeft = new St.Label({ text: 'RAM', style_class: 'gnomebeautifier-widget-sys-label' });
        this._memPct = new St.Label({ text: '–', x_expand: true, style_class: 'gnomebeautifier-widget-sys-value' });
        memRow.add_child(memLeft);
        memRow.add_child(this._memPct);
        this.body.add_child(memRow);
    }

    onTick() {
        const cpu = readCpuTotals();
        if (cpu && this._prevCpu) {
            const idleDelta = cpu.idle - this._prevCpu.idle;
            const totalDelta = cpu.total - this._prevCpu.total;
            const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) : 0;
            const pct = Math.max(0, Math.min(1, usage));
            this._cpuPct.text = `${(pct * 100).toFixed(0)}%`;
            this._cpuHistory.shift();
            this._cpuHistory.push(pct);
            this._redrawSpark();
        } else if (cpu) {
            this._cpuPct.text = '…';
        }
        this._prevCpu = cpu;

        const mem = readMemory();
        if (mem) {
            const pct = mem.used / mem.total;
            const usedGiB = mem.used / (1024 * 1024);
            const totalGiB = mem.total / (1024 * 1024);
            this._memPct.text = `${(pct * 100).toFixed(0)}%   ${usedGiB.toFixed(1)} / ${totalGiB.toFixed(1)} GiB`;
        } else {
            this._memPct.text = '–';
        }
    }

    _redrawSpark() {
        // Map each history value (0..1) to a bar height in pixels.
        const maxHeight = 28;
        for (let i = 0; i < HISTORY_LEN; i++) {
            const h = Math.max(1, Math.round(this._cpuHistory[i] * maxHeight));
            const bar = this._sparkBars[i];
            bar.height = h;
        }
    }

    onUnmount() {
        this._cpuHistory = null;
        this._prevCpu = null;
        this._cpuPct = null;
        this._memPct = null;
        this._sparkRow = null;
        this._sparkBars = null;
    }
}
