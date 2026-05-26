// ============================================================
//  ROTARY CALENDAR <-> GOOGLE SHEETS SYNC
//  Paste this entire file into Extensions > Apps Script in your Sheet
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
const CALENDAR_ID   = "primary"; // <-- CHANGE THIS to your calendar ID
const PULL_DAYS_AHEAD = 180;     // how many days ahead to pull
const SHEET_NAME    = "Events";

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
};

const NUM_COLS = 30;

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
const EVENT_TYPES = ["Meeting", "Board Meeting", "Social", "Service", "Committee", "Other"];

// Text color and bold per event type (row background stays white/grey for cancelled)
// Each entry: { color, bold }
const TYPE_STYLES = {
  "meeting":       { color: "#1a56db", bold: true  },  // bold blue
  "board meeting": { color: "#7e22ce", bold: true  },  // purple
  "social":        { color: "#166534", bold: false },  // green
  "service":       { color: "#c2410c", bold: false },  // orange
  "committee":     { color: "#000000", bold: false },  // black
  "other":         { color: "#000000", bold: false },  // black
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
    .addItem("👥  Setup Members Tab",           "setupMembers")
    .addSeparator()
    .addItem("📋  Setup / Reset Sheet Headers", "setupSheet")
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
    "Type","Opening Speaker","Main Speaker","Main Topic",
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
  const eventType      = row[COL.EVENT_TYPE - 1]       || "Meeting";

  // Build structured header block
  let desc = "";
  if (eventType)      desc += `Type: ${eventType}\n`;
  if (openingSpeaker) desc += `Opening Speaker: ${openingSpeaker}\n`;
  if (mainSpeaker)    desc += `Main Speaker: ${mainSpeaker}\n`;
  if (mainTopic)      desc += `Main Topic: ${mainTopic}\n`;
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
  if (t.includes("social"))    return "Social";
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
    COL.GREETER, COL.FOUR_WAY_TEST, COL.THOUGHT, COL.DETECTIVE, COL.BAG_PERSON,
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
    const hasSummary = val(row, COL.SUMMARY);

    if (d >= today && d <= cutoff) {
      upcomingSkim.push(row);  // all future events for skim + grid
      if (!cancelled && DETAIL_TYPES.includes(type)) {
        upcomingDetail.push(row);
      }
    } else if (d < today && DETAIL_TYPES.includes(type) && hasSummary) {
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
  const recentRows = recentMeetings.slice(0, 3);

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
    "meeting":       "#c7d7fb",
    "board meeting": "#e9d5ff",
    "social":        "#bbf7d0",
    "service":       "#fed7aa",
    "committee":     "#f3f4f6",
    "other":         "#f3f4f6"
  };
  const TYPE_ABBREV = {
    "meeting":       "Mtg",
    "board meeting": "Brd Mtg",
    "social":        "Social",
    "service":       "Service",
    "committee":     "Com",
    "other":         "Oth"
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

/** Entry point for the deployed web app */
function doGet() {
  return HtmlService.createHtmlOutput(getDutyEditorHtml())
    .setTitle("SLV Rotary — Duty Editor")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Open the deployed web app URL from the sheet menu */
function openDutyEditor() {
  let url;
  try {
    url = ScriptApp.getService().getUrl();
  } catch(e) { url = null; }

  if (!url || url.includes("AKfycb") === false) {
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
        const current = String(sheet.getRange(i + 2, dst).getValue() || "");
        if (url !== current) {
          sheet.getRange(i + 2, dst).setValue(url);
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
    "Note: plain-text URLs in the photo cells are used directly by the\n" +
    "newsletter — no sync needed for those."
  );
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