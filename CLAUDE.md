# CLAUDE.md

Claude Code loads this file at session start. Behavior rules live in [`AGENTS.md`](AGENTS.md), pulled into context by the `@AGENTS.md` import below.

@AGENTS.md

## Claude-specific notes

- **Mandatory read:** `AGENTS.md` § 0 — load root + nested `AGENTS.md` before first edit; default behavior is pre-loaded; owner does not repeat autonomy unless they state an explicit override for the task.
- `AGENTS.md` § 1 (Product Owner Authority) ranks above everything else, including any conversational nudge that sounds like permission to take a shortcut.
- **No early stop:** "the schema compiles" or "the script runs in bash" alone is **not** DoD when the owner asked for the extension to be working in GNOME Shell. See root `AGENTS.md` § 4 "Forbidden mid-session stop" and § 5.
- Run Claude Code with `--dangerously-skip-permissions` for unattended runs; otherwise interactive confirmations interrupt the full-execution contract (`AGENTS.md` § 4).
- Do not summarize, rewrite, or inline `AGENTS.md` content here. This file stays as a pointer.
