# CLAUDE.md — SLV Rotary Prototype Site

> **What this file is:** Claude Code reads this file automatically at the
> start of every session in this repo and treats it as instructions that
> override default behavior — not just background reading for human
> contributors. Keeping it accurate matters more than usual: stale or wrong
> information here doesn't just mislead a reader, it actively misleads
> Claude into wrong assumptions in future sessions. Edit it deliberately, and
> keep it in sync with the code it describes (see
> [APPSCRIPT.md](APPSCRIPT.md) for the same principle applied to the Apps
> Script side).

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
- **Duty Editor** — web app (Apps Script) for assigning duty roles at
  Meetings, Assemblies, and Socials.
- **Calendar Assistant** — AI chat interface (Apps Script + Anthropic API)
  for adding/updating/cancelling events via natural language.
- **Speaker pipeline** — in-page forms (`speak.md` / `request.md`, POSTing
  directly to the Apps Script backend, not Google Forms) feeding a Kanban
  board / sortable table for tracking speakers from offer through scheduling.

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
| `event.html` | Shareable, no-login single-event detail page (reads Sheet CSV) |
| `roster.html` | Printable duty sign-up sheet, next 4/8/12 weeks (reads Sheet CSV) |
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
| 34 | IMPORTANT | Important | Checkbox; TRUE/FALSE. When TRUE, the item is featured in the newsletter's top **Important** section (both outputs). Works on any type; for `Message` rows it routes the message to Important instead of Announcements. Settable from the Event Editor. |

NUM_COLS is now **35**. After pasting a new `.gs`, run **🔄 Rotary Sync →
Setup / Reset Sheet Headers** once so `setupSheet` widens the grid, writes the
`Important` header, and adds its checkbox.

---

## Event types

All event types are defined in `EVENT_TYPES` in RotaryCalendarSync.gs and
must be kept in sync between `year.html` (`TYPE_COLOR`, `canonicalType`) and
the Apps Script (`GRID_BG`, `TYPE_ABBREV`, `TYPE_STYLES`). When adding a new
type, update all four places plus the year.html legend.

`Message` is the exception: it is newsletter-only, so it is **not** drawn on the
year/calendar grids (both views skip it) and is not in the grid color maps or
the year.html legend — only `EVENT_TYPES`, `TYPE_STYLES`, and the Event Editor's
`TYPE_COLOR` chip map carry it.

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
| Message | `#fed7aa` | Dateless newsletter announcement (e.g. dues reminder). DATE is a "show until" date; **newsletter-only** — never synced to Calendar nor shown on the year/calendar grids. Goes to the newsletter's Announcements section, or the Important section when IMPORTANT = TRUE. |
| Other | `#d1d5db` | Anything that doesn't fit above |
| *(cancelled)* | `#e5e7eb` | Any event with Cancelled = TRUE |

The **border stripe** on year view cells signals time of day:
- Top border = morning (before noon)
- Bottom border = evening (noon or later)
- Both borders = events at both times on the same day

Uses `box-shadow: inset` (not `border-top/bottom`) to avoid CSS
`border-collapse` conflict resolution suppressing AM stripes in rows 2+.

---

## Event Detail Page

`event.html` (`/event/`) is a shareable, no-login page for a single event —
"tell someone about this specific thing" without handing them an Apps Script
URL or asking them to hunt through the calendar. Reads the same published CSV
as `year.html`/`calendar.html`/`newsletter.html` via
`assets/js/rotary-common.js`, client-side, no auth.

**Identity / URL scheme:** `/event/?date=YYYY-MM-DD&type=<Event Type>&time=<Time>`
(`eventDetailUrl(row)` in `rotary-common.js` builds this). Deliberately **not**
keyed by the hidden `Event ID` column — that's the Google Calendar sync ID,
absent on any row that hasn't been pushed yet, and permanently absent on
Holiday/Message rows (never pushed). Date + Event Type is usually unique on
its own; `time` is included whenever the caller has it and only used to
break a tie. Because it's just row content, the link stays valid even after a
sheet re-sort (unlike a row-index-based link would).

