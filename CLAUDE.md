# CLAUDE.md — SLV Rotary Prototype Site

## Project overview

This is a **GitHub Pages / Jekyll (Minima theme)** prototype website for the
San Lorenzo Valley Rotary Club. It is **not** a replacement for ClubRunner —
the club treasurer will continue to maintain that. This site prototypes
better tooling for a few pain points:

- **Speaker pipeline** — forms to request a speaker slot or offer to speak,
  fed by a Google Sheet so the speaker organizer, secretary, and president
  don't need to coordinate via email threads.
- **Calendar** — a FullCalendar.js page that reads from a Google Sheet /
  Google Calendar to display upcoming meetings and events.
- **Newsletter generator** — a JavaScript page that dynamically renders the
  weekly bulletin by parsing the club's Google Sheet (mirrors the Apps Script
  workflow that generates the Google Doc newsletter).

The site owner (Eric Brown) is becoming club president and is a CS/robotics
teacher at SLV High School — he has an engineering background and is
comfortable reading/editing code, but values clarity and maintainability.

---

## Stack

| Layer | Choice |
|---|---|
| Static site | Jekyll via `github-pages ~> 232` gem |
| Theme | Minima 2.5.1 (classic skin) |
| Hosting | GitHub Pages |
| Dynamic data | Google Sheets (published CSV or JSON feed) |
| Calendar widget | FullCalendar.js (CDN, no build step) |
| Forms | Google Forms (linked, not embedded) |
| Newsletter logic | Vanilla JS parsing Google Sheets feed |

**Do not** introduce npm build steps, React, or bundlers — this must deploy
cleanly via GitHub Pages with zero CI pipeline.

---

## Key pages

| File | Purpose |
|---|---|
| `index.md` | Homepage with quick links |
| `calendar.html` | FullCalendar view of upcoming meetings (reads Sheet CSV) |
| `newsletter.html` | Auto-generated weekly bulletin (reads Sheet CSV) |
| `speak.md` | Link to Google Form: offer to speak |
| `request.md` | Link to Google Form: request a speaker |
| `_config.yml` | Site config — title, header_pages, theme |
| `Gemfile` | GitHub Pages gem pin |

---

## Constraints & conventions

- **No dark themes** — Rotary brand is blue (`#17458F`). Keep light/neutral.
- **Minima skin** — use `classic` or `solarized`; do not switch themes.
- **Mobile-friendly** — members will view this on phones at meetings.
- **No ClubRunner replacement** — treasurer's workflow is untouched.
- **Prototype mindset** — prefer working simply over perfect; this is a demo
  to show the club what's possible, not a production system.
- **Google Sheets as the source of truth** for speakers and events.
  Published CSV URL: `https://docs.google.com/spreadsheets/d/e/2PACX-1vSiIWI11d3jQFL8I7g5vosHef2w-v5nad_hPvrSmlt13_oTar0YXcCXJpV7ZjxCJjguIAXZ7tUB8eXO/pub?gid=1793625237&single=true&output=csv`
  Actual sheet column order (0-based):
  0 Event ID | 1 Event Type | 2 Cancelled | 3 Day | 4 Date (YYYY-MM-DD) |
  5 Time (H:MM AM/PM) | 6 Duration (min) | 7 Location | 8 Google Meet Link |
  9 Speaker(s) Organizer | 10 Opening Speaker | 11 Main Speaker | 12 Main Topic |
  13 Speaker URL (optional link) | 14 Summary (newsletter + calendar body) |
  15 Speaker Top Photo URL | 16 Speaker Bottom Photo URL |
  17 MC | 18 Setup/Teardown | 19 AV/Zoom | 20 Greeter | 21 4-Way-Test | 22 Thought |
  23 Detective | 24 Bag Person | 25 Comments | 26 Sync Status | 27 Hash |
  28 Photo Top URL (hidden, auto) | 29 Photo Bottom URL (hidden, auto)

---

## Related tools (outside this repo)

- **RotaryCalendarSync.gs** — Apps Script that syncs Google Calendar ↔
  Google Sheet (bidirectional, with de-duplication via Event ID column).
- **Newsletter Apps Script** — separate script generating the Google Doc
  weekly bulletin from the same Sheet.

---

## What Claude should do by default

- Prefer **vanilla JS + CDN libraries** over anything that needs `npm install`.
- Keep Liquid/Jekyll templating simple — no custom plugins (GitHub Pages
  doesn't support them).
- When editing `_config.yml`, preserve existing comments.
- Suggest Google Forms for any data-entry workflow; don't build custom
  backends.
- If touching the newsletter or calendar JS, parse the **published Google Sheets CSV**
  endpoint (`/pub?output=csv`) rather than the Sheets API (no auth needed).
  The live URL is already hardcoded in both `calendar.html` and `newsletter.html`.
- Default to **FullCalendar 6.x** for calendar UI (loaded from cdnjs or
  jsDelivr).
