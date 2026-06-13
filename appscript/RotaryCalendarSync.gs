// ============================================================
//  ROTARY CALENDAR <-> GOOGLE SHEETS SYNC
//  Paste this entire file into Extensions > Apps Script in your Sheet
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
const CALENDAR_ID   = "primary"; // <-- CHANGE THIS to your calendar ID
const PULL_DAYS_AHEAD = 180;     // how many days ahead to pull
const SHEET_NAME    = "Events";

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
};

const NUM_COLS = 31;

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
const PIPELINE_STATUSES = ['new', 'in-progress', 'limbo', 'confirmed', 'scheduled', 'done', 'declined'];
const PIPELINE_STATUS_LABELS = {
  new: 'New', 'in-progress': 'In Progress', limbo: 'Limbo',
  confirmed: 'Confirmed', scheduled: 'Scheduled', done: 'Done ✓', declined: 'Declined',
};

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
};
const NUM_PIPE_COLS = 34;

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
    .addItem("⚡  Install Edit Trigger (run once)", "installEditTrigger")
    .addToUi();
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
  ];

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
  const inject = (html) => html.replace(/__EXEC_URL__/g, execUrl);
  if (app === 'assistant') {
    return HtmlService.createHtmlOutput(getCalendarAssistantHtml())
      .setTitle("SLV Rotary — Calendar Assistant").setXFrameOptionsMode(mode);
  }
  if (app === 'kanban') {
    return HtmlService.createHtmlOutput(inject(getKanbanHtml()))
      .setTitle("SLV Rotary — Speaker Pipeline (Kanban)").setXFrameOptionsMode(mode);
  }
  if (app === 'pipeline') {
    return HtmlService.createHtmlOutput(inject(getPipelineTableHtml()))
      .setTitle("SLV Rotary — Speaker Pipeline (Table)").setXFrameOptionsMode(mode);
  }
  if (app === 'speaker-pipeline') {
    return HtmlService.createHtmlOutput(inject(getSpeakerStatusHtml()))
      .setTitle("SLV Rotary — Speaker Pipeline Status").setXFrameOptionsMode(mode);
  }
  return HtmlService.createHtmlOutput(getDutyEditorHtml())
    .setTitle("SLV Rotary — Duty Editor").setXFrameOptionsMode(mode);
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
    ];
    boolFields.forEach(function (k) { p[k] = p[k] === "true"; });

    if (action === "speakerRequest") return handleSpeakerRequest_(p);
    if (action === "speakerOffer")   return handleSpeakerOffer_(p);
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

function handleSpeakerRequest_(data) {
  const photoUrl = savePhotoToDrive_(data);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy h:mm a");
  const sheet = getPipelineSheet_();
  const row = buildPipelineRow_('request', data, photoUrl, ts);
  sheet.appendRow(row);
  return jsonOut_({ ok: true });
}

