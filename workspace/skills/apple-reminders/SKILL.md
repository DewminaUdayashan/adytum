---
name: apple-reminders
description: Manage Apple Reminders via the `remindctl` CLI on macOS (list, add, edit, complete, delete). Supports lists, date filters, and JSON/plain output.
homepage: https://github.com/steipete/remindctl
metadata:
  {
    'requires': { 'bins': ['remindctl'], 'os': ['darwin'] },
    'install':
      [
        {
          'id': 'brew',
          'kind': 'brew',
          'formula': 'steipete/tap/remindctl',
          'bins': ['remindctl'],
          'label': 'Install remindctl via Homebrew',
        },
      ],
  }
---

# Apple Reminders CLI (remindctl)

Use `remindctl` to manage Apple Reminders directly from the terminal. It supports list filtering, date-based views, and scripting output.

Setup

- Install (Homebrew): `brew install steipete/tap/remindctl`
- From source: `pnpm install && pnpm build` (binary at `./bin/remindctl`)
- macOS-only; grant Reminders permission when prompted.

Permissions

- Check status: `remindctl status`
- Request access: `remindctl authorize`

View Reminders

- Default (today): `remindctl`
- Today: `remindctl today`
- Tomorrow: `remindctl tomorrow`
- Week: `remindctl week`
- Overdue: `remindctl overdue`
- Upcoming: `remindctl upcoming`
- Completed: `remindctl completed`
- All: `remindctl all`
- Specific date: `remindctl 2026-01-04`

Manage Lists

- List all lists: `remindctl list`
- Show list: `remindctl list Work`
- Create list: `remindctl list Projects --create`
- Rename list: `remindctl list Work --rename Office`
- Delete list: `remindctl list Work --delete`

Create Reminders

- Quick add: `remindctl add "Buy milk"`
- With list + due: `remindctl add --title "Call mom" --list Personal --due tomorrow`

Edit Reminders

- Edit title/due: `remindctl edit 1 --title "New title" --due 2026-01-04`

Complete Reminders

- Complete by id: `remindctl complete 1 2 3`

Delete Reminders

- Delete by id: `remindctl delete 4A83 --force`

Output Formats

- JSON (scripting): `remindctl today --json`
- Plain TSV: `remindctl today --plain`
- Counts only: `remindctl today --quiet`

Date Formats
Accepted by `--due` and date filters:

- `today`, `tomorrow`, `yesterday`
- `YYYY-MM-DD`
- `YYYY-MM-DDTHH:mm` (recommended; include the `T`)
- ISO 8601 with timezone (`2026-01-04T12:34:56-05:00`)
- Natural phrases like `tomorrow 3pm`

Notes

Potential Fixes if encountered time format issues.

Try these variations to see which one your specific version of remindctl prefers:

- Option 1: Use a space instead of 'T' Many CLI parsers prefer a space between the date and time. remindctl add "Title" --due "2026-02-12 15:30"
- Option 2: Use quotes with a simplified format If the tool assumes your local system time, you can drop the offset: remindctl add "Title" --due "2026-02-12 15:30:00"
- Option 3: Use the "Slash" format Some older utilities look for YYYY/MM/DD: remindctl add "Title" --due "2026/02/12 15:30"
