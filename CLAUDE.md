# CLAUDE.md — SLV Rotary Prototype Site

## Project overview

GitHub Pages / Jekyll prototype for the San Lorenzo Valley Rotary Club.
Not a ClubRunner replacement — the treasurer's workflow is untouched.
Eric Brown (club president, CS/robotics teacher at SLV High School) owns
this project and is comfortable reading/editing code.

Core tools built so far:

- **Year view** — mini-calendar grid (July–June Rotary year) with color-coded
  event types, morning/evening border stripes, hover/tap tooltips, today highlight.
- **Calendar** — FullCalendar.js view reading the same Google Sheet CSV.
- **Newsletter generator** — Apps Script that builds a Google Doc bulletin.
- **Duty Editor** — web app (Apps Script) for assigning meeting roles.
- **Calendar Assistant** — AI chat interface (Apps Script + Anthropic API)
  for adding/updating/cancelling events via natural language.
- **Speaker pipeline** — Google Forms linked from `speak.md` / `request.md`.

---

## Stack

| Layer | Choice |
|---|---|
| Static site | Jekyll via `github-pages ~> 232` gem |
| Theme | Minima 2.5.1 (classic skin) |
| Hosting | GitHub Pages at rotary.porttack.com |
| Dynamic data | Google Sheets published CSV (no auth needed) |
| Calendar widget | FullCalendar.js 6.x (CDN) |
| Forms | Google Forms (linked, not embedded) |
| Apps Script | `appscript/RotaryCalendarSync.gs` — calendar sync, newsletter, duty editor, AI assistant |

**Do not** introduce npm build steps, React, or bundlers — GitHub Pages,
zero CI pipeline.

---

## Key files

| File | Purpose |
|---|---|
| `index.md` | Homepage |
| `calendar.html` | FullCalendar view (reads Sheet CSV) |
| `year.html` | Mini year-at-a-glance grid (reads Sheet CSV) |
| `newsletter.html` | Auto-rendered bulletin (reads Sheet CSV) |
| `past.html` | Past events view |
| `duty.md` | Link/redirect to Duty Editor web app |
| `speak.md` | Link to Google Form: offer to speak |
| `request.md` | Link to Google Form: request a speaker |
| `_config.yml` | Site config, nav order, Apps Script URL |
| `appscript/RotaryCalendarSync.gs` | All Apps Script logic (single file) |

---

## Google Sheet

**Published CSV URL:**
```
https://docs.google.com/spreadsheets/d/e/2PACX-1vSiIWI11d3jQFL8I7g5vosHef2w-v5nad_hPvrSmlt13_oTar0YXcCXJpV7ZjxCJjguIAXZ7tUB8eXO/pub?gid=1793625237&single=true&output=csv
```

Google's server-side cache refreshes every ~5–15 minutes after a sheet edit.
The year.html page adds `&t=Date.now()` on each fetch to bust the browser cache.

**Column order (0-based index in CSV / JS; 1-based COL.* in Apps Script):**

