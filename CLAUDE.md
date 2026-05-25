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
| Static site | Jekyll via `github-pages ~> 227` gem |
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
| `index.md` or `calendar.html` | FullCalendar view of upcoming meetings |
| `newsletter.html` | Auto-generated bulletin from Google Sheet |
| `speak.html` | Link/embed: offer to speak (Google Form) |
| `request.html` | Link/embed: request a speaker (Google Form) |
| `_config.yml` | Site config — title, header_pages, theme |

---

## Constraints & conventions

- **No dark themes** — Rotary brand is blue (`#17458F`). Keep light/neutral.
- **Minima skin** — use `classic` or `solarized`; do not switch themes.
- **Mobile-friendly** — members will view this on phones at meetings.
- **No ClubRunner replacement** — treasurer's workflow is untouched.
- **Prototype mindset** — prefer working simply over perfect; this is a demo
  to show the club what's possible, not a production system.
- **Google Sheets as the source of truth** for speakers and events.
  The Apps Script / Sheet column order is:
  Event ID | Type | Date | Start Time | Duration | Title | Location |
  Google Meet Link | Opening Speaker | Main Speaker | Description | MC | Comments

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
- If touching the newsletter JS, parse the **published Google Sheets CSV**
  endpoint (`/export?format=csv`) rather than the Sheets API (no auth needed).
- Default to **FullCalendar 6.x** for calendar UI (loaded from cdnjs or
  jsDelivr).
