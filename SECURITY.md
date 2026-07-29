# SECURITY.md — Security & Privacy Hardening Plan

> **What this file is:** a punch list of security/privacy work that is **not
> yet implemented**. Nothing in this file describes current behavior — for
> that, see [APPSCRIPT.md §4 "Auth model"](APPSCRIPT.md#4-auth-model), which
> documents today's actual gaps in detail and is the factual source of truth
> this plan is built from. Check items off here as they ship, and update
> APPSCRIPT.md §4 to match once a gap it describes is actually closed —
> otherwise that section goes stale in the opposite direction (describing a
> hole that's been patched).

---

## Why this matters (and why it's not on fire)

Every Apps Script function runs "Execute as: Me" — Eric's full Google
account privileges (Sheets, Calendar, Drive, Gmail), regardless of who
loaded the page. The "Anyone" deployment (`.../exec`, no `?app=`) means
`google.script.run` exposes **every top-level function in the project** to
any page it serves — not just the functions that specific page's own HTML
happens to call. Today's real trust boundary is "nobody hostile has found
and poked at this URL," not actual authorization. That's consistent with
this project's stated [prototype mindset](CLAUDE.md#constraints--conventions),
but the Speaker Pipeline tab holds real PII (speaker/requestor emails,
phone numbers, cities) that this boundary is currently the *only* thing
protecting.

No known exploitation, and a small-town Rotary club's tools are a low-value
target — this isn't an emergency. The priorities below are ordered by
**(impact if someone pokes at it) × (how easy it is to stumble into by
accident)**, not by abstract severity. Closing Priority 0 removes the one
gap that's already fully diagnosed and cheap to fix; everything past that
is a bigger swing with a real design decision behind it.

---

## Priority 0 — close the documented gap (no architecture change)

This is the fix APPSCRIPT.md §4 already spells out: seven Speaker Pipeline
mutations and several PII-bearing reads take **no password argument at
all**, unlike `saveEvent` / `deleteEvent` / `addEventNote` (Event Editor)
and `bookSpeaker` / `moveSpeaker` / `saveSpeakerEdit` / `clearSpeaker`
(Book/Move/Edit Speaker), which already do this correctly. This is a
same-pattern, no-redesign fix — the hard part is just doing it
consistently everywhere, which is exactly what Priority 1 is for.

- [ ] Add a `password` argument + a shared auth check to every currently
      unprotected mutation: `savePipelineCard`, `deletePipelineCard`,
      `togglePipelineVote`, `appendPipelineNote`, `addPipelineCard`,
      `assignSpeakerToEvent`, `uploadPipelinePhoto`.
- [ ] Do the same for PII-bearing reads that take no password today:
      `getPipelineData()`, `getEventEditorData()`, `getSpeakerEditDetail()`,
      `getUpcomingEventsForPicker()`, `getMemberNames_()`. These currently
      hand back speaker/requestor emails, phone numbers, member names, and
      internal notes to anyone who calls them directly — logged in or not.
- [ ] Update every call site (`getKanbanHtml`, `getPipelineTableHtml`,
      `getSpeakerStatusHtml`, `getEventEditorHtml`, `getBookSpeakerHtml`,
      `getMoveSpeakerHtml`, `getEditSpeakerHtml`) to pass the cached
      `localStorage.pipelinePw` on every RPC call that now needs it, not
      just the ones it already covers.
- [ ] Decide whether `saveDuties()` / `getPageData()` (bare Duty Editor —
      no login screen of any kind) should get a lightweight gate too. Duty
      assignments aren't sensitive, but this is currently the one place a
      fully anonymous visitor can write to the Events sheet at all.
- [ ] Cap free-text field lengths server-side — `bio`, `summary`,
      `comments`, `topic`, etc. — the way `addEventNote` /
      `handleNoteSpeaker_` already truncate notes to 1000 chars. Most
      Pipeline/Event fields have no limit today.

---

## Priority 1 — split `Auth.gs` out of `RotaryCalendarSync.gs`

**Idea, as raised:** two `.gs` files instead of one — auth/authorization
logic in its own file, everything else in the other.

**Why this is worth doing:** Apps Script projects can hold multiple `.gs`
files that all share one global scope — splitting is purely organizational,
*zero behavior change*. The actual value: Priority 0's gaps exist because
the auth check is a copy-pasted `if (!checkPipelinePassword(password))
throw ...` repeated ad hoc in some functions and simply forgotten in
others, as the project grew past 8,000 lines in one file. A dedicated
`Auth.gs` makes the entire authorization surface reviewable in one place,
and makes it possible to *enforce* the rule instead of just hoping the next
person who adds a Pipeline mutation remembers it.

- [ ] Create `appscript/Auth.gs` containing: `checkPipelinePassword()`, a
      new shared `requireAuth_(password)` that throws a consistent error
      instead of each caller writing its own `if (!checkPipelinePassword...)
      throw new Error(...)`, and the rate-limiting helpers below.
- [ ] Migrate every mutating/PII-reading RPC (per Priority 0) to call
      `requireAuth_(password)` as its first line — one call, not a
      hand-rolled check per function.
- [ ] Update the CLAUDE.md line that currently says "All Apps Script logic
      (single file)" once this lands — either drop "single file" or note
      the split explicitly, so this doc doesn't mislead the next session.
- [ ] Update APPSCRIPT.md §4/§6 to reflect the new file boundary and the
      closed gap.
- [ ] Optional follow-up, not required for the security win: further split
      by feature area (`Pipeline.gs`, `EventEditor.gs`, `Agenda.gs`,
      `Assistant.gs`) if the single remaining file is still unwieldy to
      navigate. This is a pure readability call, not a security one — do it
      only if it's actually easier to work in that way.

**Bonus, cheap to add alongside this:** reuse the existing
`isRateLimited_()` / `LockService` pattern (currently only guarding
`doPost`) for RPC writes too, so a script hitting `google.script.run`
functions directly from devtools can't hammer the sheet. Low cost since the
plumbing already exists; add it to `Auth.gs` as `requireAuth_()`'s
companion.

---

## Priority 2 — isolate Speaker Pipeline PII into a separate spreadsheet

**Idea, as raised:** pull the Speaker Pipeline (and the raw
speak.md/request.md submission trail) out of the main "SLV Rotary Master"
spreadsheet and into its own Google Sheet.

**Why this is worth doing:** the Events tab is *published as CSV* — that's
core to how `year.html`/`calendar.html`/`newsletter.html` work, and it's
fine, because Events has no PII in it. But the Pipeline tab lives in the
same spreadsheet file today, which means its sharing settings are
inherently tied to the Events sheet's. If that file is ever shared more
broadly for a reason that has nothing to do with speakers (a treasurer
audit, a board handoff, a "can you look at this" moment), Pipeline PII
rides along by accident. A separate file gets its own sharing settings,
its own backup/retention story, and makes "please delete my info" requests
trivial to scope. It also shrinks the blast radius of Priority 0's gap
retroactively — even a leftover unauthenticated read would only ever
surface data that's supposed to be more exposed (Events), never the PII
tab.

**How, mechanically:** a single Apps Script project can open more than one
spreadsheet by ID — the Events sheet stays the *container-bound* sheet
(it needs to stay bound for `onOpen()`, the installable `onEdit` trigger,
and the Rotary Sync menu), and the Pipeline sheet becomes a second,
separately-shared spreadsheet opened via `SpreadsheetApp.openById(...)`.
This is one function to change (`getPipelineSheet_()`), not a second Apps
Script project or a second deployment.

- [ ] Create the new spreadsheet; migrate existing Pipeline Sheet rows into
      it with a one-time script (preserve `NUM_PIPE_COLS`/`CP` layout
      exactly, so nothing else in the codebase needs to change).
- [ ] Store its ID as a Script Property (`PIPELINE_SHEET_ID`), mirroring how
      `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` are already managed — not a
      hardcoded constant, so it never needs to touch the repo.
- [ ] Update `getPipelineSheet_()` to `SpreadsheetApp.openById(PIPELINE_SHEET_ID)
      .getSheetByName(PIPELINE_SHEET)` instead of
      `SpreadsheetApp.getActiveSpreadsheet()`.
- [ ] Set the new spreadsheet's sharing to the minimum needed (Eric only,
      or Eric + whoever actually needs to open it directly in Sheets — the
      web apps don't need direct sharing, since they run "Execute as: Me").
- [ ] Decide whether the rolling `Backup MM-dd HH:mm` mechanism
      (`createEventsBackup()`) should also snapshot the Pipeline sheet, and
      if so, whether those backups need the same tighter sharing as the
      live data (they will contain the same PII).
- [ ] Update APPSCRIPT.md §8 ("Data stores") once this lands.

**Cost / why this is Priority 2, not 0:** real migration work, a new file
to manage, and one more Script Property to keep in sync across
deployments. Worth doing, but it's a design change, not a bug fix — don't
rush it ahead of Priority 0, which is strictly higher-value per hour spent.

---

## Priority 3 — bigger, optional swings

These fix things Priority 0–2 don't: they're about *who* is acting, not
just *whether* they knew the password.

- [ ] **Fix name-spoofing under the shared password.** Today, anyone who
      knows `KANBAN_PASSWORD` can type *any* name into the login screen,
      and that name becomes `editor`/`currentUser` for every subsequent
      call — including the `deleteEvent` check that only the row's
      `CREATED_BY` may delete it. The password gates entry; it does
      nothing to authenticate *identity*. A lightweight fix: a per-member
      PIN stored in the Members tab (still simple string comparison, no
      real infra), checked server-side, so "who did this" is at least
      self-consistent instead of trivially spoofable by name.
  - **Open question to resolve before starting this:** is a single club
    password with self-reported names actually an acceptable trust level
    for this club's size and culture? If yes, skip this item entirely —
    it's a real design decision, not an obvious "yes."
- [ ] **Consider Google Sign-In** (deployment access restricted to a Google
      Group, or "Execute as: User accessing the web app") if the club ever
      adopts Google Workspace for Nonprofits. This is the only path to
      *real* authentication in this stack, but it requires every member to
      have and use a Google account and accept an OAuth consent screen —
      a real friction cost for a volunteer club. Don't do this speculatively;
      revisit only if Workspace is already on the table for other reasons.
- [ ] **Structured audit log**, separate from the prose Notes columns —
      a hidden "Audit Log" sheet tab that every mutating RPC appends one
      row to (who, what, when, which row). Notes are for humans; this
      would be for "did someone delete this and when" questions that are
      currently answerable only by reading prose.
- [ ] **Recurring XSS spot-check.** Rendering is consistently `esc()`-wrapped
      today across the Kanban/Table/Status/Event Editor views, but new
      fields get added to these forms often (see how many have been added
      already — Priority/Rotarian/Local/Fundraising flags, tags, hearts...).
      Worth a periodic grep for any `innerHTML =` assembling a template
      string with a sheet-sourced value that *isn't* passed through `esc()`,
      rather than trusting every future addition to remember it.

---

## Explicitly not planned right now

- **CAPTCHA on `speak.md`/`request.md`.** The existing
  `DAILY_SUBMISSION_LIMIT` (20/day, `LockService`-guarded) is judged
  sufficient for a club-scale public form; revisit only if actual spam
  shows up.
- **Rewriting off Apps Script entirely.** Out of scope — this whole
  project's constraint is "no npm build steps, no bundlers, GitHub Pages +
  Apps Script only" (see [CLAUDE.md](CLAUDE.md#stack)); a security plan
  that requires abandoning the stack isn't a plan this club will execute.
- **Constant-time password comparison** for `checkPipelinePassword()`.
  Theoretically a timing side-channel, practically irrelevant given Apps
  Script's network-latency noise floor and the tiny, non-adversarial
  audience. Not worth the code complexity.

---

## How to use this file

Work top-down — Priority 0 is strictly the best return on effort. Check
items off inline as PRs land. When a whole Priority section is done,
update the corresponding factual section of
[APPSCRIPT.md §4](APPSCRIPT.md#4-auth-model) (and §6/§8 where noted) so
that document keeps describing *actual current behavior* rather than a mix
of "today" and "how it used to be before this plan shipped."