function handleSpeakerOffer_(data) {
  const photoUrl = savePhotoToDrive_(data);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy h:mm a");
  const sheet = getPipelineSheet_();
  const row = buildPipelineRow_('offer', data, photoUrl, ts);
  sheet.appendRow(row);
  return jsonOut_({ ok: true });
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

/**
 * Main AI function. Runs the tool-use loop and returns either a plain message
 * or a proposal (pending changes for the user to confirm).
 * Called from the client via google.script.run.
 */
function processMessage(history) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) return { error: 'ANTHROPIC_API_KEY not set. Add it in Apps Script → Project Settings → Script Properties.' };

    const messages = history.slice();
    const pending  = [];

    for (let iter = 0; iter < 20; iter++) {
      const resp = callAssistantApi_(messages);
      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason === 'end_turn') {
        const text = resp.content
          .filter(function(b) { return b.type === 'text'; })
          .map(function(b) { return b.text; })
          .join('\n').trim();
        return { type: pending.length ? 'proposal' : 'message', text: text, pending: pending, updatedHistory: messages };
      }

      // Process tool calls
      const toolResults = [];
      for (var ti = 0; ti < resp.content.length; ti++) {
        const block = resp.content[ti];
        if (block.type !== 'tool_use') continue;
        const inp = block.input;
        let result;

        if (block.name === 'read_events') {
          result = assistantReadEvents_(inp.filter);
        } else if (block.name === 'read_members') {
          result = assistantReadMembers_();
        } else if (block.name === 'add_event') {
          pending.push({ action: 'add', data: inp,
            description: '➕ Add ' + (inp.eventType || 'event') + ' on ' + inp.date + (inp.time ? ' at ' + inp.time : '') });
          result = { queued: true, index: pending.length - 1 };
        } else if (block.name === 'update_event') {
          const fields = Object.keys(inp.changes || {}).join(', ');
          pending.push({ action: 'update', rowIndex: inp.rowIndex, changes: inp.changes,
            description: '✏️ ' + (inp.reason || 'Update row ' + inp.rowIndex) + (fields ? ' (' + fields + ')' : '') });
          result = { queued: true, index: pending.length - 1 };
        } else if (block.name === 'cancel_event') {
          pending.push({ action: 'cancel', rowIndex: inp.rowIndex,
            description: '🚫 Cancel event at row ' + inp.rowIndex + (inp.reason ? ' — ' + inp.reason : '') });
          result = { queued: true, index: pending.length - 1 };
        } else if (block.name === 'delete_event') {
          pending.push({ action: 'delete', rowIndex: inp.rowIndex,
            description: '🗑️ Delete row ' + inp.rowIndex + (inp.reason ? ' — ' + inp.reason : '') });
          result = { queued: true, index: pending.length - 1 };
        } else {
          result = { error: 'Unknown tool: ' + block.name };
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return { error: 'Reached maximum iterations without completing.' };
  } catch (err) {
    return { error: String(err) };
  }
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
'<header><h1>📅 SLV Rotary — Calendar Assistant</h1><button id="snap-btn" onclick="takeSnapshot()">📸 Snapshot</button></header>\n' +
'<div id="chat"><div class="msg note">Hi Eric! Describe what you\'d like to add, move, update, or cancel. I\'ll show you a plan before changing anything.  <em>Ctrl+Enter to send</em></div></div>\n' +
'<div id="proposal"><h3>📋 Proposed changes — please review before applying</h3><div id="prop-list"></div><div class="pbtns"><button id="apply-btn" onclick="applyChanges()">✅ Apply changes</button><button id="discard-btn" onclick="discardChanges()">✗ Discard</button></div></div>\n' +
'<div id="input-row"><textarea id="user-input" placeholder="e.g. Add board meeting every first Thursday at 7pm at Scopazzis, July through June…"></textarea><button id="send-btn" onclick="sendMessage()">➤</button></div>\n' +
'<script>\n' +
'var chatHistory = [], pending = null, busy = false;\n' +
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
'  chatHistory.push({ role: "user", content: txt });\n' +
'  setTyping(true);\n' +
'  try {\n' +
'    var res = await gs("processMessage", chatHistory);\n' +
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
'    chatHistory.push({ role: "user", content: "Changes were applied successfully." });\n' +
'    chatHistory.push({ role: "assistant", content: [{ type: "text", text: msg }] });\n' +
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
                     280,300,150,220];
  colWidths.forEach((w,i) => sheet.setColumnWidth(i+1, w));
  sheet.setColumnWidth(CP.BIO, 300);
  sheet.setColumnWidth(CP.NOTES, 300);

  try { SpreadsheetApp.getUi().alert('Speaker Pipeline tab is ready!'); } catch(_) {}
}