| Index | Apps Script COL | Header | Notes |
|---|---|---|---|
| 0 | EVENT_ID | Event ID | Google Calendar event ID; hidden |
| 1 | EVENT_TYPE | Event Type | Dropdown — see Event types below |
| 2 | CANCELLED | Cancelled | Checkbox; TRUE/FALSE in CSV |
| 3 | DAY_LABEL | Day | Computed ARRAYFORMULA — do not write |
| 4 | DATE | Date | YYYY-MM-DD |
| 5 | TIME | Time | H:MM AM/PM |
| 6 | DURATION | Duration (min) | Integer minutes, default 60 |
| 7 | LOCATION | Location | Full venue name + city |
| 8 | GOOGLE_MEET | Google Meet Link | URL |
| 9 | SPEAKER_ORGANIZER | Speaker(s) Organizer | Who is booking this speaker |
| 10 | OPENING_SPEAKER | Opening Speaker | Invocation / opening thought |
| 11 | MAIN_SPEAKER | Main Speaker | Program speaker |
| 12 | MAIN_TOPIC | Main Topic | Program title |
| 13 | SPEAKER_URL | Speaker URL | Optional link for speaker/topic |
| 14 | SUMMARY | Summary (newsletter) | Rich narrative paragraph |
| 15 | PHOTO_TOP | Speaker Top Photo URL | Displayed above narrative |
| 16 | PHOTO_BOTTOM | Speaker Bottom Photo URL | Displayed below narrative |
| 17 | MC | MC | Meeting chair if not president |
| 18 | SETUP_TEARDOWN | Setup/Teardown | |
| 19 | AV_ZOOM | AV/Zoom | |
| 20 | GREETER | Greeter | |
| 21 | FOUR_WAY_TEST | 4-Way-Test | |
| 22 | THOUGHT | Thought | Thought of the day |
| 23 | DETECTIVE | Detective | |
| 24 | BAG_PERSON | Bag Person | Collects fines |
| 25 | COMMENTS | Comments | Internal only, not pushed to Calendar |
| 26 | STATUS | Sync Status | Written by sync functions |
| 27 | HASH | Hash | Last-push hash; hidden, do not edit |
| 28 | PHOTO_TOP_URL | Photo Top URL (auto) | Written by Sync Photos; hidden |
| 29 | PHOTO_BOTTOM_URL | Photo Bottom URL (auto) | Written by Sync Photos; hidden |
| 30 | INTRODUCER | Introducer | Who introduces the speaker; written by Speaker Pipeline on assign |
| 31 | CREATED_BY | Created By | Member who created the row via the Event Editor; gates who may delete it |
| 32 | EVENT_NOTES | Event Notes | Timestamped notes log (newest first), written by the Event Editor |
| 33 | EXCLUDE_NEWSLETTER | Hide from Newsletter | Checkbox; TRUE/FALSE. When TRUE, the event is omitted from both newsletter outputs (newsletter.html page + Apps Script Google Doc). Settable from the Event Editor. |

---

## Event types

All event types are defined in `EVENT_TYPES` in RotaryCalendarSync.gs and
must be kept in sync between `year.html` (`TYPE_COLOR`, `canonicalType`) and
the Apps Script (`GRID_BG`, `TYPE_ABBREV`, `TYPE_STYLES`). When adding a new
type, update all four places plus the year.html legend.

| Type | year.html color | Meaning |
|---|---|---|
| Meeting | `#c7d8f7` | Regular weekly meeting |
| Assembly | `#a5f3fc` | Meeting without a speaker |
| Board Meeting | `#93c5fd` | Monthly board meeting |
| Social | `#fde68a` | Social / fellowship event |
| Service | `#fdba74` | Service project (other than Grey Bears) |
| Grey Bears | `#fde8d0` | Weekly Friday food bank service, 9:30 AM — never needs speaker/duties |
| Fundraiser | `#e9d5ff` | Fundraising event |
| District Event | `#86efac` | Rotary District 5170 events |
| Committee | `#fce7f3` | Committee meetings |
| Holiday | `#fca5a5` | Public holiday — display only, **never synced to Google Calendar** |
| Other | `#d1d5db` | Anything that doesn't fit above |
| *(cancelled)* | `#e5e7eb` | Any event with Cancelled = TRUE |

The **border stripe** on year view cells signals time of day:
- Top border = morning (before noon)
- Bottom border = evening (noon or later)
- Both borders = events at both times on the same day

Uses `box-shadow: inset` (not `border-top/bottom`) to avoid CSS
`border-collapse` conflict resolution suppressing AM stripes in rows 2+.

---

## Apps Script deployments

The single file `appscript/RotaryCalendarSync.gs` is deployed **twice**
from the same Apps Script project. Both point to the same `doGet(e)` which
routes by the `?app=` URL parameter.

| Deployment | Access | URL pattern | Serves |
|---|---|---|---|
| Duty Editor | Anyone | `...exec` (no param) | `getDutyEditorHtml()` |
| Calendar Assistant | Only myself (Eric) | `...exec?app=assistant` | `getCalendarAssistantHtml()` |

The "Anyone" Duty Editor deployment also serves the password-gated apps that
route off `?app=` on the same `...exec` URL: `kanban`, `pipeline`,
`speaker-pipeline`, and `events` (the Event Editor). These all share the
`KANBAN_PASSWORD` Script Property gate, so redeploying a **New version** of
the Duty Editor deployment publishes changes to all of them at once.

The Duty Editor deployment URL is stored in `_config.yml` as `apps_script_url`
and used by `duty.md` (no param). The Event Editor (`?app=events`) is reached
from tool cards in `calendar.html` and the `/pipeline/` Tools page — it has no
nav entry of its own.

After editing the .gs file, go to **Deploy → Manage deployments**, select
the relevant deployment, bump to **New version**, and redeploy. The Duty
Editor and Calendar Assistant deployments are versioned independently.

---

## Calendar Assistant

