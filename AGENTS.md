# AGENTS.md

Root contract for every coding agent working on **GnomeBeautifier**. **Mandatory:** read this file fully, then the nearest nested `AGENTS.md` (under `src/`, `scripts/`, `prefs/`), before your first edit or command. Vendor pointers (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/gnomebeautifier-autonomy.mdc`) redirect here only.

This file wins over nested rules except subtree narrowing that does not weaken correctness, packaging integrity, GNOME Shell compatibility, or the no-fallback rule. It wins over Cursor user rules and assistant defaults unless the owner **explicitly overrides** for the current task (§ 0).

## 0. Mandatory load & default behavior

**Read gate.** Every session: (1) root `AGENTS.md`; (2) nearest nested `AGENTS.md`; (3) then code/commands/edits. Never act from memory when this contract applies.

**Default behavior is pre-loaded.** Owner messages carry **what** and **acceptance** only — not reminders to be autonomous, read docs, commit, or validate the extension. Overrides for *this task only*: "questions only", "no commits", "skip GNOME audit", "do not push", "plan only".

| Owner provides | Agent assumes |
| --- | --- |
| Feature / bug / refactor | Implement + validate + atomic commits + § 7 report |
| Visual / panel audit | § 5 visual proof on real GNOME Shell (or recorded justification if no display) |
| Ship / create PR | PR workflow; push only when asked |
| *(no behavior wording)* | Full contract — **do not ask owner to restate it** |

**Multiple activities (FIFO):** When the owner lists more than one activity in a message (or across the session backlog), **organize them into a clear todo list**, then execute **First In, First Out** — finish item 1 before starting item 2. Do not reorder, batch-skip, or reprioritize unless the owner **explicitly** changes priority.

**Todo completion (HARD):** Every todo derived from owner requests **must be completed** before verdict `DONE`. Do not leave items `pending` / `in_progress`, silently drop scope, or mark `cancelled` unless the owner explicitly removes that item. If a real blocker stops an item, leave it incomplete, document evidence, and use verdict `PARTIAL` — never `DONE` with open todos.

**Session backlog:** The full conversation is the scope ledger. Any owner request — including follow-ups, corrections, and items raised when the owner says work is incomplete — **must** become a todo and be executed **in the same session**. Forbidden: "not requested this thread", "optional follow-up", "say if you want me to…", re-asking permission.

**Autonomy = finish:** When the owner challenges incomplete work ("are you sure?", "you're still failing"), treat that as **new todos at the front of the queue** — execute, do not re-litigate whether the item was "assigned".

**Mid-task questions:** When the owner asks a question during active work, **answer it** and **keep executing** the FIFO queue in the same session — do not stop, defer, or wait for permission to resume.

## 1. Product Owner Authority

The owner's wording IS the specification — scope and acceptance. Agents own **execution** (how to build, validate, commit, fail-closed cleanup) — not reinterpretation.

- **Literal scope.** No scope-down, no substitute artifacts, no "follow-on" partials. Ask only for destructive ambiguity or user-data ambiguity that fail-closed cannot resolve.
- **No shortcuts.** No deferring sessions, no weakening validation, no stopping because work is large. Time is the agent's problem.
- **No permission bait.** After diagnosis, fix fixable gaps in-session. Do not ask "want me to proceed?" / "say the word".
- **Owner contact (three surfaces only):** **(a)** blocking question; **(b)** incomplete work / failing validation / missing commits / real blocker (`PARTIAL` with evidence); **(c)** DoD achieved (§ 7). No progress checkpoints or optional follow-ups.

Violating § 1 equals violating § 2.

## 2. Hard Rules

Apply in order; fail explicitly at the first broken gate:

1. **No silent fallback.** Missing wallpaper directory, missing GNOME schema, missing network → surface a clear error in the panel indicator and `journalctl`. Never silently substitute an arbitrary image or no-op the feature.
2. **GNOME Shell compatibility first.** Target GNOME 47+ (ESM). Every `import` uses the `gi://` or `resource:///` URI scheme. Every `enable()` allocation has a matching teardown in `disable()`. Every signal connection tracks its `connect()` id and disconnects on disable.
3. **No leaks on disable.** `disable()` must drop indicators, timers (`GLib.source_remove`), Gio.Cancellables, file monitors, Soup sessions, and GSettings signal handlers — verified by enable→disable→enable in a nested Shell or `dbus-run-session`.
4. **User data is sacred.** The extension may read `~/Pictures/Weather-Wallpapers/` and may overwrite `org.gnome.desktop.background` / `org.gnome.desktop.interface accent-color`. It must NEVER delete files outside its own cache (`$XDG_CACHE_HOME/gnomebeautifier/`) and must NEVER run `sudo` from the extension process. Privileged operations belong in the install/setup script (`scripts/setup-wallpapers.sh`), gated by the user invoking it.
5. **No secrets.** No API keys, tokens, or coordinates in code, logs, screenshots, or commits. Open-Meteo requires no key; if a future provider does, store it in GSettings and document the user-controlled flow.
6. **Atomic commits** on delivery: one concern each (`feat(wallpaper): …`, `fix(accent): …`, `chore(packaging): …`).

## 3. Domain Boundaries

| Module | Boundary |
| --- | --- |
| `src/modules/wallpaper.js` | Owns the rotation index, current image lookup, and writes to `org.gnome.desktop.background.picture-uri` / `picture-uri-dark`. No HTTP, no palette work. |
| `src/modules/weather.js` | Owns Open-Meteo HTTP calls (Soup 3), WMO code → bucket mapping, and location resolution. No GSettings writes outside its own scope. |
| `src/modules/accent.js` | Owns image pixel sampling (GdkPixbuf), HSV/hue → accent name mapping, writes to `org.gnome.desktop.interface.accent-color` / `color-scheme`. Reads the path; never decides which image is current. |
| `src/modules/indicator.js` | Owns the `PanelMenu.Button`, its icon, and the popup menu. Wires user intent to the other modules via callbacks — never reaches into their internals. |
| `src/extension.js` | Composition root: constructs modules, passes references, registers GSettings change handlers, owns lifecycle. |
| `scripts/setup-wallpapers.sh` | Privileged one-shot installer. Installs system wallpaper packages, populates `~/Pictures/Weather-Wallpapers/`. Idempotent. Never auto-invoked by the extension. |

**Forbidden:** HTTP inside `accent.js`, GSettings.set from `weather.js` outside its own keys, the indicator directly reading WMO codes, the extension shelling out to `sudo`.

## 4. Work Workflow

1. Read root + nested `AGENTS.md` (§ 0).
2. Inspect code, schema, runtime — do not claim unread files.
3. Classify scope. **Multiple activities:** build an ordered todo list (FIFO — § 0); work one item to completion before the next. **Every todo must reach `completed`** (§ 0) or the session ends `PARTIAL` with evidence.
4. Execute — proposals alone are not delivery when action is safe.
5. Validate (§ 6); fix every reported failure; rerun until pass or real blocker.
6. Self-review request vs diff vs validation; loop until no correctable gap.

**Real blockers only:** (a) no display server available for visual proof and the owner needs it now; (b) destructive action you cannot safely fix; (c) network/credentials unavailable after diagnosis. Pre-existing failures, dirty tree, and out-of-first-edit files are in-scope when they block DoD.

**Forbidden mid-session stop:** A `gnome-extensions pack` that succeeds is not DoD when the owner asked for the feature to actually work in Shell.

## 5. Definition of Done

Propose short DoD (multiple-choice) before large/destructive work if acceptance is unstated; then execute until met.

**Default DoD for any feature change:**

1. `gnome-extensions pack src/ -o dist/ --force` succeeds with no warnings.
2. `gnome-extensions install --force dist/gnomebeautifier@caio.jcalisto.shell-extension.zip` succeeds.
3. Enable in a **nested Shell** (`dbus-run-session -- gnome-shell --nested --wayland`) or note "no display available — owner must verify visually".
4. `journalctl --user -f -o cat /usr/bin/gnome-shell` shows no errors or JS exceptions on enable, on the exercised user action, and on disable.
5. enable → disable → enable cycle with no leaked timers / signal handlers (use `Looking Glass` `Main.panel.statusArea` to confirm clean teardown).

Not DoD: pack alone, lint alone, "schema compiles", "the script runs in bash" without enabling the extension.

## 6. Validation

No "validated" without executed commands. No weakened tests for green.

```bash
# Pack and install
gnome-extensions pack src/ \
  --schema=src/schemas/org.gnome.shell.extensions.gnomebeautifier.gschema.xml \
  --extra-source=modules \
  -o dist/ --force

gnome-extensions install --force \
  dist/gnomebeautifier@caio.jcalisto.shell-extension.zip

# Lint the manifest
python3 -c "import json; json.load(open('src/metadata.json'))"

# Validate the gschema
glib-compile-schemas --strict --dry-run src/schemas/

# Smoke-test in a nested Shell (Wayland host) — owner watches
dbus-run-session -- gnome-shell --nested --wayland &
sleep 3
gnome-extensions enable gnomebeautifier@caio.jcalisto
journalctl --user -f -o cat /usr/bin/gnome-shell
```

If no graphical display is available, document that fact explicitly in § 7 and ask the owner to run the smoke test — do not claim a visual gate passed.

## 7. Final Report

Only after every todo is `completed` or a real blocker forces `PARTIAL`. Order: verdict → **owner request checklist** → files/commits → validation evidence.

**Owner request checklist (required):** Numbered list of **every** activity the owner asked for (same items as the todo list), each with status and proof:

| Status | Meaning |
| --- | --- |
| **DONE** | Delivered + validated (cite command, file, or commit) |
| **PARTIAL** | Real blocker — what was tried, why it cannot finish in-session |
| *(never silent omit)* | If an owner item is missing from the checklist, that is a contract breach |

- **DONE** — all owner items DONE; all gates verified; **zero open todos**.
- **DONE WITH RISKS** — all owner items DONE; uncorrectable non-local risks only (e.g. no display server to verify visuals).
- **PARTIAL / NOT ALIGNED** — one or more owner items incomplete; real blocker with evidence.

Never `DONE` with fixable validation failures, skipped enable/disable cycle, open todos, optional follow-ups you could execute, or a "remaining / NOT DONE" section listing work you did not attempt in-session.

## 8. Project Layout

```
GnomeBeautifier/
├── AGENTS.md, CLAUDE.md, README.md
├── Makefile, install.sh
├── scripts/
│   └── setup-wallpapers.sh        # privileged, one-shot installer
├── src/
│   ├── metadata.json
│   ├── extension.js               # composition root
│   ├── prefs.js                   # Adwaita preferences window
│   ├── stylesheet.css
│   ├── modules/
│   │   ├── wallpaper.js
│   │   ├── weather.js
│   │   ├── accent.js
│   │   └── indicator.js
│   └── schemas/
│       └── org.gnome.shell.extensions.gnomebeautifier.gschema.xml
└── dist/                          # packed .zip (gitignored)
```

## 9. Documentation Discipline

Docs describe current reality only. When changing agent rules, dedupe conflicting instructions. Behavior rules live here + nested `AGENTS.md` — not parallel copies in pointers.

## 10. Tool Loaders

- **Claude Code:** root `CLAUDE.md` → `@AGENTS.md`; nested `CLAUDE.md` per subtree if behavior narrows.
- **Codex CLI:** native `AGENTS.md`; `.codex/config.toml` `project_doc_max_bytes = 65536`.
- **Cursor IDE:** `.cursor/rules/gnomebeautifier-autonomy.mdc` + native `AGENTS.md`. **In-shell delegation uses `cursor-agent`, not `cursor`.**
- **Copilot:** `.github/copilot-instructions.md` (pointer only).

Pointers stay thin; rules stay here.