**Renders (only when present in the data):** type badge + cancelled badge,
title (meetings: `Speaker: Topic`; other types: Main Topic; falls back to the
event type), date/time (Messages show their "show until" date instead),
location with **separate Google Maps and Apple Maps buttons** (`mapUrls()` in
`rotary-common.js` — two links rather than one "smart" link, since there's no
reliable way to detect which map app a visitor prefers from a plain `<a>`),
Organizer/Introducer/Opening Speaker ("who's involved"), narrative
(`textToHtml`), top/bottom photos, a Google Meet join button, the
info/signup link, and a duty-roster table showing **only the roles that are
actually filled in** (no TBD clutter — this is a public link, not the
internal roster view). A "Copy Link" button copies `window.location.href`.

**Linked from:** `year.html` tooltips ("View details →" per event; the
tooltip's `#year-tip` is `pointer-events:none` while hover-following but gets
a `.pinned` class with `pointer-events:auto` when tapped/clicked open, so the
link is actually clickable on the pinned state), `calendar.html` (every
FullCalendar event's `url` now points here — clicking an event opens the
detail page instead of jumping straight to a Meet/speaker link; the detail
page itself surfaces that link), and `newsletter.html` (a "Details" link in
the Coming Up / Club Events meta line and the Looking Ahead skim list).
`renderMeetingEntry()` in `rotary-common.js` also gained a "Details →" link,
which flows through to both `newsletter.html`'s Recent Meetings section and
`past.html` for free since they share that renderer.

---

## Duty Roster (Printable Sign-Up Sheet)

`roster.html` (`/roster/`) is a plain static page — same pattern as
`event.html` — for printing a paper duty sign-up sheet to pass around on a
clipboard before the meeting before this one. It reads the same published CSV
via `assets/js/rotary-common.js`, client-side, no auth, and needs no Apps
Script deployment: unlike the Duty Editor or Event Editor, it never writes
anything, and the duty columns (MC, Setup/Teardown, AV/Zoom, Greeter,
4-Way-Test, Thought, Detective, Bag Person) are already exposed in the CSV —
`event.html`'s own duty-roster table reads them the same way — so there was
no need to add an Apps Script route for a read-only view.

**Scope:** `ROSTER_EVENT_TYPES` (`Meeting`, `Assembly`, `Social` — kept in
sync with `DUTY_ROSTER_TYPES` in the Apps Script; Board Meetings are
deliberately excluded from both), not cancelled, within a chosen window from
today. A `<select>` toggles **Next 4 / 8 / 12 weeks**, persisted to
`localStorage` (`rosterWeeks`).