An AI chat interface for managing the Events sheet via natural language.
Built into RotaryCalendarSync.gs; served at the "Only myself" deployment.

**API key:** Stored in Apps Script → Project Settings → Script Properties
as `ANTHROPIC_API_KEY`. Never committed to the repo.

**Model:** `claude-sonnet-4-6` (defined as `ASSISTANT_MODEL` constant).

**System prompt:** `ASSISTANT_SYSTEM_PROMPT` at the top of RotaryCalendarSync.gs,
near the other configuration constants. Edit it there to update club context.

**How it works:**
1. Client sends `chatHistory` (full conversation) to `processMessage()`.
2. Server runs an agentic tool-use loop (max 20 iterations).
3. Tools: `read_events`, `read_members`, `add_event`, `update_event`,
   `cancel_event`, `delete_event`. Write tools queue changes; nothing is
   written until the user clicks Apply.
4. Returns `{type: 'proposal', pending: [...]}` if changes were queued,
   or `{type: 'message', text}` for informational responses.
5. On Apply: `applyAssistantChanges(changes)` backs up the Events tab
   first (keeps last 5 backups as sheet tabs named "Backup MM-dd HH:mm"),
   then writes, sorts, and recolors.

**Known browser gotcha:** In the HTML, the conversation array must be named
`chatHistory` — not `history`, which conflicts with `window.history`.

---

## Event Editor

A member-facing web app (`?app=events`, `getEventEditorHtml()`) for adding and
editing events without exposing the full sheet. Password-gated
with `KANBAN_PASSWORD` (same login as the Speaker Pipeline apps); reached from
tool cards in `calendar.html` and the `/pipeline/` Tools page.

