# Rotary Calendar Sync — Google Apps Script

A Google Apps Script that provides two-way sync between a Google Sheet and Google Calendar, plus a one-click newsletter generator for SLV Rotary. Designed and developed iteratively via AI-assisted conversation — see [the full design chat](https://claude.ai/chat/48e7cd96-55d6-4995-84cd-6fdf64b53183) for context on every decision made along the way.

---

## What It Does

- **Pull** — imports upcoming Google Calendar events into the Sheet, parsing structured fields (speaker, topic, roles, etc.) from the event description
- **Push** — writes Sheet rows back to Google Calendar, creating or updating events; skips rows that haven't changed since the last push using a hash-based change detection system
- **Generate Newsletter** — produces a formatted Google Doc with upcoming meeting details, a skim list of the next 12 weeks, recent meeting recaps, and a 4-month calendar grid

---

## File Location

```
appscript/
└── RotaryCalendarSync.gs
```

---

## One-Time Setup

1. Create a new **Google Sheet**
2. Go to **Extensions > Apps Script**
3. Delete any existing code and paste the entire contents of `RotaryCalendarSync.gs`
4. Save the script (`Ctrl+S` / `Cmd+S`)
5. Close the Apps Script tab and **reload the Sheet**
6. A **🔄 Rotary Sync** menu will appear in the menu bar
7. Click **Rotary Sync > 📋 Setup / Reset Sheet Headers** — this creates the formatted header row, dropdowns, checkboxes, and the Day formula
8. Click **Rotary Sync > ⚡ Install Edit Trigger (run once)** — this installs an installable onEdit trigger so row colors update live as you type
9. Set your **Calendar ID** at line 7 of the script:
   ```javascript
   const CALENDAR_ID = "your-calendar-id@group.calendar.google.com";
   ```
   Find your Calendar ID in Google Calendar under **Settings > [your calendar] > Integrate calendar**

> **Note on permissions:** When you first run any function, Google will warn that the app is unverified. Since you are the developer, click **Advanced > Go to [project] (unsafe)** and approve. This is normal for personal scripts.

---

## Configuration Constants

At the top of the script, several constants control behavior:

| Constant | Default | Description |
|---|---|---|
| `CALENDAR_ID` | `"primary"` | Google Calendar ID to sync with |
| `PULL_DAYS_AHEAD` | `180` | How many days ahead to pull from Calendar |
| `SHEET_NAME` | `"Events"` | Name of the Sheet tab |
| `NEWSLETTER_DETAIL_COUNT` | `3` | Number of upcoming meetings shown with full detail |
| `NEWSLETTER_WEEKS_AHEAD` | `12` | Lookahead window for the newsletter skim list |
| `CLUB_NAME` | `"SLV Rotary"` | Used in newsletter titles and Calendar event prefixes |

---

## Column Reference

The sheet has 26 columns (A–Z). Columns A and Z are hidden — they are used internally by the script.

| Col | Name | Notes |
|---|---|---|
| A | Event ID | Google Calendar event ID. **Do not edit.** Hidden. |
| B | Event Type | Dropdown: Meeting, Board Meeting, Social, Service, Committee, Other |
| C | Cancelled | Checkbox. If checked, prefixes the Calendar title with `Cancelled -` and greys out the row |
| D | Day | **Read-only formula.** Shows `Tue, Sep W3` (day of week, month, week-of-month occurrence) for Meeting types. Color-coded by month: teal = odd months, indigo = even months |
| E | Date | Date in `yyyy-mm-dd` format |
| F | Time | Start time |
| G | Duration (min) | Event length in minutes. Defaults to 60 |
| H | Location | Venue name and/or address, e.g. `Scopazzi's, Boulder Creek, CA` |
| I | Google Meet Link | Full `https://meet.google.com/...` URL |
| J | Opening Speaker | Invocation / thought for the day presenter |
| K | Main Speaker | Primary program speaker |
| L | Main Topic | Speaker's topic or program title |
| M | Description | Short notes or event description |
| N | Summary | Rich narrative paragraph for the newsletter "Coming Up" section |
| O | Photo | URL to a photo for the newsletter. Must be a publicly accessible `https://` URL |
| P | MC | Meeting MC, when it is not the president |
| Q | Setup/Teardown | Role assignment |
| R | AV/Zoom | Role assignment |
| S | Greeter | Role assignment |
| T | 4-Way-Test | Role assignment |
| U | Thought | Role assignment |
| V | Detective | Role assignment |
| W | Bag Person | Role assignment |
| X | Comments | Internal notes. **Never pushed to Calendar.** |
| Y | Sync Status | Set automatically after each Push or Pull — shows result and timestamp |
| Z | Hash | Fingerprint of last-pushed fields. Used to skip unchanged rows. **Do not edit.** Hidden. |

### Row Color Coding

Rows are color-coded by Event Type for quick scanning:

| Type | Text Color |
|---|---|
| Meeting | **Bold blue** |
| Board Meeting | **Bold purple** |
| Social | Green |
| Service | Orange |
| Committee / Other | Black |
| Cancelled (any type) | Grey background, dimmed text |

---

## Push — Sheet → Calendar

**Rotary Sync > ⬆️ Push Sheet → Calendar**

- Skips rows with no date
- Computes a hash of all 19 calendar-relevant fields; if the hash matches the stored value in column Z, the row is **skipped entirely** (no API call)
- Creates new Calendar events for rows with no Event ID
- Updates existing events when content has changed
- Pauses 500ms every 5 API calls to avoid Google's rate limit
- Stores the new hash and timestamps the Status column after each successful operation
- Builds the Calendar event **title** as: `SLV Rotary [Type] - [Speaker]: [Topic]`
- Builds the Calendar event **description** as a structured block that Pull can parse back:

```
Type: Meeting
Opening Speaker: Jane Smith
Main Speaker: Bob Jones
Main Topic: Water Conservation
Meet: https://meet.google.com/xxx

Free-form description text here

MC: Dave Brown
Setup/Teardown: Alice Green
AV/Zoom: Tom White
Greeter: Mary Blue
4-Way-Test: Frank Red
Thought: Susan Gold
Detective: Phil Gray
Bag Person: Carol Pink
```

---

## Pull — Calendar → Sheet

**Rotary Sync > ⬇️ Pull from Calendar → Sheet**

- Fetches all events from today through `PULL_DAYS_AHEAD` days ahead
- Matches events to existing rows by Event ID (column A) — updates in place if found, appends if new
- Parses tagged lines (`Main Speaker:`, `MC:`, etc.) from the Calendar description back into their individual columns
- Strips tagged lines to populate the Description column with only free-form text
- Detects `Cancelled -` prefix in event title and checks the Cancelled checkbox
- Sorts rows by date after pulling
- **Never overwrites** the Comments column (X) — that is user-managed only
- **Never overwrites** the Day formula column (D)

---

## Newsletter Generator

**Rotary Sync > 📰 Generate Newsletter Doc**

Creates a new Google Doc in your **Rotary** folder in Google Drive (created automatically if it doesn't exist), named `yyyy-MM-dd SLV Rotary Newsletter`.

### Structure

1. **Masthead** — Club name and date
2. **Coming Up** — Full detail block for the next 2–3 upcoming meetings/board meetings that have a Main Speaker or Main Topic. Each block includes:
   - Date, time, location
   - Inline photo at 300px wide (fetched from the Photo URL)
   - Opening speaker, narrative summary, Google Meet link
   - Full duty roster (filled roles listed, unfilled roles grouped as TBD)
3. **Looking Ahead** — One-line entry for every event in the next 12 weeks, grouped by month. Each line includes abbreviated time (`7a`, `5:30p`), event type, speaker/topic (or TBD for meetings), and venue name as a clickable Google Maps link
4. **Recent Meetings** — Up to 3 past meetings/board meetings that have a Summary or Description, with photo if available
5. **Calendar Grid** — 4-month Sun–Sat grid with event days highlighted by type:

| Grid color | Type |
|---|---|
| Blue tint | Meeting |
| Purple tint | Board Meeting |
| Green tint | Social |
| Orange tint | Service |
| Grey tint | Committee / Other |
| Grey + ❌ | Cancelled |

Each highlighted cell shows the abbreviated type (`Mtg`, `Brd`, `Soc`, `Svc`, `Com`) and start time. Multiple events on the same day each get their own line in the cell.

After generation, a dialog shows a clickable link to the new Doc.

---

## Known Limitations & Gotchas

### Column D (Day) Formula
Column D uses a single `ARRAYFORMULA` covering the whole column. **Do not paste or type anything into column D** — it will overwrite the formula. If the formula is accidentally deleted, run **Setup / Reset Sheet Headers** to restore it.

### Timezone and Date Entry
Google Sheets can shift dates entered as text by one day due to UTC vs. local timezone differences. Always use the **date picker** (click the cell, then the calendar icon) rather than typing dates manually, or ensure the column has the `yyyy-mm-dd` number format applied (Setup does this automatically).

### Google Calendar Rate Limits
Google limits how many Calendar events can be created or updated in a short period. The script pauses 500ms every 5 operations. If you still hit rate limit errors, wait a few minutes and push again — the hash system means only the failed rows will be retried.

### Photo URLs
The newsletter photo embed only works with publicly accessible `https://` image URLs. Images uploaded directly to the Sheet cell are not supported by the Google Docs API. If a photo URL fails to load, the script falls back to showing the URL as plain text.

### Apps Script Installable Trigger
The live row-coloring on edit requires an **installable trigger** (not just the built-in `onEdit`). Run **Rotary Sync > ⚡ Install Edit Trigger** once after setup. If you copy the Sheet or script to a new file, you'll need to run it again.

### Newsletter — Meetings Without Speaker/Topic
Meetings with neither a Main Speaker nor a Main Topic are excluded from the **Coming Up** detail section but still appear in **Looking Ahead** as `TBD`.

---

## Design & Development

This script was designed and built iteratively through a conversation with Claude (Anthropic). The full chat — including all design decisions, column additions, bug fixes, and feature iterations — is available here:

👉 [https://claude.ai/chat/48e7cd96-55d6-4995-84cd-6fdf64b53183](https://claude.ai/chat/48e7cd96-55d6-4995-84cd-6fdf64b53183)

---

## Possible Future Enhancements

- **clasp integration** — use Google's [clasp CLI](https://github.com/google/clasp) to push/pull the script directly from this repo to Apps Script, eliminating manual copy-paste
- **Member roster sheet** — a second tab for member birthdays, anniversaries, and contact info that feeds into the newsletter
- **Automatic newsletter trigger** — run the newsletter generator on a schedule (e.g. every Monday morning) using a time-based Apps Script trigger
- **GitHub Pages integration** — the planned website could read the Calendar directly via the Google Calendar API and render a public-facing club calendar without needing the Sheet