**Layout:** one block per meeting, its date line prefixed with the event
type (e.g. "Assembly — Thu, March 5") since the list now mixes types, plus
time, location, and `Speaker: Topic` if set. Below that, a 3-column table —
Duty | Currently Assigned | a blank cell to sign up or cross out and write a
new name (no underline — the table's own borders mark where to write). A
blank "Currently Assigned" cell just stays blank, **except** MC, which shows
*President* in italics as a hint when nobody else is assigned (a literal
placeholder — the Officers tab isn't published as CSV for this page to read
the real name). Nothing here writes back to the sheet — changes made on
paper still need to be typed into the Duty Editor afterward.

**Print styling:** a **Print** button triggers the browser print dialog;
`@media print` hides the controls/nav *and* the site's own header/footer/page
title, and overrides Minima's `.wrapper` max-width so the sheet uses the
full page width instead of the ~800px reading column — this is a paper form,
not an article. `@page{margin:0.5in}` and `page-break-inside:avoid` on each
meeting block keep a block from splitting mid-table across a page break.

**Linked from:** tool cards on `calendar.html` and the `/pipeline/` Tools
page (next to the Agenda Generator card, since both get printed before a
meeting), and a plain text link near the top of the Duty Editor
(`getDutyEditorHtml()` in the Apps Script) using the absolute
`https://rotary.porttack.com/roster/` URL with `target="_blank"` — a
same-deployment link like `?app=agenda` would need the `__EXEC_URL__`
injection (see Apps Script deployments below) since Apps Script serves pages
inside a sandboxed iframe where relative links don't resolve, but a full
external URL needs no such injection and opens in a new tab regardless. That
link is staged in source only — it won't appear on the live page until the
Duty Editor deployment is next redeployed.

---

## Apps Script deployments

The single file `appscript/RotaryCalendarSync.gs` is deployed **twice**
from the same Apps Script project. Both point to the same `doGet(e)` which
routes by the `?app=` URL parameter.

For the full architecture (system diagram, every `?app=` route, the complete
`google.script.run` RPC surface, and — importantly — how auth actually works
across the two deployments), see [APPSCRIPT.md](APPSCRIPT.md).

| Deployment | Access | URL pattern | Serves |
|---|---|---|---|
| Duty Editor | Anyone | `...exec` (no param) | `getDutyEditorHtml()` |
| Calendar Assistant | Only myself (Eric) | `...exec?app=assistant` | `getCalendarAssistantHtml()` |

The "Anyone" Duty Editor deployment also serves the password-gated apps that
route off `?app=` on the same `...exec` URL: `kanban`, `pipeline`,
`speaker-pipeline`, `events` (the Event Editor), `book` (Book a Speaker),
`move` (Move a Speaker), and `edit` (Edit a Speaker). These all share the
`KANBAN_PASSWORD` Script Property gate, so redeploying a **New version** of
the Duty Editor deployment publishes changes to all of them at once. `agenda`
(the Meeting Agenda Generator) also routes off this deployment but is **not**
password-gated — it's read-only, so no login is needed.

The Duty Editor deployment URL is stored in `_config.yml` as `apps_script_url`
and used by `duty.md` (no param). The Event Editor (`?app=events`), Agenda
Generator (`?app=agenda`), Book a Speaker (`?app=book`), Move a Speaker
(`?app=move`), and Edit a Speaker (`?app=edit`) are reached from tool cards in
`calendar.html` and the `/pipeline/` Tools page — none has a nav entry of its
own.

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
the name with a *"– holiday"* suffix; messages show the headline with a
*"– message"* suffix and a *"through <show-until date>"* meta line; a link
renders as *"– info"* for meetings/holidays/messages and *"– signup"* for other
types. Items flagged Important are prefixed with a ★.

**Message type:** picking `Message` relabels Date → "Show Until", Event Name →
"Headline", Details → "Message text", and hides the Time and Location fields
(`time-fld` / `loc-fld`) — a message is a dateless announcement, so its DATE is
the date after which it disappears from the newsletter.

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
*are* the real meeting columns). The editor also exposes three checkboxes that
map to real columns: Important → `IMPORTANT`, Mark as cancelled → `CANCELLED`,
Hide from newsletter → `EXCLUDE_NEWSLETTER`.

**Writes:** `saveEvent(password, payload)` creates or updates one row (new rows
write cols A–C + E-onward to skip the `DAY_LABEL` formula in col D), then
recolors **only that row** via `recolorRow` — it deliberately does *not*
`sortByDate` / `applyRowColors` the whole sheet (that full recolor was slow
enough to make saves time out; every view re-sorts on read, so sheet order is
cosmetic). New rows stamp `CREATED_BY` with the logged-in member. The
`EXCLUDE_NEWSLETTER` checkbox lets a member hide a routine event (e.g. recurring
AG meetings) from the bulletin without cancelling it; both newsletter outputs
skip rows where it is TRUE. The `IMPORTANT` checkbox features the item in the
newsletter's top **Important** section (both outputs); important events also stay
in their normal section, while important messages move from Announcements to
Important.
`deleteEvent(password, rowIndex, editor)` removes a row but **only if `editor`
matches `CREATED_BY`** — anyone else must mark it cancelled instead (the Delete
button is hidden in the UI for non-creators). `addEventNote(password, rowIndex,
noteText, author)` prepends a timestamped entry to the `EVENT_NOTES` cell
(newest first), mirroring the speaker-pipeline notes log. All re-validate the
password server-side. Photo uploads reuse `uploadPipelinePhoto` (saves to
Drive → Rotary → Photos). Changes are **not** auto-pushed to Google Calendar —
that stays the manual "Push to Calendar" menu step (same as the AI Assistant's
changes).