function openSpeakerPipeline() {
  let url;
  try { url = ScriptApp.getService().getUrl(); } catch(_) { url = null; }
  if (!url) { SpreadsheetApp.getUi().alert('Deploy the web app first.'); return; }
  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Opening Speaker Pipeline…</p>' +
    '<script>window.open("' + url + '?app=kanban","_blank");google.script.host.close();</script>'
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
        status:            String(row[CP.STATUS - 1]              || 'new'),
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
  };
  const labelMap = {
    status: 'Status', speakerName: 'Speaker', speakerEmail: 'Email', speakerPhone: 'Phone',
    speakerCity: 'City', topic: 'Topic', speakerRole: 'Role', assignedTo: 'Assigned to',
    preferredDates: 'Preferred dates', tentativeDate: 'Date', speakerUrl: 'Speaker URL',
    introducer: 'Introducer', tags: 'Tags', comments: 'Comments', bio: 'Bio',
    summary: 'Summary', photoTop: 'Top photo', photoBottom: 'Bottom photo',
    photoUrl: 'Photo', eventsRow: 'Events row',
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
.card-topic{color:#444;font-size:0.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-meta{color:#888;font-size:0.8em;margin-top:3px;display:flex;gap:0.4em;flex-wrap:wrap}
.badge{background:#e8eaf0;border-radius:3px;padding:1px 5px;font-size:0.78em}
.badge.offer{background:#d1fae5;color:#065f46}
.badge.request{background:#dbeafe;color:#1e3a8a}
.badge.manual{background:#f3f4f6;color:#555}
/* Status column colors */
.hd-new{background:#6b7280}
.hd-in-progress{background:#2563eb}
.hd-limbo{background:#9333ea}
.hd-confirmed{background:#d97706}
.hd-scheduled{background:#16a34a}
.hd-done{background:#059669}
.hd-declined{background:#dc2626}
/* Panel */
#panel{position:fixed;right:-420px;top:0;width:420px;height:100%;background:#fff;box-shadow:-3px 0 16px rgba(0,0,0,0.12);transition:right 0.2s;display:flex;flex-direction:column;z-index:100}
#panel.open{right:0}
#panel-hd{background:#17458F;color:#fff;padding:0.7em 1em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#panel-hd h2{font-size:1em}
#panel-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;line-height:1}
#panel-body{flex:1;overflow-y:auto;padding:1em}
.pfield{margin-bottom:0.7em}
.pfield label{display:block;font-weight:bold;color:#17458F;font-size:0.82em;margin-bottom:2px}
.pfield input,.pfield textarea,.pfield select{width:100%;padding:5px 7px;border:1px solid #ccc;border-radius:4px;font-size:0.88em;font-family:Arial,sans-serif}
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
/* Modal */
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
.ev-date{font-weight:bold;white-space:nowrap;min-width:130px}
.ev-type{color:#6b7280;font-size:0.9em}
.ev-speaker{color:#b91c1c;font-size:0.85em;margin-left:auto}
.ev-open{color:#16a34a;font-size:0.85em;margin-left:auto}
.modal-btns{display:flex;gap:0.5em}
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
  <a class="hbtn" href="https://rotary.porttack.com/request/" target="_blank">+ Request Speaker</a>
  <button class="hbtn" onclick="toggleDeclined()">Declined</button>
  <a href="__EXEC_URL__?app=pipeline" target="_top" class="hbtn">Table →</a>
  <a href="__EXEC_URL__?app=speaker-pipeline" target="_top" class="hbtn">Status →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="board"></div>

<!-- Detail Panel -->
<div id="panel">
  <div id="panel-hd"><h2 id="panel-title">Speaker Detail</h2><button id="panel-close" onclick="closePanel()">✕</button></div>
  <div id="panel-body"></div>
</div>

<!-- Event Picker Modal -->
<div id="modal-overlay">
  <div class="modal">
    <h3>Assign to Event</h3>
    <p class="modal-desc">Green = open slot. Gray/strikethrough = already has a speaker. Click to select, then Assign.</p>
    <div id="event-list"><p style="padding:0.6em;color:#888;font-size:0.85em">Loading…</p></div>
    <div class="modal-btns">
      <button class="pbtn" onclick="confirmAssign()">Assign</button>
      <button class="pbtn sec" onclick="closeModal()">Cancel</button>
    </div>
    <div class="pmsg" id="modal-msg"></div>
  </div>
</div>

<script>
var currentUser = '', allCards = [], members = [], statuses = [], statusLabels = {};
var panelRow = null, showDeclined = false, upcomingMeetings = [], dateConflicts = {};

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
});

// ── Board ─────────────────────────────────────────────────────
async function loadBoard() {
  try {
    var data = await gs('getPipelineData', null);
    allCards = data.cards;
    members  = data.members;
    statuses = data.statuses;
    statusLabels = data.statusLabels;
    upcomingMeetings = await gs('getUpcomingEventsForPicker', null);
    renderBoard();
  } catch(e) {
    document.getElementById('board').innerHTML =
      '<p style="color:#b91c1c;padding:1.2em;font-family:Arial,sans-serif">⚠️ ' + e.message +
      '<br><br>Run <strong>Setup Speaker Pipeline Tab</strong> from the Rotary Sync menu in the spreadsheet, then reload.</p>';
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

function renderBoard() {
  computeConflicts();
  var board = document.getElementById('board');
  board.innerHTML = '';
  var visibleStatuses = statuses.filter(function(s) { return showDeclined || s !== 'declined'; });
  visibleStatuses.forEach(function(status) {
    var cards = allCards.filter(function(c) { return c.status === status; });
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
  var dateBlock = dateStr
    ? '<div class="card-date' + (isConflict ? ' conflict' : '') + '"' +
        (isConflict ? ' title="Same date as: ' + esc(others.join(', ')) + '"' : '') + '>📅 ' +
        esc(fmtMonthDay(dateStr)) + (isConflict ? ' ⚠️ conflict' : '') + '</div>'
    : '';
  var thumb = '';
  if (card.photoTop) {
    div.className += ' has-thumb';
    thumb = '<img class="card-thumb" src="' + esc(driveThumb(card.photoTop, 120)) + '" onerror="this.style.display=&#39;none&#39;">';
  }
  div.innerHTML =
    thumb +
    dateBlock +
    '<div class="card-name">' + esc(card.speakerName || '(no name)') + '</div>' +
    '<div class="card-topic">' + esc(card.topic || '—') + '</div>' +
    '<div class="card-meta">' +
      '<span class="badge ' + card.source + '">' + card.source + '</span>' +
      (card.assignedTo ? '<span class="badge">👤 ' + esc(card.assignedTo) + '</span>' : '') +
    '</div>' +
    (tagChips ? '<div class="card-tags">' + tagChips + '</div>' : '') +
    '<div class="vote-row">' +
      '<button class="vote-btn' + (iVoted ? ' voted' : '') + '" data-row="' + card.rowIndex + '">' +
        (iVoted ? '❤️' : '🤍') + ' ' + interestedNames.length +
      '</button>' +
    '</div>';
  div.addEventListener('click', function(e) {
    if (e.target.closest('.vote-btn')) return; // vote button handles its own click
    openPanel(card.rowIndex);
  });
  div.querySelector('.vote-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    gs3('togglePipelineVote', card.rowIndex, currentUser).then(function(res) {
      card.interested = res.interested;
      var btn = div.querySelector('.vote-btn');
      var names = res.interested ? res.interested.split(',').map(function(n){return n.trim();}).filter(Boolean) : [];
      var voted = names.indexOf(currentUser) !== -1;
      btn.className = 'vote-btn' + (voted ? ' voted' : '');
      btn.textContent = (voted ? '❤️' : '🤍') + ' ' + names.length;
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
    '<div class="pfield"><label>Assigned To</label>' +
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
    ((card.zoomOnly || card.availMorning || card.availEvening) ?
      '<div class="pfield"><label>Availability / Format</label><span style="font-size:0.88em">' +
        [card.availMorning ? 'Mornings' : '', card.availEvening ? 'Evenings' : '', card.zoomOnly ? '💻 Zoom only (not in person)' : '']
          .filter(Boolean).join(' · ') + '</span></div>' : '') +
    (card.requestorName ? '<div class="pfield"><label>Submitted by</label><span style="font-size:0.88em">' + esc(card.requestorName) + ' &lt;' + esc(card.requestorEmail) + '&gt;</span></div>' : '') +
    (card.interested ? '<div class="pfield"><label>Interested members</label><span style="font-size:0.88em">' + esc(card.interested) + '</span></div>' : '') +
    '<button class="pbtn" onclick="savePanel()">Save</button>' +
    (card.status === 'confirmed' || card.status === 'scheduled' ?
      '<button class="pbtn" style="background:#16a34a" onclick="openAssignModal()">Assign to Event</button>' : '') +
    '<div class="pmsg" id="panel-msg"></div>' +
    '<div class="sec-title">Notes</div>' +
    '<div class="notes-display" id="pn-notes-display">' + esc(card.notes) + '</div>' +
    '<div class="pfield"><label>Add Note</label>' +
      '<textarea id="pn-note-input" rows="2" placeholder="Type a note…"></textarea></div>' +
    '<button class="pbtn sec" onclick="addNote()">Add Note</button>';

  document.getElementById('pn-role').value = card.speakerRole || 'Main Speaker';
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
  };
  try {
    var res = await gs3('savePipelineCard', panelRow, changes, currentUser);
    var card = allCards.find(function(c) { return c.rowIndex === panelRow; });
    if (card) Object.assign(card, changes);
    if (res && res.notes != null) {
      if (card) card.notes = res.notes;
      var nd = document.getElementById('pn-notes-display');
      if (nd) nd.textContent = res.notes;
    }
    renderBoard();
    msg.className = 'pmsg ok';
    msg.textContent = (res && res.noted) ? 'Saved ✓ (' + res.noted + ' change' + (res.noted === 1 ? '' : 's') + ' logged)' : 'Saved ✓';
    setTimeout(function() { msg.textContent = ''; }, 2500);
  } catch(e) { msg.className = 'pmsg err'; msg.textContent = 'Error: ' + e.message; }
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
  list.innerHTML = '';
  events.forEach(function(ev) {
    var div = document.createElement('div');
    div.className = 'ev-item ' + (ev.available ? 'available' : 'taken');
    div.dataset.row = ev.rowIndex;
    var speakerHtml = ev.available
      ? '<span class="ev-open">open</span>'
      : '<span class="ev-speaker">' + esc(ev.mainSpeaker) + (ev.mainTopic ? ': ' + esc(ev.mainTopic) : '') + '</span>';
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

function toggleDeclined() { showDeclined = !showDeclined; renderBoard(); }

function logout() {
  localStorage.removeItem('pipelinePw');
  localStorage.removeItem('pipelineName');
  location.reload();
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
.vote-cell{color:#888;font-size:0.85em}
.expand-row td{background:#f8faff!important;padding:0}
.expand-inner{padding:0.8em 1em;display:grid;grid-template-columns:1fr 1fr;gap:0.5em 1.5em}
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
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:10px;padding:2em;width:300px;text-align:center}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
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
  <a href="__EXEC_URL__?app=speaker-pipeline" target="_top" class="hbtn">Status →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="toolbar">
  <input type="text" id="search" placeholder="Search name / topic…" oninput="renderTable()">
  <span style="font-size:0.82em;color:#666">Filter:</span>
  <button class="filter-btn active" onclick="setFilter('all',this)">All</button>
  <button class="filter-btn" onclick="setFilter('new',this)">New</button>
  <button class="filter-btn" onclick="setFilter('in-progress',this)">In Progress</button>
  <button class="filter-btn" onclick="setFilter('limbo',this)">Limbo</button>
  <button class="filter-btn" onclick="setFilter('confirmed',this)">Confirmed</button>
  <button class="filter-btn" onclick="setFilter('scheduled',this)">Scheduled</button>
  <button class="filter-btn" onclick="setFilter('done',this)">Done</button>
</div>
<div id="content"><p style="color:#888;padding:1em">Loading…</p></div>
<script>
var currentUser='',allCards=[],members=[],statuses=[],statusLabels={};
var filterStatus='all',expandedRow=null,sortCol='updatedAt',sortAsc=false,upcomingMeetings=[];
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
});
async function loadData(){
  try{
    var d=await gs('getPipelineData',null);
    allCards=d.cards;members=d.members;statuses=d.statuses;statusLabels=d.statusLabels;
    upcomingMeetings=await gs('getUpcomingEventsForPicker',null);renderTable();
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
function renderTable(){
  var q=(document.getElementById('search').value||'').toLowerCase();
  var rows=allCards.filter(function(c){
    if(filterStatus!=='all'&&c.status!==filterStatus)return false;
    if(filterStatus==='all'&&c.status==='declined')return false;
    if(q&&!(c.speakerName+c.topic+c.assignedTo).toLowerCase().includes(q))return false;
    return true;
  });
  rows.sort(function(a,b){var av=a[sortCol]||'',bv=b[sortCol]||'';return sortAsc?(av>bv?1:-1):(av<bv?1:-1);});
  var content=document.getElementById('content');
  if(!rows.length){content.innerHTML='<p style="color:#888;padding:1em">No matching speakers.</p>';return;}
  var memberOpts=[''].concat(members).map(function(m){return'<option value="'+esc(m)+'">'+esc(m||'— unassigned —')+'</option>';}).join('');
  var statusOpts=statuses.map(function(s){return'<option value="'+s+'">'+(statusLabels[s]||s)+'</option>';}).join('');
  var cols=['speakerName','topic','status','assignedTo','tentativeDate','interested','source','updatedAt'];
  var colLabels={speakerName:'Speaker',topic:'Topic',status:'Status',assignedTo:'Assigned',tentativeDate:'Date',interested:'♡',source:'Source',updatedAt:'Updated'};
  var html='<table><thead><tr>'+cols.map(function(c){
    return'<th onclick="sortBy(&#39;'+c+'&#39;)">'+(colLabels[c]||c)+(sortCol===c?(sortAsc?' ▲':' ▼'):'')+'</th>';
  }).join('')+'</tr></thead><tbody id="tbody"></tbody></table>';
  content.innerHTML=html;
  var tbody=document.getElementById('tbody');
  rows.forEach(function(card){
    var tr=document.createElement('tr');tr.style.cursor='pointer';
    var intNames=card.interested?card.interested.split(',').map(function(n){return n.trim();}).filter(Boolean):[];
    var iVoted=intNames.indexOf(currentUser)!==-1;
    tr.innerHTML='<td><strong>'+esc(card.speakerName||'(no name)')+'</strong>'+
      (card.tags?'<br>'+card.tags.split(',').map(function(t){t=t.trim();return t?'<span class="tag-chip">'+esc(t)+'</span>':''}).join(''):'')+'</td>'+
      '<td>'+esc(card.topic||'—')+'</td>'+
      '<td><span class="tag tag-'+card.status.replace('-','_')+'">'+esc(statusLabels[card.status]||card.status)+'</span></td>'+
      '<td>'+esc(card.assignedTo||'—')+'</td><td>'+esc(card.tentativeDate||'—')+'</td>'+
      '<td class="vote-cell"><button style="background:none;border:none;cursor:pointer;font-size:0.9em" onclick="voteRow(event,'+card.rowIndex+')">'+(iVoted?'❤️':'🤍')+'</button> '+intNames.length+'</td>'+
      '<td><span class="tag tag-'+card.source+'">'+card.source+'</span></td>'+
      '<td style="color:#888;font-size:0.8em">'+esc(card.updatedAt||'')+'</td>';
    tr.addEventListener('click',function(){
      expandedRow=(expandedRow===card.rowIndex)?null:card.rowIndex;renderTable();
    });
    tbody.appendChild(tr);
    if(expandedRow===card.rowIndex){tbody.appendChild(buildExpandRow(card,memberOpts,statusOpts));}
  });
}
function buildExpandRow(card,memberOpts,statusOpts){
  var tr=document.createElement('tr');tr.className='expand-row';
  var ro=card.rowIndex;
  tr.innerHTML='<td colspan="7"><div class="expand-inner">'+
    ef('Speaker Name','<input id="ef-name-'+ro+'" value="'+esc(card.speakerName)+'">')+
    ef('Topic','<input id="ef-topic-'+ro+'" value="'+esc(card.topic)+'">')+
    ef('Status','<select id="ef-status-'+ro+'">'+statusOpts+'</select>')+
    ef('Assigned To','<select id="ef-assigned-'+ro+'">'+memberOpts+'</select>')+
    ef('Tentative Date','<select id="ef-date-'+ro+'">'+buildDateOptions(card.tentativeDate)+'</select>')+
    ef('Email','<input id="ef-email-'+ro+'" value="'+esc(card.speakerEmail)+'">')+
    ef('Phone','<input id="ef-phone-'+ro+'" value="'+esc(card.speakerPhone)+'">')+
    ef('City','<input id="ef-city-'+ro+'" value="'+esc(card.speakerCity)+'">')+
    ef('Preferred Dates','<input id="ef-pref-'+ro+'" value="'+esc(card.preferredDates)+'">')+
    ef('Bio','<textarea id="ef-bio-'+ro+'" rows="3">'+esc(card.bio)+'</textarea>',true)+
    ef('Summary (newsletter)','<textarea id="ef-summary-'+ro+'" rows="3">'+esc(card.summary)+'</textarea>',true)+
    ef('Speaker URL','<input id="ef-url-'+ro+'" value="'+esc(card.speakerUrl)+'" placeholder="https://…">')+
    ef('Introducer','<input id="ef-introducer-'+ro+'" value="'+esc(card.introducer)+'">')+
    ef('Top Photo','<input id="ef-phototop-'+ro+'" value="'+esc(card.photoTop)+'" placeholder="paste URL or upload">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;ef-phototop-'+ro+'&#39;,'+ro+')">'+
      '<div id="ef-phototop-'+ro+'-prev" class="photo-prev"></div>',true)+
    ef('Bottom Photo','<input id="ef-photobottom-'+ro+'" value="'+esc(card.photoBottom)+'" placeholder="paste URL or upload">'+
      '<input type="file" accept="image/*" style="margin-top:4px;font-size:0.8em" onchange="uploadPhoto(this,&#39;ef-photobottom-'+ro+'&#39;,'+ro+')">'+
      '<div id="ef-photobottom-'+ro+'-prev" class="photo-prev"></div>',true)+
    ef('Notes','<div class="notes-log">'+esc(card.notes)+'</div>'+
      '<textarea id="ef-note-'+ro+'" rows="2" placeholder="Add a note…"></textarea>',true)+
    '<div class="row-btns">'+
      '<button class="btn btn-save" onclick="saveRow('+ro+')">Save</button>'+
      '<button class="btn btn-sec" onclick="addRowNote('+ro+')">Add Note</button>'+
      ((card.status==='confirmed'||card.status==='scheduled')?
        '<button class="btn btn-assign" onclick="assignRow('+ro+')">Assign to Event</button>':'')+
    '</div><div class="row-msg" id="ef-msg-'+ro+'"></div>'+
    '</div></td>';
  setTimeout(function(){
    var ss=document.getElementById('ef-status-'+ro);if(ss)ss.value=card.status;
    var sa=document.getElementById('ef-assigned-'+ro);if(sa)sa.value=card.assignedTo;
    showPhotoPreview('ef-phototop-'+ro);showPhotoPreview('ef-photobottom-'+ro);
  },0);
  return tr;
}
function ef(label,input,full){return'<div class="ef'+(full?' full':'')+'"><label>'+esc(label)+'</label>'+input+'</div>';}
function buildDateOptions(cur){var opts='<option value="">— no date —</option>',found=false;upcomingMeetings.forEach(function(m){var isCur=(m.date===cur);if(isCur)found=true;var disabled=(!m.available&&!isCur)?' disabled':'';var label=m.available?(esc(m.dateLabel)+(m.time?' '+m.time:'')):(esc(m.dateLabel)+' — taken'+(m.mainSpeaker?' ('+esc(m.mainSpeaker)+')':''));opts+='<option value="'+esc(m.date)+'"'+(isCur?' selected':'')+disabled+'>'+label+'</option>';});if(cur&&!found)opts+='<option value="'+esc(cur)+'" selected>'+esc(cur)+' (custom)</option>';return opts;}
function driveThumb(u,size){if(!u)return'';var id='';var i=u.indexOf('id=');if(i>=0){id=u.substring(i+3).split('&')[0];}else{var j=u.indexOf('/d/');if(j>=0)id=u.substring(j+3).split('/')[0];}return id?'https://drive.google.com/thumbnail?id='+id+'&sz=w'+(size||200):u;}
function showPhotoPreview(id){var el=document.getElementById(id);if(!el)return;var v=el.value||'';var prev=document.getElementById(id+'-prev');if(!prev)return;prev.innerHTML=(v&&v.indexOf('http')===0)?'<img src="'+esc(driveThumb(v,250))+'" style="max-width:140px;max-height:140px;border-radius:4px;border:1px solid #ddd" onerror="this.style.display=&#39;none&#39;">':'';}
async function uploadPhoto(input,targetId,ro){var file=input.files[0];if(!file)return;var prev=document.getElementById(targetId+'-prev');if(file.size>8*1024*1024){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Image too large (max 8 MB)</span>';input.value='';return;}if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#888">Uploading…</span>';try{var dataUrl=await new Promise(function(res,rej){var r=new FileReader();r.onload=function(ev){res(ev.target.result);};r.onerror=rej;r.readAsDataURL(file);});var sn=(document.getElementById('ef-name-'+ro)||{}).value||'speaker';var resp=await gs3('uploadPipelinePhoto',dataUrl,file.name,sn);document.getElementById(targetId).value=resp.url;showPhotoPreview(targetId);}catch(e){if(prev)prev.innerHTML='<span style="font-size:0.8em;color:#b91c1c">Upload failed</span>';}}
async function saveRow(ro){
  var msg=document.getElementById('ef-msg-'+ro);
  var changes={speakerName:document.getElementById('ef-name-'+ro).value.trim(),
    topic:document.getElementById('ef-topic-'+ro).value.trim(),
    status:document.getElementById('ef-status-'+ro).value,
    assignedTo:document.getElementById('ef-assigned-'+ro).value,
    tentativeDate:document.getElementById('ef-date-'+ro).value,
    speakerEmail:document.getElementById('ef-email-'+ro).value.trim(),
    speakerPhone:document.getElementById('ef-phone-'+ro).value.trim(),
    speakerCity:document.getElementById('ef-city-'+ro).value.trim(),
    preferredDates:document.getElementById('ef-pref-'+ro).value.trim(),
    bio:document.getElementById('ef-bio-'+ro).value.trim(),
    summary:document.getElementById('ef-summary-'+ro).value.trim(),
    speakerUrl:document.getElementById('ef-url-'+ro).value.trim(),
    introducer:document.getElementById('ef-introducer-'+ro).value.trim(),
    photoTop:document.getElementById('ef-phototop-'+ro).value.trim(),
    photoBottom:document.getElementById('ef-photobottom-'+ro).value.trim()};
  try{var res=await gs3('savePipelineCard',ro,changes,currentUser);
    var card=allCards.find(function(c){return c.rowIndex===ro;});if(card)Object.assign(card,changes);
    if(res&&res.notes!=null&&card)card.notes=res.notes;
    msg.className='row-msg ok';msg.textContent=(res&&res.noted)?'Saved ✓ ('+res.noted+' logged)':'Saved ✓';
    setTimeout(function(){renderTable();},800);
  }catch(e){msg.className='row-msg err';msg.textContent='Error: '+e.message;}
}
async function addRowNote(ro){
  var inp=document.getElementById('ef-note-'+ro);var text=inp.value.trim();if(!text)return;
  try{await gs3('appendPipelineNote',ro,text,currentUser);inp.value='';
    var d=await gs('getPipelineData',null);allCards=d.cards;renderTable();}
  catch(e){alert('Note failed: '+e.message);}
}
async function assignRow(ro){
  var events=await gs('getUpcomingEventsForPicker',null);
  if(!events.length){alert('No upcoming events with an open speaker slot.');return;}
  var opts=events.map(function(e,i){return i+': '+e.dateLabel+' — '+e.eventType+(e.mainTopic?' ('+e.mainTopic+')':'');}).join('\\n');
  var idx=prompt('Pick event number:\\n'+opts);if(idx===null)return;
  var ev=events[parseInt(idx)];if(!ev){alert('Invalid.');return;}
  try{var res=await gs3('assignSpeakerToEvent',ro,ev.rowIndex,currentUser);
    alert('Assigned '+res.speakerName+' to event on row '+res.eventsRow);
    var d=await gs('getPipelineData',null);allCards=d.cards;expandedRow=null;renderTable();}
  catch(e){alert('Error: '+e.message);}
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
#content{max-width:720px;margin:1.2em auto;padding:0 1em}
.section{margin-bottom:1.8em}
.sec-hd{font-size:1.05em;font-weight:bold;color:#17458F;border-bottom:2px solid #17458F;padding-bottom:0.25em;margin-bottom:0.7em;display:flex;align-items:center;gap:0.5em}
.sec-count{background:#17458F;color:#fff;font-size:0.75em;border-radius:10px;padding:1px 8px}
.card{background:#fff;border-radius:7px;padding:0.8em 1em;margin-bottom:0.55em;box-shadow:0 1px 3px rgba(0,0,0,0.07);display:flex;gap:1em;align-items:flex-start}
.card-left{flex:1}
.card-name{font-weight:bold;font-size:0.97em;color:#17458F}
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
.empty{color:#aaa;font-size:0.88em;font-style:italic;padding:0.3em 0}
#auth{position:fixed;inset:0;background:#17458F;display:flex;align-items:center;justify-content:center;z-index:200}
.auth-box{background:#fff;border-radius:10px;padding:2em;width:300px;text-align:center}
.auth-box h2{color:#17458F;margin-bottom:1em;font-size:1.1em}
.auth-box input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:0.6em;font-size:0.95em}
.auth-box button{background:#17458F;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:0.95em;width:100%}
.auth-err{color:#b91c1c;font-size:0.85em;margin-top:0.4em;min-height:1em}
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
  <a href="__EXEC_URL__?app=kanban" target="_top" class="hbtn">Kanban →</a>
  <a href="__EXEC_URL__?app=pipeline" target="_top" class="hbtn">Table →</a>
  <button class="hbtn" onclick="logout()">Logout</button>
</header>
<div id="content"><p style="color:#888;padding:1em">Loading…</p></div>
<script>
var currentUser='',allCards=[],statusLabels={};
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
});
async function loadData(){
  try{
    var d=await gs('getPipelineData',null);
    allCards=d.cards;statusLabels=d.statusLabels;render();
  }catch(e){
    document.getElementById('content').innerHTML=
      '<p style="color:#b91c1c;padding:1.2em">⚠️ '+e.message+
      '<br><br>Run <strong>Setup Speaker Pipeline Tab</strong> from the Rotary Sync menu in the spreadsheet, then reload.</p>';
  }
}
function render(){
  var sections=[
    {key:'scheduled',icon:'🗓️',desc:'Confirmed and on the calendar'},
    {key:'confirmed',icon:'✅',desc:'Speaker agreed — date TBD'},
    {key:'in-progress', icon:'📞',desc:'Actively working on it'},
    {key:'limbo',    icon:'⏳',desc:'Waiting / stalled'},
    {key:'new',      icon:'💡',desc:'New lead — not yet contacted'},
    {key:'done',     icon:'🎤',desc:'Recently presented'},
  ];
  var html='';
  sections.forEach(function(sec){
    var cards=allCards.filter(function(c){return c.status===sec.key;});
    html+='<div class="section"><div class="sec-hd">'+sec.icon+' '+(statusLabels[sec.key]||sec.key)+
      '<span class="sec-count">'+cards.length+'</span></div>';
    if(!cards.length){html+='<div class="empty">None at this stage</div></div>';return;}
    cards.forEach(function(card){
      html+='<div class="card">'+
        '<div class="card-left">'+
          '<div class="card-name">'+esc(card.speakerName||'(no name)')+'</div>'+
          (card.topic?'<div class="card-topic">'+esc(card.topic)+'</div>':'')+
          '<div class="card-meta">'+
            (card.tentativeDate?'<span>📅 '+esc(card.tentativeDate)+'</span>':'')+
            (card.assignedTo?'<span>👤 '+esc(card.assignedTo)+'</span>':'')+
            (card.speakerCity?'<span>📍 '+esc(card.speakerCity)+'</span>':'')+
            '<span class="badge badge-'+card.source+'">'+card.source+'</span>'+
            voteHtml(card)+
          '</div>'+
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
    html+='</div>';
  });
  document.getElementById('content').innerHTML=html;
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
  return '<span style="cursor:pointer;font-size:0.85em" onclick="vote('+card.rowIndex+')">'+(voted?'❤️':'🤍')+' '+names.length+'</span>';
}
function vote(ro){
  gs3('togglePipelineVote',ro,currentUser).then(function(res){
    var card=allCards.find(function(c){return c.rowIndex===ro;});
    if(card)card.interested=res.interested;
    render();
  }).catch(function(e){alert('Vote failed: '+e.message);});
}
function logout(){localStorage.removeItem('pipelinePw');localStorage.removeItem('pipelineName');location.reload();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
</script>
</body>
</html>`;
}
