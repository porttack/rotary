// ============================================================
//  ROTARY CALENDAR <-> GOOGLE SHEETS SYNC
//  Paste this entire file into Extensions > Apps Script in your Sheet
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
const CALENDAR_ID   = "primary"; // <-- CHANGE THIS to your calendar ID
const PULL_DAYS_AHEAD = 180;     // how many days ahead to pull
const SHEET_NAME    = "Events";

// Feature flag: show the "✨ Tell me what to change…" AI command line on the
// Kanban and Status pipeline pages. Set to true to re-enable (Gemini-backed;
// needs GEMINI_API_KEY in Script Properties).
const PIPELINE_AI_ENABLED = false;

// ── CALENDAR ASSISTANT — SYSTEM PROMPT ───────────────────────
// Edit this to update what the AI knows about the club.
const ASSISTANT_SYSTEM_PROMPT = `
You are the Calendar Assistant for San Lorenzo Valley (SLV) Rotary Club.
You help Eric (the club president and a CS/robotics teacher at SLV High School)
manage the club event spreadsheet via natural language.

## Club context
- Rotary year: July 1 – June 30
- Regular meetings: weekly, typically 7:00 PM evenings or 8:00 AM mornings
- Common venues: Scopazzi's (Boulder Creek, CA), School Board Room (325 Marion Ave)
- Grey Bears: weekly service at Grey Bears food bank, every Friday at 9:30 AM

## Event types
Meeting | Assembly (meeting without a speaker) | Board Meeting | Social | Service |
Grey Bears | Fundraiser | District Event | Committee | Holiday | Other

Holiday events are display-only and are NEVER synced to Google Calendar.
Grey Bears events never need speakers, topics, or duty assignments.

## Fields available when adding or updating an event
eventType, date (YYYY-MM-DD), time (H:MM AM/PM), duration (minutes, default 60),
location, openingSpeaker, mainSpeaker, mainTopic, speakerUrl, summary,
mc, setupTeardown, avZoom, greeter, fourWayTest, thought, detective, bagPerson, comments

## How to work
1. Call read_events first to understand what already exists before adding anything.
2. Queue changes with add_event / update_event / cancel_event / delete_event.
   Changes are shown to the user for confirmation — nothing is written until they approve.
3. Use update_event to move or modify existing rows; avoid delete + re-add.
4. Use cancel_event to cancel an event; reserve delete_event for true duplicates.
5. For recurring events (e.g. every Tuesday for 6 months) generate each date individually.
6. Ask clarifying questions if a request is ambiguous before queuing changes.
7. Dates: YYYY-MM-DD. Times: H:MM AM/PM (e.g. "7:00 PM", "9:30 AM").
`.trim();

// ── COLUMN MAP ───────────────────────────────────────────────
const COL = {
  EVENT_ID:        1,   // A - Google Calendar Event ID (hidden)
  EVENT_TYPE:      2,   // B - Meeting / Board Meeting / Social / Committee / Other
  CANCELLED:       3,   // C - Checkbox: if checked, prefixes title with "Cancelled - "
  DAY_LABEL:       4,   // D - Computed: "Tue, Sep W3" for Meeting/blank (formula, read-only)
  DATE:            5,   // E - Date (yyyy-MM-dd)
  TIME:            6,   // F - Start time
  DURATION:        7,   // G - Duration in minutes (default 60)
  LOCATION:        8,   // H - Venue / address
  GOOGLE_MEET:      9,  // I - Google Meet link
  SPEAKER_ORGANIZER:10, // J - Who is managing / booking this speaker
  OPENING_SPEAKER:  11, // K - Opening speaker / invocation
  MAIN_SPEAKER:     12, // L - Main speaker
  MAIN_TOPIC:       13, // M - Main topic / program title
  SPEAKER_URL:      14, // N - Optional URL for speaker/topic (links in newsletter & calendar)
  SUMMARY:          15, // O - Rich narrative paragraph for newsletter
  PHOTO_TOP:        16, // P - Top photo URL (speaker or event, displayed above narrative)
  PHOTO_BOTTOM:     17, // Q - Bottom photo URL (second image, displayed below narrative)
  MC:               18, // R - MC if not the president
  SETUP_TEARDOWN:   19, // S - Setup/Teardown
  AV_ZOOM:          20, // T - AV/Zoom
  GREETER:          21, // U - Greeter
  FOUR_WAY_TEST:    22, // V - 4-Way-Test
  THOUGHT:          23, // W - Thought
  DETECTIVE:        24, // X - Detective
  BAG_PERSON:       25, // Y - Bag Person
  COMMENTS:         26, // Z - Internal comments (not pushed to Calendar)
  STATUS:           27, // AA - Sync status
  HASH:             28, // AB - Hash of last-pushed fields (hidden, do not edit)
  PHOTO_TOP_URL:    29, // AC - Extracted URL for Photo Top (hidden; written by Sync Photos)
  PHOTO_BOTTOM_URL: 30, // AD - Extracted URL for Photo Bottom (hidden; written by Sync Photos)
  INTRODUCER:       31, // AE - Who introduces the speaker (often, not always, the organizer)
  CREATED_BY:       32, // AF - Member who created this row via the Event Editor (delete permission)
  EVENT_NOTES:      33, // AG - Timestamped notes log (newest first), like the speaker pipeline
  EXCLUDE_NEWSLETTER:34,// AH - Checkbox: if TRUE, hide this event from the newsletter bulletin
};

const NUM_COLS = 34;

// Duty field key → COL mapping (shared by web app and sheet save logic)
const DUTY_COLS = {
  mc:            COL.MC,
  setupTeardown: COL.SETUP_TEARDOWN,
  avZoom:        COL.AV_ZOOM,
  greeter:       COL.GREETER,
  fourWayTest:   COL.FOUR_WAY_TEST,
  thought:       COL.THOUGHT,
  detective:     COL.DETECTIVE,
  bagPerson:     COL.BAG_PERSON,
};

// Event type options
const EVENT_TYPES = ["Meeting", "Assembly", "Board Meeting", "Social", "Service", "Grey Bears", "Fundraiser", "District Event", "Committee", "Holiday", "Other"];

// Event types a club member may create/edit from the member-facing Event Editor
// web app (?app=events). Deliberately excludes the speaker/duty-driven meetings
// (Meeting, Assembly, Board Meeting), the auto-generated Grey Bears series, and
// Holiday / District Event rows — all managed elsewhere. Keep in sync with
// EVENT_TYPES above.
const EDITOR_EVENT_TYPES = ["Social", "Service", "Fundraiser", "Committee", "Other"];

// Speaker/program meeting types. In the Event Editor's "Show all types" mode
// these unlock the extra Main Speaker / Opening Speaker / Introducer / Google
// Meet fields. Duty roles stay in the Duty Editor — saveEvent never writes the
// duty columns, so a meeting's roster is left untouched when edited here.
const SPEAKER_EVENT_TYPES = ["Meeting", "Assembly", "Board Meeting"];

// How far ahead the Event Editor lists events. Capped at ~one year so the
// "all types" view can't balloon into multiple years of weekly meetings.
const EDITOR_WEEKS_AHEAD = 52;

// Text color and bold per event type (row background stays white/grey for cancelled)
// Each entry: { color, bold }
const TYPE_STYLES = {
  "meeting":        { color: "#1a56db", bold: true  },  // bold blue
  "assembly":       { color: "#1d4ed8", bold: false },  // blue
  "board meeting":  { color: "#7e22ce", bold: true  },  // purple
  "social":         { color: "#166534", bold: false },  // green
  "service":        { color: "#c2410c", bold: false },  // orange
  "grey bears":     { color: "#92400e", bold: false },  // dark amber
  "fundraiser":     { color: "#7c3aed", bold: true  },  // violet
  "district event": { color: "#14532d", bold: true  },  // dark green
  "committee":      { color: "#000000", bold: false },  // black
  "holiday":        { color: "#b91c1c", bold: true  },  // red
  "other":          { color: "#000000", bold: false },  // black
};
const DEFAULT_STYLE = { color: "#000000", bold: false };

// Role fields that go into Calendar description (in display order)
// Each entry: { col, label }
const ROLE_FIELDS = [
  { col: COL.MC,             label: "MC"             },
  { col: COL.SETUP_TEARDOWN, label: "Setup/Teardown" },
  { col: COL.AV_ZOOM,        label: "AV/Zoom"        },
  { col: COL.GREETER,        label: "Greeter"        },
  { col: COL.FOUR_WAY_TEST,  label: "4-Way-Test"     },
  { col: COL.THOUGHT,        label: "Thought"        },
  { col: COL.DETECTIVE,      label: "Detective"      },
  { col: COL.BAG_PERSON,     label: "Bag Person"     },
];

// ── SPEAKER PIPELINE ─────────────────────────────────────────
const PIPELINE_SHEET = 'Speaker Pipeline';
const PIPELINE_STATUSES = ['new', 'in-progress', 'limbo', 'scheduled', 'done', 'declined', 'deleted'];
const PIPELINE_STATUS_LABELS = {
  new: 'New', 'in-progress': 'In Progress', limbo: 'Limbo',
  scheduled: 'Scheduled', done: 'Done ✓', declined: 'Declined',
  deleted: 'Deleted 🗑',
};
// Legacy statuses that were merged away — normalized to a current status on read.
const PIPELINE_STATUS_ALIASES = { confirmed: 'in-progress' };

const CP = {
  SOURCE:              1,   // A - offer | request | manual
  STATUS:              2,   // B - kanban column value
  SPEAKER_NAME:        3,   // C
  SPEAKER_EMAIL:       4,   // D
  SPEAKER_PHONE:       5,   // E
  SPEAKER_CITY:        6,   // F
  TOPIC:               7,   // G
  SPEAKER_ROLE:        8,   // H - Opening | Main | Either | Unsure
  BIO:                 9,   // I
  NOTES:              10,   // J - append-only log, newest first
  ASSIGNED_TO:        11,   // K
  PREFERRED_DATES:    12,   // L - free text from submitter
  TENTATIVE_DATE:     13,   // M - YYYY-MM-DD proposed date
  EVENTS_ROW:         14,   // N - row index in Events tab once scheduled
  PHOTO_URL:          15,   // O
  REQUESTOR_NAME:     16,   // P
  REQUESTOR_EMAIL:    17,   // Q
  REQUESTOR_PHONE:    18,   // R
  SPOKE_TO_ORGANIZER: 19,   // S
  SPOKE_TO_PRESIDENT: 20,   // T
  AVAIL_MORNING:      21,   // U
  AVAIL_EVENING:      22,   // V
  ZOOM_ONLY:          23,   // W
  OTHER_SUGGESTIONS:  24,   // X
  COMMENTS:           25,   // Y
  SUBMITTED_AT:       26,   // Z
  UPDATED_AT:         27,   // AA
  UPDATED_BY:         28,   // AB
  TAGS:               29,   // AC - comma-separated tag labels
  INTERESTED:         30,   // AD - comma-separated names of members who +1'd
  SPEAKER_URL:        31,   // AE - link for speaker/topic
  SUMMARY:            32,   // AF - newsletter narrative paragraph
  INTRODUCER:         33,   // AG - who introduces the speaker at the meeting
  PHOTO_BOTTOM:       34,   // AH - second photo (PHOTO_URL col 15 is the top photo)
  PRIORITY:           35,   // AI - Low | Medium | High
  IS_ROTARIAN:        36,   // AJ - Yes if speaker is a Rotarian
  IS_LOCAL:           37,   // AK - Yes if speaker is local to SLV area
  FUNDRAISING_LITERATURE: 38, // AL - Yes if may bring fundraising/donation materials
  HEARTS:                 39, // AM - anonymous heart/support count from public speakers page
};
const NUM_PIPE_COLS = 39;

// ── MENU ─────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Rotary Sync")
    .addItem("⬇️  Pull from Calendar → Sheet", "pullFromCalendar")
    .addItem("⬆️  Push Sheet → Calendar",       "pushToCalendar")
    .addSeparator()
    .addItem("📰  Generate Newsletter Doc",     "generateNewsletter")
    .addSeparator()
    .addItem("🖼️  Sync Photos → URL Columns",   "syncPhotos")
    .addItem("📝  Open Duty Editor (web app)",  "openDutyEditor")
    .addItem("🎤  Open Speaker Pipeline (web app)", "openSpeakerPipeline")
    .addItem("👥  Setup Members Tab",           "setupMembers")
    .addSeparator()
    .addItem("📋  Setup / Reset Sheet Headers", "setupSheet")
    .addItem("🎤  Setup Speaker Pipeline Tab",  "setupSpeakerPipeline")
    .addItem("🔧  Migrate Confirmed → In Progress", "migratePipelineConfirmedStatus")
    .addItem("🧹  Purge Old Rate Counters",         "purgeOldRateCounters")
    .addItem("✉️  Authorize Email (run once)",       "authorizeMailScope")
    .addItem("⚡  Install Edit Trigger (run once)", "installEditTrigger")
    .addToUi();
}

/**
 * One-time email authorization. The form-submission emails (notifySubmission_,
 * confirmSubmitter_) call MailApp.sendEmail, which needs the
 * https://www.googleapis.com/auth/script.send_mail scope. A web app deployed
 * before that scope was granted runs without it, so every send throws
 * "You do not have permission to call MailApp.sendEmail" (silently, since the
 * email helpers swallow errors). Running THIS function from the editor triggers
 * a fresh consent prompt that includes the mail scope; once granted, the
 * "Execute as: Me" web app can send. Sends a test message to the owner so you
 * can confirm delivery end-to-end.
 */
function authorizeMailScope() {
  const me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(
    me,
    'SLV Rotary — email authorized ✅',
    'If you are reading this, the script can now send email. ' +
    'Speaker-form notifications and acknowledgements will go out from now on.'
  );
  try {
    SpreadsheetApp.getUi().alert(
      'Email authorized — a test message was sent to ' + me + '.\n\n' +
      'Check your inbox to confirm it arrived.'
    );
  } catch (_) {}
}

// ── EDIT TRIGGER ─────────────────────────────────────────────
// Simple triggers can't reliably set formatting. Instead we use an
// installable trigger. Run "Install Edit Trigger" from the menu once.

function onEditInstallable(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const col = e.range.getColumn();
  if (col !== COL.DATE && col !== COL.EVENT_TYPE && col !== COL.CANCELLED) return;

  const startRow = e.range.getRow();
  const numRows  = e.range.getNumRows();
  if (startRow < 2) return;

  for (let i = 0; i < numRows; i++) {
    recolorRow(sheet, startRow + i);
  }
}

/** Install the installable onEdit trigger (run once from the menu) */
function installEditTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Remove any existing triggers for this function to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "onEditInstallable") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("onEditInstallable")
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  SpreadsheetApp.getUi().alert("Edit trigger installed! Row colors will now update automatically.");
}

/** Recolor a single row based on its current Event Type and Cancelled values */
function recolorRow(sheet, sheetRow) {
  const type      = String(sheet.getRange(sheetRow, COL.EVENT_TYPE).getValue()).toLowerCase().trim();
  const cancelled = sheet.getRange(sheetRow, COL.CANCELLED).getValue();
  const dateVal   = sheet.getRange(sheetRow, COL.DATE).getValue();
  const style     = TYPE_STYLES[type] || DEFAULT_STYLE;
  const rowRange  = sheet.getRange(sheetRow, 1, 1, NUM_COLS);

  rowRange.setBackground(cancelled ? "#cccccc" : "#ffffff");
  rowRange.setFontColor(cancelled ? "#888888" : style.color);
  rowRange.setFontWeight((!cancelled && style.bold) ? "bold" : "normal");

  applyDayCellStyle(sheet.getRange(sheetRow, COL.DAY_LABEL), dateVal, cancelled);
}

// ── SETUP ────────────────────────────────────────────────────
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const headers = [
    "Event ID (do not edit)",  // A
    "Event Type",              // B
    "Cancelled",               // C
    "Day",                     // D - computed
    "Date",                    // E
    "Time",                    // F
    "Duration (min)",          // G
    "Location",                // H
    "Google Meet Link",         // I
    "Speaker(s) Organizer",     // J - who is managing / booking this speaker
    "Opening Speaker",          // K
    "Main Speaker",             // L
    "Main Topic",               // M
    "Speaker URL",              // N - optional link for speaker or topic
    "Summary (newsletter)",     // O - rich narrative paragraph
    "Speaker Top Photo URL",    // P - photo displayed above narrative
    "Speaker Bottom Photo URL", // Q - second photo displayed below narrative
    "MC",                       // R
    "Setup/Teardown",           // S
    "AV/Zoom",                  // T
    "Greeter",                  // U
    "4-Way-Test",               // V
    "Thought",                  // W
    "Detective",                // X
    "Bag Person",               // Y
    "Comments",                 // Z
    "Sync Status",              // AA
    "Hash (do not edit)",       // AB
    "Photo Top URL (auto)",     // AC - written by Sync Photos; do not edit
    "Photo Bottom URL (auto)",  // AD - written by Sync Photos; do not edit
    "Introducer",               // AE - who introduces the speaker
    "Created By",               // AF - Event Editor: who created the row (delete permission)
    "Event Notes",              // AG - Event Editor: timestamped notes log
    "Hide from Newsletter",     // AH - Checkbox: exclude this event from the newsletter bulletin
  ];

  // Make sure the grid is wide enough for all columns (covers older sheets
  // created before columns were added — e.g. Created By / Event Notes).
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground("#1a3a6b");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(11);
  sheet.setFrozenRows(1);

  // Column widths
  const widths = [
    200,  // A Event ID
    130,  // B Event Type
    70,   // C Cancelled
    100,  // D Day
    100,  // E Date
    90,   // F Time
    90,   // G Duration
    200,  // H Location
    240,  // I Google Meet
    160,  // J Speaker(s) Organizer
    180,  // K Opening Speaker
    180,  // L Main Speaker
    200,  // M Main Topic
    280,  // N Speaker URL
    350,  // O Summary
    200,  // P Speaker Top Photo URL
    200,  // Q Speaker Bottom Photo URL
    150,  // R MC
    150,  // S Setup/Teardown
    120,  // T AV/Zoom
    150,  // U Greeter
    150,  // V 4-Way-Test
    150,  // W Thought
    150,  // X Detective
    150,  // Y Bag Person
    220,  // Z Comments
    180,  // AA Sync Status
    50,   // AB Hash
    280,  // AC Photo Top URL (auto)
    280,  // AD Photo Bottom URL (auto)
    150,  // AE Introducer
    140,  // AF Created By
    320,  // AG Event Notes
    140,  // AH Hide from Newsletter
  ];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Hide Event ID, Hash, and auto-URL columns
  sheet.hideColumns(COL.EVENT_ID);
  sheet.hideColumns(COL.HASH);
  sheet.hideColumns(COL.PHOTO_TOP_URL, 2); // AB + AC

  // Event Type dropdown
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(EVENT_TYPES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL.EVENT_TYPE, 500, 1).setDataValidation(typeRule);

  // Cancelled checkbox — cover plenty of rows so new rows inherit it
  sheet.getRange(2, COL.CANCELLED, 1000, 1).insertCheckboxes();

  // Hide-from-Newsletter checkbox (AH) — same treatment as Cancelled
  sheet.getRange(2, COL.EXCLUDE_NEWSLETTER, 1000, 1).insertCheckboxes();

  // DAY_LABEL: single ARRAYFORMULA in D2 covers the whole column automatically.
  // This prevents Sheets from copying the formula into adjacent cells when new rows are added.
  // Shows "Tue, Sep W3" only for Meeting or blank Event Type; empty otherwise.
  sheet.getRange(2, COL.DAY_LABEL, 1000, 1).clearContent(); // clear any old individual formulas
  sheet.getRange(2, COL.DAY_LABEL).setFormula(
    '=ARRAYFORMULA(' +
      'IF(OR(B2:B="Meeting",B2:B=""),' +
        'IF(ISNUMBER(E2:E),' +
          'TEXT(E2:E,"ddd")&", "&TEXT(E2:E,"mmm")&" W"&INT((DAY(E2:E)-1)/7+1),' +
          '""' +
        '),' +
        '""' +
      ')' +
    ')'
  );
  sheet.getRange(2, COL.DAY_LABEL, 500, 1)
    .setFontStyle("italic")
    .setFontColor("#555555");

  // Date format
  sheet.getRange(2, COL.DATE, 500, 1).setNumberFormat("yyyy-mm-dd");

  // Time format
  sheet.getRange(2, COL.TIME, 500, 1).setNumberFormat("h:mm am/pm");

  // Duration: plain number
  sheet.getRange(2, COL.DURATION, 500, 1).setNumberFormat("0");

  // Apply month colors to Day column if data already exists
  colorDayColumn(sheet);

  SpreadsheetApp.getUi().alert(
    "Sheet is ready!\n\n" +
    "Next steps:\n" +
    "1. Update CALENDAR_ID at the top of the script\n" +
    "2. Use 'Pull from Calendar' to import existing events,\n" +
    "   or add rows manually and use 'Push to Calendar'"
  );
}

// ── PULL: Calendar → Sheet ────────────────────────────────────
function pullFromCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Sheet "' + SHEET_NAME + '" not found. Run Setup first.');
    return;
  }

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) {
    SpreadsheetApp.getUi().alert("Calendar not found. Check CALENDAR_ID in the script.");
    return;
  }

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + PULL_DAYS_AHEAD);
  const events = cal.getEvents(now, future);

  // Build map of existing Event IDs → row number
  const lastRow = sheet.getLastRow();
  const existingIdMap = {};
  if (lastRow > 1) {
    sheet.getRange(2, COL.EVENT_ID, lastRow - 1, 1).getValues()
      .forEach((row, i) => { if (row[0]) existingIdMap[row[0]] = i + 2; });
  }

  let created = 0, updated = 0;

  events.forEach(event => {
    const id = event.getId();
    const rowData = eventToRow(event);

    if (existingIdMap[id]) {
      const targetRow = existingIdMap[id];
      // Write cols 1-3 (A-C), skip col 4 (DAY_LABEL formula), write remaining
      sheet.getRange(targetRow, 1, 1, 3).setValues([rowData.slice(0, 3)]);
      const tail = rowData.slice(4);
      sheet.getRange(targetRow, 5, 1, tail.length).setValues([tail]);
      updated++;
    } else {
      sheet.appendRow(rowData);
      created++;
    }
  });

  applyRowColors(sheet);
  sortByDate(sheet);

  SpreadsheetApp.getUi().alert(
    `Pull complete!\n✅ ${created} new events\n🔄 ${updated} updated`
  );
}

// ── PUSH: Sheet → Calendar ────────────────────────────────────
function pushToCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Sheet "' + SHEET_NAME + '" not found. Run Setup first.');
    return;
  }

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) {
    SpreadsheetApp.getUi().alert("Calendar not found. Check CALENDAR_ID in the script.");
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert("No data rows found."); return; }

  const data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
  let created = 0, updated = 0, skipped = 0, unchanged = 0, errors = 0;

  data.forEach((row, i) => {
    const sheetRow = i + 2;
    const dateVal  = row[COL.DATE - 1];
    if (!dateVal) { skipped++; return; }
    // Holidays are display-only — never push to Google Calendar
    if (String(row[COL.EVENT_TYPE - 1] || "").toLowerCase() === "holiday") { skipped++; return; }

    // Skip rows that haven't changed since the last push
    const currentHash = rowHash(row);
    const storedHash  = String(row[COL.HASH - 1] || "");
    if (currentHash === storedHash && row[COL.EVENT_ID - 1]) {
      unchanged++;
      return;
    }

    const eventType = row[COL.EVENT_TYPE - 1] || "Meeting";
    const timeVal   = row[COL.TIME - 1];
    const duration  = parseInt(row[COL.DURATION - 1]) || 60;
    const eventId   = row[COL.EVENT_ID - 1];

    try {
      const { start, end } = buildDateTimes(dateVal, timeVal, duration);
      const title   = buildTitle(row);
      const options = buildEventOptions(row);

      if (eventId) {
        try {
          const existing = cal.getEventById(eventId);
          if (existing) {
            existing.setTitle(title);
            existing.setTime(start, end);
            existing.setLocation(options.location || "");
            existing.setDescription(options.description || "");
            sheet.getRange(sheetRow, COL.STATUS).setValue("✅ Updated " + timestamp());
            sheet.getRange(sheetRow, COL.HASH).setValue(currentHash);
            updated++;
          } else {
            const newEvt = cal.createEvent(title, start, end, options);
            sheet.getRange(sheetRow, COL.EVENT_ID).setValue(newEvt.getId());
            sheet.getRange(sheetRow, COL.STATUS).setValue("✅ Re-created " + timestamp());
            sheet.getRange(sheetRow, COL.HASH).setValue(currentHash);
            created++;
          }
        } catch(e) {
          const newEvt = cal.createEvent(title, start, end, options);
          sheet.getRange(sheetRow, COL.EVENT_ID).setValue(newEvt.getId());
          sheet.getRange(sheetRow, COL.STATUS).setValue("✅ Created " + timestamp());
          sheet.getRange(sheetRow, COL.HASH).setValue(currentHash);
          created++;
        }
      } else {
        const newEvt = cal.createEvent(title, start, end, options);
        sheet.getRange(sheetRow, COL.EVENT_ID).setValue(newEvt.getId());
        sheet.getRange(sheetRow, COL.STATUS).setValue("✅ Created " + timestamp());
        sheet.getRange(sheetRow, COL.HASH).setValue(currentHash);
        created++;
      }

      // Throttle: pause 500ms every 5 actual API calls
      if ((created + updated) % 5 === 0) Utilities.sleep(500);

    } catch(e) {
      sheet.getRange(sheetRow, COL.STATUS).setValue("❌ " + e.message);
      errors++;
    }
  });

  applyRowColors(sheet);

  SpreadsheetApp.getUi().alert(
    `Push complete!\n` +
    `✅ ${created} created  🔄 ${updated} updated\n` +
    `⏭️ ${unchanged} unchanged  ➖ ${skipped} skipped  ❌ ${errors} errors`
  );
}

// ── HELPERS ───────────────────────────────────────────────────

/** Convert a Calendar event → sheet row array */
function eventToRow(event) {
  const tz    = Session.getScriptTimeZone();
  const start = event.getStartTime();
  const end   = event.getEndTime();
  const desc  = event.getDescription() || "";
  const title = event.getTitle();

  const durationMin = Math.round((end - start) / 60000);

  // Detect cancellation from title prefix
  const cancelled = title.toLowerCase().startsWith("cancelled -");

  // Parse all tagged fields from description
  const get = (label) => {
    const m = desc.match(new RegExp(`^${escapeRegex(label)}:\\s*(.+)`, "mi"));
    return m ? m[1].trim() : "";
  };

  const openingSpeaker = get("Opening Speaker");
  const mainSpeaker    = get("Main Speaker");
  const mainTopic      = get("Main Topic");
  const mc             = get("MC");
  const setupTeardown  = get("Setup/Teardown");
  const avZoom         = get("AV/Zoom");
  const greeter        = get("Greeter");
  const fourWayTest    = get("4-Way-Test");
  const thought        = get("Thought");
  const detective      = get("Detective");
  const bagPerson      = get("Bag Person");
  const speakerUrl     = get("More Info");
  const meetLink       = get("Meet") ||
    (desc.match(/(https:\/\/meet\.google\.com\/\S+)/i) || [])[1] || "";
  const eventType      = get("Type") || guessType(title);

  // Strip all tagged lines to get clean summary body
  const allLabels = [
    "Type","Opening Speaker","Main Speaker","Main Topic","Introducer",
    "MC","Setup/Teardown","AV/Zoom","Greeter","4-Way-Test",
    "Thought","Detective","Bag Person","Meet","More Info"
  ];
  let summary = desc;
  allLabels.forEach(label => {
    summary = summary.replace(
      new RegExp(`^${escapeRegex(label)}:\\s*.+\\n?`, "mi"), ""
    );
  });
  summary = summary
    .replace(/(https:\/\/meet\.google\.com\/\S+)/gi, "")
    .trim();

  return [
    event.getId(),       // A  COL.EVENT_ID = 1
    eventType,           // B  COL.EVENT_TYPE = 2
    cancelled,           // C  COL.CANCELLED = 3
    "",                  // D  COL.DAY_LABEL = 4 (formula, not written)
    Utilities.formatDate(start, tz, "yyyy-MM-dd"), // E  COL.DATE = 5
    Utilities.formatDate(start, tz, "h:mm a"),     // F  COL.TIME = 6
    durationMin || 60,   // G  COL.DURATION = 7
    event.getLocation() || "", // H  COL.LOCATION = 8
    meetLink,            // I  COL.GOOGLE_MEET = 9
    "",                  // J  COL.SPEAKER_ORGANIZER = 10 (not in Calendar)
    openingSpeaker,      // K  COL.OPENING_SPEAKER = 11
    mainSpeaker,         // L  COL.MAIN_SPEAKER = 12
    mainTopic,           // M  COL.MAIN_TOPIC = 13
    speakerUrl,          // N  COL.SPEAKER_URL = 14
    summary,             // O  COL.SUMMARY = 15
    "",                  // P  COL.PHOTO_TOP = 16 (not in Calendar)
    "",                  // Q  COL.PHOTO_BOTTOM = 17 (not in Calendar)
    mc,                  // R  COL.MC = 18
    setupTeardown,       // S  COL.SETUP_TEARDOWN = 19
    avZoom,              // T  COL.AV_ZOOM = 20
    greeter,             // U  COL.GREETER = 21
    fourWayTest,         // V  COL.FOUR_WAY_TEST = 22
    thought,             // W  COL.THOUGHT = 23
    detective,           // X  COL.DETECTIVE = 24
    bagPerson,           // Y  COL.BAG_PERSON = 25
    "",                  // Z  COL.COMMENTS = 26 (user-managed, not overwritten)
    "Pulled " + timestamp(), // AA  COL.STATUS = 27
  ];
}

/** Build the Calendar event title */
function buildTitle(row) {
  const cancelled   = row[COL.CANCELLED - 1];
  const type        = row[COL.EVENT_TYPE - 1]   || "Meeting";
  const mainSpeaker = row[COL.MAIN_SPEAKER - 1] || "";
  const mainTopic   = row[COL.MAIN_TOPIC - 1]   || "";

  let title = `SLV Rotary ${type}`;

  if (mainSpeaker && mainTopic) {
    title += ` - ${mainSpeaker}: ${mainTopic}`;
  } else if (mainSpeaker) {
    title += ` - ${mainSpeaker}`;
  } else if (mainTopic) {
    title += ` - ${mainTopic}`;
  }

  if (cancelled) title = `Cancelled - ${title}`;

  return title;
}

/** Build the Calendar event options (location + structured description) */
function buildEventOptions(row) {
  const location       = row[COL.LOCATION - 1]        || "";
  const meetLink       = row[COL.GOOGLE_MEET - 1]      || "";
  const openingSpeaker = row[COL.OPENING_SPEAKER - 1]  || "";
  const mainSpeaker    = row[COL.MAIN_SPEAKER - 1]     || "";
  const mainTopic      = row[COL.MAIN_TOPIC - 1]       || "";
  const description    = row[COL.SUMMARY - 1]          || "";  // Summary is the calendar body
  const speakerUrl     = row[COL.SPEAKER_URL - 1]      || "";
  const introducer     = row[COL.INTRODUCER - 1]       || "";
  const eventType      = row[COL.EVENT_TYPE - 1]       || "Meeting";

  // Build structured header block
  let desc = "";
  if (eventType)      desc += `Type: ${eventType}\n`;
  if (openingSpeaker) desc += `Opening Speaker: ${openingSpeaker}\n`;
  if (mainSpeaker)    desc += `Main Speaker: ${mainSpeaker}\n`;
  if (mainTopic)      desc += `Main Topic: ${mainTopic}\n`;
  if (introducer)     desc += `Introducer: ${introducer}\n`;
  if (meetLink)       desc += `Meet: ${meetLink}\n`;
  if (speakerUrl)     desc += `More Info: ${speakerUrl}\n`;

  // Free-form description body
  if (description)    desc += `\n${description}\n`;

  // Role assignments block
  const roles = ROLE_FIELDS
    .map(f => {
      const val = row[f.col - 1] || "";
      return val ? `${f.label}: ${val}` : "";
    })
    .filter(Boolean)
    .join("\n");

  if (roles) desc += `\n${roles}`;

  return {
    location:    location,
    description: desc.trim(),
  };
}

/** Guess event type from title when not tagged */
function guessType(title) {
  const t = title.toLowerCase().replace(/^cancelled\s*-\s*/i, "");
  if (t.includes("board"))     return "Board Meeting";
  if (t.includes("district"))  return "District Event";
  if (t.includes("fundrais"))  return "Fundraiser";
  if (t.includes("social"))    return "Social";
  if (t.includes("grey bears") || t.includes("gray bears")) return "Grey Bears";
  if (t.includes("service"))   return "Service";
  if (t.includes("assembly"))  return "Assembly";
  if (t.includes("holiday"))   return "Holiday";
  if (t.includes("committee")) return "Committee";
  if (t.includes("meeting"))   return "Meeting";
  return "Other";
}

/** Build start/end Date objects from sheet values */
function buildDateTimes(dateVal, timeVal, durationMin) {
  const tz = Session.getScriptTimeZone();
  const dateStr = (dateVal instanceof Date)
    ? Utilities.formatDate(dateVal, tz, "yyyy-MM-dd")
    : String(dateVal).trim();

  let timeStr = "7:15 AM";
  if (timeVal instanceof Date) {
    timeStr = Utilities.formatDate(timeVal, tz, "h:mm a");
  } else if (timeVal) {
    timeStr = String(timeVal).trim();
  }

  const start = new Date(dateStr + " " + timeStr);
  if (isNaN(start)) throw new Error("Invalid date/time: " + dateStr + " " + timeStr);
  const end = new Date(start.getTime() + durationMin * 60000);
  return { start, end };
}

/** Apply event type text color/bold to all data rows; grey background for cancelled */
function applyRowColors(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, COL.EVENT_TYPE, lastRow - 1, 2).getValues();
  data.forEach((row, i) => {
    const sheetRow = i + 2;
    const type      = String(row[0]).toLowerCase().trim();
    const cancelled = row[1];
    const style     = TYPE_STYLES[type] || DEFAULT_STYLE;
    const rowRange  = sheet.getRange(sheetRow, 1, 1, NUM_COLS);

    // Background: grey if cancelled, white otherwise
    rowRange.setBackground(cancelled ? "#cccccc" : "#ffffff");

    // Text: dimmed if cancelled, otherwise apply type color+bold
    rowRange.setFontColor(cancelled ? "#888888" : style.color);
    rowRange.setFontWeight((!cancelled && style.bold) ? "bold" : "normal");

    // Day column gets its own month color (overrides row color for that cell)
    const dateVal = sheet.getRange(sheetRow, COL.DATE).getValue();
    applyDayCellStyle(sheet.getRange(sheetRow, COL.DAY_LABEL), dateVal, cancelled);
  });
}

/** Color column D (DAY_LABEL) text by month; called per-cell and in bulk */
function colorDayColumn(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dates     = sheet.getRange(2, COL.DATE,      lastRow - 1, 1).getValues();
  const cancelled = sheet.getRange(2, COL.CANCELLED, lastRow - 1, 1).getValues();
  dates.forEach((row, i) => {
    applyDayCellStyle(
      sheet.getRange(i + 2, COL.DAY_LABEL),
      row[0],
      cancelled[i][0]
    );
  });
}

/**
 * Set font color on a single Day cell based on month and cancelled state.
 * Odd months → teal #00695c, Even months → indigo #283593
 */
function applyDayCellStyle(cell, dateVal, cancelled) {
  if (cancelled) {
    cell.setFontColor("#888888").setFontStyle("italic");
    return;
  }
  if (!dateVal || !(dateVal instanceof Date)) {
    cell.setFontColor("#555555").setFontStyle("italic");
    return;
  }
  const month = dateVal.getMonth() + 1;
  cell.setFontColor(month % 2 === 1 ? "#00695c" : "#283593").setFontStyle("italic");
}

/** Sort data rows by date ascending */
function sortByDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet.getRange(2, 1, lastRow - 1, NUM_COLS).sort({ column: COL.DATE, ascending: true });
}

/** Escape special regex characters in a label string */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short timestamp for Status column */
function timestamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yy h:mm a");
}

/**
 * Compute a simple hash string from all calendar-relevant fields in a row.
 * If this matches the stored HASH column value, the row hasn't changed since
 * the last push and can be safely skipped.
 */
function rowHash(row) {
  const fields = [
    COL.EVENT_TYPE, COL.CANCELLED, COL.DATE, COL.TIME, COL.DURATION,
    COL.LOCATION, COL.GOOGLE_MEET, COL.OPENING_SPEAKER, COL.MAIN_SPEAKER,
    COL.MAIN_TOPIC, COL.SPEAKER_URL, COL.SUMMARY, COL.MC, COL.SETUP_TEARDOWN, COL.AV_ZOOM,
    COL.GREETER, COL.FOUR_WAY_TEST, COL.THOUGHT, COL.DETECTIVE, COL.BAG_PERSON, COL.INTRODUCER,
  ];
  const str = fields.map(c => String(row[c - 1] || "")).join("|");
  // Simple DJB2-style hash — fast and collision-resistant enough for this use
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // keep 32-bit int
  }
  return String(hash >>> 0); // unsigned
}


// ═══════════════════════════════════════════════════════════════
//  NEWSLETTER GENERATOR
// ═══════════════════════════════════════════════════════════════

const NEWSLETTER_DETAIL_COUNT = 3;   // full detail blocks for next N *meetings*
const NEWSLETTER_WEEKS_AHEAD  = 12;  // lookahead for skim list and calendar
const CLUB_NAME = "SLV Rotary";

// Which event types get full detail treatment
const DETAIL_TYPES = ["meeting", "board meeting"];

function generateNewsletter() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { SpreadsheetApp.getUi().alert('Sheet "' + SHEET_NAME + '" not found.'); return; }

  const tz     = Session.getScriptTimeZone();
  const today  = new Date(); today.setHours(0,0,0,0);
  const cutoff = new Date(today.getTime() + NEWSLETTER_WEEKS_AHEAD * 7 * 24 * 3600 * 1000);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert("No events found."); return; }

  const data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
  const val   = (row, col) => String(row[col - 1] || "").trim();

  // ── Partition ────────────────────────────────────────────────
  // upcomingDetail  = future meetings/board meetings, not cancelled, within cutoff
  // upcomingSkim    = ALL future events within cutoff (including socials etc.)
  // recentMeetings  = past meetings with a summary or description
  const upcomingDetail  = [];
  const upcomingSkim    = [];
  const recentMeetings  = [];

  data.forEach(row => {
    const dateVal = row[COL.DATE - 1];
    if (!dateVal || !(dateVal instanceof Date)) return;
    if (row[COL.EXCLUDE_NEWSLETTER - 1] === true) return; // hidden from newsletter
    const d = new Date(dateVal); d.setHours(0,0,0,0);
    const cancelled = row[COL.CANCELLED - 1];
    const type      = val(row, COL.EVENT_TYPE).toLowerCase() || "meeting";

    if (d >= today && d <= cutoff) {
      upcomingSkim.push(row);  // all future events for skim + grid
      if (!cancelled && DETAIL_TYPES.includes(type)) {
        upcomingDetail.push(row);
      }
    } else if (d < today && type === "meeting") {
      recentMeetings.push(row);
    }
  });

  upcomingDetail.sort((a,b) => a[COL.DATE-1] - b[COL.DATE-1]);
  upcomingSkim.sort((a,b)   => a[COL.DATE-1] - b[COL.DATE-1]);
  recentMeetings.sort((a,b) => b[COL.DATE-1] - a[COL.DATE-1]);

  const detailRows = upcomingDetail
    .filter(r => val(r, COL.MAIN_SPEAKER) || val(r, COL.MAIN_TOPIC))
    .slice(0, NEWSLETTER_DETAIL_COUNT);
  // Skim = ALL upcoming events within the cutoff (already filtered by date above)
  // Board meetings, socials, service — everything appears here
  const skimRows = upcomingSkim; // no slice — use full 12-week window
  const recentRows = recentMeetings.slice(0, 2);

  // ── Create Doc ───────────────────────────────────────────────
  const dateStr    = Utilities.formatDate(today, tz, "MMMM d, yyyy");
  const datePrefix = Utilities.formatDate(today, tz, "yyyy-MM-dd");
  const docTitle   = datePrefix + " " + CLUB_NAME + " Newsletter";
  const doc        = DocumentApp.create(docTitle);
  const docFile    = DriveApp.getFileById(doc.getId());

  // Move to "Rotary" folder (create if it doesn't exist)
  const folders = DriveApp.getFoldersByName("Rotary");
  const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder("Rotary");
  folder.addFile(docFile);
  DriveApp.getRootFolder().removeFile(docFile); // remove from root

  const body = doc.getBody();
  body.clear();
  body.setMarginLeft(54).setMarginRight(54).setMarginTop(54).setMarginBottom(54);

  // ── Doc helpers ──────────────────────────────────────────────

  // The correct way to set heading style in Apps Script Docs API
  const H1 = DocumentApp.ParagraphHeading.HEADING1;
  const H2 = DocumentApp.ParagraphHeading.HEADING2;
  const H3 = DocumentApp.ParagraphHeading.HEADING3;
  const NORMAL = DocumentApp.ParagraphHeading.NORMAL;

  function addHeading(text, level, color) {
    const p = body.appendParagraph(text);
    p.setHeading(level);
    p.editAsText().setForegroundColor(color || "#1a3a6b");
    return p;
  }

  function addParagraph(text, opts) {
    opts = opts || {};
    const p = body.appendParagraph(text || "");
    if (opts.heading) p.setHeading(opts.heading);
    const t = p.editAsText();
    if (opts.color)   t.setForegroundColor(opts.color);
    if (opts.bold)    t.setBold(true);
    if (opts.italic)  t.setItalic(true);
    if (opts.size)    t.setFontSize(opts.size);
    if (opts.center)  p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    return p;
  }

  function addBoldLine(label, text) {
    // "Label: text" with label bolded — use setAttribute approach to avoid index errors
    const fullText = label + ": " + (text || "");
    const p = body.appendParagraph(fullText);
    p.editAsText().setFontSize(11);
    // Bold just the label portion (0 to label.length - 1 inclusive)
    if (label.length > 0) {
      p.editAsText().setBold(0, label.length - 1, true);
      // Un-bold the rest
      if (fullText.length > label.length) {
        p.editAsText().setBold(label.length, fullText.length - 1, false);
      }
    }
    p.setIndentStart(18);
    return p;
  }

  function addRule() {
    const p = body.appendParagraph("──────────────────────────────────────────");
    p.editAsText().setForegroundColor("#cccccc").setFontSize(7);
    p.setSpacingBefore(6).setSpacingAfter(6);
  }

  function fmtDateTime(dateVal, timeVal) {
    const d = Utilities.formatDate(dateVal, tz, "EEEE, MMMM d");
    if (!timeVal) return d;
    const t = timeVal instanceof Date
      ? Utilities.formatDate(timeVal, tz, "h:mm a") : String(timeVal);
    return d + " at " + t;
  }

  function embedPhoto(photo) {
    if (!photo || !photo.startsWith("http")) return;
    try {
      const blob = UrlFetchApp.fetch(photo).getBlob();
      const img  = body.appendImage(blob);
      const ow   = img.getWidth(), oh = img.getHeight();
      img.setWidth(300);
      if (ow > 0) img.setHeight(Math.round(oh * 300 / ow));
      body.appendParagraph("");
    } catch(e) {
      const lp = body.appendParagraph("📷 Photo: " + photo);
      lp.editAsText().setFontSize(9).setForegroundColor("#888888");
    }
  }

  // ── MASTHEAD ─────────────────────────────────────────────────
  const titleP = body.appendParagraph(CLUB_NAME);
  titleP.setHeading(H1);
  titleP.editAsText().setForegroundColor("#1a3a6b").setBold(true).setFontSize(26);
  titleP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  titleP.setSpacingAfter(4);

  const subP = body.appendParagraph("Weekly Newsletter  ·  " + dateStr);
  subP.editAsText().setFontSize(10).setForegroundColor("#666666").setItalic(true);
  subP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  subP.setSpacingAfter(12);

  // ── COMING UP — DETAIL BLOCKS ─────────────────────────────────
  if (detailRows.length > 0) {
    const h = body.appendParagraph("Coming Up");
    h.setHeading(H2);
    h.editAsText().setForegroundColor("#1a3a6b").setFontSize(18);
    h.setSpacingAfter(8);

    detailRows.forEach(row => {
      const dateVal  = row[COL.DATE - 1];
      const timeVal  = row[COL.TIME - 1];
      const type     = val(row, COL.EVENT_TYPE) || "Meeting";
      const location = val(row, COL.LOCATION);
      const speaker  = val(row, COL.MAIN_SPEAKER);
      const topic    = val(row, COL.MAIN_TOPIC);
      const opening  = val(row, COL.OPENING_SPEAKER);
      const summary     = val(row, COL.SUMMARY);
      const speakerUrl  = val(row, COL.SPEAKER_URL);
      const photoTop    = val(row, COL.PHOTO_TOP);
      const photoBottom = val(row, COL.PHOTO_BOTTOM);
      const meet        = val(row, COL.GOOGLE_MEET);

      // Event heading: "Jun 3: Meeting — Jane Smith: Water Conservation"
      const dayLabel = Utilities.formatDate(dateVal, tz, "MMM d");
      let hText = dayLabel + ": " + type;
      if (speaker && topic)  hText += " — " + speaker + ": " + topic;
      else if (speaker)      hText += " — " + speaker;
      else if (topic)        hText += " — " + topic;

      const eh = body.appendParagraph(hText);
      eh.setHeading(H3);
      eh.editAsText().setForegroundColor("#1a56db").setFontSize(14);
      eh.setSpacingBefore(10).setSpacingAfter(2);

      // Date / location meta line
      let meta = fmtDateTime(dateVal, timeVal);
      if (location) meta += "  ·  " + location;
      const mp = body.appendParagraph(meta);
      mp.editAsText().setFontSize(10).setForegroundColor("#555555").setItalic(true);
      mp.setSpacingAfter(6);

      // Top photo (speaker headshot or event banner)
      embedPhoto(photoTop);

      // Opening speaker
      if (opening) addBoldLine("Opening", opening);

      // Summary paragraph
      if (summary) {
        body.appendParagraph("").setSpacingAfter(0);
        body.appendParagraph(summary).editAsText().setFontSize(11);
      }

      // Bottom photo (additional event or venue image)
      embedPhoto(photoBottom);

      // Google Meet link
      if (meet) {
        const lp = body.appendParagraph("Join online: ");
        lp.editAsText().setFontSize(10);
        lp.appendText(meet).editAsText().setLinkUrl(meet).setForegroundColor("#1a56db");
      }

      // Speaker / topic URL
      if (speakerUrl) {
        const lp = body.appendParagraph("More info: " + speakerUrl);
        const t  = lp.editAsText();
        t.setFontSize(10);
        const s = "More info: ".length;
        const e = s + speakerUrl.length - 1;
        t.setForegroundColor(s, e, "#1a56db");
        t.setLinkUrl(s, e, speakerUrl);
      }

      // Duty roster — always show all roles (filled or TBD)
      body.appendParagraph("").setSpacingAfter(0);
      const dh = body.appendParagraph("Meeting Duties");
      dh.editAsText().setBold(true).setFontSize(10).setForegroundColor("#333333");
      dh.setSpacingAfter(2);

      const filled = ROLE_FIELDS.filter(f => val(row, f.col));
      const tbd    = ROLE_FIELDS.filter(f => !val(row, f.col));

      filled.forEach(f => addBoldLine(f.label, val(row, f.col)));

      if (tbd.length > 0) {
        const p = body.appendParagraph("  " + tbd.map(f => f.label).join(", ") + ": TBD");
        p.editAsText().setFontSize(9).setForegroundColor("#999999");
        p.setIndentStart(18);
      }

      body.appendParagraph("").setSpacingAfter(0);
      addRule();
    });
  }

  // ── LOOKING AHEAD — SKIM LIST ────────────────────────────────
  if (skimRows.length > 0) {
    body.appendParagraph("").setSpacingAfter(0);
    const lh = body.appendParagraph("Looking Ahead");
    lh.setHeading(H2);
    lh.editAsText().setForegroundColor("#1a3a6b").setFontSize(18);
    lh.setSpacingAfter(4);

    const note = body.appendParagraph("Speakers are subject to change — more to be announced soon!");
    note.editAsText().setFontSize(9).setForegroundColor("#888888").setItalic(true);
    note.setSpacingAfter(8);

    let curMonth = "";
    skimRows.forEach(row => {
      const dateVal   = row[COL.DATE - 1];
      const timeVal   = row[COL.TIME - 1];
      const type      = val(row, COL.EVENT_TYPE) || "Meeting";
      const typeLower = type.toLowerCase();
      const speaker   = val(row, COL.MAIN_SPEAKER);
      const topic     = val(row, COL.MAIN_TOPIC);
      const location  = val(row, COL.LOCATION);
      const cancelled = row[COL.CANCELLED - 1];
      const isMeeting = DETAIL_TYPES.includes(typeLower);

      const mo = Utilities.formatDate(dateVal, tz, "MMMM yyyy");
      if (mo !== curMonth) {
        curMonth = mo;
        body.appendParagraph("").setSpacingAfter(0);
        const mh = body.appendParagraph(mo);
        mh.editAsText().setBold(true).setFontSize(12).setForegroundColor("#1a3a6b");
        mh.setSpacingBefore(6).setSpacingAfter(2);
      }

      const day = Utilities.formatDate(dateVal, tz, "EEE MMM d");

      // Abbreviated time: "7a", "715a", "530p"
      let tAbbrev = "";
      if (timeVal) {
        const td = timeVal instanceof Date ? timeVal : new Date("1970-01-01 " + timeVal);
        if (!isNaN(td)) {
          const h   = td.getHours();
          const m   = td.getMinutes();
          const ampm = h >= 12 ? "p" : "a";
          const h12  = h % 12 || 12;
          tAbbrev = m === 0 ? h12 + ampm : h12 + String(m).padStart(2,"0") + ampm;
        }
      }

      // Build the main line
      let line = day + (tAbbrev ? " " + tAbbrev : "") + "  " + type;

      if (isMeeting && !cancelled) {
        // Meetings: always show speaker/topic or TBD
        if (speaker && topic)       line += "  ·  " + speaker + ": " + topic;
        else if (speaker)           line += "  ·  " + speaker;
        else if (topic)             line += "  ·  " + topic;
        else                        line += "  ·  TBD";
      } else if (!cancelled) {
        // Other types: show speaker/topic if available
        if (speaker && topic)       line += "  ·  " + speaker + ": " + topic;
        else if (speaker)           line += "  ·  " + speaker;
        else if (topic)             line += "  ·  " + topic;
      }
      if (cancelled)                line += "  ❌ CANCELLED";

      const p = body.appendParagraph(line);
      p.editAsText().setFontSize(10);
      p.setSpacingBefore(1).setSpacingAfter(1);
      if (cancelled) {
        p.editAsText().setForegroundColor("#999999");
      } else {
        p.editAsText().setForegroundColor("#000000");
      }

      // Append venue name as a small map link at the end of the line
      if (location && !cancelled) {
        const venueName = location.split(",")[0].trim();
        const mapUrl    = "https://maps.google.com/?q=" + encodeURIComponent(location);
        const spacer    = "  📍 ";
        const startIdx  = p.getText().length;
        p.appendText(spacer + venueName);
        const linkStart = startIdx + spacer.length;
        const linkEnd   = linkStart + venueName.length - 1;
        p.editAsText().setFontSize(startIdx, linkEnd, 9);
        p.editAsText().setForegroundColor(startIdx, startIdx + spacer.length - 1, "#555555");
        p.editAsText().setForegroundColor(linkStart, linkEnd, "#1a56db");
        p.editAsText().setLinkUrl(linkStart, linkEnd, mapUrl);
      }
    });
  }

  // ── RECENT MEETINGS ──────────────────────────────────────────
  if (recentRows.length > 0) {
    body.appendParagraph("").setSpacingAfter(0);
    addRule();
    body.appendParagraph("").setSpacingAfter(0);
    const rh = body.appendParagraph("Recent Meetings");
    rh.setHeading(H2);
    rh.editAsText().setForegroundColor("#1a3a6b").setFontSize(18);
    rh.setSpacingAfter(8);

    recentRows.forEach(row => {
      const dateVal = row[COL.DATE - 1];
      const speaker = val(row, COL.MAIN_SPEAKER);
      const topic   = val(row, COL.MAIN_TOPIC);
      const summary     = val(row, COL.SUMMARY);
      const speakerUrl  = val(row, COL.SPEAKER_URL);
      const photoTop    = val(row, COL.PHOTO_TOP);
      const photoBottom = val(row, COL.PHOTO_BOTTOM);

      let label = Utilities.formatDate(dateVal, tz, "MMM d");
      if (speaker) label += ": " + speaker;
      if (topic)   label += (speaker ? " — " : ": ") + topic;

      const eh = body.appendParagraph(label);
      eh.setHeading(H3);
      eh.editAsText().setForegroundColor("#555555").setFontSize(13);
      eh.setSpacingBefore(8).setSpacingAfter(4);

      embedPhoto(photoTop);

      if (summary) body.appendParagraph(summary).editAsText().setFontSize(11);

      embedPhoto(photoBottom);

      if (speakerUrl) {
        const lp = body.appendParagraph("More info: " + speakerUrl);
        const t  = lp.editAsText();
        t.setFontSize(10);
        const s = "More info: ".length;
        const e = s + speakerUrl.length - 1;
        t.setForegroundColor(s, e, "#1a56db");
        t.setLinkUrl(s, e, speakerUrl);
      }
      body.appendParagraph("").setSpacingAfter(0);
    });
  }

  // ── CALENDAR GRID — 4 months ─────────────────────────────────
  body.appendParagraph("").setSpacingAfter(0);
  addRule();
  body.appendParagraph("").setSpacingAfter(0);
  const calH = body.appendParagraph("Calendar");
  calH.setHeading(H2);
  calH.editAsText().setForegroundColor("#1a3a6b").setFontSize(18);
  calH.setSpacingAfter(4);

  // Legend
  const legP = body.appendParagraph("Mtg = Meeting  ·  Brd Mtg = Board Meeting  ·  Com = Committee");
  legP.editAsText().setFontSize(8).setForegroundColor("#666666").setItalic(true);
  legP.setSpacingAfter(6);

  // Helper to abbreviate a time value as "7a", "7:15a", "5:30p"
  function timeAbbrev(timeVal) {
    if (!timeVal) return "";
    const td = timeVal instanceof Date ? timeVal : new Date("1970-01-01 " + timeVal);
    if (isNaN(td)) return "";
    const h    = td.getHours();
    const m    = td.getMinutes();
    const ampm = h >= 12 ? "p" : "a";
    const h12  = h % 12 || 12;
    return m === 0 ? h12 + ampm : h12 + String(m).padStart(2, "0") + ampm;
  }

  // Build event date map — store type and time abbreviation (cancelled events excluded)
  const eventMap = {};
  data.forEach(row => {
    const dv = row[COL.DATE - 1];
    if (!dv || !(dv instanceof Date)) return;
    if (row[COL.CANCELLED - 1]) return;
    const key = Utilities.formatDate(dv, tz, "yyyy-MM-dd");
    if (!eventMap[key]) eventMap[key] = [];
    eventMap[key].push({
      type:      val(row, COL.EVENT_TYPE).toLowerCase() || "meeting",
      timeAbbrev: timeAbbrev(row[COL.TIME - 1])
    });
  });

  const GRID_BG = {
    "meeting":        "#c7d7fb",
    "assembly":       "#a5f3fc",
    "board meeting":  "#93c5fd",
    "social":         "#bbf7d0",
    "service":        "#fdba74",
    "grey bears":     "#fde8d0",
    "fundraiser":     "#e9d5ff",
    "district event": "#86efac",
    "committee":      "#fce7f3",
    "holiday":        "#fca5a5",
    "other":          "#d1d5db"
  };
  const TYPE_ABBREV = {
    "meeting":        "Mtg",
    "assembly":       "Asm",
    "board meeting":  "Brd",
    "social":         "Social",
    "service":        "Service",
    "grey bears":     "GryBrs",
    "fundraiser":     "Fund",
    "district event": "Dist",
    "committee":      "Com",
    "holiday":        "Holiday",
    "other":          "Oth"
  };

  for (let m = 0; m < 4; m++) {
    const ms = new Date(today.getFullYear(), today.getMonth() + m, 1);
    body.appendParagraph("").setSpacingAfter(0);
    const mLabel = body.appendParagraph(Utilities.formatDate(ms, tz, "MMMM yyyy"));
    mLabel.editAsText().setBold(true).setFontSize(11).setForegroundColor("#1a3a6b");
    mLabel.setSpacingBefore(10).setSpacingAfter(2);

    const tbl = body.appendTable();
    tbl.setBorderWidth(1);

    // Header
    const hrow = tbl.appendTableRow();
    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d => {
      const c = hrow.appendTableCell(d);
      c.editAsText().setBold(true).setFontSize(8).setForegroundColor("#ffffff");
      c.setBackgroundColor("#1a3a6b");
      c.setPaddingTop(2).setPaddingBottom(2);
    });

    const daysInMonth = new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    let dayNum = 1 - ms.getDay();

    while (dayNum <= daysInMonth) {
      const wr = tbl.appendTableRow();
      for (let dow = 0; dow < 7; dow++, dayNum++) {
        if (dayNum < 1 || dayNum > daysInMonth) {
          const c = wr.appendTableCell("");
          c.setBackgroundColor("#f0f0f0");
          c.editAsText().setFontSize(8);
          c.setPaddingTop(2).setPaddingBottom(2);
        } else {
          const cd  = new Date(ms.getFullYear(), ms.getMonth(), dayNum);
          const key = Utilities.formatDate(cd, tz, "yyyy-MM-dd");
          const evs = eventMap[key] || [];

          let bg   = "#ffffff";
          let text = String(dayNum);

          if (evs.length > 0) {
            bg = GRID_BG[evs[0].type] || "#f3f4f6";
            const lines = evs.map(e => {
              const tPfx = e.timeAbbrev ? e.timeAbbrev + " " : "";
              return tPfx + (TYPE_ABBREV[e.type] || "Evt");
            });
            text = dayNum + "\n" + lines.join("\n");
          }

          const c = wr.appendTableCell(text);
          c.setBackgroundColor(bg);
          c.editAsText().setFontSize(8);
          c.setPaddingTop(2).setPaddingBottom(2);
        }
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────
  body.appendParagraph("").setSpacingAfter(0);
  const ft = body.appendParagraph("Generated " + dateStr + " · " + CLUB_NAME + " Calendar Sync");
  ft.editAsText().setFontSize(8).setForegroundColor("#aaaaaa").setItalic(true);
  ft.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  const url = docFile.getUrl();
  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;font-size:14px">Newsletter created!</p>' +
    '<p style="font-family:sans-serif"><a href="' + url + '" target="_blank">' +
    '📄 ' + docTitle + '</a></p>' +
    '<p style="font-family:sans-serif;font-size:11px;color:#666">Saved to your Rotary folder in Google Drive.</p>'
  ).setWidth(400).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, "Newsletter Ready");
}


// ═══════════════════════════════════════════════════════════════
//  DUTY EDITOR — WEB APP
//  Deploy via: Extensions > Apps Script > Deploy > New deployment
//  Type: Web app | Execute as: Me | Who has access: Anyone (or org)
// ═══════════════════════════════════════════════════════════════

/** Entry point for the deployed web app. Routes based on ?app= parameter. */
function doGet(e) {
  const app = (e && e.parameter && e.parameter.app) || '';
  const mode = HtmlService.XFrameOptionsMode.ALLOWALL;
  // Real /exec URL, injected into pages so cross-view nav links work from
  // inside the Apps Script sandbox iframe (relative links would 404/blank).
  let execUrl = '';
  try { execUrl = ScriptApp.getService().getUrl() || ''; } catch (_) {}
  const inject = (html) => html
    .replace(/__EXEC_URL__/g, execUrl)
    .replace(/__AI_ENABLED__/g, String(PIPELINE_AI_ENABLED));
  // Apps Script serves pages inside its own wrapper iframe and controls the
  // outer <head>, so a <meta viewport> inside the page HTML is ignored — phones
  // then render at a ~980px desktop width (tiny text, no media queries firing).
  // addMetaTag() injects the viewport into the real top-level page, fixing it.
  const out = (html, title) => HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(mode);
  if (app === 'assistant') {
    return out(getCalendarAssistantHtml(), "SLV Rotary — Calendar Assistant");
  }
  if (app === 'kanban') {
    return out(inject(getKanbanHtml()), "SLV Rotary — Speaker Pipeline (Kanban)");
  }
  if (app === 'pipeline') {
    return out(inject(getPipelineTableHtml()), "SLV Rotary — Speaker Pipeline (Table)");
  }
  if (app === 'speaker-pipeline') {
    return out(inject(getSpeakerStatusHtml()), "SLV Rotary — Speaker Pipeline Status");
  }
  if (app === 'events') {
    return out(inject(getEventEditorHtml()), "SLV Rotary — Event Editor");
  }
  if (app === 'publicSpeakers') {
    // JSONP endpoint for the public /speakers/ GitHub Pages page.
    // Sanitise callback name to alphanumeric/underscore only.
    const cb = ((e.parameter && e.parameter.callback) || 'speakersCallback').replace(/[^a-zA-Z0-9_]/g, '');
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(getPublicSpeakers_()) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return out(getDutyEditorHtml(), "SLV Rotary — Duty Editor");
}

/** Returns the public speaker list for the /speakers/ page (JSONP). */
function getPublicSpeakers_() {
  try {
    const sheet = getPipelineSheet_();
    if (!sheet) return { speakers: [] };
    const tz = Session.getScriptTimeZone();
    const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const data = sheet.getDataRange().getValues();
    const speakers = [];
    for (var i = 1; i < data.length; i++) {
      const row = data[i];
      const status = String(row[CP.STATUS - 1] || '');
      if (['new', 'in-progress', 'scheduled'].indexOf(status) === -1) continue;
      const name = String(row[CP.SPEAKER_NAME - 1] || '').trim();
      if (!name) continue;
      const tv = row[CP.TENTATIVE_DATE - 1];
      const tentativeDate = tv instanceof Date ? Utilities.formatDate(tv, tz, 'yyyy-MM-dd') : String(tv || '');
      // Scheduled speakers only surface once they're upcoming (today or later).
      if (status === 'scheduled' && (!tentativeDate || tentativeDate < todayStr)) continue;
      // Top photo, else bottom photo — shown as a small thumbnail on the page.
      const photo = String(row[CP.PHOTO_URL - 1] || '').trim() || String(row[CP.PHOTO_BOTTOM - 1] || '').trim();
      speakers.push({
        rowIndex:      i + 1,
        speakerName:   name,
        topic:         String(row[CP.TOPIC - 1] || ''),
        summary:       String(row[CP.SUMMARY - 1] || ''),
        priority:      String(row[CP.PRIORITY - 1] || ''),
        source:        String(row[CP.SOURCE - 1] || ''),   // offer = requested to speak (speak.md)
        status:        status,
        tentativeDate: tentativeDate,
        photo:         photo,
        hearts:        parseInt(row[CP.HEARTS - 1]) || 0,
      });
    }
    // Sort: scheduled (asc by date) → in-progress → new (most-recent first)
    const order = { 'scheduled': 0, 'in-progress': 1, 'new': 2 };
    speakers.sort(function(a, b) {
      const ao = order[a.status] || 9, bo = order[b.status] || 9;
      if (ao !== bo) return ao - bo;
      if (a.status === 'scheduled') {
        return a.tentativeDate < b.tentativeDate ? -1 : a.tentativeDate > b.tentativeDate ? 1 : 0;
      }
      return b.rowIndex - a.rowIndex;
    });
    return { speakers: speakers };
  } catch (e) {
    return { speakers: [], error: e.toString() };
  }
}

// Maximum form submissions accepted per calendar day across all form types.
const DAILY_SUBMISSION_LIMIT = 20;

/** Entry point for form submissions from the website (POST) */
function doPost(e) {
  try {
    if (isRateLimited_()) return jsonOut_({ ok: false, error: "rate_limited" });

    // Data arrives as URL-encoded form fields (hidden iframe submission).
    const p      = e.parameter || {};
    const action = String(p.action || "");

    // Checkboxes arrive as the string "true" or are absent — normalise to boolean.
    const boolFields = [
      "spokeToOrganizer", "spokeToPresident",
      "availMorning", "availEvening", "zoomOnly", "otherSuggestions",
      "isRotarian", "isLocal", "fundraisingLiterature",
    ];
    boolFields.forEach(function (k) { p[k] = p[k] === "true"; });

    if (action === "speakerRequest") return handleSpeakerRequest_(p);
    if (action === "speakerOffer")   return handleSpeakerOffer_(p);
    if (action === "heartSpeaker")  return handleHeartSpeaker_(p);
    if (action === "noteSpeaker")   return handleNoteSpeaker_(p);
    return jsonOut_({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}

/**
 * Returns true and logs a warning if today's submission count is at or above
 * DAILY_SUBMISSION_LIMIT. Uses a script lock so concurrent requests can't
 * both read the same count and both slip through.
 */
function isRateLimited_() {
  const lock  = LockService.getScriptLock();
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const key   = "sub_" + today;
  try {
    lock.waitLock(3000);
    const count = parseInt(props.getProperty(key) || "0");
    if (count >= DAILY_SUBMISSION_LIMIT) {
      Logger.log("Rate limit hit: " + count + " submissions today");
      return true;
    }
    props.setProperty(key, String(count + 1));
    return false;
  } catch (e) {
    Logger.log("Lock timeout in isRateLimited_: " + e.toString());
    return false; // fail open — let the submission through
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Remove daily "sub_YYYY-MM-DD" rate-limit counters from earlier days, keeping
 * today's (so the current day's running count isn't reset). These are created
 * by isRateLimited_() on each form POST and otherwise accumulate forever.
 * Safe to run anytime — deleting an old counter has no effect on rate limiting.
 */
function purgeOldRateCounters() {
  const props = PropertiesService.getScriptProperties();
  const all   = props.getProperties();
  const today = "sub_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  const stale = Object.keys(all).filter(function(k) {
    return k.indexOf("sub_") === 0 && k !== today;
  });
  stale.forEach(function(k) { props.deleteProperty(k); });

  try {
    SpreadsheetApp.getUi().alert(
      stale.length
        ? "Purged " + stale.length + " old rate counter" + (stale.length === 1 ? "" : "s") +
          ".\n(Today's counter, " + today + ", was kept.)"
        : "No old rate counters to purge."
    );
  } catch (_) {}
  return { ok: true, purged: stale.length };
}

/** Open the deployed web app URL from the sheet menu */
function openDutyEditor() {
  let url;
  try {
    url = ScriptApp.getService().getUrl();
  } catch(e) { url = null; }

  if (!url || !url.startsWith("https://script.google.com/macros/s/")) {
    SpreadsheetApp.getUi().alert(
      "Duty Editor is not yet deployed as a web app.\n\n" +
      "Steps:\n" +
      "  1. Extensions > Apps Script\n" +
      "  2. Deploy > New deployment\n" +
      "  3. Type: Web app\n" +
      "  4. Execute as: Me\n" +
      "  5. Who has access: Anyone (or your org)\n" +
      "  6. Click Deploy, copy the URL\n\n" +
      "Then run 'Open Duty Editor' again."
    );
    return;
  }

  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;font-size:14px">Opening Duty Editor in a new tab&hellip;</p>' +
    '<script>window.open("' + url + '","_blank");google.script.host.close();</script>'
  ).setWidth(360).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, "Duty Editor");
}

/**
 * Returns upcoming meeting data + member list for the duty editor page.
 * Called client-side via google.script.run.getPageData()
 */
function getPageData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');

  const tz      = Session.getScriptTimeZone();
  const today   = new Date(); today.setHours(0,0,0,0);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { meetings: [], members: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
  const upcoming = [];

  data.forEach((row, i) => {
    const dateVal = row[COL.DATE - 1];
    if (!dateVal || !(dateVal instanceof Date)) return;
    const d = new Date(dateVal); d.setHours(0,0,0,0);
    const type      = String(row[COL.EVENT_TYPE - 1] || "").toLowerCase();
    const cancelled = row[COL.CANCELLED - 1];
    if (d >= today && !cancelled && DETAIL_TYPES.includes(type)) {
      upcoming.push({ sheetRow: i + 2, row });
    }
  });

  upcoming.sort((a, b) => a.row[COL.DATE - 1] - b.row[COL.DATE - 1]);

  const cutoff = new Date(today.getTime() + NEWSLETTER_WEEKS_AHEAD * 7 * 24 * 3600 * 1000);
  const withinWindow = upcoming.filter(({ row }) => {
    const d = new Date(row[COL.DATE - 1]); d.setHours(0,0,0,0);
    return d <= cutoff;
  });

  const meetings = withinWindow.map(({ sheetRow, row }) => {
    const dateVal = row[COL.DATE - 1];
    const timeVal = row[COL.TIME - 1];
    const type    = String(row[COL.EVENT_TYPE - 1] || "Meeting");
    const speaker = String(row[COL.MAIN_SPEAKER - 1] || "");
    const topic   = String(row[COL.MAIN_TOPIC - 1]   || "");

    let title = type;
    if (speaker && topic) title += " — " + speaker + ": " + topic;
    else if (speaker)     title += " — " + speaker;
    else if (topic)       title += " — " + topic;

    const dateStr = Utilities.formatDate(dateVal, tz, "EEEE, MMMM d");
    const timeStr = timeVal instanceof Date
      ? Utilities.formatDate(timeVal, tz, "h:mm a")
      : String(timeVal || "");

    const duties = {};
    Object.keys(DUTY_COLS).forEach(key => {
      duties[key] = String(row[DUTY_COLS[key] - 1] || "");
    });

    return {
      rowIndex: sheetRow,
      title,
      dateStr,
      time:     timeStr,
      location: String(row[COL.LOCATION - 1] || ""),
      duties,
    };
  });

  // Member names from optional Members tab
  let members = [];
  const ms = ss.getSheetByName("Members");
  if (ms && ms.getLastRow() > 1) {
    members = ms.getRange(2, 1, ms.getLastRow() - 1, 1)
      .getValues()
      .map(r => String(r[0] || "").trim())
      .filter(Boolean)
      .sort();
  }

  return { meetings, members };
}

/**
 * Writes duty assignments back to the sheet for one meeting row.
 * Called client-side via google.script.run.saveDuties(rowIndex, duties)
 */
function saveDuties(rowIndex, duties) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  if (!rowIndex || rowIndex < 2) throw new Error("Invalid row index.");

  Object.keys(DUTY_COLS).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(duties, key)) {
      sheet.getRange(rowIndex, DUTY_COLS[key]).setValue(duties[key] || "");
    }
  });

  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yy h:mm a");
  sheet.getRange(rowIndex, COL.STATUS).setValue("✏️ Duties updated " + ts);
  recolorRow(sheet, rowIndex);
  return "Saved ✓ (" + ts + ")";
}


// ═══════════════════════════════════════════════════════════════
//  EVENT EDITOR  (?app=events)
//  Member-facing web app for creating / editing non-meeting events
//  (Social, Service, Fundraiser, etc.) without exposing the full sheet.
//  Shares the KANBAN_PASSWORD gate with the Speaker Pipeline apps.
//  Field mapping (see EDITOR_EVENT_TYPES + CLAUDE.md column table):
//    eventName → MAIN_TOPIC, organizer → SPEAKER_ORGANIZER,
//    link → SPEAKER_URL, photo → PHOTO_TOP, summary → SUMMARY.
// ═══════════════════════════════════════════════════════════════

/** Upcoming member-editable events (next 18 months) + member list, for the Event Editor. */
function getEventEditorData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');

  const tz      = Session.getScriptTimeZone();
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + EDITOR_WEEKS_AHEAD * 7 * 24 * 3600 * 1000);
  const lastRow = sheet.getLastRow();
  const events  = [];

  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
    data.forEach((row, i) => {
      const dv = row[COL.DATE - 1];
      if (!(dv instanceof Date)) return;
      const d = new Date(dv); d.setHours(0, 0, 0, 0);
      if (d < today || d > horizon) return;
      const type = String(row[COL.EVENT_TYPE - 1] || '');
      if (EVENT_TYPES.indexOf(type) === -1) return; // skip blank / unknown types
      const tv = row[COL.TIME - 1];
      events.push({
        rowIndex:  i + 2,
        eventType: type,
        cancelled: !!row[COL.CANCELLED - 1],
        date:      Utilities.formatDate(dv, tz, 'yyyy-MM-dd'),
        time:      tv instanceof Date ? Utilities.formatDate(tv, tz, 'h:mm a') : String(tv || ''),
        duration:  row[COL.DURATION - 1] || 60,
        location:  String(row[COL.LOCATION - 1]          || ''),
        eventName: String(row[COL.MAIN_TOPIC - 1]        || ''),
        organizer: String(row[COL.SPEAKER_ORGANIZER - 1] || ''),
        link:      String(row[COL.SPEAKER_URL - 1]       || ''),
        photo:     String(row[COL.PHOTO_TOP - 1]         || ''),
        summary:   String(row[COL.SUMMARY - 1]           || ''),
        mainSpeaker:    String(row[COL.MAIN_SPEAKER - 1]    || ''),
        openingSpeaker: String(row[COL.OPENING_SPEAKER - 1] || ''),
        introducer:     String(row[COL.INTRODUCER - 1]      || ''),
        googleMeet:     String(row[COL.GOOGLE_MEET - 1]     || ''),
        createdBy: String(row[COL.CREATED_BY - 1]        || ''),
        notes:     String(row[COL.EVENT_NOTES - 1]       || ''),
        hideFromNewsletter: !!row[COL.EXCLUDE_NEWSLETTER - 1],
      });
    });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let members = [];
  const ms = ss.getSheetByName('Members');
  if (ms && ms.getLastRow() > 1) {
    members = ms.getRange(2, 1, ms.getLastRow() - 1, 1)
      .getValues().map(r => String(r[0] || '').trim()).filter(Boolean).sort();
  }
  return { events: events, members: members, types: EDITOR_EVENT_TYPES, allTypes: EVENT_TYPES };
}

/**
 * Create or update one non-meeting event. Password-gated (KANBAN_PASSWORD).
 * payload: { rowIndex (0/blank = new), eventType, date 'yyyy-MM-dd',
 *            time 'h:mm a', duration, location, eventName, organizer,
 *            link, photo, summary, cancelled, editor }
 * Returns the fresh event list (row indices shift after the re-sort).
 */
function saveEvent(password, payload) {
  if (!checkPipelinePassword(password)) throw new Error('Not authorized — please log in again.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');

  const p    = payload || {};
  const type = String(p.eventType || '').trim();
  if (EVENT_TYPES.indexOf(type) === -1) throw new Error('Choose a valid event type.');
  if (!p.date) throw new Error('A date is required.');

  const who = String(p.editor || '').trim() || '?';
  const ts  = timestamp();
  const rowIndex = Number(p.rowIndex) || 0;
  let targetRow;

  if (rowIndex && rowIndex >= 2) {
    // Guard: only edit rows whose current type is a known event type.
    const curType = String(sheet.getRange(rowIndex, COL.EVENT_TYPE).getValue() || '');
    if (EVENT_TYPES.indexOf(curType) === -1) {
      throw new Error('That event is managed in the spreadsheet and cannot be edited here.');
    }
    const set = (col, val) => sheet.getRange(rowIndex, col).setValue(val);
    set(COL.EVENT_TYPE,        type);
    set(COL.CANCELLED,         !!p.cancelled);
    set(COL.DATE,              p.date);
    set(COL.TIME,              p.time || '');
    set(COL.DURATION,          Number(p.duration) || 60);
    set(COL.LOCATION,          p.location  || '');
    set(COL.MAIN_TOPIC,        p.eventName || '');
    set(COL.SPEAKER_ORGANIZER, p.organizer || '');
    set(COL.SPEAKER_URL,       p.link      || '');
    if (p.photo) set(COL.PHOTO_TOP, p.photo);   // don't clobber an embedded image with a blank
    set(COL.SUMMARY,           p.summary   || '');
    // Speaker/program fields only apply to meeting types (advanced mode). Duty
    // columns are deliberately never written — the Duty Editor owns those.
    if (SPEAKER_EVENT_TYPES.indexOf(type) !== -1) {
      set(COL.MAIN_SPEAKER,    p.mainSpeaker    || '');
      set(COL.OPENING_SPEAKER, p.openingSpeaker || '');
      set(COL.INTRODUCER,      p.introducer     || '');
      set(COL.GOOGLE_MEET,     p.googleMeet     || '');
    }
    set(COL.EXCLUDE_NEWSLETTER, !!p.hideFromNewsletter);
    set(COL.STATUS,            '✏️ Edited by ' + who + ' ' + ts);
    targetRow = rowIndex;
  } else {
    // New row: write A–C and E-onward, skipping column D (DAY_LABEL ARRAYFORMULA).
    const rowData = eventEditorBuildRow_(p, type, who, ts);
    targetRow = sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, 3).setValues([rowData.slice(0, 3)]);
    const tail = rowData.slice(4);
    sheet.getRange(targetRow, 5, 1, tail.length).setValues([tail]);
  }

  // Recolor only the touched row. A full sheet sort + recolor (what the AI
  // assistant's Apply does) is what made member saves slow enough to time out;
  // every view re-sorts by date on read, so leaving the sheet order alone here
  // is purely cosmetic and keeps saves near-instant.
  recolorRow(sheet, targetRow);
  return getEventEditorData();
}

/**
 * Delete one member-created event row. Password-gated, and only the member who
 * created the event (CREATED_BY) may delete it — others should cancel instead.
 */
function deleteEvent(password, rowIndex, editor) {
  if (!checkPipelinePassword(password)) throw new Error('Not authorized — please log in again.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  rowIndex = Number(rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error('Invalid row.');
  const type = String(sheet.getRange(rowIndex, COL.EVENT_TYPE).getValue() || '');
  if (EVENT_TYPES.indexOf(type) === -1) {
    throw new Error('That event is managed in the spreadsheet and cannot be deleted here.');
  }
  const creator = String(sheet.getRange(rowIndex, COL.CREATED_BY).getValue() || '').trim();
  const who     = String(editor || '').trim();
  if (!creator || !who || creator.toLowerCase() !== who.toLowerCase()) {
    throw new Error('Only the member who created this event' +
      (creator ? ' (' + creator + ')' : '') + ' can delete it. Mark it cancelled instead.');
  }
  sheet.deleteRow(rowIndex);
  return getEventEditorData();
}

/**
 * Prepend a timestamped note to an event's EVENT_NOTES cell (newest first),
 * mirroring the speaker-pipeline notes log. Password-gated; editor-types only.
 */
function addEventNote(password, rowIndex, noteText, author) {
  if (!checkPipelinePassword(password)) throw new Error('Not authorized — please log in again.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  rowIndex = Number(rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error('Invalid row.');
  const type = String(sheet.getRange(rowIndex, COL.EVENT_TYPE).getValue() || '');
  if (EVENT_TYPES.indexOf(type) === -1) {
    throw new Error('That event is managed in the spreadsheet and cannot be edited here.');
  }
  const text = String(noteText || '').trim();
  if (!text) throw new Error('Note is empty.');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yy h:mm a');
  const entry = '[' + stamp + ' ' + (String(author || '').trim() || '?') + ']: ' + text;
  const cell = sheet.getRange(rowIndex, COL.EVENT_NOTES);
  const existing = String(cell.getValue() || '').trim();
  const updated = existing ? entry + '\n' + existing : entry;
  cell.setValue(updated);
  return { ok: true, notes: updated };
}

/** Build a full-width row array for a new event (col D left blank for the formula). */
function eventEditorBuildRow_(p, type, who, ts) {
  const row = Array(NUM_COLS).fill('');
  row[COL.EVENT_TYPE - 1]        = type;
  row[COL.CANCELLED - 1]         = !!p.cancelled;
  row[COL.DATE - 1]              = p.date || '';
  row[COL.TIME - 1]              = p.time || '';
  row[COL.DURATION - 1]          = Number(p.duration) || 60;
  row[COL.LOCATION - 1]          = p.location  || '';
  row[COL.MAIN_TOPIC - 1]        = p.eventName || '';
  row[COL.SPEAKER_ORGANIZER - 1] = p.organizer || '';
  row[COL.SPEAKER_URL - 1]       = p.link      || '';
  row[COL.PHOTO_TOP - 1]         = p.photo     || '';
  row[COL.SUMMARY - 1]           = p.summary   || '';
  if (SPEAKER_EVENT_TYPES.indexOf(type) !== -1) {
    row[COL.MAIN_SPEAKER - 1]    = p.mainSpeaker    || '';
    row[COL.OPENING_SPEAKER - 1] = p.openingSpeaker || '';
    row[COL.INTRODUCER - 1]      = p.introducer     || '';
    row[COL.GOOGLE_MEET - 1]     = p.googleMeet     || '';
  }
  row[COL.EXCLUDE_NEWSLETTER - 1] = !!p.hideFromNewsletter;
  row[COL.CREATED_BY - 1]        = who;        // who may later delete this event
  row[COL.STATUS - 1]            = '➕ Added by ' + who + ' ' + ts;
  return row;
}


// ═══════════════════════════════════════════════════════════════
//  PHOTO SYNC
//  Reads Photo Top / Photo Bottom cells and writes extractable URLs
//  to the hidden PHOTO_TOP_URL / PHOTO_BOTTOM_URL companion columns
//  so the published CSV can reference them without touching the cells
//  that contain the actual embedded images.
//
//  Supports:
//    • Plain URL text already in the cell (no-op — CSV already has it)
//    • =IMAGE("url") formulas — URL extracted via getFormulas()
//    • Embedded cell images — requires the Advanced Google Sheets Service:
//        Apps Script editor → + (Add a service) → Google Sheets API
// ═══════════════════════════════════════════════════════════════

function syncPhotos() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { SpreadsheetApp.getUi().alert('Sheet "' + SHEET_NAME + '" not found.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert('No data rows found.'); return; }

  const ssId   = ss.getId();
  let synced   = 0, skipped = 0;

  const photoCols = [
    { src: COL.PHOTO_TOP,    dst: COL.PHOTO_TOP_URL    },
    { src: COL.PHOTO_BOTTOM, dst: COL.PHOTO_BOTTOM_URL },
  ];

  photoCols.forEach(({ src, dst }) => {
    const srcLetter = columnToLetter(src);
    const numRows   = lastRow - 1;

    // Attempt Sheets API for embedded images (requires Advanced Sheets Service)
    let apiRows = null;
    try {
      const range  = "'" + SHEET_NAME + "'!" + srcLetter + "2:" + srcLetter + lastRow;
      const result = Sheets.Spreadsheets.get(ssId, {
        ranges:          [range],
        includeGridData: true,
        fields:          "sheets.data.rowData.values.userEnteredValue.formulaValue," +
                         "sheets.data.rowData.values.effectiveValue.imageValue.contentUrl",
      });
      apiRows = (result.sheets[0].data[0].rowData || []);
    } catch(e) {
      Logger.log("Sheets API unavailable (enable Advanced Google Sheets Service for embedded image support): " + e.message);
    }

    const formulas = sheet.getRange(2, src, numRows, 1).getFormulas();

    for (let i = 0; i < numRows; i++) {
      let url = null;

      // 1. Embedded image via Sheets API contentUrl
      if (apiRows && apiRows[i] && apiRows[i].values && apiRows[i].values[0]) {
        const v = apiRows[i].values[0];
        if (v.effectiveValue && v.effectiveValue.imageValue) {
          url = v.effectiveValue.imageValue.contentUrl || null;
        }
        // IMAGE() formula via API
        if (!url && v.userEnteredValue && v.userEnteredValue.formulaValue) {
          const m = v.userEnteredValue.formulaValue.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
          if (m) url = m[1];
        }
      }

      // 2. IMAGE() formula via SpreadsheetApp (fallback when API not enabled)
      if (!url && formulas[i][0]) {
        const m = formulas[i][0].match(/=IMAGE\s*\(\s*"([^"]+)"/i);
        if (m) url = m[1];
      }

      if (url) {
        // If the URL is not already a public Drive link, copy the image to
        // Drive/Rotary/Photos so the browser can load it without authentication.
        const current = String(sheet.getRange(i + 2, dst).getValue() || "");
        let publicUrl = url;
        if (!url.startsWith("https://drive.google.com/uc?")) {
          if (current.startsWith("https://drive.google.com/uc?")) {
            // Already exported to Drive on a previous sync — reuse it.
            publicUrl = current;
          } else {
            try {
              const blob     = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getBlob();
              const which    = src === COL.PHOTO_TOP ? "top" : "bottom";
              const fileName = SHEET_NAME + "_row" + (i + 2) + "_" + which;
              blob.setName(fileName);
              const file = getRotaryPhotosFolder_().createFile(blob);
              file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
              publicUrl = "https://drive.google.com/uc?export=view&id=" + file.getId();
            } catch (fetchErr) {
              Logger.log("Could not copy image to Drive (row " + (i + 2) + "): " + fetchErr.message);
              // Fall back to the raw URL — may not be publicly accessible
            }
          }
        }
        if (publicUrl !== current) {
          sheet.getRange(i + 2, dst).setValue(publicUrl);
          synced++;
        }
      } else {
        skipped++;
      }
    }
  });

  SpreadsheetApp.getUi().alert(
    "Photo sync complete!\n" +
    "✅ " + synced + " URL" + (synced !== 1 ? "s" : "") + " written to companion columns\n" +
    "⏭️ " + skipped + " cells skipped (empty, plain text URL, or no extractable image)\n\n" +
    "Embedded images are exported to Drive → Rotary → Photos and made\n" +
    "publicly accessible. Plain-text URLs in the photo cells are used\n" +
    "directly by the newsletter — no sync needed for those."
  );
}

/** Returns the Drive folder at Rotary/Photos, creating it if needed. */
function getRotaryPhotosFolder_() {
  const rotaryFolders = DriveApp.getFoldersByName("Rotary");
  const rotary = rotaryFolders.hasNext() ? rotaryFolders.next() : DriveApp.createFolder("Rotary");
  const photoFolders = rotary.getFoldersByName("Photos");
  return photoFolders.hasNext() ? photoFolders.next() : rotary.createFolder("Photos");
}

/** Convert 1-based column number to sheet letter (e.g. 28 → "AB") */
function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col    = Math.floor((col - 1) / 26);
  }
  return letter;
}


// ═══════════════════════════════════════════════════════════════
//  MEMBERS TAB SETUP
// ═══════════════════════════════════════════════════════════════

/** Create (or reset) the Members tab with a header and sample rows */
function setupMembers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ms = ss.getSheetByName("Members");
  if (!ms) ms = ss.insertSheet("Members");

  const hdr = ms.getRange(1, 1, 1, 1);
  hdr.setValue("Name");
  hdr.setBackground("#1a3a6b").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11);
  ms.setColumnWidth(1, 220);
  ms.setFrozenRows(1);

  if (ms.getLastRow() < 2) {
    ms.getRange(2, 1, 3, 1).setValues([
      ["Alice Aardvark"],
      ["Bob Bobcat"],
      ["Carol Chen"],
    ]);
  }

  SpreadsheetApp.getUi().alert(
    "Members tab is ready!\n\n" +
    "Replace the sample names with your club members' names.\n" +
    "These names will appear as dropdown options in the Duty Editor."
  );
}


// ═══════════════════════════════════════════════════════════════
//  DUTY EDITOR HTML (served by doGet)
// ═══════════════════════════════════════════════════════════════

function getDutyEditorHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLV Rotary &mdash; Duty Editor</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 1em 1.2em; color: #222; }
  h1 { color: #17458F; margin-bottom: 0.15em; font-size: 1.5em; }
  .sub { color: #666; font-size: 0.9em; margin-top: 0; margin-bottom: 1.5em; }
  .card { border: 1px solid #c5cae9; border-radius: 7px; padding: 1em 1.2em; margin: 1.2em 0; background: #fafafa; }
  .card h2 { color: #1a56db; font-size: 1.05em; margin: 0 0 0.2em; }
  .meta { color: #555; font-size: 0.87em; margin: 0 0 0.8em; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px; vertical-align: middle; }
  td.lbl { width: 130px; font-weight: bold; color: #17458F; white-space: nowrap; font-size: 0.92em; }
  select { width: 100%; padding: 4px; font-size: 0.95em; border: 1px solid #ccc; border-radius: 3px; background: #fff; }
  .btn { background: #17458F; color: #fff; border: none; padding: 8px 22px; border-radius: 4px;
         cursor: pointer; font-size: 0.97em; margin-top: 0.8em; }
  .btn:disabled { background: #aaa; cursor: default; }
  .msg { font-size: 0.88em; margin: 0.4em 0 0; min-height: 1.2em; }
  .ok  { color: #166534; }
  .err { color: #b91c1c; }
  #loading { color: #666; padding: 1.5em 0; }
  #no-members { color: #888; font-size: 0.9em; font-style: italic; margin-bottom: 0.8em; }
</style>
</head>
<body>
<h1>SLV Rotary &mdash; Duty Editor</h1>
<p class="sub">Assign duties for upcoming meetings within the next 12 weeks.
  Names come from the <strong>Members</strong> tab in the spreadsheet.</p>
<p id="loading">Loading upcoming meetings&hellip;</p>
<div id="no-members" style="display:none">
  No members found. Run <strong>Setup Members Tab</strong> from the sheet menu and add names.
</div>
<div id="cards"></div>
<script>
var DUTY_FIELDS = [
  {key: 'mc',            label: 'MC'},
  {key: 'setupTeardown', label: 'Setup/Teardown'},
  {key: 'avZoom',        label: 'AV/Zoom'},
  {key: 'greeter',       label: 'Greeter'},
  {key: 'fourWayTest',   label: '4-Way-Test'},
  {key: 'thought',       label: 'Thought'},
  {key: 'detective',     label: 'Detective'},
  {key: 'bagPerson',     label: 'Bag Person'}
];

var pageMembers = [];

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildSelect(name, curVal) {
  var opts = [''].concat(pageMembers).map(function(m) {
    return '<option value="' + esc(m) + '"' + (m === curVal ? ' selected' : '') + '>'
      + esc(m || '— unassigned —') + '</option>';
  }).join('');
  return '<select name="' + name + '">' + opts + '</select>';
}

function renderCards(data) {
  pageMembers = data.members;
  document.getElementById('loading').style.display = 'none';
  if (!data.members.length) {
    document.getElementById('no-members').style.display = 'block';
  }
  var container = document.getElementById('cards');
  data.meetings.forEach(function(mtg, idx) {
    var metaParts = [esc(mtg.dateStr)];
    if (mtg.time)     metaParts.push(esc(mtg.time));
    if (mtg.location) metaParts.push(esc(mtg.location));
    var rows = DUTY_FIELDS.map(function(f) {
      return '<tr><td class="lbl">' + esc(f.label) + '</td><td>'
        + buildSelect(f.key, mtg.duties[f.key] || '') + '</td></tr>';
    }).join('');
    var div = document.createElement('div');
    div.className = 'card';
    div.setAttribute('data-row', mtg.rowIndex);
    div.setAttribute('data-idx', idx);
    div.innerHTML =
      '<h2>' + esc(mtg.title) + '</h2>'
      + '<p class="meta">' + metaParts.join(' &nbsp;&middot;&nbsp; ') + '</p>'
      + '<table>' + rows + '</table>'
      + '<button class="btn" onclick="saveMeeting(this)">Save Changes</button>'
      + '<p class="msg" id="msg' + idx + '"></p>';
    container.appendChild(div);
  });
  if (!data.meetings.length) {
    container.innerHTML = '<p style="color:#666">No upcoming meetings found.</p>';
  }
}

function saveMeeting(btn) {
  var card     = btn.closest('.card');
  var rowIndex = parseInt(card.getAttribute('data-row'), 10);
  var idx      = parseInt(card.getAttribute('data-idx'), 10);
  var selects  = card.querySelectorAll('select');
  var duties   = {};
  selects.forEach(function(s) { duties[s.name] = s.value; });
  btn.disabled    = true;
  btn.textContent = 'Saving…';
  var msgEl = document.getElementById('msg' + idx);
  msgEl.className = 'msg';
  msgEl.textContent = '';
  google.script.run
    .withSuccessHandler(function(result) {
      btn.disabled    = false;
      btn.textContent = 'Save Changes';
      msgEl.className = 'msg ok';
      msgEl.textContent = result;
    })
    .withFailureHandler(function(err) {
      btn.disabled    = false;
      btn.textContent = 'Save Changes';
      msgEl.className = 'msg err';
      msgEl.textContent = 'Error: ' + err.message;
    })
    .saveDuties(rowIndex, duties);
}

google.script.run
  .withSuccessHandler(renderCards)
  .withFailureHandler(function(err) {
    document.getElementById('loading').textContent = 'Error loading data: ' + err.message;
  })
  .getPageData();
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════
//  WEBSITE FORM SUBMISSIONS  (handled by doPost)
// ═══════════════════════════════════════════════════════════════

// Public, members-and-community speaker list (GitHub Pages). Linked from the
// acknowledgement emails so submitters can see the lineup and support speakers.
const PUBLIC_SPEAKERS_URL = 'https://rotary.porttack.com/speakers/';

function handleSpeakerRequest_(data) {
  const photoUrl = savePhotoToDrive_(data);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy h:mm a");
  const sheet = getPipelineSheet_();
  const row = buildPipelineRow_('request', data, photoUrl, ts);
  sheet.appendRow(row);
  notifySubmission_('request', data, photoUrl, ts);
  confirmSubmitter_('request', data);
  return jsonOut_({ ok: true });
}

function handleSpeakerOffer_(data) {
  const photoUrl = savePhotoToDrive_(data);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy h:mm a");
  const sheet = getPipelineSheet_();
  const row = buildPipelineRow_('offer', data, photoUrl, ts);
  sheet.appendRow(row);
  notifySubmission_('offer', data, photoUrl, ts);
  confirmSubmitter_('offer', data);
  return jsonOut_({ ok: true });
}

/**
 * Send a thank-you acknowledgement to the person who filled out the form:
 * the requestor on a "request", the speaker on an "offer". A no-op if they
 * left their email blank. Wrapped so a mail failure never blocks the
 * submission. Replies go to NOTIFY_EMAILS (so the organizer fields them) when
 * that property is set.
 */
function confirmSubmitter_(source, data) {
  try {
    const isOffer = source === 'offer';
    const toEmail = String((isOffer ? data.speakerEmail : data.requestorEmail) || '').trim();
    if (!toEmail) return;
    const toName = String((isOffer ? data.speakerName : data.requestorName) || '').trim();

    const subject = isOffer
      ? 'Thank you for offering to speak to SLV Rotary'
      : 'Thank you for your SLV Rotary speaker suggestion';

    const greeting = toName ? 'Hi ' + toName + ',' : 'Hello,';
    const intro = isOffer
      ? 'Thank you for offering to speak to the San Lorenzo Valley Rotary Club! ' +
        'Our speaker organizer will be in touch, typically within a week, to talk through scheduling.'
      : 'Thank you for suggesting a speaker for the San Lorenzo Valley Rotary Club! ' +
        'Our speaker organizer will follow up with you about next steps.';
    const topicLine = String(data.topic || '').trim()
      ? 'Topic noted: ' + String(data.topic).trim() + '.'
      : '';

    const esc = function(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    const htmlBody =
      '<div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5">' +
      '<p>' + esc(greeting) + '</p>' +
      '<p>' + esc(intro) + '</p>' +
      (topicLine ? '<p style="color:#555">' + esc(topicLine) + '</p>' : '') +
      '<p>You can see our upcoming and proposed speakers — and show your support — here:</p>' +
      '<p><a href="' + PUBLIC_SPEAKERS_URL + '" style="display:inline-block;background:#17458F;' +
      'color:#fff;text-decoration:none;padding:8px 16px;border-radius:4px">See the speaker lineup →</a></p>' +
      '<p style="margin-top:1.2em">With gratitude,<br>San Lorenzo Valley Rotary Club</p>' +
      '<p style="font-size:12px;color:#888">A quick note: SLV Rotary is non-political and non-religious, ' +
      'and we don\'t use our programs as a fundraising platform.</p>' +
      '</div>';
    const textBody =
      greeting + '\n\n' + intro + '\n' + (topicLine ? topicLine + '\n' : '') +
      '\nSee our speaker lineup and show your support:\n' + PUBLIC_SPEAKERS_URL +
      '\n\nWith gratitude,\nSan Lorenzo Valley Rotary Club';

    const options = { htmlBody: htmlBody, name: 'SLV Rotary' };
    const replyToRaw = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || '';
    const replyTo = replyToRaw.split(/[\s,]+/).map(function(s) { return s.trim(); }).filter(Boolean)[0];
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(toEmail, subject, textBody, options);
  } catch (err) {
    Logger.log('confirmSubmitter_ failed: ' + err.toString());
  }
}

/**
 * Email a notification for a new speaker form submission. Recipients come from
 * the NOTIFY_EMAILS script property (comma- or whitespace-separated). A no-op
 * if the property is unset or empty. Wrapped so a mail failure never blocks the
 * submission — the appended sheet row is the source of truth.
 */
function notifySubmission_(source, data, photoUrl, ts) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || '';
    const recipients = raw.split(/[\s,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!recipients.length) return;

    const isOffer = source === 'offer';
    const speaker = data.speakerName || '(no name)';
    const subject = (isOffer ? '🎤 New speaker offer: ' : '🎤 New speaker request: ') + speaker;

    // Build a label → value list, skipping empty fields.
    const rows = [];
    const add = function(label, val) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        rows.push([label, String(val).trim()]);
      }
    };
    const yn = function(v) { return v ? 'Yes' : ''; };

    add(isOffer ? 'Submitted by' : 'Requested by', data.requestorName);
    add('Requestor email', data.requestorEmail);
    add('Requestor phone', data.requestorPhone);
    add('Speaker', speaker);
    add('Speaker email', data.speakerEmail);
    add('Speaker phone', data.speakerPhone);
    add('Speaker city', data.speakerCity);
    add('Topic', data.topic);
    add('Summary', data.summary);
    add('Speaker role', data.speakerRole);
    add('Priority', data.priority);
    add('Is Rotarian', yn(data.isRotarian));
    add('Local', yn(data.isLocal));
    add('Fundraising materials', yn(data.fundraisingLiterature));
    add('Zoom only', yn(data.zoomOnly));
    add('Avail morning', yn(data.availMorning));
    add('Avail evening', yn(data.availEvening));
    add('Preferred / suggested dates', data.suggestedDates);
    add('Spoke to organizer', yn(data.spokeToOrganizer));
    add('Spoke to president', yn(data.spokeToPresident));
    add('Bio', data.bio);
    add('Comments', data.comments);
    add('Photo', photoUrl);
    add('Submitted at', ts);

    const esc = function(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    const tableRows = rows.map(function(r) {
      return '<tr><td style="padding:3px 10px 3px 0;vertical-align:top;color:#555;font-weight:bold;white-space:nowrap">' +
        esc(r[0]) + '</td><td style="padding:3px 0;vertical-align:top">' + esc(r[1]) + '</td></tr>';
    }).join('');

    // Link to the Speaker Pipeline status page so the recipient can open the
    // new card and start working it. Best-effort — skip the link if the web
    // app URL isn't available.
    let statusUrl = '';
    try { statusUrl = ScriptApp.getService().getUrl() || ''; } catch (_) {}
    if (statusUrl) statusUrl += '?app=speaker-pipeline';

    const htmlBody =
      '<div style="font-family:Arial,sans-serif;color:#222">' +
      '<h2 style="color:#17458F;margin:0 0 0.4em">' + esc(subject) + '</h2>' +
      '<table style="border-collapse:collapse;font-size:14px">' + tableRows + '</table>' +
      (statusUrl
        ? '<p style="margin-top:1em"><a href="' + esc(statusUrl) +
          '" style="display:inline-block;background:#17458F;color:#fff;text-decoration:none;' +
          'padding:8px 16px;border-radius:4px;font-size:14px">Open the Speaker Pipeline →</a></p>'
        : '') +
      '<p style="margin-top:1em;font-size:12px;color:#888">Sent automatically from the SLV Rotary website speaker form.</p>' +
      '</div>';
    const textBody = rows.map(function(r) { return r[0] + ': ' + r[1]; }).join('\n') +
      (statusUrl ? '\n\nOpen the Speaker Pipeline to start working this card:\n' + statusUrl : '');

    const replyTo = (data.requestorEmail || data.speakerEmail || '').trim();
    const options = { htmlBody: htmlBody };
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(recipients.join(','), subject, textBody, options);
  } catch (err) {
    Logger.log('notifySubmission_ failed: ' + err.toString());
  }
}

function handleHeartSpeaker_(p) {
  const rowIndex = parseInt(p.rowIndex);
  if (!rowIndex || rowIndex < 2) return ContentService.createTextOutput('ok');
  const sheet = getPipelineSheet_();
  if (!sheet) return ContentService.createTextOutput('ok');
  const cell = sheet.getRange(rowIndex, CP.HEARTS);
  cell.setValue((parseInt(cell.getValue()) || 0) + 1);
  return ContentService.createTextOutput('ok');
}

function handleNoteSpeaker_(p) {
  const rowIndex = parseInt(p.rowIndex);
  const text = String(p.noteText || '').trim().substring(0, 1000);
  if (!rowIndex || rowIndex < 2 || !text) return ContentService.createTextOutput('ok');
  const sheet = getPipelineSheet_();
  if (!sheet) return ContentService.createTextOutput('ok');
  const notesCell = sheet.getRange(rowIndex, CP.NOTES);
  const existing = String(notesCell.getValue() || '');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const note = '[Anon, ' + ts + '] ' + text;
  notesCell.setValue(existing ? existing + '\n' + note : note);
  return ContentService.createTextOutput('ok');
}

function buildPipelineRow_(source, data, photoUrl, ts) {
  const row = Array(NUM_PIPE_COLS).fill('');
  row[CP.SOURCE - 1]              = source;
  row[CP.STATUS - 1]              = 'new';
  row[CP.SPEAKER_NAME - 1]        = data.speakerName      || '';
  row[CP.SPEAKER_EMAIL - 1]       = data.speakerEmail     || '';
  row[CP.SPEAKER_PHONE - 1]       = data.speakerPhone     || '';
  row[CP.SPEAKER_CITY - 1]        = data.speakerCity      || '';
  row[CP.TOPIC - 1]               = data.topic            || '';
  row[CP.SUMMARY - 1]             = data.summary          || '';
  row[CP.SPEAKER_ROLE - 1]        = data.speakerRole      || '';
  row[CP.BIO - 1]                 = data.bio              || '';
  row[CP.PREFERRED_DATES - 1]     = data.suggestedDates   || '';
  row[CP.PHOTO_URL - 1]           = photoUrl;
  row[CP.REQUESTOR_NAME - 1]      = data.requestorName    || '';
  row[CP.REQUESTOR_EMAIL - 1]     = data.requestorEmail   || '';
  row[CP.REQUESTOR_PHONE - 1]     = data.requestorPhone   || '';
  row[CP.SPOKE_TO_ORGANIZER - 1]  = data.spokeToOrganizer ? 'Yes' : '';
  row[CP.SPOKE_TO_PRESIDENT - 1]  = data.spokeToPresident ? 'Yes' : '';
  row[CP.AVAIL_MORNING - 1]       = data.availMorning     ? 'Yes' : '';
  row[CP.AVAIL_EVENING - 1]       = data.availEvening     ? 'Yes' : '';
  row[CP.ZOOM_ONLY - 1]           = data.zoomOnly         ? 'Yes' : '';
  row[CP.OTHER_SUGGESTIONS - 1]   = data.otherSuggestions ? 'Yes' : '';
  row[CP.COMMENTS - 1]            = data.comments         || '';
  row[CP.PRIORITY - 1]            = data.priority              || '';
  row[CP.IS_ROTARIAN - 1]         = data.isRotarian            ? 'Yes' : '';
  row[CP.IS_LOCAL - 1]            = data.isLocal               ? 'Yes' : '';
  row[CP.FUNDRAISING_LITERATURE - 1] = data.fundraisingLiterature ? 'Yes' : '';
  row[CP.SUBMITTED_AT - 1]        = ts;
  row[CP.UPDATED_AT - 1]          = ts;
  row[CP.UPDATED_BY - 1]          = 'form submission';
  return row;
}

function savePhotoToDrive_(data) {
  if (!data.photoBase64) return '';
  try {
    const base64 = data.photoBase64.includes(',') ? data.photoBase64.split(',')[1] : data.photoBase64;
    // Derive MIME from the data URL prefix (data:image/png;base64,...) if not given.
    const prefixMime = (data.photoBase64.match(/^data:([^;]+);/) || [])[1];
    const mime = data.photoMime || prefixMime || 'image/jpeg';
    const ext  = (data.photoName || 'photo.jpg').split('.').pop() || 'jpg';
    const safeName = (data.speakerName || 'speaker')
      .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') || 'speaker';
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, safeName + '.' + ext);
    const file = getRotaryPhotosFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  } catch (err) {
    Logger.log('Photo save error: ' + err.toString());
    return '';
  }
}

function getPipelineSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PIPELINE_SHEET);
  if (!sheet) {
    setupSpeakerPipeline();
    sheet = ss.getSheetByName(PIPELINE_SHEET);
  }
  return sheet;
}

/** Find or create a sheet tab with a header row. */
function getOrCreateTab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const hdr = sheet.getRange(1, 1, 1, headers.length);
    hdr.setValues([headers]);
    hdr.setBackground("#1a3a6b").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11);
    sheet.setFrozenRows(1);
    headers.forEach((_, i) => sheet.setColumnWidth(i + 1, 160));
  }
  return sheet;
}

// ═══════════════════════════════════════════════════════════════
//  CALENDAR ASSISTANT
//  Second deployment: Execute as Me | Who has access: Only myself
//  URL: ...exec?app=assistant
//  Requires: Script Properties → ANTHROPIC_API_KEY
// ═══════════════════════════════════════════════════════════════

const ASSISTANT_MODEL = 'claude-sonnet-4-6';

const ASSISTANT_TOOLS = [
  {
    name: 'read_events',
    description: 'Read events from the Events sheet. Always call this before making changes.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional. Date range like "2026-07 to 2027-06", an event type, or a keyword.',
        },
      },
    },
  },
  {
    name: 'read_members',
    description: 'Read the member name list from the Members tab.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_event',
    description: 'Queue a new event row to be added (pending user confirmation).',
    input_schema: {
      type: 'object',
      required: ['eventType', 'date'],
      properties: {
        eventType:      { type: 'string' },
        date:           { type: 'string', description: 'YYYY-MM-DD' },
        time:           { type: 'string', description: 'H:MM AM/PM' },
        duration:       { type: 'number', description: 'Minutes' },
        location:       { type: 'string' },
        openingSpeaker: { type: 'string' },
        mainSpeaker:    { type: 'string' },
        mainTopic:      { type: 'string' },
        speakerUrl:     { type: 'string' },
        summary:        { type: 'string' },
        mc:             { type: 'string' },
        setupTeardown:  { type: 'string' },
        avZoom:         { type: 'string' },
        greeter:        { type: 'string' },
        fourWayTest:    { type: 'string' },
        thought:        { type: 'string' },
        detective:      { type: 'string' },
        bagPerson:      { type: 'string' },
        comments:       { type: 'string' },
      },
    },
  },
  {
    name: 'update_event',
    description: 'Queue an update to an existing event row (pending user confirmation). Use rowIndex from read_events.',
    input_schema: {
      type: 'object',
      required: ['rowIndex', 'changes'],
      properties: {
        rowIndex: { type: 'number', description: '1-based sheet row number from read_events' },
        changes:  { type: 'object', description: 'Fields to change. Same names as add_event fields.' },
        reason:   { type: 'string', description: 'Brief reason shown in the confirmation list.' },
      },
    },
  },
  {
    name: 'cancel_event',
    description: 'Queue cancellation of an event (sets Cancelled checkbox). Safer than delete.',
    input_schema: {
      type: 'object',
      required: ['rowIndex'],
      properties: {
        rowIndex: { type: 'number' },
        reason:   { type: 'string' },
      },
    },
  },
  {
    name: 'delete_event',
    description: 'Queue deletion of an event row. Use only for true duplicates; prefer cancel_event.',
    input_schema: {
      type: 'object',
      required: ['rowIndex'],
      properties: {
        rowIndex: { type: 'number' },
        reason:   { type: 'string' },
      },
    },
  },
];

// Which AI powers the Calendar Assistant by default. The client can override
// per-session ('gemini' or 'claude'); Gemini needs GEMINI_API_KEY, Claude
// needs ANTHROPIC_API_KEY (both in Script Properties).
const ASSISTANT_PROVIDER_DEFAULT = 'gemini';

// Event fields shared by add_event and update_event, in Gemini's schema dialect
// (UPPERCASE types). Gemini needs a concrete typed object for the `changes` arg.
const GEMINI_EVENT_FIELDS = {
  eventType:      { type: 'STRING' }, date:           { type: 'STRING' },
  time:           { type: 'STRING' }, duration:       { type: 'NUMBER' },
  location:       { type: 'STRING' }, openingSpeaker: { type: 'STRING' },
  mainSpeaker:    { type: 'STRING' }, mainTopic:      { type: 'STRING' },
  speakerUrl:     { type: 'STRING' }, summary:        { type: 'STRING' },
  mc:             { type: 'STRING' }, setupTeardown:  { type: 'STRING' },
  avZoom:         { type: 'STRING' }, greeter:        { type: 'STRING' },
  fourWayTest:    { type: 'STRING' }, thought:        { type: 'STRING' },
  detective:      { type: 'STRING' }, bagPerson:      { type: 'STRING' },
  comments:       { type: 'STRING' },
};

// Same tools as ASSISTANT_TOOLS, expressed as Gemini functionDeclarations.
const GEMINI_ASSISTANT_TOOLS = [
  { name: 'read_events', description: 'Read events from the Events sheet. Always call this before making changes.',
    parameters: { type: 'OBJECT', properties: { filter: { type: 'STRING', description: 'Optional date range like "2026-07 to 2027-06", an event type, or a keyword.' } } } },
  { name: 'read_members', description: 'Read the member name list from the Members tab.',
    parameters: { type: 'OBJECT', properties: {} } },
  { name: 'add_event', description: 'Queue a new event row to be added (pending user confirmation).',
    parameters: { type: 'OBJECT', required: ['eventType', 'date'], properties: GEMINI_EVENT_FIELDS } },
  { name: 'update_event', description: 'Queue an update to an existing event row. Use rowIndex from read_events.',
    parameters: { type: 'OBJECT', required: ['rowIndex', 'changes'], properties: {
      rowIndex: { type: 'INTEGER' }, reason: { type: 'STRING' }, changes: { type: 'OBJECT', properties: GEMINI_EVENT_FIELDS } } } },
  { name: 'cancel_event', description: 'Queue cancellation of an event (sets the Cancelled checkbox). Safer than delete.',
    parameters: { type: 'OBJECT', required: ['rowIndex'], properties: { rowIndex: { type: 'INTEGER' }, reason: { type: 'STRING' } } } },
  { name: 'delete_event', description: 'Queue deletion of an event row. Only for true duplicates; prefer cancel_event.',
    parameters: { type: 'OBJECT', required: ['rowIndex'], properties: { rowIndex: { type: 'INTEGER' }, reason: { type: 'STRING' } } } },
];

/**
 * Main AI function for the Calendar Assistant. Runs a tool-use loop with the
 * chosen provider (Gemini by default, or Claude) and returns either a plain
 * message or a proposal (pending changes for the user to confirm).
 * History is provider-neutral: [{ role:'user'|'assistant', text }].
 * Called from the client via google.script.run.
 */
function processMessage(history, provider) {
  provider = (provider === 'claude' || provider === 'gemini') ? provider : ASSISTANT_PROVIDER_DEFAULT;
  try {
    // Normalise history to the neutral { role, text } shape (tolerate older
    // {content} entries so a stale client doesn't break things).
    const hist = (history || []).map(function(h) {
      var text = (h.text != null) ? h.text
        : (typeof h.content === 'string' ? h.content
          : (Array.isArray(h.content)
              ? h.content.filter(function(b){ return b && b.type === 'text'; }).map(function(b){ return b.text; }).join('\n')
              : ''));
      return { role: h.role === 'assistant' ? 'assistant' : 'user', text: String(text || '') };
    });
    const pending = [];
    const text = (provider === 'claude')
      ? runClaudeAssistant_(hist, pending)
      : runGeminiAssistant_(hist, pending);
    const updatedHistory = hist.concat([{ role: 'assistant', text: text }]);
    return { type: pending.length ? 'proposal' : 'message', text: text, pending: pending, updatedHistory: updatedHistory };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}

/** Execute one Events tool call; write tools queue into `pending` (no writes here). */
function executeAssistantTool_(name, inp, pending) {
  inp = inp || {};
  if (name === 'read_events')  return assistantReadEvents_(inp.filter);
  if (name === 'read_members') return assistantReadMembers_();
  if (name === 'add_event') {
    pending.push({ action: 'add', data: inp,
      description: '➕ Add ' + (inp.eventType || 'event') + ' on ' + inp.date + (inp.time ? ' at ' + inp.time : '') });
    return { queued: true, index: pending.length - 1 };
  }
  if (name === 'update_event') {
    const fields = Object.keys(inp.changes || {}).join(', ');
    pending.push({ action: 'update', rowIndex: inp.rowIndex, changes: inp.changes,
      description: '✏️ ' + (inp.reason || 'Update row ' + inp.rowIndex) + (fields ? ' (' + fields + ')' : '') });
    return { queued: true, index: pending.length - 1 };
  }
  if (name === 'cancel_event') {
    pending.push({ action: 'cancel', rowIndex: inp.rowIndex,
      description: '🚫 Cancel event at row ' + inp.rowIndex + (inp.reason ? ' — ' + inp.reason : '') });
    return { queued: true, index: pending.length - 1 };
  }
  if (name === 'delete_event') {
    pending.push({ action: 'delete', rowIndex: inp.rowIndex,
      description: '🗑️ Delete row ' + inp.rowIndex + (inp.reason ? ' — ' + inp.reason : '') });
    return { queued: true, index: pending.length - 1 };
  }
  return { error: 'Unknown tool: ' + name };
}

/** Claude (Anthropic) agentic loop over the neutral history. */
function runClaudeAssistant_(hist, pending) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set. Add it in Apps Script → Project Settings → Script Properties.');
  const messages = hist.map(function(h) { return { role: h.role, content: h.text }; });
  for (let iter = 0; iter < 20; iter++) {
    const resp = callAssistantApi_(messages);
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason === 'end_turn') {
      return resp.content.filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join('\n').trim();
    }
    const toolResults = [];
    resp.content.forEach(function(block) {
      if (block.type !== 'tool_use') return;
      const result = executeAssistantTool_(block.name, block.input, pending);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    });
    messages.push({ role: 'user', content: toolResults });
  }
  return 'Reached the maximum number of steps. Any queued changes are shown below — please review.';
}

/** Gemini agentic loop (function calling) over the neutral history. */
function runGeminiAssistant_(hist, pending) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set. Add it in Apps Script → Project Settings → Script Properties.');
  const contents = hist.map(function(h) { return { role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] }; });
  const tools = [{ functionDeclarations: GEMINI_ASSISTANT_TOOLS }];
  for (let iter = 0; iter < 20; iter++) {
    const body  = callGeminiAssistantApi_(apiKey, contents, tools);
    const cand  = (body.candidates || [])[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const calls = parts.filter(function(p) { return p.functionCall; });
    if (!calls.length) {
      return parts.filter(function(p){ return p.text; }).map(function(p){ return p.text; }).join('\n').trim() || 'Done.';
    }
    // Echo the model's function-call turn, then return one result per call.
    contents.push({ role: 'model', parts: calls.map(function(p){ return { functionCall: p.functionCall }; }) });
    contents.push({ role: 'user', parts: calls.map(function(p) {
      const result = executeAssistantTool_(p.functionCall.name, p.functionCall.args || {}, pending);
      return { functionResponse: { name: p.functionCall.name, response: { result: result } } };
    }) });
  }
  return 'Reached the maximum number of steps. Any queued changes are shown below — please review.';
}

function callGeminiAssistantApi_(apiKey, contents, tools) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
    ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    systemInstruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
    contents: contents,
    tools: tools,
    generationConfig: { temperature: 0 },
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    muteHttpExceptions: true, payload: JSON.stringify(payload),
  });
  const body = JSON.parse(resp.getContentText());
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  return body;
}

/**
 * Write queued changes to the sheet after user confirmation.
 * Called from the client via google.script.run.
 */
function applyAssistantChanges(changes) {
  const backupName = createEventsBackup();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  let added = 0, updated = 0, cancelled = 0, deleted = 0;

  // Apply non-deletes first, then deletes in reverse row order (to keep indices stable)
  const deletes = changes.filter(function(c) { return c.action === 'delete'; })
                         .sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  const others  = changes.filter(function(c) { return c.action !== 'delete'; });

  others.forEach(function(change) {
    if (change.action === 'add') {
      sheet.appendRow(assistantBuildRow_(change.data));
      added++;
    } else if (change.action === 'update') {
      assistantApplyUpdates_(sheet, change.rowIndex, change.changes);
      updated++;
    } else if (change.action === 'cancel') {
      sheet.getRange(change.rowIndex, COL.CANCELLED).setValue(true);
      recolorRow(sheet, change.rowIndex);
      cancelled++;
    }
  });
  deletes.forEach(function(change) {
    sheet.deleteRow(change.rowIndex);
    deleted++;
  });

  sortByDate(sheet);
  applyRowColors(sheet);
  return { ok: true, added: added, updated: updated, cancelled: cancelled, deleted: deleted, backupName: backupName };
}

/**
 * Copy the Events sheet to a timestamped backup tab (keeps last 5 backups).
 * Public so the client can call it directly via google.script.run.
 */
function createEventsBackup() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const tz    = Session.getScriptTimeZone();
  const label = 'Backup ' + Utilities.formatDate(new Date(), tz, 'MM-dd HH:mm');

  const old = ss.getSheets()
    .filter(function(s) { return s.getName().startsWith('Backup '); })
    .sort(function(a, b) { return a.getName().localeCompare(b.getName()); });
  while (old.length >= 5) ss.deleteSheet(old.shift());

  sheet.copyTo(ss).setName(label);
  return label;
}

// ── Private helpers ───────────────────────────────────────────

function assistantReadEvents_(filter) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { events: [], count: 0 };

  const tz   = Session.getScriptTimeZone();
  const data = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();

  let events = data.map(function(row, i) {
    const dv = row[COL.DATE - 1];
    const tv = row[COL.TIME - 1];
    return {
      rowIndex:       i + 2,
      eventType:      String(row[COL.EVENT_TYPE - 1]       || ''),
      cancelled:      !!row[COL.CANCELLED - 1],
      date:           dv instanceof Date ? Utilities.formatDate(dv, tz, 'yyyy-MM-dd') : String(dv || ''),
      time:           tv instanceof Date ? Utilities.formatDate(tv, tz, 'h:mm a')    : String(tv || ''),
      duration:       row[COL.DURATION - 1]        || 60,
      location:       String(row[COL.LOCATION - 1]         || ''),
      openingSpeaker: String(row[COL.OPENING_SPEAKER - 1]  || ''),
      mainSpeaker:    String(row[COL.MAIN_SPEAKER - 1]     || ''),
      mainTopic:      String(row[COL.MAIN_TOPIC - 1]       || ''),
      mc:             String(row[COL.MC - 1]               || ''),
      comments:       String(row[COL.COMMENTS - 1]         || ''),
    };
  }).filter(function(e) { return e.date; });

  if (filter) {
    const f = filter.toLowerCase();
    const rangeM = f.match(/(\d{4}-\d{2})\s+to\s+(\d{4}-\d{2})/);
    if (rangeM) {
      events = events.filter(function(e) { return e.date >= rangeM[1] && e.date <= rangeM[2] + '-31'; });
    } else {
      events = events.filter(function(e) {
        return e.eventType.toLowerCase().includes(f) || e.date.includes(f) ||
               e.mainSpeaker.toLowerCase().includes(f) || e.mainTopic.toLowerCase().includes(f);
      });
    }
  }
  return { events: events, count: events.length };
}

function assistantReadMembers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ms = ss.getSheetByName('Members');
  if (!ms || ms.getLastRow() < 2) return { members: [] };
  const members = ms.getRange(2, 1, ms.getLastRow() - 1, 1)
    .getValues().map(function(r) { return String(r[0] || '').trim(); }).filter(Boolean);
  return { members: members };
}

function assistantBuildRow_(data) {
  const row = Array(NUM_COLS).fill('');
  row[COL.EVENT_TYPE - 1]      = data.eventType      || 'Other';
  row[COL.CANCELLED - 1]       = false;
  row[COL.DATE - 1]            = data.date            || '';
  row[COL.TIME - 1]            = data.time            || '';
  row[COL.DURATION - 1]        = data.duration        || 60;
  row[COL.LOCATION - 1]        = data.location        || '';
  row[COL.OPENING_SPEAKER - 1] = data.openingSpeaker  || '';
  row[COL.MAIN_SPEAKER - 1]    = data.mainSpeaker     || '';
  row[COL.MAIN_TOPIC - 1]      = data.mainTopic       || '';
  row[COL.SPEAKER_URL - 1]     = data.speakerUrl      || '';
  row[COL.SUMMARY - 1]         = data.summary         || '';
  row[COL.MC - 1]              = data.mc              || '';
  row[COL.SETUP_TEARDOWN - 1]  = data.setupTeardown   || '';
  row[COL.AV_ZOOM - 1]         = data.avZoom          || '';
  row[COL.GREETER - 1]         = data.greeter         || '';
  row[COL.FOUR_WAY_TEST - 1]   = data.fourWayTest     || '';
  row[COL.THOUGHT - 1]         = data.thought         || '';
  row[COL.DETECTIVE - 1]       = data.detective       || '';
  row[COL.BAG_PERSON - 1]      = data.bagPerson       || '';
  row[COL.COMMENTS - 1]        = data.comments        || '';
  row[COL.STATUS - 1]          = 'Added by AI ' + timestamp();
  return row;
}

function assistantApplyUpdates_(sheet, rowIndex, changes) {
  const colMap = {
    eventType:      COL.EVENT_TYPE,      date:           COL.DATE,
    time:           COL.TIME,            duration:       COL.DURATION,
    location:       COL.LOCATION,        openingSpeaker: COL.OPENING_SPEAKER,
    mainSpeaker:    COL.MAIN_SPEAKER,    mainTopic:      COL.MAIN_TOPIC,
    speakerUrl:     COL.SPEAKER_URL,     summary:        COL.SUMMARY,
    mc:             COL.MC,              setupTeardown:  COL.SETUP_TEARDOWN,
    avZoom:         COL.AV_ZOOM,         greeter:        COL.GREETER,
    fourWayTest:    COL.FOUR_WAY_TEST,   thought:        COL.THOUGHT,
    detective:      COL.DETECTIVE,       bagPerson:      COL.BAG_PERSON,
    comments:       COL.COMMENTS,
  };
  Object.entries(changes).forEach(function(entry) {
    const col = colMap[entry[0]];
    if (col) sheet.getRange(rowIndex, col).setValue(entry[1]);
  });
  sheet.getRange(rowIndex, COL.STATUS).setValue('Updated by AI ' + timestamp());
  recolorRow(sheet, rowIndex);
}

function callAssistantApi_(messages) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const resp   = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    muteHttpExceptions: true,
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    payload: JSON.stringify({
      model:      ASSISTANT_MODEL,
      max_tokens: 4096,
      system:     ASSISTANT_SYSTEM_PROMPT,
      tools:      ASSISTANT_TOOLS,
      messages:   messages,
    }),
  });
  const body = JSON.parse(resp.getContentText());
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  return body;
}

// ── Calendar Assistant HTML ───────────────────────────────────

function getCalendarAssistantHtml() {
  return '<!DOCTYPE html>\n' +
'<html>\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>SLV Rotary — Calendar Assistant</title>\n' +
'<style>\n' +
'*{box-sizing:border-box;margin:0;padding:0}\n' +
'body{font-family:Arial,sans-serif;background:#f0f2f5;height:100vh;display:flex;flex-direction:column;overflow:hidden}\n' +
'header{background:#17458F;color:#fff;padding:0.7em 1em;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}\n' +
'header h1{font-size:1.05em;font-weight:bold}\n' +
'#snap-btn{font-size:0.8em;padding:3px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;cursor:pointer}\n' +
'#snap-btn:hover{background:rgba(255,255,255,0.28)}\n' +
'#chat{flex:1;overflow-y:auto;padding:1em;display:flex;flex-direction:column;gap:0.7em}\n' +
'.msg{max-width:82%;padding:0.6em 0.85em;border-radius:14px;line-height:1.55;font-size:0.9em;word-break:break-word;white-space:pre-wrap}\n' +
'.user{align-self:flex-end;background:#17458F;color:#fff;border-bottom-right-radius:3px}\n' +
'.assistant{align-self:flex-start;background:#fff;color:#222;border:1px solid #dde;border-bottom-left-radius:3px}\n' +
'.note{align-self:center;background:#e8f0fe;color:#1a3a6b;font-size:0.8em;border-radius:8px;padding:0.35em 0.8em;max-width:95%;text-align:center}\n' +
'.err{align-self:flex-start;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:10px}\n' +
'.typing{align-self:flex-start;background:#fff;border:1px solid #dde;border-radius:14px;border-bottom-left-radius:3px;padding:0.6em 1em;color:#999;font-size:0.85em;font-style:italic}\n' +
'#proposal{background:#fff;border-top:3px solid #17458F;padding:0.85em 1em;flex-shrink:0;display:none}\n' +
'#proposal h3{color:#17458F;font-size:0.9em;margin-bottom:0.45em}\n' +
'#prop-list{font-size:0.82em;color:#333;max-height:140px;overflow-y:auto;margin-bottom:0.65em;line-height:1.7}\n' +
'#prop-list div{border-bottom:1px solid #f0f0f0;padding:1px 0}\n' +
'.pbtns{display:flex;gap:0.5em}\n' +
'#apply-btn{background:#17458F;color:#fff;border:none;padding:7px 18px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:0.88em}\n' +
'#apply-btn:hover{background:#1a56db}\n' +
'#discard-btn{background:#f4f4f4;color:#444;border:1px solid #ccc;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:0.88em}\n' +
'#discard-btn:hover{background:#e8e8e8}\n' +
'#input-row{display:flex;gap:0.5em;padding:0.65em;background:#fff;border-top:1px solid #e0e0e0;flex-shrink:0}\n' +
'#user-input{flex:1;padding:0.55em 0.75em;border:1px solid #ccc;border-radius:6px;font-size:0.9em;font-family:Arial,sans-serif;resize:none;height:58px}\n' +
'#user-input:focus{outline:none;border-color:#17458F}\n' +
'#send-btn{background:#17458F;color:#fff;border:none;padding:0 1.1em;border-radius:6px;cursor:pointer;font-size:1.15em}\n' +
'#send-btn:disabled{background:#aaa;cursor:default}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<header><h1>📅 SLV Rotary — Calendar Assistant</h1><div style="display:flex;gap:0.5em;align-items:center"><select id="prov" onchange="setProvider(this.value)" title="Which AI answers" style="font-size:0.8em;padding:3px 6px;border-radius:4px;border:none"><option value="gemini">Gemini</option><option value="claude">Claude</option></select><button id="snap-btn" onclick="takeSnapshot()">📸 Snapshot</button></div></header>\n' +
'<div id="chat"><div class="msg note">Hi Eric! Describe what you\'d like to add, move, update, or cancel. I\'ll show you a plan before changing anything.  <em>Ctrl+Enter to send</em></div></div>\n' +
'<div id="proposal"><h3>📋 Proposed changes — please review before applying</h3><div id="prop-list"></div><div class="pbtns"><button id="apply-btn" onclick="applyChanges()">✅ Apply changes</button><button id="discard-btn" onclick="discardChanges()">✗ Discard</button></div></div>\n' +
'<div id="input-row"><textarea id="user-input" placeholder="e.g. Add board meeting every first Thursday at 7pm at Scopazzis, July through June…"></textarea><button id="send-btn" onclick="sendMessage()">➤</button></div>\n' +
'<script>\n' +
'var chatHistory = [], pending = null, busy = false;\n' +
'var provider = localStorage.getItem("assistantProvider") || "gemini";\n' +
'function setProvider(v) { provider = v; localStorage.setItem("assistantProvider", v); }\n' +
'\n' +
'function addMsg(cls, text) {\n' +
'  var c = document.getElementById("chat");\n' +
'  var d = document.createElement("div");\n' +
'  d.className = "msg " + cls;\n' +
'  d.textContent = text;\n' +
'  c.appendChild(d);\n' +
'  c.scrollTop = c.scrollHeight;\n' +
'}\n' +
'\n' +
'function setTyping(on) {\n' +
'  var el = document.getElementById("typing-dot");\n' +
'  if (on && !el) {\n' +
'    var d = document.createElement("div");\n' +
'    d.id = "typing-dot"; d.className = "typing";\n' +
'    d.textContent = "Thinking…";\n' +
'    var c = document.getElementById("chat");\n' +
'    c.appendChild(d); c.scrollTop = c.scrollHeight;\n' +
'  } else if (!on && el) el.remove();\n' +
'}\n' +
'\n' +
'function showProposal(p) {\n' +
'  pending = p;\n' +
'  var list = document.getElementById("prop-list");\n' +
'  list.innerHTML = "";\n' +
'  p.forEach(function(c) { var d = document.createElement("div"); d.textContent = c.description; list.appendChild(d); });\n' +
'  document.getElementById("proposal").style.display = "block";\n' +
'}\n' +
'function hideProposal() { document.getElementById("proposal").style.display = "none"; pending = null; }\n' +
'\n' +
'function gs(fn, arg) {\n' +
'  return new Promise(function(ok, fail) {\n' +
'    google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](arg);\n' +
'  });\n' +
'}\n' +
'function gs2(fn, a, b) {\n' +
'  return new Promise(function(ok, fail) {\n' +
'    google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a, b);\n' +
'  });\n' +
'}\n' +
'\n' +
'async function sendMessage() {\n' +
'  if (busy) return;\n' +
'  var inp = document.getElementById("user-input");\n' +
'  var txt = inp.value.trim();\n' +
'  if (!txt) return;\n' +
'  hideProposal();\n' +
'  inp.value = ""; busy = true;\n' +
'  document.getElementById("send-btn").disabled = true;\n' +
'  addMsg("user", txt);\n' +
'  chatHistory.push({ role: "user", text: txt });\n' +
'  setTyping(true);\n' +
'  try {\n' +
'    var res = await gs2("processMessage", chatHistory, provider);\n' +
'    setTyping(false);\n' +
'    if (res.error) { addMsg("err", "⚠️ " + res.error); }\n' +
'    else {\n' +
'      chatHistory = res.updatedHistory;\n' +
'      if (res.text) addMsg("assistant", res.text);\n' +
'      if (res.type === "proposal" && res.pending && res.pending.length) showProposal(res.pending);\n' +
'    }\n' +
'  } catch(e) { setTyping(false); addMsg("err", "⚠️ " + (e.message || String(e))); }\n' +
'  busy = false;\n' +
'  document.getElementById("send-btn").disabled = false;\n' +
'  inp.focus();\n' +
'}\n' +
'\n' +
'async function applyChanges() {\n' +
'  if (!pending) return;\n' +
'  var ch = pending; hideProposal(); busy = true;\n' +
'  document.getElementById("send-btn").disabled = true;\n' +
'  setTyping(true);\n' +
'  try {\n' +
'    var res = await gs("applyAssistantChanges", ch);\n' +
'    setTyping(false);\n' +
'    var msg = "✅ Done — added " + res.added + ", updated " + res.updated +\n' +
'      ", cancelled " + res.cancelled + ", deleted " + res.deleted + "." +\n' +
'      (res.backupName ? " Backup: " + res.backupName : "");\n' +
'    addMsg("note", msg);\n' +
'    chatHistory.push({ role: "user", text: "Changes were applied successfully." });\n' +
'    chatHistory.push({ role: "assistant", text: msg });\n' +
'  } catch(e) { setTyping(false); addMsg("err", "⚠️ Apply failed: " + (e.message || String(e))); }\n' +
'  busy = false;\n' +
'  document.getElementById("send-btn").disabled = false;\n' +
'}\n' +
'\n' +
'function discardChanges() {\n' +
'  hideProposal();\n' +
'  addMsg("note", "Changes discarded. What would you like to do differently?");\n' +
'}\n' +
'\n' +
'async function takeSnapshot() {\n' +
'  try { var n = await gs("createEventsBackup", null); addMsg("note", "📸 Snapshot saved: " + n); }\n' +
'  catch(e) { addMsg("err", "⚠️ Snapshot failed: " + (e.message || String(e))); }\n' +
'}\n' +
'\n' +
'document.getElementById("prov").value = provider;\n' +
'document.getElementById("user-input").addEventListener("keydown", function(e) {\n' +
'  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); sendMessage(); }\n' +
'});\n' +
'</script>\n' +
'</body>\n' +
'</html>';
}


// ═══════════════════════════════════════════════════════════════
//  SPEAKER PIPELINE — SETUP & SERVER API
// ═══════════════════════════════════════════════════════════════

function setupSpeakerPipeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PIPELINE_SHEET);
  if (!sheet) sheet = ss.insertSheet(PIPELINE_SHEET);

  const headers = [
    'Source', 'Status', 'Speaker Name', 'Speaker Email', 'Speaker Phone',
    'Speaker City', 'Topic', 'Speaker Role', 'Bio', 'Notes',
    'Assigned To', 'Preferred Dates', 'Tentative Date', 'Events Row', 'Photo URL',
    'Requestor Name', 'Requestor Email', 'Requestor Phone',
    'Spoke to Organizer', 'Spoke to President',
    'Avail Morning', 'Avail Evening', 'Zoom Only', 'Other Suggestions', 'Comments',
    'Submitted At', 'Updated At', 'Updated By',
    'Tags', 'Interested (+1s)',
    'Speaker URL', 'Summary', 'Introducer', 'Photo Bottom',
    'Priority', 'Is Rotarian', 'Is Local', 'Fundraising Literature', 'Hearts',
  ];

  const hdr = sheet.getRange(1, 1, 1, headers.length);
  hdr.setValues([headers]);
  hdr.setBackground('#1a3a6b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sheet.setFrozenRows(1);

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PIPELINE_STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, CP.STATUS, 500, 1).setDataValidation(statusRule);

  const colWidths = [80,90,160,180,120,120,220,110,300,300,
                     130,180,110,80,220,140,180,120,80,80,70,70,70,80,220,130,130,130,200,200,
                     280,300,150,220,80,80,70,110,60];
  colWidths.forEach((w,i) => sheet.setColumnWidth(i+1, w));
  sheet.setColumnWidth(CP.BIO, 300);
  sheet.setColumnWidth(CP.NOTES, 300);

  try { SpreadsheetApp.getUi().alert('Speaker Pipeline tab is ready!'); } catch(_) {}
}

/**
 * One-time cleanup after the 'confirmed' stage was merged into 'in-progress'.
 * Rewrites any 'confirmed' values in the Speaker Pipeline STATUS column.
 * Safe to run repeatedly (no-op once there are none left).
 */
function migratePipelineConfirmedStatus() {
  const sheet = getPipelineSheet_();
  const last = sheet.getLastRow();
  if (last < 2) { try { SpreadsheetApp.getUi().alert('No pipeline rows to migrate.'); } catch(_) {} return; }
  const range = sheet.getRange(2, CP.STATUS, last - 1, 1);
  const vals = range.getValues();
  let changed = 0;
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === 'confirmed') { vals[i][0] = 'in-progress'; changed++; }
  }
  if (changed) range.setValues(vals);
  try {
    SpreadsheetApp.getUi().alert(
      changed
        ? 'Migrated ' + changed + ' "confirmed" card' + (changed === 1 ? '' : 's') + ' to "in-progress".'
        : 'No "confirmed" cards found — nothing to migrate.'
    );
  } catch(_) {}
  return { ok: true, migrated: changed };
}

function openSpeakerPipeline() {
  let url;
  try { url = ScriptApp.getService().getUrl(); } catch(_) { url = null; }
  if (!url) { SpreadsheetApp.getUi().alert('Deploy the web app first.'); return; }
  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Opening Speaker Pipeline…</p>' +
    '<script>window.open("' + url + '?app=speaker-pipeline","_blank");google.script.host.close();</script>'
  ).setWidth(320).setHeight(60);
  SpreadsheetApp.getUi().showModalDialog(html, 'Speaker Pipeline');
}

/** Validate the shared pipeline password against Script Properties. */
function checkPipelinePassword(password) {
  const stored = PropertiesService.getScriptProperties().getProperty('KANBAN_PASSWORD');
  return !!(stored && password === stored);
}

/** Return all pipeline cards + member list for the web apps. */
function getPipelineData() {
  const sheet = getPipelineSheet_();
  const last = sheet.getLastRow();
  const cards = [];
  if (last > 1) {
    const data = sheet.getRange(2, 1, last - 1, NUM_PIPE_COLS).getValues();
    const tz = Session.getScriptTimeZone();
    data.forEach((row, i) => {
      const tv = row[CP.TENTATIVE_DATE - 1];
      cards.push({
        rowIndex:          i + 2,
        source:            String(row[CP.SOURCE - 1]              || ''),
        status:            (function(s){ s = String(s || 'new'); return PIPELINE_STATUS_ALIASES[s] || s; })(row[CP.STATUS - 1]),
        speakerName:       String(row[CP.SPEAKER_NAME - 1]        || ''),
        speakerEmail:      String(row[CP.SPEAKER_EMAIL - 1]       || ''),
        speakerPhone:      String(row[CP.SPEAKER_PHONE - 1]       || ''),
        speakerCity:       String(row[CP.SPEAKER_CITY - 1]        || ''),
        topic:             String(row[CP.TOPIC - 1]               || ''),
        speakerRole:       String(row[CP.SPEAKER_ROLE - 1]        || ''),
        bio:               String(row[CP.BIO - 1]                 || ''),
        notes:             String(row[CP.NOTES - 1]               || ''),
        assignedTo:        String(row[CP.ASSIGNED_TO - 1]         || ''),
        preferredDates:    String(row[CP.PREFERRED_DATES - 1]     || ''),
        tentativeDate:     tv instanceof Date ? Utilities.formatDate(tv, tz, 'yyyy-MM-dd') : String(tv || ''),
        eventsRow:         row[CP.EVENTS_ROW - 1]                 || '',
        photoUrl:          String(row[CP.PHOTO_URL - 1]           || ''),
        requestorName:     String(row[CP.REQUESTOR_NAME - 1]      || ''),
        requestorEmail:    String(row[CP.REQUESTOR_EMAIL - 1]     || ''),
        requestorPhone:    String(row[CP.REQUESTOR_PHONE - 1]     || ''),
        spokeToOrganizer:  row[CP.SPOKE_TO_ORGANIZER - 1] === 'Yes',
        spokeToPresident:  row[CP.SPOKE_TO_PRESIDENT - 1] === 'Yes',
        availMorning:      row[CP.AVAIL_MORNING - 1] === 'Yes',
        availEvening:      row[CP.AVAIL_EVENING - 1] === 'Yes',
        zoomOnly:          row[CP.ZOOM_ONLY - 1] === 'Yes',
        otherSuggestions:  row[CP.OTHER_SUGGESTIONS - 1] === 'Yes',
        comments:          String(row[CP.COMMENTS - 1]            || ''),
        submittedAt:       String(row[CP.SUBMITTED_AT - 1]        || ''),
        updatedAt:         String(row[CP.UPDATED_AT - 1]          || ''),
        updatedBy:         String(row[CP.UPDATED_BY - 1]          || ''),
        tags:              String(row[CP.TAGS - 1]                || ''),
        interested:        String(row[CP.INTERESTED - 1]          || ''),
        speakerUrl:        String(row[CP.SPEAKER_URL - 1]         || ''),
        summary:           String(row[CP.SUMMARY - 1]             || ''),
        introducer:        String(row[CP.INTRODUCER - 1]          || ''),
        photoTop:          String(row[CP.PHOTO_URL - 1]           || ''),
        photoBottom:       String(row[CP.PHOTO_BOTTOM - 1]        || ''),
        priority:          String(row[CP.PRIORITY - 1]            || ''),
        isRotarian:        row[CP.IS_ROTARIAN - 1] === 'Yes',
        isLocal:           row[CP.IS_LOCAL - 1] === 'Yes',
        fundraisingLiterature: row[CP.FUNDRAISING_LITERATURE - 1] === 'Yes',
        hearts:            parseInt(row[CP.HEARTS - 1]) || 0,
      });
    });
  }
  const members = getMemberNames_();
  return { cards, members, statuses: PIPELINE_STATUSES, statusLabels: PIPELINE_STATUS_LABELS };
}

/** Update fields on an existing pipeline card. Logs a timestamped change note. */
function savePipelineCard(rowIndex, changes, updatedBy) {
  const sheet = getPipelineSheet_();
  const tz = Session.getScriptTimeZone();
  const colMap = {
    status: CP.STATUS, speakerName: CP.SPEAKER_NAME, speakerEmail: CP.SPEAKER_EMAIL,
    speakerPhone: CP.SPEAKER_PHONE, speakerCity: CP.SPEAKER_CITY,
    topic: CP.TOPIC, speakerRole: CP.SPEAKER_ROLE, bio: CP.BIO,
    assignedTo: CP.ASSIGNED_TO, preferredDates: CP.PREFERRED_DATES,
    tentativeDate: CP.TENTATIVE_DATE, eventsRow: CP.EVENTS_ROW, photoUrl: CP.PHOTO_URL,
    comments: CP.COMMENTS, tags: CP.TAGS,
    speakerUrl: CP.SPEAKER_URL, summary: CP.SUMMARY, introducer: CP.INTRODUCER,
    photoTop: CP.PHOTO_URL, photoBottom: CP.PHOTO_BOTTOM,
    priority: CP.PRIORITY,
    zoomOnly: CP.ZOOM_ONLY, isRotarian: CP.IS_ROTARIAN,
    isLocal: CP.IS_LOCAL, fundraisingLiterature: CP.FUNDRAISING_LITERATURE,
  };
  const labelMap = {
    status: 'Status', speakerName: 'Speaker', speakerEmail: 'Email', speakerPhone: 'Phone',
    speakerCity: 'City', topic: 'Topic', speakerRole: 'Role', assignedTo: 'Assigned to',
    preferredDates: 'Preferred dates', tentativeDate: 'Date', speakerUrl: 'Speaker URL',
    introducer: 'Introducer', tags: 'Tags', comments: 'Comments', bio: 'Bio',
    summary: 'Summary', photoTop: 'Top photo', photoBottom: 'Bottom photo',
    photoUrl: 'Photo', eventsRow: 'Events row', priority: 'Priority',
    zoomOnly: 'Zoom only', isRotarian: 'Is Rotarian', isLocal: 'Is Local',
    fundraisingLiterature: 'Fundraising lit.',
  };
  // Long/opaque fields: note that they changed, not the full (often huge) value.
  const longFields = { bio: true, summary: true, photoTop: true, photoBottom: true, photoUrl: true };

  // Read the current row once so we can diff old → new and only write real changes.
  const cur = sheet.getRange(rowIndex, 1, 1, NUM_PIPE_COLS).getValues()[0];
  const diffs = [];
  Object.entries(changes).forEach(([k, v]) => {
    const col = colMap[k];
    if (!col) return;
    let oldVal = cur[col - 1];
    if (oldVal instanceof Date) oldVal = Utilities.formatDate(oldVal, tz, 'yyyy-MM-dd');
    oldVal = String(oldVal == null ? '' : oldVal);
    const newVal = String(v == null ? '' : v);
    if (oldVal === newVal) return; // unchanged — skip write and note
    sheet.getRange(rowIndex, col).setValue(v);
    if (longFields[k]) diffs.push((labelMap[k] || k) + (newVal ? ' updated' : ' cleared'));
    else diffs.push((labelMap[k] || k) + ': ' + (oldVal || '∅') + ' → ' + (newVal || '∅'));
  });

  const ts = Utilities.formatDate(new Date(), tz, 'M/d/yy h:mm a');
  let notes = null;
  if (diffs.length) {
    const entry = '[' + ts + ' ' + (updatedBy || '?') + ']: ' + diffs.join('; ');
    const noteCell = sheet.getRange(rowIndex, CP.NOTES);
    const existing = String(noteCell.getValue() || '').trim();
    notes = existing ? entry + '\n' + existing : entry;
    noteCell.setValue(notes);
  }
  sheet.getRange(rowIndex, CP.UPDATED_AT).setValue(ts);
  sheet.getRange(rowIndex, CP.UPDATED_BY).setValue(updatedBy || '');
  return { ok: true, noted: diffs.length, notes: notes };
}

/** Permanently delete a pipeline row. Removing the row shifts all rows below
 *  it up by one, so clients must reload after calling this. */
function deletePipelineCard(rowIndex) {
  const sheet = getPipelineSheet_();
  if (!rowIndex || rowIndex < 2) throw new Error('Invalid row index.');
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

/** Toggle a +1 vote for memberName on a pipeline card. Returns updated interested string. */
function togglePipelineVote(rowIndex, memberName) {
  const sheet = getPipelineSheet_();
  const cell = sheet.getRange(rowIndex, CP.INTERESTED);
  const existing = String(cell.getValue() || '');
  const names = existing ? existing.split(',').map(n => n.trim()).filter(Boolean) : [];
  const idx = names.indexOf(memberName);
  if (idx === -1) { names.push(memberName); } else { names.splice(idx, 1); }
  const updated = names.join(', ');
  cell.setValue(updated);
  return { ok: true, interested: updated };
}

/**
 * Save an uploaded/pasted photo (base64 data URL) to Drive and return a public
 * URL. Called from the pipeline web apps when a user uploads from their computer.
 */
function uploadPipelinePhoto(dataUrl, fileName, speakerName) {
  const url = savePhotoToDrive_({
    photoBase64: dataUrl,
    photoName:   fileName || 'photo.jpg',
    speakerName: speakerName || 'speaker',
  });
  if (!url) throw new Error('Could not save photo. Check that the file is a valid image under ~10 MB.');
  return { ok: true, url: url };
}

/** Prepend a timestamped note to the Notes cell (newest-first). */
function appendPipelineNote(rowIndex, noteText, authorName) {
  const sheet = getPipelineSheet_();
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'M/d/yy h:mm a');
  const entry = '[' + stamp + ' ' + (authorName || '?') + ']: ' + noteText;
  const cell = sheet.getRange(rowIndex, CP.NOTES);
  const existing = String(cell.getValue() || '').trim();
  cell.setValue(existing ? entry + '\n' + existing : entry);
  sheet.getRange(rowIndex, CP.UPDATED_AT).setValue(stamp);
  sheet.getRange(rowIndex, CP.UPDATED_BY).setValue(authorName || '');
  return { ok: true };
}

/** Add a manually-created pipeline card. */
function addPipelineCard(data, addedBy) {
  const sheet = getPipelineSheet_();
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy h:mm a');
  const row = buildPipelineRow_('manual', data, '', ts);
  row[CP.UPDATED_BY - 1] = addedBy || '';
  if (data.status) row[CP.STATUS - 1] = data.status;
  sheet.appendRow(row);
  return { ok: true, rowIndex: sheet.getLastRow() };
}

/** Return upcoming Events rows where the main speaker slot is empty or TBD. */
function getUpcomingEventsForPicker() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUM_COLS).getValues();
  const results = [];
  data.forEach((row, i) => {
    const dv = row[COL.DATE - 1];
    if (!dv || !(dv instanceof Date)) return;
    const d = new Date(dv); d.setHours(0, 0, 0, 0);
    if (d < today) return;
    if (row[COL.CANCELLED - 1]) return;
    const type = String(row[COL.EVENT_TYPE - 1] || '').toLowerCase();
    // Only regular Meetings can host a speaker — assemblies (no-speaker by
    // definition) and board meetings are never assignable/tentative dates.
    if (type !== 'meeting') return;
    const tv = row[COL.TIME - 1];
    const speakerRaw = String(row[COL.MAIN_SPEAKER - 1] || '').trim();
    const speakerUp  = speakerRaw.toUpperCase();
    const available  = !speakerRaw || speakerUp === 'TBD' || speakerUp === 'N/A';
    results.push({
      rowIndex:    i + 2,
      date:        Utilities.formatDate(dv, tz, 'yyyy-MM-dd'),
      dateLabel:   Utilities.formatDate(dv, tz, 'EEE MMM d, yyyy'),
      eventType:   String(row[COL.EVENT_TYPE - 1] || ''),
      mainSpeaker: speakerRaw,
      mainTopic:   String(row[COL.MAIN_TOPIC - 1] || ''),
      time:        tv instanceof Date ? Utilities.formatDate(tv, tz, 'h:mm a') : String(tv || ''),
      location:    String(row[COL.LOCATION - 1] || ''),
      available:   available,
    });
  });
  return results; // return all; client trims to preference
}

/**
 * Copy speaker data from a pipeline card into an existing Events row.
 * Sets pipeline card status to 'scheduled' and records the events row link.
 */
function assignSpeakerToEvent(pipelineRow, eventsRow, updatedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const evSheet = ss.getSheetByName(SHEET_NAME);
  const pSheet  = getPipelineSheet_();

  const tz = Session.getScriptTimeZone();
  const pData = pSheet.getRange(pipelineRow, 1, 1, NUM_PIPE_COLS).getValues()[0];
  const speakerName  = String(pData[CP.SPEAKER_NAME - 1] || '');
  const topic        = String(pData[CP.TOPIC - 1]        || '');
  const bio          = String(pData[CP.BIO - 1]          || '');
  const summary      = String(pData[CP.SUMMARY - 1]      || '');
  const speakerUrl   = String(pData[CP.SPEAKER_URL - 1]  || '');
  const introducer   = String(pData[CP.INTRODUCER - 1]   || '');
  const photoTop     = String(pData[CP.PHOTO_URL - 1]    || '');
  const photoBottom  = String(pData[CP.PHOTO_BOTTOM - 1] || '');
  const role         = String(pData[CP.SPEAKER_ROLE - 1] || 'Main Speaker').toLowerCase();

  // The scheduled meeting's date — mirrored onto the card so it shows on the
  // board and is included in conflict detection.
  const evDateRaw = evSheet.getRange(eventsRow, COL.DATE).getValue();
  const evDate = evDateRaw instanceof Date ? Utilities.formatDate(evDateRaw, tz, 'yyyy-MM-dd') : String(evDateRaw || '');

  if (role.includes('opening')) {
    evSheet.getRange(eventsRow, COL.OPENING_SPEAKER).setValue(speakerName);
  } else {
    evSheet.getRange(eventsRow, COL.MAIN_SPEAKER).setValue(speakerName);
    evSheet.getRange(eventsRow, COL.MAIN_TOPIC).setValue(topic);
  }
  // Prefer the explicit Summary; fall back to Bio if Summary is empty.
  const narrative = summary || bio;
  if (narrative)    evSheet.getRange(eventsRow, COL.SUMMARY).setValue(narrative);
  if (speakerUrl)   evSheet.getRange(eventsRow, COL.SPEAKER_URL).setValue(speakerUrl);
  if (introducer)   evSheet.getRange(eventsRow, COL.INTRODUCER).setValue(introducer);
  if (photoTop)     evSheet.getRange(eventsRow, COL.PHOTO_TOP).setValue(photoTop);
  if (photoBottom)  evSheet.getRange(eventsRow, COL.PHOTO_BOTTOM).setValue(photoBottom);

  const ts = Utilities.formatDate(new Date(), tz, 'M/d/yy h:mm a');
  evSheet.getRange(eventsRow, COL.STATUS).setValue('Speaker assigned ' + ts);

  pSheet.getRange(pipelineRow, CP.STATUS).setValue('scheduled');
  pSheet.getRange(pipelineRow, CP.EVENTS_ROW).setValue(eventsRow);
  if (evDate) pSheet.getRange(pipelineRow, CP.TENTATIVE_DATE).setValue(evDate);

  // Log the scheduling as a change note.
  const noteCell = pSheet.getRange(pipelineRow, CP.NOTES);
  const existingNote = String(noteCell.getValue() || '').trim();
  const entry = '[' + ts + ' ' + (updatedBy || '?') + ']: Scheduled' + (evDate ? ' to ' + evDate : '') + ' (Events row ' + eventsRow + ')';
  noteCell.setValue(existingNote ? entry + '\n' + existingNote : entry);

  pSheet.getRange(pipelineRow, CP.UPDATED_AT).setValue(ts);
  pSheet.getRange(pipelineRow, CP.UPDATED_BY).setValue(updatedBy || '');

  return { ok: true, speakerName, eventsRow };
}

function getMemberNames_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ms = ss.getSheetByName('Members');
  if (!ms || ms.getLastRow() < 2) return [];
  return ms.getRange(2, 1, ms.getLastRow() - 1, 1)
    .getValues().map(r => String(r[0] || '').trim()).filter(Boolean).sort();
}


// ═══════════════════════════════════════════════════════════════
//  PIPELINE AI COMMAND LINE  (Gemini — proposes, never auto-applies)
//  Requires: Script Properties → GEMINI_API_KEY
// ═══════════════════════════════════════════════════════════════

const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Turn one plain-language instruction into a list of proposed pipeline actions.
 * Returns { actions: [...], message } — the client shows these for confirmation
 * and only calls applyPipelineActions() if the user clicks Apply. Nothing is
 * written here.
 */
function pipelineAssistantCommand(text, updatedBy) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { error: 'GEMINI_API_KEY not set. Add it in Apps Script → Project Settings → Script Properties.' };
    if (!text || !String(text).trim()) return { actions: [], message: 'Type a command first.' };

    const cards    = getPipelineData().cards.filter(function(c) { return c.status !== 'deleted'; });
    const meetings = getUpcomingEventsForPicker();
    const members  = getMemberNames_();

    const cardLines = cards.map(function(c) {
      return '[' + c.rowIndex + '] ' + (c.speakerName || '(no name)') +
        ' — status=' + c.status +
        (c.assignedTo ? ', assignedTo=' + c.assignedTo : '') +
        (c.topic ? ', topic=' + c.topic : '') +
        (c.tentativeDate ? ', date=' + c.tentativeDate : '');
    }).join('\n');
    const meetingLines = meetings.map(function(m) {
      return '[' + m.rowIndex + '] ' + m.date + ' ' + (m.available ? '(open)' : '(taken: ' + m.mainSpeaker + ')');
    }).join('\n');

    const sys =
      'You convert ONE short instruction from a Rotary club officer into structured actions on a speaker pipeline. ' +
      'Only use the speakers (each shown with a rowIndex) and meetings (each shown with an eventsRow) from the context. ' +
      'Match speaker names case-insensitively and tolerantly (a first name alone is fine if it is unambiguous). ' +
      'Valid statuses: ' + PIPELINE_STATUSES.join(', ') + '. ' +
      'Valid member names for assignedTo: ' + (members.join(', ') || '(none)') + '.\n' +
      'Action kinds:\n' +
      '- "update": change a card. Set rowIndex and any of: status, assignedTo, tentativeDate (YYYY-MM-DD), topic.\n' +
      '- "note": add a note. Set rowIndex and note.\n' +
      '- "assign": book a speaker into a meeting date. Set rowIndex (the speaker) and eventsRow (the meeting).\n' +
      '- "none": when the request is unclear, or the speaker/meeting is not found. Explain why in message.\n' +
      'To DELETE or REMOVE a speaker, use an "update" action with status "deleted" (this moves the card to ' +
      'the Deleted trash and is reversible). To restore one, update status to "new".\n' +
      'Give every action a short human description like "Move Jane Smith → Scheduled" or "Delete John Doe (move to trash)". ' +
      'Only do what was asked. If a name is ambiguous or not found, return a single "none" action and explain in message.';
    const user = 'SPEAKERS:\n' + (cardLines || '(none)') +
      '\n\nMEETINGS (open speaker slots):\n' + (meetingLines || '(none)') +
      '\n\nINSTRUCTION:\n' + String(text).trim();

    const schema = {
      type: 'OBJECT',
      properties: {
        actions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              kind:          { type: 'STRING' },
              rowIndex:      { type: 'INTEGER' },
              status:        { type: 'STRING' },
              assignedTo:    { type: 'STRING' },
              tentativeDate: { type: 'STRING' },
              topic:         { type: 'STRING' },
              note:          { type: 'STRING' },
              eventsRow:     { type: 'INTEGER' },
              description:   { type: 'STRING' },
            },
            required: ['kind', 'description'],
          },
        },
        message: { type: 'STRING' },
      },
      required: ['actions'],
    };

    const parsed = callGeminiJson_(apiKey, sys, user, schema);
    const raw = (parsed && parsed.actions) || [];

    // Validate every proposed action against real rows before showing it.
    const validCards = {}; cards.forEach(function(c) { validCards[c.rowIndex] = c; });
    const validMtgs  = {}; meetings.forEach(function(m) { validMtgs[m.rowIndex] = m; });
    const actions = [];
    raw.forEach(function(a) {
      if (!a || a.kind === 'none') return;
      if (a.kind === 'update') {
        if (!validCards[a.rowIndex]) return;
        const changes = {};
        if (a.status && PIPELINE_STATUSES.indexOf(a.status) !== -1) changes.status = a.status;
        if (a.assignedTo) changes.assignedTo = a.assignedTo;
        if (a.tentativeDate) changes.tentativeDate = a.tentativeDate;
        if (a.topic) changes.topic = a.topic;
        if (!Object.keys(changes).length) return;
        actions.push({ kind: 'update', rowIndex: a.rowIndex, changes: changes, description: a.description || 'Update row ' + a.rowIndex });
      } else if (a.kind === 'note') {
        if (!validCards[a.rowIndex] || !a.note) return;
        actions.push({ kind: 'note', rowIndex: a.rowIndex, note: a.note, description: a.description || 'Add a note' });
      } else if (a.kind === 'assign') {
        if (!validCards[a.rowIndex] || !validMtgs[a.eventsRow]) return;
        actions.push({ kind: 'assign', rowIndex: a.rowIndex, eventsRow: a.eventsRow, description: a.description || 'Assign to a meeting' });
      }
    });
    return { ok: true, actions: actions, message: (parsed && parsed.message) || '' };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}

/** Apply actions confirmed by the user. Reuses the existing write functions. */
function applyPipelineActions(actions, updatedBy) {
  if (!actions || !actions.length) return { ok: true, applied: 0 };
  let applied = 0;
  actions.forEach(function(a) {
    if (a.kind === 'update')      { savePipelineCard(a.rowIndex, a.changes, updatedBy); applied++; }
    else if (a.kind === 'note')   { appendPipelineNote(a.rowIndex, a.note, updatedBy);  applied++; }
    else if (a.kind === 'assign') { assignSpeakerToEvent(a.rowIndex, a.eventsRow, updatedBy); applied++; }
  });
  return { ok: true, applied: applied };
}

function callGeminiJson_(apiKey, systemText, userText, schema) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
    ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    muteHttpExceptions: true, payload: JSON.stringify(payload),
  });
  const body = JSON.parse(resp.getContentText());
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  const cand  = (body.candidates || [])[0];
  const parts = cand && cand.content && cand.content.parts;
  if (!parts || !parts[0] || parts[0].text == null) throw new Error('No response from Gemini.');
  return JSON.parse(parts[0].text);
}


// ═══════════════════════════════════════════════════════════════
//  EVENT EDITOR — HTML  (?app=events)
// ═══════════════════════════════════════════════════════════════
function getEventEditorHtml() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLV Rotary — Event Editor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#eef1f6;color:#1e293b;height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{background:linear-gradient(135deg,#17458F,#1a56db);color:#fff;padding:0.7em 1em;display:flex;align-items:center;gap:0.7em;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.15)}
header h1{font-size:1.05em;font-weight:700;flex:1;letter-spacing:0.01em}
.hbtn{font-size:0.8em;padding:5px 12px;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;cursor:pointer;text-decoration:none;white-space:nowrap}
.hbtn:hover{background:rgba(255,255,255,0.3)}
#main{flex:1;overflow-y:auto;padding:0.9em;max-width:760px;width:100%;margin:0 auto}
#hint{font-size:0.8em;color:#64748b;margin:0 0.2em 0.8em;line-height:1.45}
#toolbar{display:flex;gap:0.6em;margin-bottom:0.6em;position:sticky;top:0;z-index:5}
#search{flex:1;padding:10px 13px;border:1px solid #cfd6e4;border-radius:9px;font-size:0.95em;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.05)}
#search:focus{outline:none;border-color:#1a56db;box-shadow:0 0 0 3px rgba(26,86,219,0.12)}
#add-btn{background:#16a34a;color:#fff;border:none;padding:10px 18px;border-radius:9px;font-weight:700;cursor:pointer;font-size:0.92em;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.15)}
#add-btn:hover{background:#15803d}
.month-hd{font-size:0.76em;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;margin:1.1em 0 0.45em 0.2em}
.ev{background:#fff;border-radius:11px;padding:0.65em 0.85em 0.65em 0.9em;margin-bottom:0.5em;cursor:pointer;display:flex;align-items:center;gap:0.85em;border-left:5px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,0.07);transition:box-shadow .12s,transform .12s}
.ev:hover{box-shadow:0 4px 12px rgba(0,0,0,0.13);transform:translateY(-1px)}
.ev.cancelled{opacity:0.55}
.ev.cancelled .ev-name{text-decoration:line-through}
.ev-date{flex-shrink:0;width:46px;text-align:center;line-height:1.05}
.ev-dow{font-size:0.66em;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:0.03em}
.ev-day{font-size:1.4em;font-weight:800;color:#17458F}
.ev-mon{font-size:0.64em;text-transform:uppercase;color:#94a3b8;font-weight:700}
.ev-main{flex:1;min-width:0}
.ev-name{font-weight:600;color:#1e293b;font-size:0.96em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-untitled{color:#94a3b8;font-style:italic;font-weight:400}
.ev-meta{font-size:0.8em;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-chip{flex-shrink:0;font-size:0.7em;font-weight:700;padding:3px 10px;border-radius:20px;color:#3a2f00}
.ev-cancelled-tag{flex-shrink:0;font-size:0.66em;font-weight:700;color:#b91c1c;background:#fee2e2;padding:3px 9px;border-radius:20px}
.ev-thumb{flex-shrink:0;width:46px;height:46px;object-fit:cover;border-radius:7px;border:1px solid #e2e8f0}
.ev-signup{color:#1a56db;font-weight:600;font-size:0.85em;text-decoration:none;white-space:nowrap}
.ev-signup:hover{text-decoration:underline}
.empty{text-align:center;color:#94a3b8;padding:3em 1em;font-size:0.95em;line-height:1.6}
/* Slide-over panel */
#scrim{position:fixed;inset:0;background:rgba(15,23,42,0.45);opacity:0;visibility:hidden;transition:opacity .2s;z-index:50}
#scrim.open{opacity:1;visibility:visible}
#panel{position:fixed;top:0;right:-470px;width:450px;max-width:93vw;height:100%;background:#fff;box-shadow:-6px 0 24px rgba(0,0,0,0.18);transition:right .22s cubic-bezier(.4,0,.2,1);z-index:60;display:flex;flex-direction:column}
#panel.open{right:0}
#panel-hd{background:#17458F;color:#fff;padding:0.85em 1em;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
#panel-hd h2{font-size:1.05em}
#panel-x{background:none;border:none;color:#fff;font-size:1.4em;cursor:pointer;line-height:1}
#panel-body{flex:1;overflow-y:auto;padding:1.1em}
.fld{margin-bottom:0.85em}
.fld label{display:block;font-size:0.74em;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#475569;margin-bottom:4px}
.fld input,.fld select,.fld textarea{width:100%;padding:9px 11px;border:1px solid #cfd6e4;border-radius:8px;font-size:0.95em;font-family:inherit;background:#fff;color:#1e293b}
.fld input:focus,.fld select:focus,.fld textarea:focus{outline:none;border-color:#1a56db;box-shadow:0 0 0 3px rgba(26,86,219,0.12)}
.fld textarea{resize:vertical;min-height:80px}
.fld-row{display:flex;gap:0.7em}
.fld-row .fld{flex:1}
.chk{display:flex;align-items:center;gap:0.5em;cursor:pointer;font-size:0.9em;color:#334155;margin-top:0.3em}
.chk input{width:auto}
#panel-foot{flex-shrink:0;padding:0.8em 1.1em;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:0.6em}
.btn{border:none;border-radius:8px;padding:11px 18px;font-size:0.92em;font-weight:700;cursor:pointer}
.btn-save{background:#16a34a;color:#fff;flex:1}
.btn-save:hover{background:#15803d}
.btn-save:disabled{background:#9ca3af;cursor:default}
.btn-del{background:#fff;color:#dc2626;border:1px solid #fca5a5}
.btn-del:hover{background:#fef2f2}
#toast{position:fixed;bottom:1.3em;left:50%;transform:translateX(-50%) translateY(160%);background:#1e293b;color:#fff;padding:11px 22px;border-radius:10px;font-size:0.9em;z-index:80;transition:transform .25s;box-shadow:0 4px 16px rgba(0,0,0,0.25)}
#toast.show{transform:translateX(-50%) translateY(0)}
#toast.err{background:#b91c1c}
/* Auth */
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:12px;padding:2em;width:300px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.3)}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
@media(max-width:520px){#panel{width:100%;max-width:100%;right:-100%}}
</style>
</head>
<body>

<div id="auth">
  <div class="auth-box">
    <h2>📋 SLV Rotary<br>Club Events</h2>
    <input type="text" id="auth-name" placeholder="Your name" autocomplete="name">
    <input type="password" id="auth-pw" placeholder="Password">
    <button onclick="doLogin()">Enter</button>
    <div class="auth-err" id="auth-err"></div>
  </div>
</div>

<header>
  <h1>📋 Club Events</h1>
  <span id="hdr-user" style="font-size:0.85em;opacity:0.85"></span>
  <button class="hbtn" id="adv-toggle" onclick="toggleAdvanced()" title="Also edit meetings, board meetings, and every other event type">Show all types</button>
  <a class="hbtn" href="__EXEC_URL__" target="_top">Duty Editor →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>

<div id="main">
  <p id="hint">Add or edit socials, service projects, fundraisers and other dates for the next year. Tap <strong>Show all types</strong> to also edit meetings (speaker, topic, Google Meet, introducer); duty roles stay in the Duty Editor.</p>
  <div id="toolbar">
    <input id="search" placeholder="Search events…" oninput="render()">
    <select id="weeks" onchange="render()" title="How far ahead to show" style="padding:10px 9px;border:1px solid #cfd6e4;border-radius:9px;font-size:0.9em;background:#fff">
      <option value="0">All</option>
      <option value="4">4 wks</option>
      <option value="8">8 wks</option>
      <option value="12">12 wks</option>
      <option value="26">26 wks</option>
    </select>
    <button id="add-btn" onclick="openNew()">+ Add</button>
  </div>
  <div id="list"></div>
</div>

<div id="scrim" onclick="closePanel()"></div>
<div id="panel">
  <div id="panel-hd"><h2 id="panel-title">Add Event</h2><button id="panel-x" onclick="closePanel()">✕</button></div>
  <div id="panel-body">
    <div class="fld"><label>Event Type</label><select id="f-type" onchange="updateTypeUI()"></select></div>
    <div class="fld-row">
      <div class="fld"><label>Date</label><input type="date" id="f-date"></div>
      <div class="fld"><label>Time</label><input type="time" id="f-time"></div>
      <div class="fld" style="max-width:95px"><label>Min</label><input type="number" id="f-duration" min="0" step="15"></div>
    </div>
    <div class="fld"><label id="lbl-name">Event Name</label><input type="text" id="f-name" placeholder="e.g. Beach Cleanup"></div>
    <div id="speaker-fields" style="display:none">
      <div class="fld"><label>Main Speaker</label><input type="text" id="f-main-speaker" list="member-list" placeholder="Program speaker"></div>
      <div class="fld"><label>Opening Speaker</label><input type="text" id="f-opening-speaker" placeholder="Invocation / opening thought (usually blank)"></div>
      <div class="fld"><label>Introducer</label><input type="text" id="f-introducer" list="member-list" placeholder="Who introduces the speaker"></div>
      <div class="fld"><label>Google Meet Link</label><input type="url" id="f-meet" placeholder="https://meet.google.com/… (usually blank)"></div>
    </div>
    <div class="fld"><label>Location</label><input type="text" id="f-location" placeholder="Venue and city"></div>
    <div class="fld"><label id="lbl-organizer">Organizer</label><input type="text" id="f-organizer" list="member-list" placeholder="Who is running this"><datalist id="member-list"></datalist></div>
    <div class="fld"><label>Details (for newsletter)</label><textarea id="f-summary" placeholder="What is happening, who should come…"></textarea></div>
    <div class="fld"><label id="lbl-link">Info / Signup Link</label><input type="url" id="f-link" placeholder="https://…"></div>
    <div class="fld"><label>Photo (optional)</label>
      <input type="url" id="f-photo" placeholder="https://… or upload below" oninput="showPhotoPrev()">
      <input type="file" accept="image/*" style="margin-top:6px;font-size:0.85em" onchange="uploadPhoto(this)">
      <div id="f-photo-prev" style="margin-top:6px"></div>
    </div>
    <label class="chk"><input type="checkbox" id="f-cancelled"> Mark as cancelled</label>
    <label class="chk"><input type="checkbox" id="f-hide-newsletter"> Hide from newsletter</label>
    <div id="notes-section" style="margin-top:1.1em;display:none">
      <div style="font-weight:700;color:#17458F;font-size:0.78em;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #e2e8f0;padding-bottom:3px;margin-bottom:0.5em">Notes</div>
      <div id="f-notes-display" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.5em 0.7em;font-size:0.82em;white-space:pre-wrap;max-height:130px;overflow-y:auto;color:#334155;margin-bottom:0.5em"></div>
      <textarea id="f-note-input" placeholder="Add a note…" style="width:100%;padding:9px 11px;border:1px solid #cfd6e4;border-radius:8px;font-size:0.9em;min-height:50px;resize:vertical;font-family:inherit"></textarea>
      <button class="btn" style="background:#eef2ff;color:#1a56db;border:1px solid #c7d2fe;margin-top:6px;padding:8px 14px" onclick="addNote()">Add Note</button>
    </div>
  </div>
  <div id="panel-foot">
    <button class="btn btn-del" id="btn-del" onclick="deleteCurrent()">Delete</button>
    <button class="btn btn-save" onclick="savePanel()">Save</button>
  </div>
</div>

<div id="toast"></div>

<script>
var DATA={events:[],members:[],types:[],allTypes:[]}, currentUser='', editingRow=0, toastTimer=null;
var advanced=localStorage.getItem('eventEditorAdvanced')==='1';
var SPEAKER_TYPES=['Meeting','Assembly','Board Meeting'];
var ADV_EXCLUDE=['Grey Bears']; // editing these here is rare — keep them out of the advanced list
var DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MONF=['January','February','March','April','May','June','July','August','September','October','November','December'];
var TYPE_COLOR={'Meeting':'#c7d8f7','Assembly':'#a5f3fc','Board Meeting':'#93c5fd','Social':'#fde68a','Service':'#fdba74','Grey Bears':'#fde8d0','Fundraiser':'#e9d5ff','District Event':'#86efac','Committee':'#fce7f3','Holiday':'#fca5a5','Other':'#d1d5db'};

function gs(fn,arg){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](arg);});}
function gs2(fn,a,b){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a,b);});}
function gs3(fn,a,b,c){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a,b,c);});}
function gs4(fn,a,b,c,d){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a,b,c,d);});}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Time helpers (no regex — backtick template eats backslashes)
function to24(s){
  s=String(s||'').trim(); if(!s)return '';
  var up=s.toUpperCase(), ap='';
  if(up.indexOf('PM')>-1)ap='PM'; else if(up.indexOf('AM')>-1)ap='AM';
  var t=up.replace('AM','').replace('PM','').trim(), parts=t.split(':');
  if(parts.length<2)return '';
  var h=parseInt(parts[0],10), m=parseInt(parts[1],10);
  if(isNaN(h)||isNaN(m))return '';
  if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0;
  return ('0'+h).slice(-2)+':'+('0'+m).slice(-2);
}
function to12(s){
  s=String(s||'').trim(); if(!s)return '';
  var parts=s.split(':'); if(parts.length<2)return '';
  var h=parseInt(parts[0],10), m=parseInt(parts[1],10);
  if(isNaN(h)||isNaN(m))return '';
  var ap=h>=12?'PM':'AM', h12=h%12; if(h12===0)h12=12;
  return h12+':'+('0'+m).slice(-2)+' '+ap;
}
function cardDate(ds){var p=ds.split('-'),dt=new Date(+p[0],+p[1]-1,+p[2]);return{dow:DOW[dt.getDay()],day:+p[2],mon:MON[+p[1]-1]};}
function monthKey(ds){var p=ds.split('-');return MONF[+p[1]-1]+' '+p[0];}
function isoAhead(days){var d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+days);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}

function toast(msg,err){var t=document.getElementById('toast');t.textContent=msg;t.className=err?'show err':'show';clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.className='';},2600);}
function busy(b){var s=document.querySelector('.btn-save');if(s){s.disabled=b;s.textContent=b?'Saving…':'Save';}}

// ── Photo upload + preview (reuses the pipeline's Drive uploader) ──
function driveThumb(u,size){if(!u)return'';var id='',i=u.indexOf('id=');if(i>=0){id=u.substring(i+3).split('&')[0];}else{var j=u.indexOf('/d/');if(j>=0)id=u.substring(j+3).split('/')[0];}return id?'https://drive.google.com/thumbnail?id='+id+'&sz=w'+(size||200):u;}
function showPhotoPrev(){var v=getV('f-photo'),prev=document.getElementById('f-photo-prev');if(!prev)return;prev.innerHTML=(v&&v.indexOf('http')===0)?'<img src="'+esc(driveThumb(v,250))+'" style="max-width:150px;max-height:150px;border-radius:8px;border:1px solid #ddd" onerror="this.style.display=&#39;none&#39;">':'';}
function uploadPhoto(input){
  var file=input.files[0]; if(!file)return;
  var prev=document.getElementById('f-photo-prev');
  if(file.size>8*1024*1024){prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Image too large (max 8 MB)</span>';input.value='';return;}
  prev.innerHTML='<span style="font-size:0.8em;color:#64748b">Uploading…</span>';
  var reader=new FileReader();
  reader.onload=function(ev){
    gs3('uploadPipelinePhoto',ev.target.result,file.name,getV('f-name')||'event')
      .then(function(res){setV('f-photo',res.url);showPhotoPrev();})
      .catch(function(e){prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Upload failed: '+(e.message||e)+'</span>';});
  };
  reader.readAsDataURL(file);
}

// ── List ──────────────────────────────────────────────────────
function render(){
  var q=(document.getElementById('search').value||'').toLowerCase();
  var list=document.getElementById('list'); list.innerHTML='';
  var wk=parseInt((document.getElementById('weeks')||{}).value,10)||0;
  var cutoff=wk?isoAhead(wk*7):'';
  var shown=DATA.events.filter(function(e){
    // Basic mode: only the member-editable types. Advanced: everything except
    // Grey Bears (rarely edited here — kept out so the list stays readable).
    if(advanced){ if(ADV_EXCLUDE.indexOf(e.eventType)!==-1)return false; }
    else if(DATA.types.indexOf(e.eventType)===-1)return false;
    if(cutoff && e.date>cutoff)return false;   // week-count view filter
    if(!q)return true;
    return (e.eventName+' '+e.eventType+' '+e.location+' '+e.organizer+' '+(e.mainSpeaker||'')+' '+e.date).toLowerCase().indexOf(q)>-1;
  });
  if(!shown.length){list.innerHTML='<div class="empty">No events found.<br>Tap <b>+ Add</b> to create one.</div>';return;}
  var curMonth='';
  shown.forEach(function(e){
    var mk=monthKey(e.date);
    if(mk!==curMonth){curMonth=mk;var h=document.createElement('div');h.className='month-hd';h.textContent=mk;list.appendChild(h);}
    var cd=cardDate(e.date), color=TYPE_COLOR[e.eventType]||'#d1d5db';
    var meta=[]; if(e.time)meta.push(esc(e.time)); if(e.location)meta.push(esc(e.location)); if(e.organizer)meta.push('· '+esc(e.organizer));
    var nameHtml=e.eventName?esc(e.eventName):'<span class="ev-untitled">(untitled '+esc(e.eventType)+')</span>';
    // A signup/info link becomes a "– signup" link on the title (it stops the
    // click from also opening the edit panel).
    if(e.link)nameHtml+=' <a class="ev-signup" href="'+esc(e.link)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">– signup</a>';
    // Scaled thumbnail sits just before the type chip when the event has a photo.
    var thumb=e.photo?'<img class="ev-thumb" src="'+esc(driveThumb(e.photo,120))+'" onerror="this.style.display=&#39;none&#39;">':'';
    var tag=e.cancelled?'<span class="ev-cancelled-tag">Cancelled</span>':'<span class="ev-chip" style="background:'+color+'">'+esc(e.eventType)+'</span>';
    var card=document.createElement('div');
    card.className='ev'+(e.cancelled?' cancelled':'');
    card.style.borderLeftColor=color;
    card.innerHTML=
      '<div class="ev-date"><div class="ev-dow">'+cd.dow+'</div><div class="ev-day">'+cd.day+'</div><div class="ev-mon">'+cd.mon+'</div></div>'+
      '<div class="ev-main"><div class="ev-name">'+nameHtml+'</div><div class="ev-meta">'+meta.join(' ')+'</div></div>'+thumb+tag;
    card.onclick=(function(r){return function(){openEdit(r);};})(e.rowIndex);
    list.appendChild(card);
  });
}

// ── Panel ─────────────────────────────────────────────────────
function fillOptions(){
  var sel=document.getElementById('f-type'); sel.innerHTML='';
  var typeList=(advanced&&DATA.allTypes&&DATA.allTypes.length)
    ?DATA.allTypes.filter(function(t){return ADV_EXCLUDE.indexOf(t)===-1;})
    :DATA.types;
  typeList.forEach(function(t){var o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o);});
  var dl=document.getElementById('member-list'); dl.innerHTML='';
  DATA.members.forEach(function(m){var o=document.createElement('option');o.value=m;dl.appendChild(o);});
}
// Show the speaker block + relabel the shared fields when a meeting type is picked.
function updateTypeUI(){
  var isMtg=SPEAKER_TYPES.indexOf(getV('f-type'))>-1;
  document.getElementById('speaker-fields').style.display=isMtg?'':'none';
  document.getElementById('lbl-name').textContent=isMtg?'Main Topic':'Event Name';
  document.getElementById('lbl-link').textContent=isMtg?'Speaker URL':'Info / Signup Link';
  document.getElementById('lbl-organizer').textContent=isMtg?'Speaker Organizer':'Organizer';
  document.getElementById('f-name').placeholder=isMtg?'e.g. Water Conservation':'e.g. Beach Cleanup';
}
// Header toggle: persist the choice, rebuild the type dropdown + list.
function toggleAdvanced(){
  advanced=!advanced;
  localStorage.setItem('eventEditorAdvanced',advanced?'1':'');
  syncAdvToggle();
  fillOptions(); render();
}
function syncAdvToggle(){
  var b=document.getElementById('adv-toggle');
  if(b)b.textContent=advanced?'✓ All types':'Show all types';
}
function openPanel(){document.getElementById('panel').classList.add('open');document.getElementById('scrim').classList.add('open');}
function closePanel(){document.getElementById('panel').classList.remove('open');document.getElementById('scrim').classList.remove('open');}
function setV(id,v){document.getElementById(id).value=(v==null?'':v);}
function getV(id){return document.getElementById(id).value;}

function sameUser(a,b){return !!a&&!!b&&String(a).trim().toLowerCase()===String(b).trim().toLowerCase();}

function openNew(){
  editingRow=0;
  document.getElementById('panel-title').textContent='Add Event';
  document.getElementById('btn-del').style.display='none';
  document.getElementById('notes-section').style.display='none';
  setV('f-type',DATA.types[0]||'Social'); setV('f-date',''); setV('f-time',''); setV('f-duration','60');
  setV('f-name',''); setV('f-location',''); setV('f-organizer',currentUser);
  setV('f-summary',''); setV('f-link',''); setV('f-photo','');
  setV('f-main-speaker',''); setV('f-opening-speaker',''); setV('f-introducer',''); setV('f-meet','');
  document.getElementById('f-cancelled').checked=false;
  document.getElementById('f-hide-newsletter').checked=false;
  updateTypeUI();
  showPhotoPrev();
  openPanel();
}
function openEdit(rowIndex){
  var e=null,i; for(i=0;i<DATA.events.length;i++){if(DATA.events[i].rowIndex===rowIndex){e=DATA.events[i];break;}}
  if(!e)return;
  editingRow=rowIndex;
  document.getElementById('panel-title').textContent='Edit Event';
  // Only the member who created the event may delete it; everyone else cancels.
  document.getElementById('btn-del').style.display=sameUser(e.createdBy,currentUser)?'':'none';
  setV('f-type',e.eventType); setV('f-date',e.date); setV('f-time',to24(e.time)); setV('f-duration',e.duration);
  setV('f-name',e.eventName); setV('f-location',e.location); setV('f-organizer',e.organizer);
  setV('f-summary',e.summary); setV('f-link',e.link); setV('f-photo',e.photo);
  setV('f-main-speaker',e.mainSpeaker||''); setV('f-opening-speaker',e.openingSpeaker||'');
  setV('f-introducer',e.introducer||''); setV('f-meet',e.googleMeet||'');
  updateTypeUI();
  document.getElementById('f-cancelled').checked=!!e.cancelled;
  document.getElementById('f-hide-newsletter').checked=!!e.hideFromNewsletter;
  document.getElementById('notes-section').style.display='';
  document.getElementById('f-notes-display').textContent=e.notes||'(no notes yet)';
  document.getElementById('f-note-input').value='';
  showPhotoPrev();
  openPanel();
}
function addNote(){
  if(!editingRow)return;
  var inp=document.getElementById('f-note-input'), text=inp.value.trim();
  if(!text)return;
  var pw=localStorage.getItem('pipelinePw')||'';
  gs4('addEventNote',pw,editingRow,text,currentUser).then(function(res){
    inp.value='';
    document.getElementById('f-notes-display').textContent=res.notes||'(no notes yet)';
    for(var i=0;i<DATA.events.length;i++){if(DATA.events[i].rowIndex===editingRow){DATA.events[i].notes=res.notes;break;}}
    toast('Note added ✓');
  }).catch(function(err){toast('Error: '+(err.message||err),true);});
}
function savePanel(){
  if(!getV('f-date')){toast('Please pick a date',true);return;}
  var payload={rowIndex:editingRow,eventType:getV('f-type'),date:getV('f-date'),time:to12(getV('f-time')),
    duration:getV('f-duration'),location:getV('f-location'),eventName:getV('f-name'),organizer:getV('f-organizer'),
    link:getV('f-link'),photo:getV('f-photo'),summary:getV('f-summary'),
    mainSpeaker:getV('f-main-speaker'),openingSpeaker:getV('f-opening-speaker'),
    introducer:getV('f-introducer'),googleMeet:getV('f-meet'),
    cancelled:document.getElementById('f-cancelled').checked,
    hideFromNewsletter:document.getElementById('f-hide-newsletter').checked,editor:currentUser};
  var pw=localStorage.getItem('pipelinePw')||'';
  // A note typed but not yet "Add"ed should be saved too — editing an existing
  // row keeps its row index (saveEvent edits in place), so we can append after.
  var noteText=(document.getElementById('f-note-input').value||'').trim();
  var noteRow=editingRow;
  busy(true);
  gs2('saveEvent',pw,payload).then(function(fresh){
    DATA.events=fresh.events;
    if(noteText&&noteRow){
      return gs4('addEventNote',pw,noteRow,noteText,currentUser).then(function(res){
        for(var i=0;i<DATA.events.length;i++){if(DATA.events[i].rowIndex===noteRow){DATA.events[i].notes=res.notes;break;}}
      });
    }
  }).then(function(){busy(false);closePanel();render();toast('Saved ✓');})
    .catch(function(err){busy(false);toast('Error: '+(err.message||err),true);});
}
function deleteCurrent(){
  if(!editingRow)return;
  if(!confirm('Delete this event permanently? This cannot be undone.'))return;
  var pw=localStorage.getItem('pipelinePw')||'';
  gs3('deleteEvent',pw,editingRow,currentUser).then(function(fresh){DATA.events=fresh.events;closePanel();render();toast('Deleted');})
    .catch(function(err){toast('Error: '+(err.message||err),true);});
}

// ── Data + Auth ───────────────────────────────────────────────
function loadData(){
  gs('getEventEditorData').then(function(d){DATA=d;syncAdvToggle();fillOptions();render();})
    .catch(function(err){toast('Load error: '+(err.message||err),true);});
}
function doLogin(){
  var name=document.getElementById('auth-name').value.trim(), pw=document.getElementById('auth-pw').value;
  if(!name){document.getElementById('auth-err').textContent='Enter your name.';return;}
  if(!pw){document.getElementById('auth-err').textContent='Enter the password.';return;}
  gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){localStorage.setItem('pipelinePw',pw);localStorage.setItem('pipelineName',name);currentUser=name;
      document.getElementById('auth').style.display='none';document.getElementById('hdr-user').textContent=name;loadData();}
    else{document.getElementById('auth-err').textContent='Wrong password.';}
  }).catch(function(err){document.getElementById('auth-err').textContent='Error: '+(err.message||err);});
}
function logout(){localStorage.removeItem('pipelinePw');localStorage.removeItem('pipelineName');location.reload();}

window.addEventListener('load',function(){
  var pw=localStorage.getItem('pipelinePw'), name=localStorage.getItem('pipelineName');
  if(pw&&name){gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){currentUser=name;document.getElementById('auth').style.display='none';document.getElementById('hdr-user').textContent=name;loadData();}
    else{localStorage.removeItem('pipelinePw');}});}
  document.getElementById('auth-pw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
});
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════
//  SPEAKER PIPELINE — KANBAN VIEW  (?app=kanban)
// ═══════════════════════════════════════════════════════════════
function getKanbanHtml() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLV Rotary — Speaker Pipeline (Kanban)</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f0f2f5;height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{background:#17458F;color:#fff;padding:0.6em 1em;display:flex;align-items:center;gap:1em;flex-shrink:0}
header h1{font-size:1em;font-weight:bold;flex:1}
.hbtn{font-size:0.8em;padding:3px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;cursor:pointer}
.hbtn:hover{background:rgba(255,255,255,0.28)}
/* Columns show/hide menu */
#cols-wrap{position:relative}
#cols-menu{position:absolute;right:0;top:calc(100% + 4px);background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.18);padding:0.3em 0;min-width:180px;display:none;z-index:120}
#cols-menu.open{display:block}
#cols-menu label{display:flex;align-items:center;gap:0.55em;padding:5px 12px;font-size:0.83em;color:#333;cursor:pointer;white-space:nowrap}
#cols-menu label:hover{background:#f0f4ff}
#cols-menu .cm-count{margin-left:auto;color:#999;font-size:0.9em}
#board{flex:1;overflow-x:auto;display:flex;gap:0.6em;padding:0.7em;align-items:flex-start}
.col{background:#e8eaf0;border-radius:8px;width:200px;flex-shrink:0;display:flex;flex-direction:column;max-height:100%}
.col-hd{padding:0.5em 0.7em;font-weight:bold;font-size:0.82em;color:#fff;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center}
.col-body{flex:1;overflow-y:auto;padding:0.4em;display:flex;flex-direction:column;gap:0.35em;min-height:60px}
.col-body.drag-over{background:#c8d8f8}
.card{background:#fff;border-radius:6px;padding:0.5em 0.65em;cursor:pointer;border-left:3px solid #17458F;font-size:0.82em;user-select:none;position:relative}
.card:hover{box-shadow:0 2px 6px rgba(0,0,0,0.12)}
.card.dragging{opacity:0.4}
.card.has-thumb{padding-right:54px}
.card-thumb{position:absolute;top:6px;right:6px;width:44px;height:44px;object-fit:cover;border-radius:4px;border:1px solid #ddd}
.card.conflict{border-left-color:#dc2626;background:#fff7f7}
.card-date{font-weight:bold;font-size:0.9em;color:#15803d;margin-bottom:3px}
.card-date.conflict{color:#dc2626}
.card-name{font-weight:bold;color:#17458F;margin-bottom:2px}
.card-sub{color:#444;font-size:0.85em;margin-bottom:2px}
.who-lbl{color:#888;font-weight:normal;font-size:0.88em}
.card-topic{color:#444;font-size:0.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-meta{color:#888;font-size:0.8em;margin-top:3px;display:flex;gap:0.4em;flex-wrap:wrap}
.badge{background:#e8eaf0;border-radius:3px;padding:1px 5px;font-size:0.78em}
.badge.offer{background:#d1fae5;color:#065f46}
.badge.request{background:#dbeafe;color:#1e3a8a}
.badge.manual{background:#f3f4f6;color:#555}
.priority-low{background:#f3f4f6;color:#4b5563}
.priority-medium{background:#bfdbfe;color:#1e40af}
.priority-high{background:#fed7aa;color:#9a3412}
/* Status column colors */
.hd-new{background:#6b7280}
.hd-in-progress{background:#2563eb}
.hd-limbo{background:#9333ea}
.hd-confirmed{background:#d97706}
.hd-scheduled{background:#16a34a}
.hd-done{background:#059669}
.hd-declined{background:#dc2626}
.hd-deleted{background:#4b5563}
.hd-upcoming{background:#0f766e}
/* Upcoming-meetings column cards (informational; from the Events calendar) */
.mtg-card{background:#fff;border-radius:6px;padding:0.45em 0.6em;border-left:3px solid #0f766e;font-size:0.82em}
.mtg-card.clickable{cursor:pointer}
.mtg-card.clickable:hover{box-shadow:0 2px 6px rgba(0,0,0,0.12)}
.mtg-card.empty{background:#f3f4f6;border-left-color:#cbd5e1;opacity:0.9;padding:0.35em 0.6em}
.mtg-card.tentative{background:#fffbeb;border-left-color:#f59e0b;opacity:1}
.mtg-date{font-weight:bold;color:#0f766e;font-size:0.9em}
.mtg-time{font-weight:normal;color:#888;font-size:0.92em}
.mtg-speaker{font-weight:bold;color:#17458F;margin-top:2px}
.mtg-topic{color:#555;font-size:0.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.mtg-empty{color:#9ca3af;font-style:italic;margin-top:1px}
.mtg-tent{color:#b45309;font-size:0.78em;margin-top:2px}
/* Panel */
#panel{position:fixed;right:-420px;top:0;width:420px;height:100%;background:#fff;box-shadow:-3px 0 16px rgba(0,0,0,0.12);transition:right 0.2s;display:flex;flex-direction:column;z-index:100}
#panel.open{right:0}
#panel-hd{background:#17458F;color:#fff;padding:0.7em 1em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#panel-hd h2{font-size:1em}
#panel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;line-height:1}
#panel-save-hd{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:3px 10px;border-radius:4px;font-size:0.82em;cursor:pointer}
#panel-save-hd:hover{background:rgba(255,255,255,0.3)}
.panel-hd-btns{display:flex;align-items:center;gap:0.5em}
#panel-body{flex:1;overflow-y:auto;padding:1em}
.pfield{margin-bottom:0.7em}
.pfield label{display:block;font-weight:bold;color:#17458F;font-size:0.82em;margin-bottom:2px}
.pfield input,.pfield textarea,.pfield select{width:100%;padding:5px 7px;border:1px solid #ccc;border-radius:4px;font-size:0.88em;font-family:Arial,sans-serif}
.pfield input[type=checkbox]{width:auto;padding:0;border:none;box-shadow:none}
.pfield textarea{resize:vertical;min-height:60px}
.notes-display{background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:0.5em 0.7em;font-size:0.8em;white-space:pre-wrap;max-height:120px;overflow-y:auto;color:#333;margin-bottom:0.4em}
.pbtn{background:#17458F;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:0.4em}
.pbtn:hover{background:#1a56db}
.pbtn.sec{background:#f4f4f4;color:#444;border:1px solid #ccc}
.pbtn.sec:hover{background:#e8e8e8}
.pbtn.danger{background:#dc2626}
.pmsg{font-size:0.8em;margin-top:0.4em;min-height:1em}
.pmsg.ok{color:#166534}.pmsg.err{color:#b91c1c}
.sec-title{font-weight:bold;color:#17458F;font-size:0.85em;border-bottom:1px solid #e0e0e0;padding-bottom:3px;margin:0.8em 0 0.5em}
/* Auth */
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:10px;padding:2em;width:300px;text-align:center}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
/* Tags on cards */
.card-tags{display:flex;flex-wrap:wrap;gap:2px;margin-top:3px}
.tag-chip{font-size:0.72em;padding:1px 6px;border-radius:8px;background:#e0e7ff;color:#3730a3;font-weight:500}
/* Vote button */
.vote-row{display:flex;justify-content:flex-end;align-items:center;gap:4px;margin-top:4px}
.vote-btn{background:none;border:1px solid #d1d5db;border-radius:10px;padding:1px 7px;font-size:0.78em;cursor:pointer;color:#6b7280;line-height:1.5}
.vote-btn.voted{background:#fee2e2;border-color:#fca5a5;color:#b91c1c}
/* Quick status changer on each card (tap-friendly on phones) */
.card-status{width:100%;margin-top:5px;font-size:0.76em;padding:3px 4px;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#374151;cursor:pointer}
/* Modal */
#modal-overlay,#fill-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:150;align-items:center;justify-content:center}
#modal-overlay.show,#fill-overlay.show{display:flex}
#fill-list{flex:1;overflow-y:auto;max-height:340px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:0.6em}
.ev-item.wanted{background:#fffbeb}
.ev-item.wanted:hover{background:#fef3c7}
.modal{background:#fff;border-radius:8px;padding:1.2em;width:440px;max-height:80vh;display:flex;flex-direction:column}
.modal h3{color:#17458F;margin-bottom:0.5em}
.modal-desc{font-size:0.82em;color:#555;margin-bottom:0.6em}
#event-list{flex:1;overflow-y:auto;max-height:340px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:0.6em}
.ev-item{padding:0.5em 0.75em;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.84em;display:flex;gap:0.5em;align-items:baseline}
.ev-item:last-child{border-bottom:none}
.ev-item.available:hover{background:#f0f7ff}
.ev-item.available.selected{background:#dbeafe;border-left:3px solid #2563eb}
.ev-item.taken{color:#9ca3af;cursor:default}
.ev-item.taken .ev-speaker{text-decoration:line-through;font-size:0.9em}
.ev-item.tentative{background:#fffbeb}
.ev-item.tentative:hover{background:#fef3c7}
.ev-date{font-weight:bold;white-space:nowrap;min-width:130px}
.ev-type{color:#6b7280;font-size:0.9em}
.ev-speaker{color:#b91c1c;font-size:0.85em;margin-left:auto}
.ev-open{color:#16a34a;font-size:0.85em;margin-left:auto}
.ev-tentative{color:#b45309;font-size:0.82em;margin-left:auto;text-align:right}
.modal-btns{display:flex;gap:0.5em}
/* AI command line (sits between header and board) */
#ai-wrap{flex-shrink:0;background:#fff;border-bottom:1px solid #e0e0e0;padding:0.5em 0.7em}
#ai-bar{display:flex;gap:0.5em}
#ai-input{flex:1;min-width:0;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:0.9em}
#ai-input:focus{outline:none;border-color:#17458F}
#ai-go{background:#17458F;color:#fff;border:none;border-radius:6px;padding:0 16px;font-size:0.9em;cursor:pointer;white-space:nowrap}
#ai-go:disabled{background:#aaa;cursor:default}
#ai-proposal{display:none;margin-top:0.5em;padding:0.6em 0.8em;background:#f8faff;border:1px solid #c5cae9;border-left:3px solid #17458F;border-radius:6px}
#ai-proposal.show{display:block}
#ai-prop-list{font-size:0.88em;color:#333;margin-bottom:0.5em;line-height:1.6}
#ai-prop-list div{padding:1px 0}
.ai-btns{display:flex;gap:0.5em}
.ai-btns button{border:none;border-radius:4px;padding:6px 14px;font-size:0.88em;cursor:pointer}
.ai-btns .apply{background:#17458F;color:#fff}
.ai-btns .cancel{background:#f4f4f4;color:#444;border:1px solid #ccc}
#ai-msg{font-size:0.85em;margin-top:0.4em;min-height:1em}
#ai-msg.ok{color:#166534}#ai-msg.err{color:#b91c1c}
/* Phone layout: stack the columns and make the detail panel full-width */
@media (max-width:600px){
  /* Bump the base size so all the em-based text scales up for phones.
     ≥16px inputs also stop iOS Safari from auto-zooming on focus. */
  body{font-size:18px}
  header{flex-wrap:wrap;gap:0.45em;padding:0.6em 0.8em}
  header h1{font-size:1.15em;flex:1 0 100%;margin-bottom:0.2em}
  #assignee-filter{flex:1 1 auto;font-size:0.95em;padding:7px 8px}
  .hbtn{font-size:0.9em;padding:7px 12px}
  #board{flex-direction:column;overflow-x:hidden;overflow-y:auto}
  .col{width:100%;max-height:none}
  /* Let columns grow to full height; #board is the single scroll container
     (avoids the nested column-scroll-inside-board-scroll that felt broken). */
  .col-body{min-height:0;flex:none;overflow:visible}
  .col-hd{font-size:1em;padding:0.7em 0.85em}
  /* Larger cards, full topic (no ellipsis truncation), bigger tap targets. */
  .card{font-size:0.95em;padding:0.75em 0.9em}
  .card-name{font-size:1.05em}
  .card-topic{font-size:1em;white-space:normal}
  .badge{font-size:0.85em;padding:2px 7px}
  .card-status{font-size:0.95em;padding:9px 8px;margin-top:8px}
  .vote-btn{font-size:0.95em;padding:5px 12px}
  .mtg-card{font-size:0.95em;padding:0.65em 0.8em}
  .mtg-date{font-size:1em}
  .mtg-empty,.mtg-tent{font-size:0.92em}
  /* Detail panel + modals: comfortable form fields and buttons. */
  .pfield label{font-size:0.92em}
  .pfield input,.pfield textarea,.pfield select{font-size:1em;padding:9px 10px}
  .pbtn{font-size:1em;padding:10px 16px;margin-bottom:0.3em}
  .ev-item{font-size:1em;padding:0.7em 0.85em}
  .modal h3{font-size:1.15em}
  .modal-desc{font-size:0.92em}
  #cols-menu{min-width:60vw}
  #cols-menu label{font-size:1em;padding:9px 14px}
  #ai-input{font-size:1em;padding:11px 12px}
  #ai-go{font-size:1em;padding:0 18px}
  #panel{width:100%;right:-100%}
  .modal{width:94vw}
}
</style>
</head>
<body>

<div id="auth">
  <div class="auth-box">
    <h2>📅 SLV Rotary<br>Speaker Pipeline</h2>
    <input type="text" id="auth-name" placeholder="Your name" autocomplete="name">
    <input type="password" id="auth-pw" placeholder="Password">
    <button onclick="doLogin()">Enter</button>
    <div class="auth-err" id="auth-err"></div>
  </div>
</div>

<header>
  <h1>🎤 Speaker Pipeline — Kanban</h1>
  <span id="hdr-user" style="font-size:0.85em;opacity:0.8"></span>
  <select id="assignee-filter" onchange="setAssignee(this.value)" style="font-size:0.8em;padding:3px 6px;border-radius:4px;border:none"><option value="">All assignees</option></select>
  <a class="hbtn" href="https://rotary.porttack.com/request/" target="_blank">+ Request Speaker</a>
  <span id="cols-wrap">
    <button class="hbtn" onclick="toggleColsMenu(event)">Columns ▾</button>
    <div id="cols-menu"></div>
  </span>
  <a href="__EXEC_URL__?app=pipeline" target="_top" class="hbtn">Table →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="ai-wrap" style="display:none">
  <div id="ai-bar">
    <input id="ai-input" placeholder="✨ Tell me what to change — e.g. “move Jane to scheduled” or “delete John Doe”">
    <button id="ai-go" onclick="aiSubmit()">Ask</button>
  </div>
</div>
<div id="board"></div>

<!-- Detail Panel -->
<div id="panel">
  <div id="panel-hd"><h2 id="panel-title">Speaker Detail</h2><div class="panel-hd-btns"><button id="panel-save-hd" onclick="savePanel()">Save</button><button id="panel-close" onclick="closePanel()">✕</button></div></div>
  <div id="panel-body"></div>
</div>

<!-- Event Picker Modal -->
<div id="modal-overlay">
  <div class="modal">
    <h3>Assign to Event</h3>
    <p class="modal-desc">Green = open · Amber = open but another card has it as a tentative date · Gray/strikethrough = already has a speaker. Click an open date to select, then Assign.</p>
    <div id="event-list"><p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p></div>
    <div class="modal-btns">
      <button class="pbtn" onclick="confirmAssign()">Assign</button>
      <button class="pbtn sec" onclick="closeModal()">Cancel</button>
    </div>
    <div class="pmsg" id="modal-msg"></div>
  </div>
</div>

<!-- Fill-Slot Modal (assign a pipeline speaker to an open meeting date) -->
<div id="fill-overlay">
  <div class="modal">
    <h3 id="fill-title">Assign a Speaker</h3>
    <p class="modal-desc">Pick a pipeline speaker to put in this open meeting slot. ⭐ marks speakers who listed this as a tentative date. This writes the speaker into the Events calendar.</p>
    <div id="fill-list"><p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p></div>
    <div class="modal-btns">
      <button class="pbtn" onclick="confirmFill()">Assign</button>
      <button class="pbtn sec" onclick="closeFill()">Cancel</button>
    </div>
    <div class="pmsg" id="fill-msg"></div>
  </div>
</div>

<script>
var currentUser = '', allCards = [], members = [], statuses = [], statusLabels = {};
var panelRow = null, upcomingMeetings = [], dateConflicts = {};
var assigneeFilter = '';
// Columns the user has hidden (persisted). Declined is hidden by default.
var HIDDEN_COLS_KEY = 'kanbanHiddenCols';
function loadHiddenCols() {
  try {
    var v = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) || 'null');
    if (Array.isArray(v)) return v;
  } catch(e) {}
  return ['declined', 'deleted'];
}
var hiddenCols = loadHiddenCols();
var AI_ENABLED = __AI_ENABLED__; // server-injected feature flag

function gs(fn, arg) {
  return new Promise(function(ok, fail) {
    var r = google.script.run.withSuccessHandler(ok).withFailureHandler(fail);
    r[fn](arg);
  });
}
function gs2(fn, a, b) {
  return new Promise(function(ok, fail) {
    google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a, b);
  });
}
function gs3(fn, a, b, c) {
  return new Promise(function(ok, fail) {
    google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a, b, c);
  });
}

// ── Auth ──────────────────────────────────────────────────────
function doLogin() {
  var name = document.getElementById('auth-name').value.trim();
  var pw   = document.getElementById('auth-pw').value;
  if (!name) { document.getElementById('auth-err').textContent = 'Enter your name.'; return; }
  if (!pw)   { document.getElementById('auth-err').textContent = 'Enter the password.'; return; }
  gs('checkPipelinePassword', pw).then(function(ok) {
    if (ok) {
      localStorage.setItem('pipelinePw', pw);
      localStorage.setItem('pipelineName', name);
      currentUser = name;
      document.getElementById('auth').style.display = 'none';
      document.getElementById('hdr-user').textContent = name;
      loadBoard();
    } else {
      document.getElementById('auth-err').textContent = 'Wrong password. (Set KANBAN_PASSWORD in Script Properties if not done yet.)';
    }
  }).catch(function(err) {
    document.getElementById('auth-err').textContent = 'Error: ' + (err.message || String(err));
  });
}

window.addEventListener('load', function() {
  var pw = localStorage.getItem('pipelinePw');
  var name = localStorage.getItem('pipelineName');
  if (pw && name) {
    gs('checkPipelinePassword', pw).then(function(ok) {
      if (ok) {
        currentUser = name;
        document.getElementById('auth').style.display = 'none';
        document.getElementById('hdr-user').textContent = name;
        loadBoard();
      } else { localStorage.removeItem('pipelinePw'); }
    });
  }
  document.getElementById('auth-pw').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  var ai = document.getElementById('ai-input');
  if (ai) ai.addEventListener('keydown', function(e) { if (e.key === 'Enter') aiSubmit(); });
  if (AI_ENABLED) { var w = document.getElementById('ai-wrap'); if (w) w.style.display = ''; }
});

// ── Board ─────────────────────────────────────────────────────
// localStorage stash so the board paints instantly on load (stale-while-
// revalidate): render the last-known board, then fetch fresh and reconcile.
// Same-browser only — never a cross-user sync mechanism, so we always refetch.
var KANBAN_CACHE_KEY = 'kanbanBoardCache';
function saveBoardCache() {
  try {
    localStorage.setItem(KANBAN_CACHE_KEY, JSON.stringify({
      cards: allCards, members: members, statuses: statuses,
      statusLabels: statusLabels, meetings: upcomingMeetings
    }));
  } catch(e) { /* quota / private mode — caching is best-effort */ }
}
function applyBoardData(data, meetings) {
  allCards = data.cards;
  members  = data.members;
  statuses = data.statuses;
  statusLabels = data.statusLabels;
  if (meetings) upcomingMeetings = meetings;
  populateAssigneeFilter();
  renderBoard();
}

async function loadBoard() {
  // 1. Paint immediately from cache if we have one.
  var paintedFromCache = false;
  try {
    var cached = JSON.parse(localStorage.getItem(KANBAN_CACHE_KEY) || 'null');
    if (cached && cached.cards) {
      applyBoardData(cached, cached.meetings);
      paintedFromCache = true;
    }
  } catch(e) { /* corrupt cache — ignore and load fresh */ }

  // 2. Fetch fresh in parallel and reconcile.
  try {
    var results = await Promise.all([
      gs('getPipelineData', null),
      gs('getUpcomingEventsForPicker', null)
    ]);
    applyBoardData(results[0], results[1]);
    saveBoardCache();
  } catch(e) {
    if (!paintedFromCache) {
      document.getElementById('board').innerHTML =
        '<p style="color:#b91c1c;padding:1.2em;font-family:Arial,sans-serif">⚠️ ' + e.message +
        '<br><br>Run <strong>Setup Speaker Pipeline Tab</strong> from the Rotary Sync menu in the spreadsheet, then reload.</p>';
    }
    // If we already painted from cache, keep showing it rather than blanking.
  }
}

// Map of tentative/scheduled date -> [speaker names] across non-declined cards,
// used to flag two speakers competing for the same meeting date.
function computeConflicts() {
  dateConflicts = {};
  allCards.forEach(function(c) {
    if (c.status === 'declined') return;
    var d = c.tentativeDate;
    if (!d) return;
    (dateConflicts[d] = dateConflicts[d] || []).push(c.speakerName || '(no name)');
  });
}

function fmtMonthDay(d) {
  var p = String(d).split('-');
  if (p.length < 3) return d;
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(p[1],10)-1] || '';
  return mo + ' ' + parseInt(p[2], 10);
}

// Build the assignee dropdown from whoever currently owns cards, plus an
// "Unassigned" bucket. Default (empty value) shows everyone.
function populateAssigneeFilter() {
  var sel = document.getElementById('assignee-filter');
  if (!sel) return;
  var seen = {};
  allCards.forEach(function(c) { if (c.assignedTo) seen[c.assignedTo] = true; });
  var names = Object.keys(seen).sort();
  var html = '<option value="">All assignees</option>';
  names.forEach(function(n) { html += '<option value="' + esc(n) + '">' + esc(n) + '</option>'; });
  html += '<option value="__UNASSIGNED__">— Unassigned —</option>';
  sel.innerHTML = html;
  sel.value = assigneeFilter;
}
function setAssignee(v) { assigneeFilter = v; renderBoard(); }
function matchAssignee(c) {
  if (!assigneeFilter) return true;
  if (assigneeFilter === '__UNASSIGNED__') return !c.assignedTo;
  return c.assignedTo === assigneeFilter;
}

// The Upcoming column is a synthetic, non-droppable column keyed '__upcoming__'.
var UPCOMING_COL = '__upcoming__';
var UPCOMING_LIMIT = 12;

// Build a compact, date-sorted card for one Events-calendar meeting slot.
function buildMeetingCard(m) {
  var div = document.createElement('div');
  var dateShort = String(m.dateLabel || '').split(',')[0] || fmtMonthDay(m.date);
  var dateLine = '<div class="mtg-date">' + esc(dateShort) +
    (m.time ? ' <span class="mtg-time">' + esc(m.time) + '</span>' : '') + '</div>';
  var baseTitle = dateShort + (m.time ? ' · ' + m.time : '') + (m.location ? ' · ' + m.location : '');
  // Pipeline cards eyeing this exact date (excludes already-scheduled cards).
  var tent = (dateConflicts[m.date] || []).slice();

  if (m.available) {
    // Open slot — clickable to assign a speaker from the pipeline.
    div.className = 'mtg-card empty clickable' + (tent.length ? ' tentative' : '');
    div.title = baseTitle + ' — no speaker yet (click to assign a speaker)';
    div.innerHTML = dateLine + '<div class="mtg-empty">— no speaker —</div>' +
      (tent.length ? '<div class="mtg-tent" title="' + esc(tent.join(', ')) + '">⭐ ' +
        tent.length + ' tentative: ' + esc(tent.join(', ')) + '</div>' : '');
    div.addEventListener('click', function() { openFillModal(m); });
  } else {
    // Filled slot — clickable to open the linked pipeline card, if any.
    var linked = allCards.filter(function(c) { return String(c.eventsRow) === String(m.rowIndex); })[0];
    div.className = 'mtg-card' + (linked ? ' clickable' : '');
    div.title = baseTitle + (m.mainTopic ? ' — ' + m.mainTopic : '') + (linked ? ' (click to open card)' : '');
    div.innerHTML = dateLine +
      '<div class="mtg-speaker">' + esc(m.mainSpeaker) + '</div>' +
      (m.mainTopic ? '<div class="mtg-topic">' + esc(m.mainTopic) + '</div>' : '');
    if (linked) div.addEventListener('click', function() { openPanel(linked.rowIndex); });
  }
  return div;
}

// Build the informational "Upcoming" column from the Events calendar data.
function buildUpcomingColumn() {
  var meetings = upcomingMeetings.slice()
    .sort(function(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); })
    .slice(0, UPCOMING_LIMIT);
  var filled = meetings.filter(function(m) { return !m.available; }).length;
  var col = document.createElement('div');
  col.className = 'col';
  col.innerHTML =
    '<div class="col-hd hd-upcoming">' +
      '<span>📅 Upcoming</span>' +
      '<span style="background:rgba(255,255,255,0.3);border-radius:10px;padding:1px 7px;font-size:0.9em" ' +
        'title="' + filled + ' of ' + meetings.length + ' have a speaker">' + filled + '/' + meetings.length + '</span>' +
    '</div>' +
    '<div class="col-body" id="col-upcoming"></div>';
  var body = col.querySelector('.col-body');
  if (!meetings.length) {
    body.innerHTML = '<p style="color:#888;font-size:0.8em;padding:0.4em">No upcoming meetings.</p>';
  } else {
    meetings.forEach(function(m) { body.appendChild(buildMeetingCard(m)); });
  }
  return col;
}

function renderBoard() {
  computeConflicts();
  buildColsMenu();
  var board = document.getElementById('board');
  board.innerHTML = '';
  if (hiddenCols.indexOf(UPCOMING_COL) === -1) board.appendChild(buildUpcomingColumn());
  var visibleStatuses = statuses.filter(function(s) { return hiddenCols.indexOf(s) === -1; });
  visibleStatuses.forEach(function(status) {
    var cards = allCards.filter(function(c) { return c.status === status && matchAssignee(c); });
    var col = document.createElement('div');
    col.className = 'col';
    col.dataset.status = status;
    col.innerHTML =
      '<div class="col-hd hd-' + status + '">' +
        '<span>' + (statusLabels[status] || status) + '</span>' +
        '<span style="background:rgba(255,255,255,0.3);border-radius:10px;padding:1px 7px;font-size:0.9em">' + cards.length + '</span>' +
      '</div>' +
      '<div class="col-body" id="col-' + status + '"></div>';
    var body = col.querySelector('.col-body');
    setupDrop(body, status);
    cards.forEach(function(card) { body.appendChild(buildCard(card)); });
    board.appendChild(col);
  });
}

function buildCard(card) {
  var div = document.createElement('div');
  div.className = 'card';
  div.draggable = true;
  div.dataset.row = card.rowIndex;
  var interestedNames = card.interested ? card.interested.split(',').map(function(n){return n.trim();}).filter(Boolean) : [];
  var iVoted = interestedNames.indexOf(currentUser) !== -1;
  var tagChips = card.tags ? card.tags.split(',').map(function(t){t=t.trim();return t?'<span class="tag-chip">'+esc(t)+'</span>':''}).join('') : '';
  var dateStr = card.tentativeDate || '';
  var others = dateStr ? (dateConflicts[dateStr] || []).filter(function(n){ return n !== (card.speakerName || '(no name)'); }) : [];
  var isConflict = others.length > 0;
  if (isConflict) div.className += ' conflict';
  // The date is only tentative until the card is actually scheduled (booked
  // into the Events calendar) or done.
  var isTentative = dateStr && card.status !== 'scheduled' && card.status !== 'done';
  var dateBlock = dateStr
    ? '<div class="card-date' + (isConflict ? ' conflict' : '') + '"' +
        (isConflict ? ' title="Same date as: ' + esc(others.join(', ')) + '"' : '') + '>📅 ' +
        esc(fmtMonthDay(dateStr)) + (isTentative ? ' (tentative)' : '') + (isConflict ? ' ⚠️ conflict' : '') + '</div>'
    : '';
  var thumb = '';
  if (card.photoTop) {
    div.className += ' has-thumb';
    thumb = '<img class="card-thumb" src="' + esc(driveThumb(card.photoTop, 120)) + '" onerror="this.style.display=&#39;none&#39;">';
  }
  div.innerHTML =
    thumb +
    dateBlock +
    '<div class="card-name"><span class="who-lbl">Speaker:</span> ' + esc(card.speakerName || '(no name)') + '</div>' +
    (card.requestorName ? '<div class="card-sub"><span class="who-lbl">Requestor:</span> ' + esc(card.requestorName) + '</div>' : '') +
    (card.assignedTo ? '<div class="card-sub"><span class="who-lbl">Manager:</span> ' + esc(card.assignedTo) + '</div>' : '') +
    '<div class="card-topic">' + esc(card.topic || '—') + '</div>' +
    '<div class="card-meta">' +
      '<span class="badge ' + card.source + '">' + card.source + '</span>' +
      (card.priority ? '<span class="badge priority-' + card.priority.toLowerCase() + '">' + esc(card.priority) + '</span>' : '') +
    '</div>' +
    (tagChips ? '<div class="card-tags">' + tagChips + '</div>' : '') +
    ((card.isRotarian || card.isLocal || card.fundraisingLiterature) ?
      '<div class="card-tags">' +
        (card.isRotarian ? '<span class="badge" style="background:#e0e7ff;color:#3730a3">Rotarian</span>' : '') +
        (card.isLocal ? '<span class="badge" style="background:#dcfce7;color:#166534">Local</span>' : '') +
        (card.fundraisingLiterature ? '<span class="badge" style="background:#fef9c3;color:#854d0e">&#9888; Fundraising lit.</span>' : '') +
      '</div>' : '') +
    '<select class="card-status">' +
      statuses.map(function(s) { return '<option value="' + s + '"' + (s === card.status ? ' selected' : '') + '>' + esc(statusLabels[s] || s) + '</option>'; }).join('') +
    '</select>' +
    '<div class="vote-row">' +
      '<button class="vote-btn' + (iVoted ? ' voted' : '') + '" data-row="' + card.rowIndex + '" title="Interest — members + public website hearts">' +
        (iVoted ? '❤️' : '🤍') + ' ' + (interestedNames.length + (card.hearts || 0)) +
      '</button>' +
    '</div>';
  div.addEventListener('click', function(e) {
    // The vote button and status dropdown handle their own clicks.
    if (e.target.closest('.vote-btn') || e.target.closest('.card-status')) return;
    openPanel(card.rowIndex);
  });
  var statusSel = div.querySelector('.card-status');
  statusSel.addEventListener('click', function(e) { e.stopPropagation(); });
  // Suspend HTML5 dragging while the dropdown is in use so desktop browsers
  // don't try to drag the card out from under an open <select>.
  statusSel.addEventListener('mousedown', function() { div.draggable = false; });
  statusSel.addEventListener('focus', function() { div.draggable = false; });
  statusSel.addEventListener('blur', function() { div.draggable = true; });
  statusSel.addEventListener('change', function(e) {
    e.stopPropagation();
    var newStatus = statusSel.value;
    if (newStatus === card.status) return;
    card.status = newStatus;
    renderBoard();
    saveBoardCache();
    gs3('savePipelineCard', card.rowIndex, { status: newStatus }, currentUser)
      .catch(function(err) { alert('Save failed: ' + err.message); loadBoard(); });
  });
  div.querySelector('.vote-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    gs3('togglePipelineVote', card.rowIndex, currentUser).then(function(res) {
      card.interested = res.interested;
      var btn = div.querySelector('.vote-btn');
      var names = res.interested ? res.interested.split(',').map(function(n){return n.trim();}).filter(Boolean) : [];
      var voted = names.indexOf(currentUser) !== -1;
      btn.className = 'vote-btn' + (voted ? ' voted' : '');
      btn.textContent = (voted ? '❤️' : '🤍') + ' ' + (names.length + (card.hearts || 0));
      saveBoardCache();
    });
  });
  div.addEventListener('dragstart', function(e) {
    div.classList.add('dragging');
    e.dataTransfer.setData('rowIndex', card.rowIndex);
  });
  div.addEventListener('dragend', function() { div.classList.remove('dragging'); });
  return div;
}

function setupDrop(el, status) {
  el.addEventListener('dragover', function(e) { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', function() { el.classList.remove('drag-over'); });
  el.addEventListener('drop', function(e) {
    e.preventDefault(); el.classList.remove('drag-over');
    var rowIndex = parseInt(e.dataTransfer.getData('rowIndex'));
    if (!rowIndex) return;
    var card = allCards.find(function(c) { return c.rowIndex === rowIndex; });
    if (!card || card.status === status) return;
    card.status = status;
    renderBoard();
    saveBoardCache();
    gs3('savePipelineCard', rowIndex, { status: status }, currentUser)
      .catch(function(err) { alert('Save failed: ' + err.message); loadBoard(); });
  });
}

// ── Detail Panel ─────────────────────────────────────────────
function openPanel(rowIndex) {
  var card = allCards.find(function(c) { return c.rowIndex === rowIndex; });
  if (!card) return;
  panelRow = rowIndex;
  var b = document.getElementById('panel-body');
  document.getElementById('panel-title').textContent = card.speakerName || 'Speaker Detail';

  var memberOpts = [''].concat(members).map(function(m) {
    return '<option value="' + esc(m) + '"' + (m === card.assignedTo ? ' selected' : '') + '>' + esc(m || '— unassigned —') + '</option>';
  }).join('');
  var statusOpts = statuses.map(function(s) {
    return '<option value="' + s + '"' + (s === card.status ? ' selected' : '') + '>' + (statusLabels[s] || s) + '</option>';
  }).join('');

  b.innerHTML =
    '<div class="pfield"><label>Speaker Name</label>' +
      '<input id="pn-name" value="' + esc(card.speakerName) + '"></div>' +
    '<div class="pfield"><label>Topic</label>' +
      '<input id="pn-topic" value="' + esc(card.topic) + '"></div>' +
    '<div class="pfield"><label>Status</label>' +
      '<select id="pn-status">' + statusOpts + '</select></div>' +
    '<div class="pfield"><label>Priority</label>' +
      '<select id="pn-priority">' +
        '<option value="">— none —</option>' +
        '<option value="Low">Low — Idea</option>' +
        '<option value="Medium">Medium — Recommended</option>' +
        '<option value="High">High — Strongly Recommended</option>' +
      '</select></div>' +
    '<div class="pfield"><label>Manager (Assigned To)</label>' +
      '<select id="pn-assigned">' + memberOpts + '</select></div>' +
    '<div class="pfield"><label>Tentative Date <span style="font-weight:normal;color:#888;font-size:0.9em">(open meeting dates)</span></label>' +
      '<select id="pn-date">' + buildDateOptions(card.tentativeDate) + '</select></div>' +
    '<div class="pfield"><label>Speaker Role</label>' +
      '<select id="pn-role"><option>Opening Speaker</option><option>Main Speaker</option><option>Either</option><option>Unsure</option></select></div>' +
    '<div class="pfield"><label>Email</label><input id="pn-email" value="' + esc(card.speakerEmail) + '"></div>' +
    '<div class="pfield"><label>Phone</label><input id="pn-phone" value="' + esc(card.speakerPhone) + '"></div>' +
    '<div class="pfield"><label>City</label><input id="pn-city" value="' + esc(card.speakerCity) + '"></div>' +
    '<div class="pfield"><label>Preferred Dates</label>' +
      '<input id="pn-pref" value="' + esc(card.preferredDates) + '"></div>' +
    '<div class="pfield"><label>Bio</label>' +
      '<textarea id="pn-bio" rows="3">' + esc(card.bio) + '</textarea></div>' +
    '<div class="pfield"><label>Summary <span style="font-weight:normal;color:#888;font-size:0.9em">(newsletter narrative)</span></label>' +
      '<textarea id="pn-summary" rows="3">' + esc(card.summary) + '</textarea></div>' +
    '<div class="pfield"><label>Speaker URL</label>' +
      '<input id="pn-url" value="' + esc(card.speakerUrl) + '" placeholder="https://…"></div>' +
    '<div class="pfield"><label>Introducer</label>' +
      '<input id="pn-introducer" value="' + esc(card.introducer) + '" placeholder="Who introduces the speaker"></div>' +
    '<div class="pfield"><label>Top Photo</label>' +
      '<input id="pn-phototop" value="' + esc(card.photoTop) + '" placeholder="paste an image URL, or upload below">' +
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-phototop&#39;)">' +
      '<div id="pn-phototop-prev" class="photo-prev"></div></div>' +
    '<div class="pfield"><label>Bottom Photo</label>' +
      '<input id="pn-photobottom" value="' + esc(card.photoBottom) + '" placeholder="paste an image URL, or upload below">' +
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-photobottom&#39;)">' +
      '<div id="pn-photobottom-prev" class="photo-prev"></div></div>' +
    '<div class="pfield"><label>Tags <span style="font-weight:normal;color:#888;font-size:0.9em">(comma-separated)</span></label>' +
      '<input id="pn-tags" value="' + esc(card.tags) + '" placeholder="e.g. environment, local, tech"></div>' +
    '<div class="pfield"><label>Comments <span style="font-weight:normal;color:#888;font-size:0.9em">(internal — from the submitter)</span></label>' +
      '<textarea id="pn-comments" rows="2">' + esc(card.comments) + '</textarea></div>' +
    '<div class="pfield"><label>Format &amp; Speaker Details</label>' +
      '<div style="margin-top:0.4em">' +
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-zoom-only"> Zoom only (not in person)</label>' +
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-rotarian"> Rotarian</label>' +
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-local"> Local to Santa Cruz County</label>' +
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-fundraising"> May bring fundraising or donation materials</label>' +
      '</div></div>' +
    (card.requestorName ? '<div class="pfield"><label>Submitted by</label><span style="font-size:0.88em">' + esc(card.requestorName) + ' &lt;' + esc(card.requestorEmail) + '&gt;</span></div>' : '') +
    (card.interested ? '<div class="pfield"><label>Interested members</label><span style="font-size:0.88em">' + esc(card.interested) + '</span></div>' : '') +
    '<button class="pbtn" onclick="savePanel()">Save</button>' +
    (['in-progress', 'limbo', 'scheduled'].indexOf(card.status) !== -1 ?
      '<button class="pbtn" style="background:#16a34a" onclick="openAssignModal()">Assign to Event</button>' : '') +
    (card.status === 'deleted'
      ? '<button class="pbtn sec" onclick="restoreCard()">↩︎ Restore</button>' +
        '<button class="pbtn danger" onclick="deleteCard()">🗑 Delete permanently</button>'
      : '<button class="pbtn danger" onclick="deleteCard()">🗑 Delete</button>') +
    '<div class="pmsg" id="panel-msg"></div>' +
    '<div class="sec-title">Notes</div>' +
    '<div class="notes-display" id="pn-notes-display">' + esc(card.notes) + '</div>' +
    '<div class="pfield"><label>Add Note</label>' +
      '<textarea id="pn-note-input" rows="2" placeholder="Type a note…"></textarea></div>' +
    '<button class="pbtn sec" onclick="addNote()">Add Note</button>';

  document.getElementById('pn-role').value = card.speakerRole || 'Main Speaker';
  document.getElementById('pn-priority').value = card.priority || '';
  document.getElementById('pn-zoom-only').checked = !!card.zoomOnly;
  document.getElementById('pn-is-rotarian').checked = !!card.isRotarian;
  document.getElementById('pn-is-local').checked = !!card.isLocal;
  document.getElementById('pn-fundraising').checked = !!card.fundraisingLiterature;
  showPhotoPreview('pn-phototop');
  showPhotoPreview('pn-photobottom');
  document.getElementById('panel').classList.add('open');
}

// Drive "uc?export=view" links don't render in <img>; convert to the
// thumbnail endpoint, which does. Non-Drive URLs pass through unchanged.
function driveThumb(u, size) {
  if (!u) return '';
  var id = '';
  var i = u.indexOf('id=');
  if (i >= 0) { id = u.substring(i + 3).split('&')[0]; }
  else { var j = u.indexOf('/d/'); if (j >= 0) id = u.substring(j + 3).split('/')[0]; }
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + (size || 200) : u;
}

function showPhotoPreview(inputId) {
  var v = (document.getElementById(inputId) || {}).value || '';
  var prev = document.getElementById(inputId + '-prev');
  if (!prev) return;
  prev.innerHTML = (v && v.indexOf('http') === 0)
    ? '<img src="' + esc(driveThumb(v, 250)) + '" style="max-width:140px;max-height:140px;border-radius:4px;border:1px solid #ddd" onerror="this.style.display=&#39;none&#39;">'
    : '';
}

async function uploadPhoto(input, targetId) {
  var file = input.files[0];
  if (!file) return;
  var target = document.getElementById(targetId);
  var prev = document.getElementById(targetId + '-prev');
  if (file.size > 8 * 1024 * 1024) {
    if (prev) prev.innerHTML = '<span style="font-size:0.8em;color:#b91c1c">Image too large (max 8 MB)</span>';
    input.value = '';
    return;
  }
  if (prev) prev.innerHTML = '<span style="font-size:0.8em;color:#888">Uploading…</span>';
  try {
    var dataUrl = await new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload = function(ev) { resolve(ev.target.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    var speakerName = (document.getElementById('pn-name') || {}).value || 'speaker';
    var res = await gs3('uploadPipelinePhoto', dataUrl, file.name, speakerName);
    target.value = res.url;
    showPhotoPreview(targetId);
  } catch(e) {
    if (prev) prev.innerHTML = '<span style="font-size:0.8em;color:#b91c1c">Upload failed: ' + (e.message || e) + '</span>';
  }
}

function closePanel() { document.getElementById('panel').classList.remove('open'); panelRow = null; }

// Soft-delete (move to the hidden Deleted column) or, if already there,
// permanently remove the sheet row.
async function deleteCard() {
  if (!panelRow) return;
  var card = allCards.find(function(c) { return c.rowIndex === panelRow; });
  if (!card) return;
  var msg = document.getElementById('panel-msg');
  if (card.status === 'deleted') {
    if (!confirm('Permanently delete this card? This removes the row and cannot be undone.')) return;
    try {
      await gs('deletePipelineCard', panelRow);
      closePanel();
      loadBoard(); // row indexes shift after a delete — reload fresh
    } catch(e) { msg.className = 'pmsg err'; msg.textContent = 'Error: ' + e.message; }
    return;
  }
  if (!confirm('Move this card to Deleted? You can restore it from the Deleted column.')) return;
  card.status = 'deleted';
  renderBoard();
  saveBoardCache();
  gs3('savePipelineCard', panelRow, { status: 'deleted' }, currentUser)
    .catch(function(err) { alert('Delete failed: ' + err.message); loadBoard(); });
  closePanel();
}

// Restore a deleted card back to New.
function restoreCard() {
  if (!panelRow) return;
  var card = allCards.find(function(c) { return c.rowIndex === panelRow; });
  if (!card) return;
  card.status = 'new';
  renderBoard();
  saveBoardCache();
  gs3('savePipelineCard', panelRow, { status: 'new' }, currentUser)
    .catch(function(err) { alert('Restore failed: ' + err.message); loadBoard(); });
  closePanel();
}

async function savePanel() {
  if (!panelRow) return;
  var msg = document.getElementById('panel-msg');
  var changes = {
    speakerName: document.getElementById('pn-name').value.trim(),
    topic:       document.getElementById('pn-topic').value.trim(),
    status:      document.getElementById('pn-status').value,
    assignedTo:  document.getElementById('pn-assigned').value,
    tentativeDate: document.getElementById('pn-date').value,
    speakerRole: document.getElementById('pn-role').value,
    priority:    document.getElementById('pn-priority').value,
    speakerEmail: document.getElementById('pn-email').value.trim(),
    speakerPhone: document.getElementById('pn-phone').value.trim(),
    speakerCity:  document.getElementById('pn-city').value.trim(),
    preferredDates: document.getElementById('pn-pref').value.trim(),
    bio:          document.getElementById('pn-bio').value.trim(),
    summary:      document.getElementById('pn-summary').value.trim(),
    speakerUrl:   document.getElementById('pn-url').value.trim(),
    introducer:   document.getElementById('pn-introducer').value.trim(),
    photoTop:     document.getElementById('pn-phototop').value.trim(),
    photoBottom:  document.getElementById('pn-photobottom').value.trim(),
    tags:         document.getElementById('pn-tags').value.trim(),
    comments:     document.getElementById('pn-comments').value.trim(),
    zoomOnly:     document.getElementById('pn-zoom-only').checked ? 'Yes' : '',
    isRotarian:   document.getElementById('pn-is-rotarian').checked ? 'Yes' : '',
    isLocal:      document.getElementById('pn-is-local').checked ? 'Yes' : '',
    fundraisingLiterature: document.getElementById('pn-fundraising').checked ? 'Yes' : '',
  };
  try {
    var res = await gs3('savePipelineCard', panelRow, changes, currentUser);
    var card = allCards.find(function(c) { return c.rowIndex === panelRow; });
    if (card) {
      Object.assign(card, changes);
      card.zoomOnly = changes.zoomOnly === 'Yes';
      card.isRotarian = changes.isRotarian === 'Yes';
      card.isLocal = changes.isLocal === 'Yes';
      card.fundraisingLiterature = changes.fundraisingLiterature === 'Yes';
    }
    if (res && res.notes != null) {
      if (card) card.notes = res.notes;
      var nd = document.getElementById('pn-notes-display');
      if (nd) nd.textContent = res.notes;
    }
    renderBoard();
    var okText = (res && res.noted) ? 'Saved ✓ (' + res.noted + ' change' + (res.noted === 1 ? '' : 's') + ' logged)' : 'Saved ✓';
    msg.className = 'pmsg ok'; msg.textContent = okText;
    setTimeout(function() { msg.textContent = ''; }, 2500);
  } catch(e) {
    msg.className = 'pmsg err'; msg.textContent = 'Error: ' + e.message;
  }
}

async function addNote() {
  if (!panelRow) return;
  var inp = document.getElementById('pn-note-input');
  var text = inp.value.trim();
  if (!text) return;
  try {
    await gs3('appendPipelineNote', panelRow, text, currentUser);
    inp.value = '';
    var card = allCards.find(function(c) { return c.rowIndex === panelRow; });
    var data = await gs('getPipelineData', null);
    var updated = data.cards.find(function(c) { return c.rowIndex === panelRow; });
    if (updated && card) { card.notes = updated.notes; }
    document.getElementById('pn-notes-display').textContent = updated ? updated.notes : '';
    allCards = data.cards;
    renderBoard();
  } catch(e) { alert('Note failed: ' + e.message); }
}

// ── Assign to Event Modal ─────────────────────────────────────
var selectedEventsRow = null;

async function openAssignModal() {
  selectedEventsRow = null;
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('modal-msg').textContent = '';
  var list = document.getElementById('event-list');
  list.innerHTML = '<p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p>';
  var events = await gs('getUpcomingEventsForPicker', null);
  if (!events.length) {
    list.innerHTML = '<p style="padding:0.6em;color:#888;font-size:0.85em">No upcoming meetings found.</p>';
    return;
  }
  // Map meeting date -> names of OTHER pipeline cards that have it as a
  // tentative date, so we can flag open slots someone else is already eyeing.
  var tentMap = {};
  allCards.forEach(function(c) {
    if (c.status === 'declined' || c.status === 'scheduled') return;
    if (c.rowIndex === panelRow) return; // ignore the card being assigned
    if (!c.tentativeDate) return;
    (tentMap[c.tentativeDate] = tentMap[c.tentativeDate] || []).push(c.speakerName || '(no name)');
  });
  list.innerHTML = '';
  events.forEach(function(ev) {
    var tentNames = tentMap[ev.date] || [];
    var div = document.createElement('div');
    var cls = ev.available ? (tentNames.length ? 'available tentative' : 'available') : 'taken';
    div.className = 'ev-item ' + cls;
    div.dataset.row = ev.rowIndex;
    var speakerHtml;
    if (!ev.available) {
      speakerHtml = '<span class="ev-speaker">' + esc(ev.mainSpeaker) + (ev.mainTopic ? ': ' + esc(ev.mainTopic) : '') + '</span>';
    } else if (tentNames.length) {
      speakerHtml = '<span class="ev-tentative">⚠️ tentative: ' + esc(tentNames.join(', ')) + '</span>';
    } else {
      speakerHtml = '<span class="ev-open">open</span>';
    }
    div.innerHTML =
      '<span class="ev-date">' + esc(ev.dateLabel) + '</span>' +
      '<span class="ev-type">' + esc(ev.eventType) + (ev.time ? ' ' + ev.time : '') + '</span>' +
      speakerHtml;
    if (ev.available) {
      div.addEventListener('click', function() {
        list.querySelectorAll('.ev-item').forEach(function(el) { el.classList.remove('selected'); });
        div.classList.add('selected');
        selectedEventsRow = ev.rowIndex;
      });
    }
    list.appendChild(div);
  });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  selectedEventsRow = null;
}

async function confirmAssign() {
  if (!selectedEventsRow || !panelRow) {
    document.getElementById('modal-msg').textContent = 'Please select an available date first.';
    return;
  }
  var msg = document.getElementById('modal-msg');
  try {
    var res = await gs3('assignSpeakerToEvent', panelRow, selectedEventsRow, currentUser);
    msg.className = 'pmsg ok'; msg.textContent = '✓ Assigned ' + res.speakerName;
    var data = await gs('getPipelineData', null);
    allCards = data.cards; renderBoard();
    setTimeout(function() { closeModal(); closePanel(); }, 1500);
  } catch(e) { msg.className = 'pmsg err'; msg.textContent = 'Error: ' + e.message; }
}

// ── Fill-Slot Modal (from the Upcoming column) ────────────────
// Reverse of the Assign modal: here the meeting date is fixed and we pick a
// pipeline speaker to drop into it.
var fillMeeting = null, fillSelectedRow = null;
var FILL_STATUS_ORDER = { 'in-progress': 0, limbo: 1, new: 2 };

function openFillModal(m) {
  fillMeeting = m; fillSelectedRow = null;
  document.getElementById('fill-overlay').classList.add('show');
  document.getElementById('fill-msg').textContent = '';
  var dateShort = String(m.dateLabel || '').split(',')[0] || fmtMonthDay(m.date);
  document.getElementById('fill-title').textContent = 'Assign a Speaker — ' + dateShort;
  var list = document.getElementById('fill-list');

  // Candidates: any pipeline card with a name that isn't already booked/closed.
  var cands = allCards.filter(function(c) {
    return ['scheduled', 'done', 'declined'].indexOf(c.status) === -1 && (c.speakerName || '').trim();
  });
  cands.sort(function(a, b) {
    var aw = a.tentativeDate === m.date ? 0 : 1, bw = b.tentativeDate === m.date ? 0 : 1;
    if (aw !== bw) return aw - bw;                       // wanted-this-date first
    var ao = FILL_STATUS_ORDER[a.status]; ao = (ao == null ? 9 : ao);
    var bo = FILL_STATUS_ORDER[b.status]; bo = (bo == null ? 9 : bo);
    if (ao !== bo) return ao - bo;                       // then by pipeline stage
    return (a.speakerName || '').localeCompare(b.speakerName || '');
  });

  if (!cands.length) {
    list.innerHTML = '<p style="padding:0.6em;color:#888;font-size:0.85em">No assignable speakers in the pipeline. Add or confirm a speaker first.</p>';
    return;
  }
  list.innerHTML = '';
  cands.forEach(function(c) {
    var wants = (c.tentativeDate === m.date);
    var div = document.createElement('div');
    div.className = 'ev-item available' + (wants ? ' wanted' : '');
    div.innerHTML =
      '<span class="ev-date" style="min-width:120px">' + esc(c.speakerName) + '</span>' +
      '<span class="ev-type">' + esc(statusLabels[c.status] || c.status) + (c.topic ? ' · ' + esc(c.topic) : '') + '</span>' +
      (wants ? '<span class="ev-tentative">⭐ wanted this date</span>' : '');
    div.addEventListener('click', function() {
      list.querySelectorAll('.ev-item').forEach(function(el) { el.classList.remove('selected'); });
      div.classList.add('selected');
      fillSelectedRow = c.rowIndex;
    });
    list.appendChild(div);
  });
}

function closeFill() {
  document.getElementById('fill-overlay').classList.remove('show');
  fillMeeting = null; fillSelectedRow = null;
}

async function confirmFill() {
  var msg = document.getElementById('fill-msg');
  if (!fillSelectedRow || !fillMeeting) { msg.className = 'pmsg err'; msg.textContent = 'Pick a speaker first.'; return; }
  try {
    var res = await gs3('assignSpeakerToEvent', fillSelectedRow, fillMeeting.rowIndex, currentUser);
    msg.className = 'pmsg ok'; msg.textContent = '✓ Assigned ' + res.speakerName;
    var results = await Promise.all([ gs('getPipelineData', null), gs('getUpcomingEventsForPicker', null) ]);
    applyBoardData(results[0], results[1]);
    saveBoardCache();
    setTimeout(closeFill, 1200);
  } catch(e) { msg.className = 'pmsg err'; msg.textContent = 'Error: ' + e.message; }
}

// ── Column show/hide menu ─────────────────────────────────────
function saveHiddenCols() {
  try { localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(hiddenCols)); } catch(e) {}
}
function buildColsMenu() {
  var menu = document.getElementById('cols-menu');
  if (!menu) return;
  var counts = {};
  allCards.forEach(function(c) { counts[c.status] = (counts[c.status] || 0) + 1; });
  var defs = [{ key: UPCOMING_COL, label: '📅 Upcoming', count: upcomingMeetings.length }];
  statuses.forEach(function(s) { defs.push({ key: s, label: statusLabels[s] || s, count: counts[s] || 0 }); });
  menu.innerHTML = defs.map(function(d) {
    var checked = hiddenCols.indexOf(d.key) === -1 ? ' checked' : '';
    return '<label><input type="checkbox"' + checked +
      ' onchange="toggleCol(&#39;' + d.key + '&#39;)">' +
      '<span>' + esc(d.label) + '</span>' +
      '<span class="cm-count">' + d.count + '</span></label>';
  }).join('');
}
function toggleColsMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('cols-menu').classList.toggle('open');
}
function toggleCol(status) {
  var i = hiddenCols.indexOf(status);
  if (i === -1) hiddenCols.push(status); else hiddenCols.splice(i, 1);
  saveHiddenCols();
  renderBoard();
}
// Close the menu when clicking anywhere outside it.
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('cols-wrap');
  var menu = document.getElementById('cols-menu');
  if (menu && wrap && !wrap.contains(e.target)) menu.classList.remove('open');
});

function logout() {
  localStorage.removeItem('pipelinePw');
  localStorage.removeItem('pipelineName');
  location.reload();
}

// ── AI command line (Gemini; proposes via a confirm dialog) ───
function aiSubmit() {
  var inp = document.getElementById('ai-input');
  var t = (inp.value || '').trim();
  if (!t) return;
  var go = document.getElementById('ai-go');
  go.disabled = true; go.textContent = '…';
  gs3('pipelineAssistantCommand', t, currentUser).then(function(res) {
    go.disabled = false; go.textContent = 'Ask';
    if (res && res.error) { alert('⚠️ ' + res.error); return; }
    var actions = (res && res.actions) || [];
    if (!actions.length) { alert((res && res.message) || 'I could not find a matching change. Try the speaker’s exact name.'); return; }
    var summary = actions.map(function(a) { return '• ' + a.description; }).join('\\n');
    if (!confirm('Apply these changes?\\n\\n' + summary)) return;
    go.disabled = true; go.textContent = '…';
    gs3('applyPipelineActions', actions, currentUser).then(function() {
      go.disabled = false; go.textContent = 'Ask'; inp.value = '';
      loadBoard();
    }).catch(function(e) { go.disabled = false; go.textContent = 'Ask'; alert('Apply failed: ' + (e.message || e)); });
  }).catch(function(e) { go.disabled = false; go.textContent = 'Ask'; alert('Error: ' + (e.message || e)); });
}

// Build <option>s for a tentative-date dropdown from upcoming meeting slots.
// Open slots are selectable; booked slots are disabled and show the speaker.
function buildDateOptions(cur) {
  var opts = '<option value="">— no date —</option>';
  var found = false;
  upcomingMeetings.forEach(function(m) {
    var isCur = (m.date === cur);
    if (isCur) found = true;
    var disabled = (!m.available && !isCur) ? ' disabled' : '';
    var label = m.available
      ? esc(m.dateLabel) + (m.time ? ' ' + m.time : '')
      : esc(m.dateLabel) + ' — taken' + (m.mainSpeaker ? ' (' + esc(m.mainSpeaker) + ')' : '');
    opts += '<option value="' + esc(m.date) + '"' + (isCur ? ' selected' : '') + disabled + '>' + label + '</option>';
  });
  if (cur && !found) opts += '<option value="' + esc(cur) + '" selected>' + esc(cur) + ' (custom)</option>';
  return opts;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════
//  SPEAKER PIPELINE — TABLE VIEW  (?app=pipeline)
// ═══════════════════════════════════════════════════════════════
function getPipelineTableHtml() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLV Rotary — Speaker Pipeline (Table)</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f0f2f5;min-height:100vh}
header{background:#17458F;color:#fff;padding:0.6em 1em;display:flex;align-items:center;gap:1em}
header h1{font-size:1em;font-weight:bold;flex:1}
.hbtn{font-size:0.8em;padding:3px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;cursor:pointer;text-decoration:none}
#toolbar{background:#fff;border-bottom:1px solid #ddd;padding:0.5em 1em;display:flex;gap:0.8em;flex-wrap:wrap;align-items:center}
#search{padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:0.88em;width:180px}
.filter-btn{padding:3px 10px;border:1px solid #ccc;border-radius:12px;font-size:0.8em;cursor:pointer;background:#fff}
.filter-btn.active{background:#17458F;color:#fff;border-color:#17458F}
#content{padding:0.7em 1em}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07)}
th{background:#17458F;color:#fff;padding:7px 10px;text-align:left;font-size:0.82em;cursor:pointer;white-space:nowrap}
th:hover{background:#1a56db}
td{padding:7px 10px;font-size:0.85em;border-bottom:1px solid #f0f0f0;vertical-align:top}
tr:hover td{background:#f8f9ff}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.78em;font-weight:bold}
.tag-new{background:#e5e7eb;color:#374151}
.tag-in-progress{background:#dbeafe;color:#1e40af}
.tag-limbo{background:#ede9fe;color:#5b21b6}
.tag-confirmed{background:#fef3c7;color:#92400e}
.tag-scheduled{background:#dcfce7;color:#14532d}
.tag-done{background:#d1fae5;color:#065f46}
.tag-declined{background:#fee2e2;color:#991b1b}
.tag-offer{background:#d1fae5;color:#065f46}
.tag-request{background:#dbeafe;color:#1e3a8a}
.tag-manual{background:#f3f4f6;color:#555}
.tag-chip{font-size:0.75em;padding:1px 6px;border-radius:8px;background:#e0e7ff;color:#3730a3;font-weight:500;margin-right:2px}
.cell-topic{color:#555;font-size:0.95em;margin-top:2px}
.prio{display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.74em;font-weight:bold}
.prio-high{background:#fed7aa;color:#9a3412}
.prio-medium{background:#bfdbfe;color:#1e40af}
.prio-low{background:#f3f4f6;color:#4b5563}
.vote-cell{color:#888;font-size:0.85em}
.expand-row td{background:#f8faff!important;padding:0}
.expand-inner{padding:0.8em 1em;display:grid;grid-template-columns:1fr 1fr;gap:0.5em 1.5em}
@media (max-width:600px){
  /* Bump base size so the em-based text scales up; ≥16px inputs avoid iOS zoom. */
  body{font-size:18px}
  header{flex-wrap:wrap;gap:0.45em}
  header h1{flex:1 0 100%;font-size:1.15em}
  .hbtn{font-size:0.9em;padding:7px 12px}
  #toolbar{gap:0.5em}
  #search{width:100%;font-size:1em;padding:8px 9px}
  .filter-btn{font-size:0.9em;padding:6px 12px}
  #content{overflow-x:auto}
  table{font-size:0.9em;min-width:560px}
  /* Editable expand form: single column with comfortable fields. */
  .expand-inner{grid-template-columns:1fr}
  .ef label{font-size:0.9em}
  .ef input,.ef textarea,.ef select{font-size:1em;padding:8px 9px}
  .btn{font-size:0.95em;padding:9px 16px}
}
.ef label{display:block;font-size:0.78em;font-weight:bold;color:#17458F;margin-bottom:2px}
.ef input,.ef textarea,.ef select{width:100%;padding:4px 7px;border:1px solid #ccc;border-radius:3px;font-size:0.85em;font-family:Arial,sans-serif}
.ef textarea{resize:vertical;min-height:50px}
.ef.full{grid-column:1/-1}
.notes-log{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:3px;padding:0.4em 0.6em;font-size:0.8em;white-space:pre-wrap;max-height:100px;overflow-y:auto;margin-bottom:0.4em}
.row-btns{grid-column:1/-1;display:flex;gap:0.5em;margin-top:0.3em}
.btn{padding:5px 14px;border:none;border-radius:4px;cursor:pointer;font-size:0.83em}
.btn-save{background:#17458F;color:#fff}
.btn-sec{background:#f4f4f4;color:#444;border:1px solid #ccc}
.btn-assign{background:#16a34a;color:#fff}
.row-msg{font-size:0.8em;min-height:1em}
.row-msg.ok{color:#166534}.row-msg.err{color:#b91c1c}
/* Layout: desktop calendar sidebar + main table */
#layout{display:flex;gap:1em;align-items:flex-start}
#main{flex:1;min-width:0}
#cal-side{width:230px;flex-shrink:0;position:sticky;top:0.7em;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.07);padding:0.7em 0.8em}
#cal-side h2{font-size:0.92em;color:#17458F;margin-bottom:0.5em;display:flex;align-items:center;gap:0.4em}
#cal-side .cal-tot{margin-left:auto;background:#0f766e;color:#fff;font-size:0.78em;border-radius:10px;padding:1px 7px}
.cal-item{display:flex;flex-direction:column;padding:0.35em 0;border-bottom:1px solid #f0f0f0;font-size:0.84em}
.cal-item:last-child{border-bottom:none}
.cal-date{font-weight:bold;color:#0f766e}
.cal-spk{color:#17458F}
.cal-open{color:#9ca3af;font-style:italic}
.cal-tent{color:#b45309}
.cal-empty{color:#999;font-size:0.84em;font-style:italic}
/* AI command line */
#ai-bar{padding:0.6em 1em 0;display:flex;gap:0.5em}
#ai-input{flex:1;min-width:0;padding:9px 11px;border:1px solid #ccc;border-radius:6px;font-size:0.95em}
#ai-input:focus{outline:none;border-color:#17458F}
#ai-go{background:#17458F;color:#fff;border:none;border-radius:6px;padding:0 16px;font-size:0.95em;cursor:pointer;white-space:nowrap}
#ai-go:disabled{background:#aaa;cursor:default}
/* Detail panel (slide-in editor) */
#panel{position:fixed;right:-440px;top:0;width:440px;height:100%;background:#fff;box-shadow:-3px 0 16px rgba(0,0,0,0.12);transition:right 0.2s;display:flex;flex-direction:column;z-index:100}
#panel.open{right:0}
#panel-hd{background:#17458F;color:#fff;padding:0.7em 1em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#panel-hd h2{font-size:1em}
#panel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;line-height:1}
#panel-save-hd{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:3px 10px;border-radius:4px;font-size:0.82em;cursor:pointer}
#panel-save-hd:hover{background:rgba(255,255,255,0.3)}
.panel-hd-btns{display:flex;align-items:center;gap:0.5em}
#panel-body{flex:1;overflow-y:auto;padding:1em}
.pfield{margin-bottom:0.7em}
.pfield label{display:block;font-weight:bold;color:#17458F;font-size:0.82em;margin-bottom:2px}
.pfield input,.pfield textarea,.pfield select{width:100%;padding:5px 7px;border:1px solid #ccc;border-radius:4px;font-size:0.88em;font-family:Arial,sans-serif}
.pfield input[type=checkbox]{width:auto;padding:0;border:none;box-shadow:none}
.pfield textarea{resize:vertical;min-height:60px}
.notes-display{background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:0.5em 0.7em;font-size:0.8em;white-space:pre-wrap;max-height:120px;overflow-y:auto;color:#333;margin-bottom:0.4em}
.pbtn{background:#17458F;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:0.4em;margin-bottom:0.3em}
.pbtn:hover{background:#1a56db}
.pbtn.sec{background:#f4f4f4;color:#444;border:1px solid #ccc}
.pbtn.sec:hover{background:#e8e8e8}
.pbtn.danger{background:#dc2626}
.pmsg{font-size:0.8em;margin-top:0.4em;min-height:1em}
.pmsg.ok{color:#166534}.pmsg.err{color:#b91c1c}
.sec-title{font-weight:bold;color:#17458F;font-size:0.85em;border-bottom:1px solid #e0e0e0;padding-bottom:3px;margin:0.8em 0 0.5em}
/* Assign-to-event modal */
#modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:150;align-items:center;justify-content:center}
#modal-overlay.show{display:flex}
.modal{background:#fff;border-radius:8px;padding:1.2em;width:440px;max-height:80vh;display:flex;flex-direction:column}
.modal h3{color:#17458F;margin-bottom:0.5em}
.modal-desc{font-size:0.82em;color:#555;margin-bottom:0.6em}
#event-list{flex:1;overflow-y:auto;max-height:340px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:0.6em}
.ev-item{padding:0.5em 0.75em;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.84em;display:flex;gap:0.5em;align-items:baseline}
.ev-item:last-child{border-bottom:none}
.ev-item.available:hover{background:#f0f7ff}
.ev-item.available.selected{background:#dbeafe;border-left:3px solid #2563eb}
.ev-item.taken{color:#9ca3af;cursor:default}
.ev-item.taken .ev-speaker{text-decoration:line-through;font-size:0.9em}
.ev-item.tentative{background:#fffbeb}
.ev-item.tentative:hover{background:#fef3c7}
.ev-date{font-weight:bold;white-space:nowrap;min-width:130px}
.ev-type{color:#6b7280;font-size:0.9em}
.ev-speaker{color:#b91c1c;font-size:0.85em;margin-left:auto}
.ev-open{color:#16a34a;font-size:0.85em;margin-left:auto}
.ev-tentative{color:#b45309;font-size:0.82em;margin-left:auto;text-align:right}
.modal-btns{display:flex;gap:0.5em}
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:10px;padding:2em;width:300px;text-align:center}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
/* Phone: sidebar hidden, panel + modal full width */
@media (max-width:600px){
  #layout{display:block}
  #cal-side{display:none}
  #panel{width:100%;right:-100%}
  .modal{width:94vw}
  #ai-input{font-size:1em;padding:11px 12px}
  #ai-go{font-size:1em;padding:0 18px}
}
</style>
</head>
<body>
<div id="auth">
  <div class="auth-box">
    <h2>📅 SLV Rotary<br>Speaker Pipeline</h2>
    <input type="text" id="auth-name" placeholder="Your name" autocomplete="name">
    <input type="password" id="auth-pw" placeholder="Password">
    <button onclick="doLogin()">Enter</button>
    <div class="auth-err" id="auth-err"></div>
  </div>
</div>
<header>
  <h1>🎤 Speaker Pipeline — Table</h1>
  <span id="hdr-user" style="font-size:0.85em;opacity:0.8"></span>
  <a class="hbtn" href="https://rotary.porttack.com/request/" target="_blank">+ Request Speaker</a>
  <a href="__EXEC_URL__?app=kanban" target="_top" class="hbtn">Kanban →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="ai-bar" style="display:none">
  <input id="ai-input" placeholder="✨ Tell me what to change — e.g. “move Jane to scheduled” or “assign Bob to the first open date”">
  <button id="ai-go" onclick="aiSubmit()">Ask</button>
</div>
<div id="toolbar">
  <input type="text" id="search" placeholder="Search name / topic…" oninput="renderTable()">
  <span style="font-size:0.82em;color:#666">Filter:</span>
  <button class="filter-btn active" onclick="setFilter('all',this)">All</button>
  <button class="filter-btn" onclick="setFilter('new',this)">New</button>
  <button class="filter-btn" onclick="setFilter('in-progress',this)">In Progress</button>
  <button class="filter-btn" onclick="setFilter('limbo',this)">Limbo</button>
  <button class="filter-btn" onclick="setFilter('scheduled',this)">Scheduled</button>
  <button class="filter-btn" onclick="setFilter('done',this)">Done</button>
  <span style="font-size:0.82em;color:#666;margin-left:0.4em">Assigned to:</span>
  <select id="assignee-filter" onchange="setAssignee(this.value)" style="font-size:0.82em;padding:3px 6px;border:1px solid #ccc;border-radius:4px"><option value="">All</option></select>
</div>
<div id="content"><p style="color:#888;padding:1em">Loading…</p></div>

<!-- Detail Panel -->
<div id="panel">
  <div id="panel-hd"><h2 id="panel-title">Speaker Detail</h2><div class="panel-hd-btns"><button id="panel-save-hd" onclick="savePanel()">Save</button><button id="panel-close" onclick="closePanel()">✕</button></div></div>
  <div id="panel-body"></div>
</div>

<!-- Event Picker Modal -->
<div id="modal-overlay">
  <div class="modal">
    <h3>Assign to Event</h3>
    <p class="modal-desc">Green = open · Amber = open but another card has it as a tentative date · Gray/strikethrough = already has a speaker. Click an open date to select, then Assign.</p>
    <div id="event-list"><p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p></div>
    <div class="modal-btns">
      <button class="pbtn" onclick="confirmAssign()">Assign</button>
      <button class="pbtn sec" onclick="closeModal()">Cancel</button>
    </div>
    <div class="pmsg" id="modal-msg"></div>
  </div>
</div>

<script>
var currentUser='',allCards=[],members=[],statuses=[],statusLabels={};
var filterStatus='all',sortCol='smart',sortAsc=false,upcomingMeetings=[],assigneeFilter='';
var panelRow=null,selectedEventsRow=null;
var AI_ENABLED=__AI_ENABLED__; // server-injected feature flag
function gs(fn,a){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a);})}
function gs3(fn,a,b,c){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a,b,c);})}
function doLogin(){
  var name=document.getElementById('auth-name').value.trim();
  var pw=document.getElementById('auth-pw').value;
  if(!name){document.getElementById('auth-err').textContent='Enter your name.';return;}
  gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){localStorage.setItem('pipelinePw',pw);localStorage.setItem('pipelineName',name);
      currentUser=name;document.getElementById('auth').style.display='none';
      document.getElementById('hdr-user').textContent=name;loadData();}
    else{document.getElementById('auth-err').textContent='Wrong password. (Set KANBAN_PASSWORD in Script Properties if not done yet.)';}
  }).catch(function(err){document.getElementById('auth-err').textContent='Error: '+(err.message||String(err));});
}
window.addEventListener('load',function(){
  var pw=localStorage.getItem('pipelinePw'),name=localStorage.getItem('pipelineName');
  if(pw&&name){gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){currentUser=name;document.getElementById('auth').style.display='none';
      document.getElementById('hdr-user').textContent=name;loadData();}
    else{localStorage.removeItem('pipelinePw');}
  }).catch(function(){localStorage.removeItem('pipelinePw');});}
  document.getElementById('auth-pw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
  var ai=document.getElementById('ai-input');
  if(ai)ai.addEventListener('keydown',function(e){if(e.key==='Enter')aiSubmit();});
  if(AI_ENABLED){var b=document.getElementById('ai-bar');if(b)b.style.display='';}
});
async function loadData(){
  try{
    var d=await gs('getPipelineData',null);
    allCards=d.cards;members=d.members;statuses=d.statuses;statusLabels=d.statusLabels;
    upcomingMeetings=await gs('getUpcomingEventsForPicker',null);populateAssigneeFilter();renderTable();
  }catch(e){
    document.getElementById('content').innerHTML=
      '<p style="color:#b91c1c;padding:1.2em">⚠️ '+e.message+
      '<br><br>Run <strong>Setup Speaker Pipeline Tab</strong> from the Rotary Sync menu in the spreadsheet, then reload.</p>';
  }
}
function setFilter(s,btn){
  filterStatus=s;document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');renderTable();
}
function populateAssigneeFilter(){
  var sel=document.getElementById('assignee-filter');if(!sel)return;
  var seen={};allCards.forEach(function(c){if(c.assignedTo)seen[c.assignedTo]=true;});
  var names=Object.keys(seen).sort();
  var html='<option value="">All</option>';
  names.forEach(function(n){html+='<option value="'+esc(n)+'">'+esc(n)+'</option>';});
  html+='<option value="__UNASSIGNED__">— Unassigned —</option>';
  sel.innerHTML=html;sel.value=assigneeFilter;
}
function setAssignee(v){assigneeFilter=v;renderTable();}
function matchAssignee(c){
  if(!assigneeFilter)return true;
  if(assigneeFilter==='__UNASSIGNED__')return !c.assignedTo;
  return c.assignedTo===assigneeFilter;
}
// Default ordering: dated cards first (soonest date first), then by priority
// (High → Medium → Low → none), then most-recently-added (highest row) first.
var PRIO_RANK={high:0,medium:1,low:2};
function smartCompare(a,b){
  var ad=a.tentativeDate||'',bd=b.tentativeDate||'';
  if(ad&&!bd)return -1;
  if(!ad&&bd)return 1;
  if(ad&&bd&&ad!==bd)return ad<bd?-1:1;
  var ap=PRIO_RANK[(a.priority||'').toLowerCase()];ap=(ap==null?3:ap);
  var bp=PRIO_RANK[(b.priority||'').toLowerCase()];bp=(bp==null?3:bp);
  if(ap!==bp)return ap-bp;
  return b.rowIndex-a.rowIndex;
}
function renderTable(){
  var q=(document.getElementById('search').value||'').toLowerCase();
  var rows=allCards.filter(function(c){
    if(filterStatus!=='all'&&c.status!==filterStatus)return false;
    if(filterStatus==='all'&&(c.status==='declined'||c.status==='deleted'))return false;
    if(!matchAssignee(c))return false;
    if(q&&!(c.speakerName+c.topic+c.assignedTo).toLowerCase().includes(q))return false;
    return true;
  });
  if(sortCol==='smart'){rows.sort(smartCompare);}
  else{rows.sort(function(a,b){var av=a[sortCol]||'',bv=b[sortCol]||'';return sortAsc?(av>bv?1:-1):(av<bv?1:-1);});}
  var content=document.getElementById('content');
  var cols=['speakerName','priority','status','assignedTo','tentativeDate','interested'];
  var colLabels={speakerName:'Speaker / Topic',priority:'Priority',status:'Status',assignedTo:'Assigned',tentativeDate:'Date',interested:'♡'};
  var tableHtml;
  if(!rows.length){
    tableHtml='<p style="color:#888;padding:1em">No matching speakers.</p>';
  }else{
    tableHtml='<table><thead><tr>'+cols.map(function(c){
      return'<th onclick="sortBy(&#39;'+c+'&#39;)">'+(colLabels[c]||c)+(sortCol===c?(sortAsc?' ▲':' ▼'):'')+'</th>';
    }).join('')+'</tr></thead><tbody id="tbody"></tbody></table>';
  }
  content.innerHTML='<div id="layout"><aside id="cal-side">'+buildCalSidebar()+'</aside><div id="main">'+tableHtml+'</div></div>';
  if(!rows.length)return;
  var tbody=document.getElementById('tbody');
  rows.forEach(function(card){
    var tr=document.createElement('tr');tr.style.cursor='pointer';
    var intNames=card.interested?card.interested.split(',').map(function(n){return n.trim();}).filter(Boolean):[];
    var iVoted=intNames.indexOf(currentUser)!==-1;
    var pk=(card.priority||'').toLowerCase();
    var prioCell=({high:'Strongly Recommended',medium:'Recommended',low:'Idea'})[pk];
    prioCell=prioCell?'<span class="prio prio-'+pk+'">'+prioCell+'</span>':'—';
    tr.innerHTML='<td><strong>'+esc(card.speakerName||'(no name)')+'</strong>'+
      (card.topic?'<div class="cell-topic">'+esc(card.topic)+'</div>':'')+
      (card.tags?'<div>'+card.tags.split(',').map(function(t){t=t.trim();return t?'<span class="tag-chip">'+esc(t)+'</span>':''}).join('')+'</div>':'')+'</td>'+
      '<td>'+prioCell+'</td>'+
      '<td><span class="tag tag-'+card.status+'">'+esc(statusLabels[card.status]||card.status)+'</span></td>'+
      '<td>'+esc(card.assignedTo||'—')+'</td><td>'+esc(card.tentativeDate||'—')+'</td>'+
      '<td class="vote-cell"><button style="background:none;border:none;cursor:pointer;font-size:0.9em" title="Interest — members + public website hearts" onclick="voteRow(event,'+card.rowIndex+')">'+(iVoted?'❤️':'🤍')+'</button> '+(intNames.length+(card.hearts||0))+'</td>';
    tr.addEventListener('click',function(){openPanel(card.rowIndex);});
    tbody.appendChild(tr);
  });
}
// Compact, date-sorted calendar sidebar (next 12 meetings; open vs. booked).
function buildCalSidebar(){
  var ms=upcomingMeetings.slice().sort(function(a,b){return a.date<b.date?-1:(a.date>b.date?1:0);}).slice(0,12);
  if(!ms.length) return '<h2>📅 Upcoming</h2><div class="cal-empty">No upcoming meetings.</div>';
  var filled=ms.filter(function(m){return !m.available;}).length;
  var tentByDate={};
  allCards.forEach(function(c){
    if(c.status==='scheduled'||c.status==='declined'||c.status==='deleted')return;
    if(!c.tentativeDate)return;
    (tentByDate[c.tentativeDate]=tentByDate[c.tentativeDate]||[]).push(c.speakerName||'(no name)');
  });
  var rows=ms.map(function(m){
    var d=String(m.dateLabel||'').split(',')[0]||m.date;
    var tent=tentByDate[m.date]||[];
    var second=m.available
      ? (tent.length?'<span class="cal-tent">⭐ '+esc(tent.join(', '))+' (tentative)</span>':'<span class="cal-open">— open —</span>')
      : '<span class="cal-spk">'+esc(m.mainSpeaker)+'</span>';
    return '<div class="cal-item"><span class="cal-date">'+esc(d)+(m.time?' '+esc(m.time):'')+'</span>'+second+'</div>';
  }).join('');
  return '<h2>📅 Upcoming <span class="cal-tot" title="'+filled+' of '+ms.length+' have a speaker">'+filled+'/'+ms.length+'</span></h2>'+rows;
}
// ── AI command line (proposes via a confirm dialog) ───
function aiSubmit(){
  var inp=document.getElementById('ai-input');
  var t=(inp.value||'').trim();
  if(!t)return;
  var go=document.getElementById('ai-go');
  go.disabled=true;go.textContent='…';
  gs3('pipelineAssistantCommand',t,currentUser).then(function(res){
    go.disabled=false;go.textContent='Ask';
    if(res&&res.error){alert('⚠️ '+res.error);return;}
    var actions=(res&&res.actions)||[];
    if(!actions.length){alert((res&&res.message)||'I could not find a matching change. Try the speaker’s exact name.');return;}
    var summary=actions.map(function(a){return '• '+a.description;}).join('\\n');
    if(!confirm('Apply these changes?\\n\\n'+summary))return;
    go.disabled=true;go.textContent='…';
    gs3('applyPipelineActions',actions,currentUser).then(function(){
      go.disabled=false;go.textContent='Ask';inp.value='';
      loadData();
    }).catch(function(e){go.disabled=false;go.textContent='Ask';alert('Apply failed: '+(e.message||e));});
  }).catch(function(e){go.disabled=false;go.textContent='Ask';alert('Error: '+(e.message||e));});
}
// ── Detail Panel (full editor, shared design with the Kanban view) ──
function openPanel(rowIndex){
  var card=allCards.find(function(c){return c.rowIndex===rowIndex;});
  if(!card)return;
  panelRow=rowIndex;
  var b=document.getElementById('panel-body');
  document.getElementById('panel-title').textContent=card.speakerName||'Speaker Detail';
  var memberOpts=[''].concat(members).map(function(m){return '<option value="'+esc(m)+'"'+(m===card.assignedTo?' selected':'')+'>'+esc(m||'— unassigned —')+'</option>';}).join('');
  var statusOpts=statuses.map(function(s){return '<option value="'+s+'"'+(s===card.status?' selected':'')+'>'+(statusLabels[s]||s)+'</option>';}).join('');
  b.innerHTML=
    '<div class="pfield"><label>Speaker Name</label><input id="pn-name" value="'+esc(card.speakerName)+'"></div>'+
    '<div class="pfield"><label>Topic</label><input id="pn-topic" value="'+esc(card.topic)+'"></div>'+
    '<div class="pfield"><label>Status</label><select id="pn-status">'+statusOpts+'</select></div>'+
    '<div class="pfield"><label>Priority</label><select id="pn-priority"><option value="">— none —</option><option value="Low">Low — Idea</option><option value="Medium">Medium — Recommended</option><option value="High">High — Strongly Recommended</option></select></div>'+
    '<div class="pfield"><label>Manager (Assigned To)</label><select id="pn-assigned">'+memberOpts+'</select></div>'+
    '<div class="pfield"><label>Tentative Date <span style="font-weight:normal;color:#888;font-size:0.9em">(open meeting dates)</span></label><select id="pn-date">'+buildDateOptions(card.tentativeDate)+'</select></div>'+
    '<div class="pfield"><label>Speaker Role</label><select id="pn-role"><option>Opening Speaker</option><option>Main Speaker</option><option>Either</option><option>Unsure</option></select></div>'+
    '<div class="pfield"><label>Email</label><input id="pn-email" value="'+esc(card.speakerEmail)+'"></div>'+
    '<div class="pfield"><label>Phone</label><input id="pn-phone" value="'+esc(card.speakerPhone)+'"></div>'+
    '<div class="pfield"><label>City</label><input id="pn-city" value="'+esc(card.speakerCity)+'"></div>'+
    '<div class="pfield"><label>Preferred Dates</label><input id="pn-pref" value="'+esc(card.preferredDates)+'"></div>'+
    '<div class="pfield"><label>Bio</label><textarea id="pn-bio" rows="3">'+esc(card.bio)+'</textarea></div>'+
    '<div class="pfield"><label>Summary <span style="font-weight:normal;color:#888;font-size:0.9em">(newsletter narrative)</span></label><textarea id="pn-summary" rows="3">'+esc(card.summary)+'</textarea></div>'+
    '<div class="pfield"><label>Speaker URL</label><input id="pn-url" value="'+esc(card.speakerUrl)+'" placeholder="https://…"></div>'+
    '<div class="pfield"><label>Introducer</label><input id="pn-introducer" value="'+esc(card.introducer)+'" placeholder="Who introduces the speaker"></div>'+
    '<div class="pfield"><label>Top Photo</label><input id="pn-phototop" value="'+esc(card.photoTop)+'" placeholder="paste an image URL, or upload below">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-phototop&#39;)">'+
      '<div id="pn-phototop-prev" class="photo-prev"></div></div>'+
    '<div class="pfield"><label>Bottom Photo</label><input id="pn-photobottom" value="'+esc(card.photoBottom)+'" placeholder="paste an image URL, or upload below">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-photobottom&#39;)">'+
      '<div id="pn-photobottom-prev" class="photo-prev"></div></div>'+
    '<div class="pfield"><label>Tags <span style="font-weight:normal;color:#888;font-size:0.9em">(comma-separated)</span></label><input id="pn-tags" value="'+esc(card.tags)+'" placeholder="e.g. environment, local, tech"></div>'+
    '<div class="pfield"><label>Comments <span style="font-weight:normal;color:#888;font-size:0.9em">(internal — from the submitter)</span></label><textarea id="pn-comments" rows="2">'+esc(card.comments)+'</textarea></div>'+
    '<div class="pfield"><label>Format &amp; Speaker Details</label>'+
      '<div style="margin-top:0.4em">'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-zoom-only"> Zoom only (not in person)</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-rotarian"> Rotarian</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-local"> Local to Santa Cruz County</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-fundraising"> May bring fundraising or donation materials</label>'+
      '</div></div>'+
    (card.requestorName?'<div class="pfield"><label>Submitted by</label><span style="font-size:0.88em">'+esc(card.requestorName)+' &lt;'+esc(card.requestorEmail)+'&gt;</span></div>':'')+
    (card.interested?'<div class="pfield"><label>Interested members</label><span style="font-size:0.88em">'+esc(card.interested)+'</span></div>':'')+
    '<div class="pfield"><label>Source / Last updated</label><span style="font-size:0.85em;color:#555">'+esc(card.source||'—')+(card.updatedAt?' · '+esc(card.updatedAt):'')+'</span></div>'+
    '<button class="pbtn" onclick="savePanel()">Save</button>'+
    (['in-progress','limbo','scheduled'].indexOf(card.status)!==-1?'<button class="pbtn" style="background:#16a34a" onclick="openAssignModal()">Assign to Event</button>':'')+
    (card.status==='deleted'
      ?'<button class="pbtn sec" onclick="restoreCard()">↩︎ Restore</button><button class="pbtn danger" onclick="deleteCard()">🗑 Delete permanently</button>'
      :'<button class="pbtn danger" onclick="deleteCard()">🗑 Delete</button>')+
    '<div class="pmsg" id="panel-msg"></div>'+
    '<div class="sec-title">Notes</div>'+
    '<div class="notes-display" id="pn-notes-display">'+esc(card.notes)+'</div>'+
    '<div class="pfield"><label>Add Note</label><textarea id="pn-note-input" rows="2" placeholder="Type a note…"></textarea></div>'+
    '<button class="pbtn sec" onclick="panelAddNote()">Add Note</button>';
  document.getElementById('pn-role').value=card.speakerRole||'Main Speaker';
  document.getElementById('pn-priority').value=card.priority||'';
  document.getElementById('pn-zoom-only').checked=!!card.zoomOnly;
  document.getElementById('pn-is-rotarian').checked=!!card.isRotarian;
  document.getElementById('pn-is-local').checked=!!card.isLocal;
  document.getElementById('pn-fundraising').checked=!!card.fundraisingLiterature;
  showPhotoPreview('pn-phototop');showPhotoPreview('pn-photobottom');
  document.getElementById('panel').classList.add('open');
}
function closePanel(){document.getElementById('panel').classList.remove('open');panelRow=null;}
function buildDateOptions(cur){var opts='<option value="">— no date —</option>',found=false;upcomingMeetings.forEach(function(m){var isCur=(m.date===cur);if(isCur)found=true;var disabled=(!m.available&&!isCur)?' disabled':'';var label=m.available?(esc(m.dateLabel)+(m.time?' '+m.time:'')):(esc(m.dateLabel)+' — taken'+(m.mainSpeaker?' ('+esc(m.mainSpeaker)+')':''));opts+='<option value="'+esc(m.date)+'"'+(isCur?' selected':'')+disabled+'>'+label+'</option>';});if(cur&&!found)opts+='<option value="'+esc(cur)+'" selected>'+esc(cur)+' (custom)</option>';return opts;}
function driveThumb(u,size){if(!u)return'';var id='';var i=u.indexOf('id=');if(i>=0){id=u.substring(i+3).split('&')[0];}else{var j=u.indexOf('/d/');if(j>=0)id=u.substring(j+3).split('/')[0];}return id?'https://drive.google.com/thumbnail?id='+id+'&sz=w'+(size||200):u;}
function showPhotoPreview(id){var el=document.getElementById(id);if(!el)return;var v=el.value||'';var prev=document.getElementById(id+'-prev');if(!prev)return;prev.innerHTML=(v&&v.indexOf('http')===0)?'<img src="'+esc(driveThumb(v,250))+'" style="max-width:140px;max-height:140px;border-radius:4px;border:1px solid #ddd" onerror="this.style.display=&#39;none&#39;">':'';}
async function uploadPhoto(input,targetId){var file=input.files[0];if(!file)return;var prev=document.getElementById(targetId+'-prev');if(file.size>8*1024*1024){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Image too large (max 8 MB)</span>';input.value='';return;}if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#888">Uploading…</span>';try{var dataUrl=await new Promise(function(res,rej){var r=new FileReader();r.onload=function(ev){res(ev.target.result);};r.onerror=rej;r.readAsDataURL(file);});var sn=(document.getElementById('pn-name')||{}).value||'speaker';var resp=await gs3('uploadPipelinePhoto',dataUrl,file.name,sn);document.getElementById(targetId).value=resp.url;showPhotoPreview(targetId);}catch(e){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Upload failed</span>';}}
async function savePanel(){
  if(!panelRow)return;
  var msg=document.getElementById('panel-msg');
  var changes={
    speakerName:document.getElementById('pn-name').value.trim(),
    topic:document.getElementById('pn-topic').value.trim(),
    status:document.getElementById('pn-status').value,
    priority:document.getElementById('pn-priority').value,
    assignedTo:document.getElementById('pn-assigned').value,
    tentativeDate:document.getElementById('pn-date').value,
    speakerRole:document.getElementById('pn-role').value,
    speakerEmail:document.getElementById('pn-email').value.trim(),
    speakerPhone:document.getElementById('pn-phone').value.trim(),
    speakerCity:document.getElementById('pn-city').value.trim(),
    preferredDates:document.getElementById('pn-pref').value.trim(),
    bio:document.getElementById('pn-bio').value.trim(),
    summary:document.getElementById('pn-summary').value.trim(),
    speakerUrl:document.getElementById('pn-url').value.trim(),
    introducer:document.getElementById('pn-introducer').value.trim(),
    photoTop:document.getElementById('pn-phototop').value.trim(),
    photoBottom:document.getElementById('pn-photobottom').value.trim(),
    tags:document.getElementById('pn-tags').value.trim(),
    comments:document.getElementById('pn-comments').value.trim(),
    zoomOnly:document.getElementById('pn-zoom-only').checked?'Yes':'',
    isRotarian:document.getElementById('pn-is-rotarian').checked?'Yes':'',
    isLocal:document.getElementById('pn-is-local').checked?'Yes':'',
    fundraisingLiterature:document.getElementById('pn-fundraising').checked?'Yes':''
  };
  try{
    var res=await gs3('savePipelineCard',panelRow,changes,currentUser);
    var card=allCards.find(function(c){return c.rowIndex===panelRow;});
    if(card){
      Object.assign(card,changes);
      card.zoomOnly=changes.zoomOnly==='Yes';
      card.isRotarian=changes.isRotarian==='Yes';
      card.isLocal=changes.isLocal==='Yes';
      card.fundraisingLiterature=changes.fundraisingLiterature==='Yes';
    }
    if(res&&res.notes!=null){if(card)card.notes=res.notes;var nd=document.getElementById('pn-notes-display');if(nd)nd.textContent=res.notes;}
    renderTable();
    msg.className='pmsg ok';
    msg.textContent=(res&&res.noted)?'Saved ✓ ('+res.noted+' change'+(res.noted===1?'':'s')+' logged)':'Saved ✓';
    setTimeout(function(){msg.textContent='';},2500);
  }catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
}
async function panelAddNote(){
  if(!panelRow)return;
  var inp=document.getElementById('pn-note-input');var text=inp.value.trim();if(!text)return;
  try{
    await gs3('appendPipelineNote',panelRow,text,currentUser);inp.value='';
    var data=await gs('getPipelineData',null);
    var updated=data.cards.find(function(c){return c.rowIndex===panelRow;});
    var card=allCards.find(function(c){return c.rowIndex===panelRow;});
    if(updated&&card)card.notes=updated.notes;
    document.getElementById('pn-notes-display').textContent=updated?updated.notes:'';
    allCards=data.cards;renderTable();
  }catch(e){alert('Note failed: '+e.message);}
}
async function deleteCard(){
  if(!panelRow)return;
  var card=allCards.find(function(c){return c.rowIndex===panelRow;});if(!card)return;
  var msg=document.getElementById('panel-msg');
  if(card.status==='deleted'){
    if(!confirm('Permanently delete this card? This removes the row and cannot be undone.'))return;
    try{await gs('deletePipelineCard',panelRow);closePanel();loadData();}
    catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
    return;
  }
  if(!confirm('Move this card to Deleted? You can restore it from the Kanban view.'))return;
  card.status='deleted';renderTable();
  gs3('savePipelineCard',panelRow,{status:'deleted'},currentUser).catch(function(err){alert('Delete failed: '+err.message);loadData();});
  closePanel();
}
function restoreCard(){
  if(!panelRow)return;
  var card=allCards.find(function(c){return c.rowIndex===panelRow;});if(!card)return;
  card.status='new';renderTable();
  gs3('savePipelineCard',panelRow,{status:'new'},currentUser).catch(function(err){alert('Restore failed: '+err.message);loadData();});
  closePanel();
}
// ── Assign-to-Event modal ────────────────────────────────────
async function openAssignModal(){
  selectedEventsRow=null;
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('modal-msg').textContent='';
  var list=document.getElementById('event-list');
  list.innerHTML='<p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p>';
  var events=await gs('getUpcomingEventsForPicker',null);
  if(!events.length){list.innerHTML='<p style="padding:0.6em;color:#888;font-size:0.85em">No upcoming meetings found.</p>';return;}
  var tentMap={};
  allCards.forEach(function(c){
    if(c.status==='declined'||c.status==='scheduled')return;
    if(c.rowIndex===panelRow)return;
    if(!c.tentativeDate)return;
    (tentMap[c.tentativeDate]=tentMap[c.tentativeDate]||[]).push(c.speakerName||'(no name)');
  });
  list.innerHTML='';
  events.forEach(function(ev){
    var tentNames=tentMap[ev.date]||[];
    var div=document.createElement('div');
    var cls=ev.available?(tentNames.length?'available tentative':'available'):'taken';
    div.className='ev-item '+cls;div.dataset.row=ev.rowIndex;
    var speakerHtml;
    if(!ev.available){speakerHtml='<span class="ev-speaker">'+esc(ev.mainSpeaker)+(ev.mainTopic?': '+esc(ev.mainTopic):'')+'</span>';}
    else if(tentNames.length){speakerHtml='<span class="ev-tentative">⚠️ tentative: '+esc(tentNames.join(', '))+'</span>';}
    else{speakerHtml='<span class="ev-open">open</span>';}
    div.innerHTML='<span class="ev-date">'+esc(ev.dateLabel)+'</span><span class="ev-type">'+esc(ev.eventType)+(ev.time?' '+ev.time:'')+'</span>'+speakerHtml;
    if(ev.available){div.addEventListener('click',function(){list.querySelectorAll('.ev-item').forEach(function(el){el.classList.remove('selected');});div.classList.add('selected');selectedEventsRow=ev.rowIndex;});}
    list.appendChild(div);
  });
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show');selectedEventsRow=null;}
async function confirmAssign(){
  if(!selectedEventsRow||!panelRow){document.getElementById('modal-msg').textContent='Please select an available date first.';return;}
  var msg=document.getElementById('modal-msg');
  try{
    var res=await gs3('assignSpeakerToEvent',panelRow,selectedEventsRow,currentUser);
    msg.className='pmsg ok';msg.textContent='✓ Assigned '+res.speakerName;
    await loadData();
    setTimeout(function(){closeModal();closePanel();},1500);
  }catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
}
function sortBy(col){sortAsc=(sortCol===col)?!sortAsc:false;sortCol=col;renderTable();}
function voteRow(e,ro){
  e.stopPropagation();
  gs3('togglePipelineVote',ro,currentUser).then(function(res){
    var card=allCards.find(function(c){return c.rowIndex===ro;});
    if(card)card.interested=res.interested;
    renderTable();
  }).catch(function(err){alert('Vote failed: '+err.message);});
}
function logout(){localStorage.removeItem('pipelinePw');localStorage.removeItem('pipelineName');location.reload();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════
//  SPEAKER PIPELINE — STATUS VIEW  (?app=speaker-pipeline)
// ═══════════════════════════════════════════════════════════════
function getSpeakerStatusHtml() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLV Rotary — Speaker Pipeline Status</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f7f8fa;color:#222}
header{background:#17458F;color:#fff;padding:0.8em 1.2em;display:flex;align-items:baseline;gap:1em}
header h1{font-size:1.05em;font-weight:bold;flex:1}
header a{color:#fff;font-size:0.82em;opacity:0.8;text-decoration:none}
.hbtn{font-size:0.8em;padding:3px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;cursor:pointer;text-decoration:none}
.hbtn:hover{background:rgba(255,255,255,0.28)}
#content{max-width:1040px;margin:1.2em auto;padding:0 1em}
/* Two-column layout: calendar sidebar (desktop) + the status list. */
#layout{display:flex;gap:1.2em;align-items:flex-start}
#main{flex:1;min-width:0}
#cal-side{width:240px;flex-shrink:0;position:sticky;top:1em;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.07);padding:0.7em 0.8em}
#cal-side h2{font-size:0.92em;color:#17458F;margin-bottom:0.5em;display:flex;align-items:center;gap:0.4em}
#cal-side .cal-tot{margin-left:auto;background:#0f766e;color:#fff;font-size:0.78em;border-radius:10px;padding:1px 7px}
.cal-item{display:flex;flex-direction:column;padding:0.35em 0;border-bottom:1px solid #f0f0f0;font-size:0.84em}
.cal-item:last-child{border-bottom:none}
.cal-date{font-weight:bold;color:#0f766e}
.cal-spk{color:#17458F}
.cal-open{color:#9ca3af;font-style:italic}
.cal-tent{color:#b45309}
.cal-empty{color:#999;font-size:0.84em;font-style:italic}
.section{margin-bottom:1.8em}
.sec-hd{font-size:1.05em;font-weight:bold;color:#17458F;border-bottom:2px solid #17458F;padding-bottom:0.25em;margin-bottom:0.2em;display:flex;align-items:center;gap:0.5em}
.sec-count{background:#17458F;color:#fff;font-size:0.75em;border-radius:10px;padding:1px 8px}
.sec-desc{font-size:0.82em;color:#888;margin:0 0 0.7em}
/* Per-card stage changer (no dragging needed) */
.stage-row{margin-top:6px;display:flex;align-items:center;gap:6px}
.stage-lbl{font-size:0.8em;color:#666;font-weight:bold}
.stage-sel{font-size:0.85em;padding:4px 6px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer}
.card{background:#fff;border-radius:7px;padding:0.8em 1em;margin-bottom:0.55em;box-shadow:0 1px 3px rgba(0,0,0,0.07);display:flex;gap:1em;align-items:flex-start}
.card-left{flex:1}
.card-name{font-weight:bold;font-size:0.97em;color:#17458F}
.card-name.card-open{cursor:pointer}
.card-name.card-open:hover{text-decoration:underline}
.open-hint{font-weight:normal;font-size:0.78em;color:#9ca3af}
.card-sub{color:#444;font-size:0.86em;margin-top:1px}
.who-lbl{color:#888;font-weight:normal;font-size:0.88em}
.card-topic{color:#444;font-size:0.88em;margin-top:2px}
.card-meta{color:#888;font-size:0.8em;margin-top:4px;display:flex;flex-wrap:wrap;gap:0.6em}
.card-notes{background:#f8f9fa;border-radius:4px;padding:0.35em 0.6em;font-size:0.78em;color:#555;margin-top:0.5em;white-space:pre-wrap;max-height:80px;overflow-y:auto}
.note-form{margin-top:0.5em;display:flex;gap:0.4em}
.note-form input{flex:1;padding:4px 7px;border:1px solid #ccc;border-radius:4px;font-size:0.82em}
.note-form button{background:#17458F;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.82em;white-space:nowrap}
.badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:0.76em;font-weight:bold}
.badge-offer{background:#d1fae5;color:#065f46}
.badge-request{background:#dbeafe;color:#1e3a8a}
.badge-manual{background:#f3f4f6;color:#555}
.priority-low{background:#f3f4f6;color:#4b5563}
.priority-medium{background:#bfdbfe;color:#1e40af}
.priority-high{background:#fed7aa;color:#9a3412}
.empty{color:#aaa;font-size:0.88em;font-style:italic;padding:0.3em 0}
/* AI command line */
#ai-bar{max-width:1040px;margin:0.9em auto 0;padding:0 1em;display:flex;gap:0.5em}
#ai-input{flex:1;min-width:0;padding:9px 11px;border:1px solid #ccc;border-radius:6px;font-size:0.95em}
#ai-input:focus{outline:none;border-color:#17458F}
#ai-go{background:#17458F;color:#fff;border:none;border-radius:6px;padding:0 16px;font-size:0.95em;cursor:pointer;white-space:nowrap}
#ai-go:disabled{background:#aaa;cursor:default}
#ai-proposal{max-width:1040px;margin:0.5em auto 0;padding:0.7em 1em;display:none;background:#fff;border:1px solid #c5cae9;border-left:3px solid #17458F;border-radius:6px}
#ai-proposal.show{display:block}
#ai-prop-list{font-size:0.9em;color:#333;margin-bottom:0.5em;line-height:1.6}
#ai-prop-list div{padding:1px 0}
.ai-btns{display:flex;gap:0.5em}
.ai-btns button{border:none;border-radius:4px;padding:7px 16px;font-size:0.9em;cursor:pointer}
.ai-btns .apply{background:#17458F;color:#fff}
.ai-btns .cancel{background:#f4f4f4;color:#444;border:1px solid #ccc}
#ai-msg{font-size:0.85em;margin-top:0.4em;min-height:1em}
#ai-msg.ok{color:#166534}#ai-msg.err{color:#b91c1c}
@media (max-width:600px){
  /* Bump base size so the em-based text scales up; ≥16px inputs avoid iOS zoom. */
  body{font-size:18px}
  #ai-input{font-size:1em;padding:11px 12px}
  #ai-go{font-size:1em;padding:0 18px}
  header{flex-wrap:wrap;gap:0.45em}
  header h1{flex:1 0 100%;font-size:1.15em}
  #assignee-filter{flex:1 1 auto;font-size:0.95em;padding:7px 8px}
  .hbtn{font-size:0.9em;padding:7px 12px}
  #content{margin:0.8em auto}
  /* Calendar sidebar is desktop-only; stack to a single column on phones. */
  #layout{display:block}
  #cal-side{display:none}
  .sec-hd{font-size:1.15em}
  .sec-desc{font-size:0.9em}
  .card{flex-direction:column-reverse;align-items:stretch}
  .card img{align-self:flex-start}
  .card-name{font-size:1.05em}
  .card-topic{font-size:0.95em}
  .card-meta{font-size:0.9em}
  .card-notes{font-size:0.88em}
  .note-form input{font-size:1em;padding:8px 9px}
  .note-form button{font-size:0.95em;padding:8px 14px}
  .stage-lbl{font-size:0.9em}
  .stage-sel{font-size:1em;padding:8px 9px}
}
/* Detail panel (slide-in editor) */
#panel{position:fixed;right:-440px;top:0;width:440px;height:100%;background:#fff;box-shadow:-3px 0 16px rgba(0,0,0,0.12);transition:right 0.2s;display:flex;flex-direction:column;z-index:100}
#panel.open{right:0}
#panel-hd{background:#17458F;color:#fff;padding:0.7em 1em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#panel-hd h2{font-size:1em}
#panel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;line-height:1}
#panel-save-hd{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:3px 10px;border-radius:4px;font-size:0.82em;cursor:pointer}
#panel-save-hd:hover{background:rgba(255,255,255,0.3)}
.panel-hd-btns{display:flex;align-items:center;gap:0.5em}
#panel-body{flex:1;overflow-y:auto;padding:1em}
.pfield{margin-bottom:0.7em}
.pfield label{display:block;font-weight:bold;color:#17458F;font-size:0.82em;margin-bottom:2px}
.pfield input,.pfield textarea,.pfield select{width:100%;padding:5px 7px;border:1px solid #ccc;border-radius:4px;font-size:0.88em;font-family:Arial,sans-serif}
.pfield input[type=checkbox]{width:auto;padding:0;border:none;box-shadow:none}
.pfield textarea{resize:vertical;min-height:60px}
.notes-display{background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:0.5em 0.7em;font-size:0.8em;white-space:pre-wrap;max-height:120px;overflow-y:auto;color:#333;margin-bottom:0.4em}
.pbtn{background:#17458F;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:0.4em;margin-bottom:0.3em}
.pbtn:hover{background:#1a56db}
.pbtn.sec{background:#f4f4f4;color:#444;border:1px solid #ccc}
.pbtn.sec:hover{background:#e8e8e8}
.pbtn.danger{background:#dc2626}
.pmsg{font-size:0.8em;margin-top:0.4em;min-height:1em}
.pmsg.ok{color:#166534}.pmsg.err{color:#b91c1c}
.sec-title{font-weight:bold;color:#17458F;font-size:0.85em;border-bottom:1px solid #e0e0e0;padding-bottom:3px;margin:0.8em 0 0.5em}
/* Assign-to-event modal */
#modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:150;align-items:center;justify-content:center}
#modal-overlay.show{display:flex}
.modal{background:#fff;border-radius:8px;padding:1.2em;width:440px;max-height:80vh;display:flex;flex-direction:column}
.modal h3{color:#17458F;margin-bottom:0.5em}
.modal-desc{font-size:0.82em;color:#555;margin-bottom:0.6em}
#event-list{flex:1;overflow-y:auto;max-height:340px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:0.6em}
.ev-item{padding:0.5em 0.75em;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.84em;display:flex;gap:0.5em;align-items:baseline}
.ev-item:last-child{border-bottom:none}
.ev-item.available:hover{background:#f0f7ff}
.ev-item.available.selected{background:#dbeafe;border-left:3px solid #2563eb}
.ev-item.taken{color:#9ca3af;cursor:default}
.ev-item.taken .ev-speaker{text-decoration:line-through;font-size:0.9em}
.ev-item.tentative{background:#fffbeb}
.ev-item.tentative:hover{background:#fef3c7}
.ev-date{font-weight:bold;white-space:nowrap;min-width:130px}
.ev-type{color:#6b7280;font-size:0.9em}
.ev-speaker{color:#b91c1c;font-size:0.85em;margin-left:auto}
.ev-open{color:#16a34a;font-size:0.85em;margin-left:auto}
.ev-tentative{color:#b45309;font-size:0.82em;margin-left:auto;text-align:right}
.modal-btns{display:flex;gap:0.5em}
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:10px;padding:2em;width:300px;text-align:center}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
/* Phone: the detail panel and modal go full-width. Placed after the base
   #panel/.modal rules so source order lets these win (equal specificity). */
@media (max-width:600px){
  #panel{width:100%;right:-100%}
  .modal{width:94vw}
}
</style>
</head>
<body>
<div id="auth">
  <div class="auth-box">
    <h2>📅 SLV Rotary<br>Speaker Pipeline</h2>
    <input type="text" id="auth-name" placeholder="Your name" autocomplete="name">
    <input type="password" id="auth-pw" placeholder="Password">
    <button onclick="doLogin()">Enter</button>
    <div class="auth-err" id="auth-err"></div>
  </div>
</div>
<header>
  <h1>🎤 SLV Rotary — Speaker Pipeline</h1>
  <select id="assignee-filter" onchange="setAssignee(this.value)" style="font-size:0.8em;padding:3px 6px;border-radius:4px;border:none"><option value="">All assignees</option></select>
  <a href="__EXEC_URL__?app=kanban" target="_top" class="hbtn">Kanban →</a>
  <a href="__EXEC_URL__?app=pipeline" target="_top" class="hbtn">Table →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="ai-bar" style="display:none">
  <input id="ai-input" placeholder="✨ Tell me what to change — e.g. “move Jane to scheduled” or “assign Bob to the first open date”">
  <button id="ai-go" onclick="aiSubmit()">Ask</button>
</div>
<div id="content"><p style="color:#888;padding:1em">Loading…</p></div>

<!-- Detail Panel -->
<div id="panel">
  <div id="panel-hd"><h2 id="panel-title">Speaker Detail</h2><div class="panel-hd-btns"><button id="panel-save-hd" onclick="savePanel()">Save</button><button id="panel-close" onclick="closePanel()">✕</button></div></div>
  <div id="panel-body"></div>
</div>

<!-- Event Picker Modal -->
<div id="modal-overlay">
  <div class="modal">
    <h3>Assign to Event</h3>
    <p class="modal-desc">Green = open · Amber = open but another card has it as a tentative date · Gray/strikethrough = already has a speaker. Click an open date to select, then Assign.</p>
    <div id="event-list"><p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p></div>
    <div class="modal-btns">
      <button class="pbtn" onclick="confirmAssign()">Assign</button>
      <button class="pbtn sec" onclick="closeModal()">Cancel</button>
    </div>
    <div class="pmsg" id="modal-msg"></div>
  </div>
</div>

<script>
var currentUser='',allCards=[],members=[],statuses=[],statusLabels={},upcomingMeetings=[],assigneeFilter='';
var panelRow=null,selectedEventsRow=null;
var AI_ENABLED=__AI_ENABLED__; // server-injected feature flag
function gs(fn,a){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a);})}
function gs3(fn,a,b,c){return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(fail)[fn](a,b,c);})}
function doLogin(){
  var name=document.getElementById('auth-name').value.trim();
  var pw=document.getElementById('auth-pw').value;
  if(!name){document.getElementById('auth-err').textContent='Enter your name.';return;}
  gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){localStorage.setItem('pipelinePw',pw);localStorage.setItem('pipelineName',name);
      currentUser=name;document.getElementById('auth').style.display='none';loadData();}
    else{document.getElementById('auth-err').textContent='Wrong password. (Set KANBAN_PASSWORD in Script Properties if not done yet.)';}
  }).catch(function(err){document.getElementById('auth-err').textContent='Error: '+(err.message||String(err));});
}
window.addEventListener('load',function(){
  var pw=localStorage.getItem('pipelinePw'),name=localStorage.getItem('pipelineName');
  if(pw&&name){gs('checkPipelinePassword',pw).then(function(ok){
    if(ok){currentUser=name;document.getElementById('auth').style.display='none';loadData();}
    else{localStorage.removeItem('pipelinePw');}
  }).catch(function(){localStorage.removeItem('pipelinePw');});}
  document.getElementById('auth-pw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
  var ai=document.getElementById('ai-input');
  if(ai)ai.addEventListener('keydown',function(e){if(e.key==='Enter')aiSubmit();});
  if(AI_ENABLED){var b=document.getElementById('ai-bar');if(b)b.style.display='';}
});
async function loadData(){
  try{
    var r=await Promise.all([gs('getPipelineData',null),gs('getUpcomingEventsForPicker',null)]);
    allCards=r[0].cards;members=r[0].members||[];statuses=r[0].statuses;statusLabels=r[0].statusLabels;upcomingMeetings=r[1]||[];
    populateAssigneeFilter();render();
  }catch(e){
    document.getElementById('content').innerHTML=
      '<p style="color:#b91c1c;padding:1.2em">⚠️ '+e.message+
      '<br><br>Run <strong>Setup Speaker Pipeline Tab</strong> from the Rotary Sync menu in the spreadsheet, then reload.</p>';
  }
}
// Compact, date-sorted calendar sidebar (next 12 meetings; open vs. booked).
function buildCalSidebar(){
  var ms=upcomingMeetings.slice().sort(function(a,b){return a.date<b.date?-1:(a.date>b.date?1:0);}).slice(0,12);
  if(!ms.length) return '<h2>📅 Upcoming</h2><div class="cal-empty">No upcoming meetings.</div>';
  var filled=ms.filter(function(m){return !m.available;}).length;
  // Map open meeting dates -> pipeline speakers eyeing them (tentative), so an
  // open slot shows who is being considered for it (mirrors the Kanban board).
  var tentByDate={};
  allCards.forEach(function(c){
    if(c.status==='scheduled'||c.status==='declined'||c.status==='deleted')return;
    if(!c.tentativeDate)return;
    (tentByDate[c.tentativeDate]=tentByDate[c.tentativeDate]||[]).push(c.speakerName||'(no name)');
  });
  var rows=ms.map(function(m){
    var d=String(m.dateLabel||'').split(',')[0]||m.date;
    var tent=tentByDate[m.date]||[];
    var second=m.available
      ? (tent.length?'<span class="cal-tent">⭐ '+esc(tent.join(', '))+' (tentative)</span>':'<span class="cal-open">— open —</span>')
      : '<span class="cal-spk">'+esc(m.mainSpeaker)+'</span>';
    return '<div class="cal-item"><span class="cal-date">'+esc(d)+(m.time?' '+esc(m.time):'')+'</span>'+second+'</div>';
  }).join('');
  return '<h2>📅 Upcoming <span class="cal-tot" title="'+filled+' of '+ms.length+' have a speaker">'+filled+'/'+ms.length+'</span></h2>'+rows;
}
// Change a card's stage from the status list (no dragging needed).
function setStage(ro,val){
  var card=allCards.find(function(c){return c.rowIndex===ro;});
  if(!card||card.status===val)return;
  card.status=val;render();
  gs3('savePipelineCard',ro,{status:val},currentUser).catch(function(e){alert('Save failed: '+e.message);loadData();});
}

// ── AI command line (Gemini; proposes via a confirm dialog) ───
function aiSubmit(){
  var inp=document.getElementById('ai-input');
  var t=(inp.value||'').trim();
  if(!t)return;
  var go=document.getElementById('ai-go');
  go.disabled=true;go.textContent='…';
  gs3('pipelineAssistantCommand',t,currentUser).then(function(res){
    go.disabled=false;go.textContent='Ask';
    if(res&&res.error){alert('⚠️ '+res.error);return;}
    var actions=(res&&res.actions)||[];
    if(!actions.length){alert((res&&res.message)||'I could not find a matching change. Try the speaker’s exact name.');return;}
    var summary=actions.map(function(a){return '• '+a.description;}).join('\\n');
    if(!confirm('Apply these changes?\\n\\n'+summary))return;
    go.disabled=true;go.textContent='…';
    gs3('applyPipelineActions',actions,currentUser).then(function(){
      go.disabled=false;go.textContent='Ask';inp.value='';
      loadData();
    }).catch(function(e){go.disabled=false;go.textContent='Ask';alert('Apply failed: '+(e.message||e));});
  }).catch(function(e){go.disabled=false;go.textContent='Ask';alert('Error: '+(e.message||e));});
}
function render(){
  var sections=[
    {key:'new',         icon:'💡',desc:'New lead — not yet contacted'},
    {key:'in-progress', icon:'📞',desc:'Actively working on it (incl. speakers who have agreed)'},
    {key:'scheduled',   icon:'🗓️',desc:'Booked on the calendar'},
    {key:'done',        icon:'🎤',desc:'Recently presented'},
    {key:'limbo',       icon:'⏳',desc:'Waiting / stalled'},
  ];
  var stageOpts=statuses.filter(function(s){return s!=='deleted';});
  var main='';
  sections.forEach(function(sec){
    var cards=allCards.filter(function(c){return c.status===sec.key&&matchAssignee(c);});
    if(sec.key==='new') cards=cards.slice().sort(function(a,b){return b.rowIndex-a.rowIndex;});
    main+='<div class="section"><div class="sec-hd">'+sec.icon+' '+(statusLabels[sec.key]||sec.key)+
      '<span class="sec-count">'+cards.length+'</span></div>';
    if(sec.desc) main+='<div class="sec-desc">'+esc(sec.desc)+'</div>';
    if(!cards.length){main+='<div class="empty">None at this stage</div></div>';return;}
    cards.forEach(function(card){
      var stageSel='<div class="stage-row"><span class="stage-lbl">Stage:</span>'+
        '<select class="stage-sel" onchange="setStage('+card.rowIndex+',this.value)">'+
          stageOpts.map(function(s){return '<option value="'+s+'"'+(s===card.status?' selected':'')+'>'+esc(statusLabels[s]||s)+'</option>';}).join('')+
        '</select></div>';
      main+='<div class="card">'+
        '<div class="card-left">'+
          '<div class="card-name card-open" title="Open full details" onclick="openPanel('+card.rowIndex+')"><span class="who-lbl">Speaker:</span> '+esc(card.speakerName||'(no name)')+' <span class="open-hint">✎ details</span></div>'+
          (card.requestorName?'<div class="card-sub"><span class="who-lbl">Requestor:</span> '+esc(card.requestorName)+'</div>':'')+
          (card.assignedTo?'<div class="card-sub"><span class="who-lbl">Manager:</span> '+esc(card.assignedTo)+'</div>':'')+
          (card.topic?'<div class="card-topic">'+esc(card.topic)+'</div>':'')+
          '<div class="card-meta">'+
            (card.tentativeDate?'<span>📅 '+esc(card.tentativeDate)+((card.status!=='scheduled'&&card.status!=='done')?' (tentative)':'')+'</span>':'')+
            (card.speakerCity?'<span>📍 '+esc(card.speakerCity)+'</span>':'')+
            '<span class="badge badge-'+card.source+'">'+card.source+'</span>'+
            (card.priority?'<span class="badge priority-'+card.priority.toLowerCase()+'">'+esc(card.priority)+'</span>':'')+
            (card.isRotarian?'<span class="badge" style="background:#e0e7ff;color:#3730a3">Rotarian</span>':'')+
            (card.isLocal?'<span class="badge" style="background:#dcfce7;color:#166534">Local</span>':'')+
            (card.fundraisingLiterature?'<span class="badge" style="background:#fef9c3;color:#854d0e">&#9888; Fundraising lit.</span>':'')+
            voteHtml(card)+
          '</div>'+
          stageSel+
          (card.tags?'<div style="margin-top:4px">'+card.tags.split(',').map(function(t){t=t.trim();return t?'<span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:0.76em">'+esc(t)+'</span> ':''}).join('')+'</div>':'')+
          (card.notes?'<div class="card-notes">'+esc(card.notes)+'</div>':'')+
          '<div class="note-form">'+
            '<input type="text" id="note-'+card.rowIndex+'" placeholder="Add a note…">'+
            '<button onclick="addNote('+card.rowIndex+')">Add</button>'+
          '</div>'+
        '</div>'+
        (card.photoUrl?'<img src="'+esc(driveThumb(card.photoUrl,150))+'" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display=&#39;none&#39;">':'')+
      '</div>';
    });
    main+='</div>';
  });
  document.getElementById('content').innerHTML='<div id="layout"><aside id="cal-side">'+buildCalSidebar()+'</aside><div id="main">'+main+'</div></div>';
}
function driveThumb(u,size){if(!u)return'';var id='';var i=u.indexOf('id=');if(i>=0){id=u.substring(i+3).split('&')[0];}else{var j=u.indexOf('/d/');if(j>=0)id=u.substring(j+3).split('/')[0];}return id?'https://drive.google.com/thumbnail?id='+id+'&sz=w'+(size||200):u;}
async function addNote(ro){
  var inp=document.getElementById('note-'+ro);var text=inp.value.trim();if(!text)return;
  try{await gs3('appendPipelineNote',ro,text,currentUser);inp.value='';
    var d=await gs('getPipelineData',null);allCards=d.cards;render();}
  catch(e){alert('Note failed: '+e.message);}
}
function voteHtml(card){
  var names=card.interested?card.interested.split(',').map(function(n){return n.trim();}).filter(Boolean):[];
  var voted=names.indexOf(currentUser)!==-1;
  return '<span style="cursor:pointer;font-size:0.85em" title="Interest — members + public website hearts" onclick="vote('+card.rowIndex+')">'+(voted?'❤️':'🤍')+' '+(names.length+(card.hearts||0))+'</span>';
}
function vote(ro){
  gs3('togglePipelineVote',ro,currentUser).then(function(res){
    var card=allCards.find(function(c){return c.rowIndex===ro;});
    if(card)card.interested=res.interested;
    render();
  }).catch(function(e){alert('Vote failed: '+e.message);});
}
function populateAssigneeFilter(){
  var sel=document.getElementById('assignee-filter');if(!sel)return;
  var seen={};allCards.forEach(function(c){if(c.assignedTo)seen[c.assignedTo]=true;});
  var names=Object.keys(seen).sort();
  var html='<option value="">All assignees</option>';
  names.forEach(function(n){html+='<option value="'+esc(n)+'">'+esc(n)+'</option>';});
  html+='<option value="__UNASSIGNED__">— Unassigned —</option>';
  sel.innerHTML=html;sel.value=assigneeFilter;
}
function setAssignee(v){assigneeFilter=v;render();}
function matchAssignee(c){
  if(!assigneeFilter)return true;
  if(assigneeFilter==='__UNASSIGNED__')return !c.assignedTo;
  return c.assignedTo===assigneeFilter;
}
// ── Detail Panel (full editor, shared design with the Kanban view) ──
function openPanel(rowIndex){
  var card=allCards.find(function(c){return c.rowIndex===rowIndex;});
  if(!card)return;
  panelRow=rowIndex;
  var b=document.getElementById('panel-body');
  document.getElementById('panel-title').textContent=card.speakerName||'Speaker Detail';
  var memberOpts=[''].concat(members).map(function(m){return '<option value="'+esc(m)+'"'+(m===card.assignedTo?' selected':'')+'>'+esc(m||'— unassigned —')+'</option>';}).join('');
  var statusOpts=statuses.map(function(s){return '<option value="'+s+'"'+(s===card.status?' selected':'')+'>'+(statusLabels[s]||s)+'</option>';}).join('');
  b.innerHTML=
    '<div class="pfield"><label>Speaker Name</label><input id="pn-name" value="'+esc(card.speakerName)+'"></div>'+
    '<div class="pfield"><label>Topic</label><input id="pn-topic" value="'+esc(card.topic)+'"></div>'+
    '<div class="pfield"><label>Status</label><select id="pn-status">'+statusOpts+'</select></div>'+
    '<div class="pfield"><label>Priority</label><select id="pn-priority"><option value="">— none —</option><option value="Low">Low — Idea</option><option value="Medium">Medium — Recommended</option><option value="High">High — Strongly Recommended</option></select></div>'+
    '<div class="pfield"><label>Manager (Assigned To)</label><select id="pn-assigned">'+memberOpts+'</select></div>'+
    '<div class="pfield"><label>Tentative Date <span style="font-weight:normal;color:#888;font-size:0.9em">(open meeting dates)</span></label><select id="pn-date">'+buildDateOptions(card.tentativeDate)+'</select></div>'+
    '<div class="pfield"><label>Speaker Role</label><select id="pn-role"><option>Opening Speaker</option><option>Main Speaker</option><option>Either</option><option>Unsure</option></select></div>'+
    '<div class="pfield"><label>Email</label><input id="pn-email" value="'+esc(card.speakerEmail)+'"></div>'+
    '<div class="pfield"><label>Phone</label><input id="pn-phone" value="'+esc(card.speakerPhone)+'"></div>'+
    '<div class="pfield"><label>City</label><input id="pn-city" value="'+esc(card.speakerCity)+'"></div>'+
    '<div class="pfield"><label>Preferred Dates</label><input id="pn-pref" value="'+esc(card.preferredDates)+'"></div>'+
    '<div class="pfield"><label>Bio</label><textarea id="pn-bio" rows="3">'+esc(card.bio)+'</textarea></div>'+
    '<div class="pfield"><label>Summary <span style="font-weight:normal;color:#888;font-size:0.9em">(newsletter narrative)</span></label><textarea id="pn-summary" rows="3">'+esc(card.summary)+'</textarea></div>'+
    '<div class="pfield"><label>Speaker URL</label><input id="pn-url" value="'+esc(card.speakerUrl)+'" placeholder="https://…"></div>'+
    '<div class="pfield"><label>Introducer</label><input id="pn-introducer" value="'+esc(card.introducer)+'" placeholder="Who introduces the speaker"></div>'+
    '<div class="pfield"><label>Top Photo</label><input id="pn-phototop" value="'+esc(card.photoTop)+'" placeholder="paste an image URL, or upload below">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-phototop&#39;)">'+
      '<div id="pn-phototop-prev" class="photo-prev"></div></div>'+
    '<div class="pfield"><label>Bottom Photo</label><input id="pn-photobottom" value="'+esc(card.photoBottom)+'" placeholder="paste an image URL, or upload below">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;pn-photobottom&#39;)">'+
      '<div id="pn-photobottom-prev" class="photo-prev"></div></div>'+
    '<div class="pfield"><label>Tags <span style="font-weight:normal;color:#888;font-size:0.9em">(comma-separated)</span></label><input id="pn-tags" value="'+esc(card.tags)+'" placeholder="e.g. environment, local, tech"></div>'+
    '<div class="pfield"><label>Comments <span style="font-weight:normal;color:#888;font-size:0.9em">(internal — from the submitter)</span></label><textarea id="pn-comments" rows="2">'+esc(card.comments)+'</textarea></div>'+
    '<div class="pfield"><label>Format &amp; Speaker Details</label>'+
      '<div style="margin-top:0.4em">'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-zoom-only"> Zoom only (not in person)</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-rotarian"> Rotarian</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-is-local"> Local to Santa Cruz County</label>'+
        '<label style="font-weight:normal;display:block;margin-bottom:4px"><input type="checkbox" id="pn-fundraising"> May bring fundraising or donation materials</label>'+
      '</div></div>'+
    (card.requestorName?'<div class="pfield"><label>Submitted by</label><span style="font-size:0.88em">'+esc(card.requestorName)+' &lt;'+esc(card.requestorEmail)+'&gt;</span></div>':'')+
    (card.interested?'<div class="pfield"><label>Interested members</label><span style="font-size:0.88em">'+esc(card.interested)+'</span></div>':'')+
    '<button class="pbtn" onclick="savePanel()">Save</button>'+
    (['in-progress','limbo','scheduled'].indexOf(card.status)!==-1?'<button class="pbtn" style="background:#16a34a" onclick="openAssignModal()">Assign to Event</button>':'')+
    (card.status==='deleted'
      ?'<button class="pbtn sec" onclick="restoreCard()">↩︎ Restore</button><button class="pbtn danger" onclick="deleteCard()">🗑 Delete permanently</button>'
      :'<button class="pbtn danger" onclick="deleteCard()">🗑 Delete</button>')+
    '<div class="pmsg" id="panel-msg"></div>'+
    '<div class="sec-title">Notes</div>'+
    '<div class="notes-display" id="pn-notes-display">'+esc(card.notes)+'</div>'+
    '<div class="pfield"><label>Add Note</label><textarea id="pn-note-input" rows="2" placeholder="Type a note…"></textarea></div>'+
    '<button class="pbtn sec" onclick="panelAddNote()">Add Note</button>';
  document.getElementById('pn-role').value=card.speakerRole||'Main Speaker';
  document.getElementById('pn-priority').value=card.priority||'';
  document.getElementById('pn-zoom-only').checked=!!card.zoomOnly;
  document.getElementById('pn-is-rotarian').checked=!!card.isRotarian;
  document.getElementById('pn-is-local').checked=!!card.isLocal;
  document.getElementById('pn-fundraising').checked=!!card.fundraisingLiterature;
  showPhotoPreview('pn-phototop');showPhotoPreview('pn-photobottom');
  document.getElementById('panel').classList.add('open');
}
function closePanel(){document.getElementById('panel').classList.remove('open');panelRow=null;}
function buildDateOptions(cur){
  var opts='<option value="">— no date —</option>',found=false;
  upcomingMeetings.forEach(function(m){
    var isCur=(m.date===cur);if(isCur)found=true;
    var disabled=(!m.available&&!isCur)?' disabled':'';
    var label=m.available?(esc(m.dateLabel)+(m.time?' '+m.time:'')):(esc(m.dateLabel)+' — taken'+(m.mainSpeaker?' ('+esc(m.mainSpeaker)+')':''));
    opts+='<option value="'+esc(m.date)+'"'+(isCur?' selected':'')+disabled+'>'+label+'</option>';
  });
  if(cur&&!found)opts+='<option value="'+esc(cur)+'" selected>'+esc(cur)+' (custom)</option>';
  return opts;
}
function showPhotoPreview(inputId){
  var el=document.getElementById(inputId);if(!el)return;var v=el.value||'';
  var prev=document.getElementById(inputId+'-prev');if(!prev)return;
  prev.innerHTML=(v&&v.indexOf('http')===0)?'<img src="'+esc(driveThumb(v,250))+'" style="max-width:140px;max-height:140px;border-radius:4px;border:1px solid #ddd" onerror="this.style.display=&#39;none&#39;">':'';
}
async function uploadPhoto(input,targetId){
  var file=input.files[0];if(!file)return;
  var target=document.getElementById(targetId);var prev=document.getElementById(targetId+'-prev');
  if(file.size>8*1024*1024){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Image too large (max 8 MB)</span>';input.value='';return;}
  if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#888">Uploading…</span>';
  try{
    var dataUrl=await new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(ev){resolve(ev.target.result);};r.onerror=reject;r.readAsDataURL(file);});
    var speakerName=(document.getElementById('pn-name')||{}).value||'speaker';
    var res=await gs3('uploadPipelinePhoto',dataUrl,file.name,speakerName);
    target.value=res.url;showPhotoPreview(targetId);
  }catch(e){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Upload failed: '+(e.message||e)+'</span>';}
}
async function savePanel(){
  if(!panelRow)return;
  var msg=document.getElementById('panel-msg');
  var changes={
    speakerName:document.getElementById('pn-name').value.trim(),
    topic:document.getElementById('pn-topic').value.trim(),
    status:document.getElementById('pn-status').value,
    priority:document.getElementById('pn-priority').value,
    assignedTo:document.getElementById('pn-assigned').value,
    tentativeDate:document.getElementById('pn-date').value,
    speakerRole:document.getElementById('pn-role').value,
    speakerEmail:document.getElementById('pn-email').value.trim(),
    speakerPhone:document.getElementById('pn-phone').value.trim(),
    speakerCity:document.getElementById('pn-city').value.trim(),
    preferredDates:document.getElementById('pn-pref').value.trim(),
    bio:document.getElementById('pn-bio').value.trim(),
    summary:document.getElementById('pn-summary').value.trim(),
    speakerUrl:document.getElementById('pn-url').value.trim(),
    introducer:document.getElementById('pn-introducer').value.trim(),
    photoTop:document.getElementById('pn-phototop').value.trim(),
    photoBottom:document.getElementById('pn-photobottom').value.trim(),
    tags:document.getElementById('pn-tags').value.trim(),
    comments:document.getElementById('pn-comments').value.trim(),
    zoomOnly:document.getElementById('pn-zoom-only').checked?'Yes':'',
    isRotarian:document.getElementById('pn-is-rotarian').checked?'Yes':'',
    isLocal:document.getElementById('pn-is-local').checked?'Yes':'',
    fundraisingLiterature:document.getElementById('pn-fundraising').checked?'Yes':''
  };
  try{
    var res=await gs3('savePipelineCard',panelRow,changes,currentUser);
    var card=allCards.find(function(c){return c.rowIndex===panelRow;});
    if(card){
      Object.assign(card,changes);
      card.zoomOnly=changes.zoomOnly==='Yes';
      card.isRotarian=changes.isRotarian==='Yes';
      card.isLocal=changes.isLocal==='Yes';
      card.fundraisingLiterature=changes.fundraisingLiterature==='Yes';
    }
    if(res&&res.notes!=null){if(card)card.notes=res.notes;var nd=document.getElementById('pn-notes-display');if(nd)nd.textContent=res.notes;}
    render();
    msg.className='pmsg ok';
    msg.textContent=(res&&res.noted)?'Saved ✓ ('+res.noted+' change'+(res.noted===1?'':'s')+' logged)':'Saved ✓';
    setTimeout(function(){msg.textContent='';},2500);
  }catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
}
async function panelAddNote(){
  if(!panelRow)return;
  var inp=document.getElementById('pn-note-input');var text=inp.value.trim();if(!text)return;
  try{
    await gs3('appendPipelineNote',panelRow,text,currentUser);inp.value='';
    var data=await gs('getPipelineData',null);
    var updated=data.cards.find(function(c){return c.rowIndex===panelRow;});
    var card=allCards.find(function(c){return c.rowIndex===panelRow;});
    if(updated&&card)card.notes=updated.notes;
    document.getElementById('pn-notes-display').textContent=updated?updated.notes:'';
    allCards=data.cards;render();
  }catch(e){alert('Note failed: '+e.message);}
}
async function deleteCard(){
  if(!panelRow)return;
  var card=allCards.find(function(c){return c.rowIndex===panelRow;});if(!card)return;
  var msg=document.getElementById('panel-msg');
  if(card.status==='deleted'){
    if(!confirm('Permanently delete this card? This removes the row and cannot be undone.'))return;
    try{await gs('deletePipelineCard',panelRow);closePanel();loadData();}
    catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
    return;
  }
  if(!confirm('Move this card to Deleted? You can restore it from the Kanban view.'))return;
  card.status='deleted';render();
  gs3('savePipelineCard',panelRow,{status:'deleted'},currentUser).catch(function(err){alert('Delete failed: '+err.message);loadData();});
  closePanel();
}
function restoreCard(){
  if(!panelRow)return;
  var card=allCards.find(function(c){return c.rowIndex===panelRow;});if(!card)return;
  card.status='new';render();
  gs3('savePipelineCard',panelRow,{status:'new'},currentUser).catch(function(err){alert('Restore failed: '+err.message);loadData();});
  closePanel();
}
// ── Assign-to-Event modal ────────────────────────────────────
async function openAssignModal(){
  selectedEventsRow=null;
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('modal-msg').textContent='';
  var list=document.getElementById('event-list');
  list.innerHTML='<p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p>';
  var events=await gs('getUpcomingEventsForPicker',null);
  if(!events.length){list.innerHTML='<p style="padding:0.6em;color:#888;font-size:0.85em">No upcoming meetings found.</p>';return;}
  var tentMap={};
  allCards.forEach(function(c){
    if(c.status==='declined'||c.status==='scheduled')return;
    if(c.rowIndex===panelRow)return;
    if(!c.tentativeDate)return;
    (tentMap[c.tentativeDate]=tentMap[c.tentativeDate]||[]).push(c.speakerName||'(no name)');
  });
  list.innerHTML='';
  events.forEach(function(ev){
    var tentNames=tentMap[ev.date]||[];
    var div=document.createElement('div');
    var cls=ev.available?(tentNames.length?'available tentative':'available'):'taken';
    div.className='ev-item '+cls;div.dataset.row=ev.rowIndex;
    var speakerHtml;
    if(!ev.available){speakerHtml='<span class="ev-speaker">'+esc(ev.mainSpeaker)+(ev.mainTopic?': '+esc(ev.mainTopic):'')+'</span>';}
    else if(tentNames.length){speakerHtml='<span class="ev-tentative">⚠️ tentative: '+esc(tentNames.join(', '))+'</span>';}
    else{speakerHtml='<span class="ev-open">open</span>';}
    div.innerHTML='<span class="ev-date">'+esc(ev.dateLabel)+'</span><span class="ev-type">'+esc(ev.eventType)+(ev.time?' '+ev.time:'')+'</span>'+speakerHtml;
    if(ev.available){div.addEventListener('click',function(){list.querySelectorAll('.ev-item').forEach(function(el){el.classList.remove('selected');});div.classList.add('selected');selectedEventsRow=ev.rowIndex;});}
    list.appendChild(div);
  });
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show');selectedEventsRow=null;}
async function confirmAssign(){
  if(!selectedEventsRow||!panelRow){document.getElementById('modal-msg').textContent='Please select an available date first.';return;}
  var msg=document.getElementById('modal-msg');
  try{
    var res=await gs3('assignSpeakerToEvent',panelRow,selectedEventsRow,currentUser);
    msg.className='pmsg ok';msg.textContent='✓ Assigned '+res.speakerName;
    await loadData();
    setTimeout(function(){closeModal();closePanel();},1500);
  }catch(e){msg.className='pmsg err';msg.textContent='Error: '+e.message;}
}
function logout(){localStorage.removeItem('pipelinePw');localStorage.removeItem('pipelineName');location.reload();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
</script>
</body>
</html>`;
}