**Adding new columns:** `CREATED_BY`, `EVENT_NOTES`, `EXCLUDE_NEWSLETTER`, and
`IMPORTANT` were appended to the schema (NUM_COLS is now **35**). After pasting a
new `.gs`, run **🔄 Rotary Sync → Setup / Reset Sheet Headers** once —
`setupSheet` widens the grid, writes the new headers, and adds the
Hide-from-Newsletter and Important checkboxes. Until then, the Event Editor (and
any code reading all `NUM_COLS`) will error on sheets that still have the old
column count.

---

## Book / Move / Edit Speaker

Three focused, password-gated (`KANBAN_PASSWORD`) tools for the everyday
speaker-booking workflow, deliberately separate from the full Event Editor and
from the multi-stage Speaker Pipeline (new → in-progress → limbo → scheduled →
done). Anyone with the shared login can use them — there's no additional
role check beyond that. Edit a Speaker in particular exists to keep the
day-to-day fix-up-a-speaker task simple (a small, single-purpose form) rather
than routing less tech-comfortable officers through the full Event Editor.

**Book a Speaker** (`?app=book`, `getBookSpeakerHtml()` /
`bookSpeaker(password, eventsRow, speaker, editor)`) lets a member enter a
brand-new speaker — name, topic, opening speaker, organizer, introducer,
speaker URL, Google Meet link, a separate Bio and Summary (matching the
Speaker Pipeline's own distinction: Bio is about the speaker, Summary is the
newsletter-ready program blurb — same labels as `request.md`'s form), and
top/bottom photo uploads (via the existing `uploadPipelinePhoto`) — and assign
them straight onto an upcoming Meeting in one submit. The Events sheet has
only one narrative column, so the Events row gets Summary, falling back to
Bio if blank (mirrors `assignSpeakerToEvent`'s `summary || bio`); the created
pipeline card keeps both separately. The meeting picker
(`getUpcomingEventsForPicker()`, shared with the Speaker Pipeline's own assign
flow) lists **every** upcoming Meeting, flagging ones that already have a
speaker; picking a taken one asks
for confirmation before overwriting. On submit, `bookSpeaker` writes the
speaker/program columns directly onto the Events row, stamps `STATUS`,
prepends an `EVENT_NOTES` entry ("Booked <name> — <topic>"), **and** appends a
matching Speaker Pipeline card (`status: 'scheduled'`, `EVENTS_ROW` linked)
so the pipeline board keeps a complete history even for speakers booked here
rather than walked through the pipeline's stages.

**Move a Speaker** (`?app=move`, `getMoveSpeakerHtml()` /
`moveSpeaker(password, fromRow, toRow, editor)`) reassigns an already-booked
speaker from one Meeting to another — picking a From meeting (any with a
speaker) and a To meeting (any Meeting; taken ones flagged + confirmed).
`SPEAKER_MOVE_COLS` defines exactly what travels with the speaker:
`SPEAKER_ORGANIZER`, `OPENING_SPEAKER`, `MAIN_SPEAKER`, `MAIN_TOPIC`,
`SPEAKER_URL`, `SUMMARY`, `PHOTO_TOP`/`PHOTO_BOTTOM` (+ their hidden `_URL`
companions), and `INTRODUCER` — copied onto the target row, then cleared on
the source row. **Deliberately excluded:** `GOOGLE_MEET`, the duty columns,
and date/time/location, since those belong to the meeting slot, not the
traveling speaker. Both rows get an `EVENT_NOTES` entry logging the move, and
if a Speaker Pipeline card's `EVENTS_ROW` pointed at the vacated row, it's
repointed to the new one (with its own note appended).

**Edit a Speaker** (`?app=edit`, `getEditSpeakerHtml()`) fixes up the details
of a speaker already booked onto a Meeting — the same field set as Book a
Speaker (no Priority — that field only matters on the Speaker Pipeline board
itself, not this quick fix-up form), prefilled from that meeting via
`getSpeakerEditDetail(rowIndex)`. Because Bio/Email/Phone/City live only on a
Speaker Pipeline card (not the Events sheet), `getSpeakerEditDetail` looks up
a linked card via `findLinkedPipelineRow_(eventsRow, expectedSpeakerName)`
and pulls those fields from there; the picker only ever offers Meetings that
already have a speaker (`!available` from `getUpcomingEventsForPicker`). On
save, `saveSpeakerEdit(password, eventsRow, speaker, editor)` writes the
Events row (same `summary || bio` fallback as Book) **and**, if a linked card
exists, pushes the same edits to it so the pipeline board doesn't go stale
(Priority itself is never touched by this sync, so whatever priority a linked
card already had is left alone). A **Clear Speaker** button
(`clearSpeaker(password, eventsRow, editor)`) blanks `SPEAKER_MOVE_COLS` on
that row for when a booking falls through — the meeting itself stays on the
calendar, just speakerless — and if a pipeline card was linked, it's unlinked
(`EVENTS_ROW` cleared) and reverted to `in-progress` rather than left
pointing at a now-speakerless meeting. Both writes log an `EVENT_NOTES` entry.

**`findLinkedPipelineRow_(eventsRow, expectedSpeakerName)`** (shared by
`getSpeakerEditDetail`, `saveSpeakerEdit`, `clearSpeaker`, `moveSpeaker`)
scans the pipeline's `EVENTS_ROW` column for a match, but — since `EVENTS_ROW`
is a raw row *index*, not a stable ID — it goes stale whenever the Events
sheet is re-sorted or rows shift elsewhere (`sortByDate()`, called by e.g. the
AI Assistant's `applyAssistantChanges()`), which can silently repoint an old
link at whatever meeting now happens to sit at that row number. Passing the
meeting's current `MAIN_SPEAKER` as `expectedSpeakerName` guards against
this: a candidate row is only trusted if its own `SPEAKER_NAME` still matches,
otherwise the call treats it as "no linked card" instead of pulling in (or
overwriting) an unrelated speaker's Bio/Email/Phone/City.

All three tools reuse `getUpcomingEventsForPicker()` for their pickers (so
they only ever operate on the plain `meeting`-type rows that function
already scopes to — Assemblies and Board Meetings aren't included), and all
return a fresh picker list so the client updates in place without a full page
reload.

---

## Agenda Generator

A read-only, unauthenticated web app (`?app=agenda`, `getAgendaEditorHtml()`)
that renders a printable 15-row meeting agenda in the browser — styled after
`assets/ref/meeting_agenda_example.docx` — for a chosen upcoming meeting, with
buttons to **Print** (browser print, `@media print` hides the header/picker) or
**Copy for Doc** (copies the agenda to the clipboard as rich HTML, built
entirely client-side — see below). No password: it never writes to the Events
sheet, so there's nothing to gate.
Reached from tool cards in `calendar.html` and the `/pipeline/` Tools page.

**Eligible meetings:** `isAgendaEligible_(type, dateVal)` gates both the picker
(`getAgendaData()`) and `buildAgendaModel_()` itself (so a manually-passed
`rowIndex` can't bypass it). Only `AGENDA_MEETING_TYPES` (Meeting, Assembly —
any day) and `AGENDA_THURSDAY_TYPES` (Social, Service — **only** when
`dateVal.getDay() === 4`, the club's regular meeting day) qualify; everything
else, including Board Meeting, throws/is excluded. Update both constants
together if the eligible-type policy changes.

**Officers tab:** a simple two-column sheet (`Role | Name`, no header
requirement beyond that) read by `getOfficers_()`. Some roles repeat (two
Directors, two Service Chairs) — each role maps to an array of names, joined
`"A / B"` when rendered. Not written by any tool; edit it by hand once a year
when the board changes. Supplies the President (MC fallback + several agenda
rows), Treasurer (raffle rows), and the five `COMMITTEE_CHAIR_ROLES` (Service,
Youth, Membership, International, Foundation) for the Committee Announcements
row. The Club Leadership list at the bottom of the agenda is every row of the
Officers tab, in sheet order.

**Row sourcing:** most of the 15 rows pull directly from the selected meeting's
duty columns (4-Way-Test, Thought, Greeter, Detective, Bag Person), the
Officers tab (President/Treasurer/chairs), and the speaker fields
(Introducer ‖ Speaker Organizer for "who," Main Speaker/Topic for "how"). Rows
1, 6, 11, 14, and 15 use **MC ‖ President** (`mcOrPres` — the meeting's MC duty
if set, else the Officers-tab President) for "who," not the President alone.
Row 12's "who" is deliberately left blank (`who: ""`) — the raffle
drawing/cards duty isn't tracked as a named assignment. Two rows are computed:
- **Club Announcements** (row 6) — an editable box, pre-filled by
  `getAgendaAnnouncements_()` from the master calendar: any still-showing
  `Message` rows plus non-meeting events (excluding Grey Bears) within
  `AGENDA_ANNOUNCE_LOOKAHEAD_DAYS` (21) of the meeting. The president edits/
  deletes lines before printing or exporting. On screen and in print this is a
  `contenteditable` div (`#ann-box`, class `.ann-edit`) rather than a
  `<textarea>` — a textarea has a fixed-height internal viewport that scrolls,
  and browsers only print what's inside that viewport, silently clipping long
  announcement lists; a `contenteditable` div grows with its content in normal
  page flow instead, so nothing scrolls or gets cut off. Both outputs also
  leave blank space beneath for handwritten additions — a dashed box in the
  Word Doc export, one `.notes-block` (min-height ~7em) in the HTML page.
- **Next Meeting** (row 13) — `getNextMeetingAgendaText_()` finds the next
  non-cancelled `AGENDA_MEETING_TYPES` row after this one (Meeting/Assembly
  only — narrower than the picker's Thursday-social/service allowance, since
  this row previews the next *speaker* program), shows its speaker/topic +
  `SUMMARY` blurb, then lists anything else happening between the two
  meetings (excluding Grey Bears and Message rows).

**No "TBD" placeholders** — every "who" cell (agenda rows and the duties
table) shows the raw sheet/Officers value, or **blank** if unassigned; nothing
in `buildAgendaModel_` synthesizes a "TBD" string for a missing person. (The
"Next Meeting" row's "TBD" is unrelated informational text — it means no
future meeting was found at all, not a missing duty.)

**Meeting Duties table:** a second table, below the 15-row agenda and above
Club Leadership, listing every `ROLE_FIELDS` duty (MC, Setup/Teardown, AV/Zoom,
Greeter, 4-Way-Test, Thought, Detective, Bag Person) with its raw assigned name
or blank — `model.duties`, built once in `buildAgendaModel_` and rendered
identically by both the "Copy for Doc" clipboard output and the HTML page
(`#duty-table`).

**Copy for Doc:** the "📋 Copy for Doc" button (`copyForDoc()` in
`getAgendaEditorHtml()`) writes the agenda to the clipboard as rich HTML
(`buildCopyHtml()`, via the Clipboard API's `ClipboardItem` with both
`text/html` and `text/plain` payloads) so pasting into Word, Pages, or Google
Docs picks up the title block, both tables, and the leadership list with
formatting intact — no file, no download. `current` (the in-memory agenda
model from the last `render()`) plus the live text in `#ann-box` feed
`buildCopyHtml()`. This is the third approach tried here, after two file-based
exports both proved unreliable: an HTML page served with a `.doc` extension
(Word and Google Docs opened it, Pages refused), then a hand-rolled `.rtf`
file (backslash-prefixed control words + manual page/column-width geometry —
too fragile to get right without a live Word/Pages test loop, and it showed:
garbled formatting, narrow columns). Before either, an even earlier version
called `DocumentApp`/`DriveApp` on the server (`generateAgendaDoc()`, since
removed), which depended on the *deployed script's own* Drive access and
broke when the viewer wasn't signed into the same Google account the
spreadsheet lives under. Clipboard HTML sidesteps every one of those failure
modes — no server round trip, no file format to construct byte-for-byte, no
page geometry to guess; the browser's own paste handling does the work, and
every major word processor already knows how to accept it. If the Clipboard
API isn't available (`navigator.clipboard`/`ClipboardItem` missing —
non-HTTPS context, unsupported browser), `copyForDoc()` catches the failure
and tells the user to select and copy the on-screen agenda manually instead.

**Print/screen sizing:** both outputs favor legibility over compactness. The
HTML page scales dynamically: `#sheet` sets `font-size:calc(1em * var(--afs))`,
and since nearly every descendant size in the page is in `em`, changing the
single `--afs` CSS variable scales the whole agenda proportionally (club
title, meta, both tables, leadership list) — this applies identically
on-screen and when printed, so there's no separate print-only font bump to
keep in sync. `--afs` defaults to `1.8` and is also exposed as a
**Small/Medium/Large/Huge** `<select id="fontsize">` in the header
(`setFontScale()`, values `1.2`/`1.5`/`1.8`/`2.2`, persisted to `localStorage`
as `agendaFontScale` and restored on load) — this scale has been tuned twice:
bumped up from an initial too-small pass, then dialed back down after that
bump proved too big both on-screen and in print.
`@page{margin:0.75in}` in `@media print`; `#main{max-width:none}` removes the
on-screen 760px cap so the table still uses the full print width. Tables are
expected to spill across multiple printed pages when content is long;
`page-break-inside:avoid` on table rows keeps a single duty/agenda row from
splitting mid-row. **Gotcha:** `table.ag`/`table.duty` use
`table-layout:fixed` with column widths on `nth-child` selectors (covering
both `<th>` and `<td>`, since `table-layout:fixed` only reads widths from the
first row) — plain HTML tables default to `table-layout:auto`, where fixed-px
column widths are just suggestions the browser overrides when scaled-up cell
content needs more room, which let the table grow past the edges of `#sheet`
once `--afs` got large. `table-layout:fixed` makes the declared widths (in %,
not px, so they still track `#sheet`'s own width) authoritative — cell text
wraps instead of forcing the table wider.

`buildAgendaModel_(rowIndex, announcementsOverride)` is the single source of
truth for both outputs — the HTML render calls it via `getAgendaData()` /
`getAgendaModel(rowIndex)`, and the client mirrors that same `current` model
into the RTF export — so the two never drift.

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
| `doGet(e)` | Web request | Routes to Duty Editor, Calendar Assistant, Event Editor, Agenda Generator, Book/Move Speaker, etc. |
| `doPost(e)` | Web request | Handles speaker request form submissions |
| `getPageData()` | Duty Editor client | Returns upcoming meetings + member list |
| `saveDuties(rowIndex, duties)` | Duty Editor client | Writes duty assignments |
| `getEventEditorData()` | Event Editor client | Non-meeting events (18 mo) + members |
| `saveEvent(password, payload)` | Event Editor client | Create/update one non-meeting event |
| `deleteEvent(password, rowIndex, editor)` | Event Editor client | Delete a non-meeting event (creator only) |
| `addEventNote(password, rowIndex, noteText, author)` | Event Editor client | Append a timestamped event note |
| `bookSpeaker(password, eventsRow, speaker, editor)` | Book a Speaker client | Assign a new speaker to a meeting + log pipeline card |
| `moveSpeaker(password, fromRow, toRow, editor)` | Move a Speaker client | Move a booked speaker between meetings |
| `getSpeakerEditDetail(rowIndex)` | Edit a Speaker client | Reads a meeting's speaker fields + linked pipeline card's Bio/contact info |
| `saveSpeakerEdit(password, eventsRow, speaker, editor)` | Edit a Speaker client | Edits a booked speaker's fields, syncs a linked pipeline card |
| `clearSpeaker(password, eventsRow, editor)` | Edit a Speaker client | Unbooks a speaker from a meeting; reverts a linked pipeline card |
| `getOfficers_()` | Agenda Generator | Reads the Officers tab (Role \| Name) |
| `buildAgendaModel_(rowIndex, announcementsOverride)` | Agenda Generator | Shared title block + 15 agenda rows + leadership list |
| `getAgendaData()` | Agenda Generator client | Upcoming meeting picker list + model for the next one |
| `getAgendaModel(rowIndex)` | Agenda Generator client | Rebuilds the model when the picker selection changes |
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