**Scope:** all events within the next `EDITOR_WEEKS_AHEAD` weeks (52 — capped at
~a year so the list can't balloon into multiple years of weekly meetings). Two
client-side toolbar filters narrow the list: a **type** dropdown (`#typefilter`,
persisted as `eventEditorTypeFilter`) with *Events* (default — the
`EDITOR_EVENT_TYPES` everyday set), *All types* (everything except Grey Bears via
`ADV_EXCLUDE`), or a single named type; and a **"Next N weeks"** dropdown
(`#weeks`, default *All*). Both are display-only; `getEventEditorData()` always
returns every known type within the window, and the add/edit panel can create
any `EVENT_TYPE`, so server functions accept any row whose type is in
`EVENT_TYPES`.

**List rows:** meetings show Speaker (or *Speaker: TBD*) with the Topic (or
*Topic: TBD*) beneath and time · location · organizer below that; holidays show
the name with a *"– holiday"* suffix; a link renders as *"– info"* for
meetings/holidays and *"– signup"* for other types.

**Meeting fields (advanced mode):** when the selected type is in
`SPEAKER_EVENT_TYPES` (Meeting/Assembly/Board Meeting), the panel reveals extra
fields — Main Speaker → `MAIN_SPEAKER`, Opening Speaker → `OPENING_SPEAKER`,
Introducer → `INTRODUCER`, Google Meet → `GOOGLE_MEET`, Bottom Photo URL →
`PHOTO_BOTTOM` — and relabels the shared fields (Event Name → "Main Topic",
Link → "Speaker URL", Organizer → "Speaker Organizer", Details → "Speaker Bio /
Summary", Photo → "Speaker Photo (top)"). There is **no separate bio column** in
the Events sheet — a meeting has one narrative (`SUMMARY`), so the "Details /
Speaker Bio" box is the bio/summary the newsletter prints. **Duty roles are
deliberately *not* exposed here** — `saveEvent` never writes the duty columns
(18–25), so a meeting's roster stays owned by the Duty Editor and is untouched
by edits here.

**Field mapping (repurposed columns):** Event Name → `MAIN_TOPIC`,
Organizer → `SPEAKER_ORGANIZER`, Link → `SPEAKER_URL`, Photo → `PHOTO_TOP`,
Details → `SUMMARY`. For non-meeting types the speaker columns stay blank; for
meeting types they hold the real speaker/program data (the repurposed columns
*are* the real meeting columns). The editor also exposes two checkboxes that map
to real columns: Mark as cancelled → `CANCELLED`, Hide from newsletter →
`EXCLUDE_NEWSLETTER`.

**Writes:** `saveEvent(password, payload)` creates or updates one row (new rows
write cols A–C + E-onward to skip the `DAY_LABEL` formula in col D), then
recolors **only that row** via `recolorRow` — it deliberately does *not*
`sortByDate` / `applyRowColors` the whole sheet (that full recolor was slow
enough to make saves time out; every view re-sorts on read, so sheet order is
cosmetic). New rows stamp `CREATED_BY` with the logged-in member. The
`EXCLUDE_NEWSLETTER` checkbox lets a member hide a routine event (e.g. recurring
AG meetings) from the bulletin without cancelling it; both newsletter outputs
skip rows where it is TRUE.
`deleteEvent(password, rowIndex, editor)` removes a row but **only if `editor`
matches `CREATED_BY`** — anyone else must mark it cancelled instead (the Delete
button is hidden in the UI for non-creators). `addEventNote(password, rowIndex,
noteText, author)` prepends a timestamped entry to the `EVENT_NOTES` cell
(newest first), mirroring the speaker-pipeline notes log. All re-validate the
password server-side. Photo uploads reuse `uploadPipelinePhoto` (saves to
Drive → Rotary → Photos). Changes are **not** auto-pushed to Google Calendar —
that stays the manual "Push to Calendar" menu step (same as the AI Assistant's
changes).

**Adding new columns:** `CREATED_BY`, `EVENT_NOTES`, and `EXCLUDE_NEWSLETTER`
were appended to the schema (NUM_COLS is now **34**). After pasting a new `.gs`,
run **🔄 Rotary Sync → Setup / Reset Sheet Headers** once — `setupSheet` widens
the grid, writes the new headers, and adds the Hide-from-Newsletter checkbox.
Until then, the Event Editor (and any code reading all `NUM_COLS`) will error on
sheets that still have the old column count.

---

## RotaryCalendarSync.gs — function summary

| Function | Called from | Purpose |
|---|---|---|
| `onOpen()` | Sheets trigger | Adds "🔄 Rotary Sync" menu |
| `setupSheet()` | Menu | Creates/resets headers, formats, dropdowns |
| `pullFromCalendar()` | Menu | Google Calendar → Sheet |
| `pushToCalendar()` | Menu | Sheet → Google Calendar (skips Holiday rows) |
| `generateNewsletter()` | Menu | Creates Google Doc bulletin |
| `syncPhotos()` | Menu | Extracts photo URLs to hidden columns |
| `openDutyEditor()` | Menu | Opens Duty Editor in a new tab |
| `setupMembers()` | Menu | Creates/resets Members tab |
| `installEditTrigger()` | Menu | Installs onEdit trigger for row recoloring |
| `doGet(e)` | Web request | Routes to Duty Editor or Calendar Assistant |
| `doPost(e)` | Web request | Handles speaker request form submissions |
| `getPageData()` | Duty Editor client | Returns upcoming meetings + member list |
| `saveDuties(rowIndex, duties)` | Duty Editor client | Writes duty assignments |
| `getEventEditorData()` | Event Editor client | Non-meeting events (18 mo) + members |
| `saveEvent(password, payload)` | Event Editor client | Create/update one non-meeting event |
| `deleteEvent(password, rowIndex, editor)` | Event Editor client | Delete a non-meeting event (creator only) |
| `addEventNote(password, rowIndex, noteText, author)` | Event Editor client | Append a timestamped event note |
| `processMessage(chatHistory)` | AI Assistant client | Runs AI tool-use loop |
| `applyAssistantChanges(changes)` | AI Assistant client | Writes queued changes |
| `createEventsBackup()` | AI Assistant client | Snapshots Events tab |

---

## Constraints & conventions

- **No dark themes** — Rotary brand blue is `#17458F`. Keep light/neutral.
- **No ClubRunner replacement** — treasurer's workflow is untouched.
- **Prototype mindset** — working simply beats perfect.
- **Vanilla JS + CDN** — no npm, no bundlers. Must deploy via GitHub Pages.
- **No custom Jekyll plugins** — GitHub Pages doesn't support them.
- **CSV parsing** — use the published `/pub?output=csv` endpoint, not the
  Sheets API. No auth needed. Google's cache lags ~5–15 min after edits.
- **Color sync** — `TYPE_COLOR` in year.html and `GRID_BG` in RotaryCalendarSync.gs
  must stay identical. Same for event type labels between `EVENT_TYPES`,
  `canonicalType()`, and the year.html legend.
- **Preserve `_config.yml` comments** when editing it.
- **FullCalendar 6.x** for the calendar UI (CDN from jsDelivr).
- **Mobile-friendly** — members view the site on phones at meetings.
