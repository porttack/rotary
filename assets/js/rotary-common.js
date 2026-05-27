// Shared utilities for SLV Rotary bulletin pages (newsletter.html, past.html)

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSiIWI11d3jQFL8I7g5vosHef2w-v5nad_hPvrSmlt13_oTar0YXcCXJpV7ZjxCJjguIAXZ7tUB8eXO/pub?gid=1793625237&single=true&output=csv';

const COL = {
  eventId:0, eventType:1, cancelled:2, day:3, date:4, time:5,
  durationMin:6, location:7, meetLink:8,
  speakerOrganizer:9,
  openingSpeaker:10, mainSpeaker:11, mainTopic:12, speakerUrl:13, summary:14,
  photoTop:15, photoBottom:16, mc:17, setupTeardown:18, avZoom:19, greeter:20,
  fourWayTest:21, thought:22, detective:23, bagPerson:24, comments:25,
  photoTopUrl:28, photoBottomUrl:29,
};

// ── Parsing ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { cur.push(field); field = ''; }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (ch !== '\r') { field += ch; }
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

const fv          = (row, col) => (row[col] || '').trim();
const isCancelled = row => fv(row, COL.cancelled).toUpperCase() === 'TRUE';

function to24h(t) {
  if (!t) return '00:00:00';
  // 24-hour "H:MM:SS" — Sheets time-value export without AM/PM
  const hms = t.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
  if (hms) return `${String(parseInt(hms[1])).padStart(2,'0')}:${hms[2]}:00`;
  // 12-hour "H:MM AM/PM" or "H:MM:SS AM/PM"
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!m) return t;
  let h = parseInt(m[1]);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12)  h = 0;
  return `${String(h).padStart(2,'0')}:${m[2]}:00`;
}

// Normalize "3/18/2026" (locale export from date-value cells) → "2026-03-18"
function normDateStr(ds) {
  const mdy = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return mdy ? `${mdy[3]}-${String(mdy[1]).padStart(2,'0')}-${String(mdy[2]).padStart(2,'0')}` : ds;
}

function parseRowDate(row) {
  const ds = fv(row, COL.date);
  if (!ds) return null;
  const ts  = fv(row, COL.time);
  const iso = normDateStr(ds);
  const d   = new Date(ts ? `${iso}T${to24h(ts)}` : `${iso}T00:00:00`);
  return isNaN(d) ? null : d;
}

function abbrevTime(ts) {
  if (!ts) return '';
  let h, min;
  // 24-hour "H:MM:SS"
  const hms = ts.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
  if (hms) {
    h = parseInt(hms[1]); min = parseInt(hms[2]);
  } else {
    // 12-hour "H:MM AM/PM" or "H:MM:SS AM/PM"
    const m = ts.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (!m) return '';
    h = parseInt(m[1]); min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12)  h = 0;
  }
  const h12  = h % 12 || 12;
  const ampm = h >= 12 ? 'p' : 'a';
  return min === 0 ? `${h12}${ampm}` : `${h12}${String(min).padStart(2,'0')}${ampm}`;
}

// ── HTML helpers ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function textToHtml(s) { return esc(s).replace(/\n/g,'<br>'); }

function mapLink(location, displayText) {
  if (!location) return esc(displayText || '');
  const url = `https://maps.google.com/?q=${encodeURIComponent(location)}`;
  return `<a href="${url}" target="_blank" rel="noopener">${esc(displayText || location)}</a>`;
}

function linkWrap(text, url) {
  if (!url) return esc(text);
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
}

// Prefer a direct URL in the photo cell; fall back to the companion URL column.
function photoSrc(row, primaryCol, fallbackCol) {
  const v = fv(row, primaryCol);
  if (v && v.startsWith('http')) return v;
  const f = fv(row, fallbackCol);
  return (f && f.startsWith('http')) ? f : '';
}

const fmt          = (d, opts) => d.toLocaleDateString('en-US', opts);
const fmtLong      = d => fmt(d, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
const fmtShort     = d => fmt(d, {month:'short', day:'numeric'});
const fmtDayDate   = d => fmt(d, {weekday:'short', month:'short', day:'numeric'});
const fmtMonthYear = d => fmt(d, {month:'long', year:'numeric'});

// ── Shared meeting entry renderer ─────────────────────────────────────────
// Renders a single past meeting block (no duty roster).
// Used by recentMeetings() in newsletter.html and the full list in past.html.
function renderMeetingEntry(row) {
  const d           = parseRowDate(row);
  const speaker     = fv(row, COL.mainSpeaker);
  const topic       = fv(row, COL.mainTopic);
  const summary     = fv(row, COL.summary);
  const speakerUrl  = fv(row, COL.speakerUrl);
  const photoTop    = photoSrc(row, COL.photoTop,    COL.photoTopUrl);
  const photoBottom = photoSrc(row, COL.photoBottom, COL.photoBottomUrl);

  let label = d ? esc(fmtShort(d)) : '?';
  if (speaker) label += `: ${linkWrap(speaker, speakerUrl)}`;
  if (topic)   label += (speaker ? ' &mdash; ' : ': ') + esc(topic);

  let html = `<div class="event-block">
  <h3 class="event-heading past">${label}</h3>`;
  if (photoTop) {
    html += `\n  <img src="${esc(photoTop)}" alt="${esc(speaker||topic||'')}" class="event-photo" loading="lazy" onerror="this.style.display='none'">`;
  }
  if (summary) html += `\n  <p class="event-narrative">${textToHtml(summary)}</p>`;
  if (photoBottom) {
    html += `\n  <img src="${esc(photoBottom)}" alt="${esc(speaker||topic||'')}" class="event-photo" loading="lazy" onerror="this.style.display='none'">`;
  }
  html += `\n</div>`;
  return html;
}
