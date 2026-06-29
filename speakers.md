---
layout: page
title: Requested Speakers
permalink: /speakers/
---

<style>
  .sp-list { max-width: 680px; }
  .sp-card {
    border: 1px solid #ddd; border-radius: 6px;
    padding: 0.9em 1.1em; margin-bottom: 0.8em;
    font-family: Arial, sans-serif; background: #fff;
  }
  .sp-name { font-size: 1.05em; font-weight: bold; color: #17458F; margin-bottom: 0.15em; }
  .sp-topic { color: #333; font-size: 0.95em; margin-bottom: 0.5em; }
  .sp-meta { display: flex; align-items: center; gap: 0.7em; flex-wrap: wrap; margin-top: 0.4em; }
  .sp-badge {
    font-size: 0.78em; padding: 2px 9px; border-radius: 10px;
    font-weight: bold; white-space: nowrap;
  }
  .sp-badge-scheduled  { background: #d1fae5; color: #065f46; }
  .sp-badge-in-progress{ background: #dbeafe; color: #1e3a8a; }
  .sp-badge-new        { background: #f3f4f6; color: #374151; }
  .sp-prio-high    { background: #fed7aa; color: #9a3412; }
  .sp-prio-medium  { background: #bfdbfe; color: #1e40af; }
  .sp-prio-low     { background: #f3f4f6; color: #4b5563; }
  .sp-prio-request { background: #eef3fb; color: #17458F; }
  .sp-card-body { display: flex; gap: 0.9em; align-items: flex-start; }
  .sp-card-main { flex: 1; min-width: 0; }
  .sp-photo {
    flex-shrink: 0; width: 64px; height: 64px;
    object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0;
  }
  .sp-badges { display: flex; align-items: center; gap: 0.45em; flex-wrap: wrap; margin: 0.1em 0 0.45em; }
  .sp-date { font-size: 0.8em; color: #b45309; font-weight: bold; white-space: nowrap; }
  .sp-summary { color: #555; font-size: 0.9em; line-height: 1.45; margin-top: 0.2em; }
  .sp-summary p { margin: 0 0 0.45em; }
  .sp-summary p:last-child { margin-bottom: 0; }
  .sp-summary a { color: #17458F; overflow-wrap: anywhere; word-break: break-word; }
  .sp-summary ul { margin: 0.2em 0 0.45em; padding-left: 1.3em; }
  .sp-md-h { font-size: 0.95em; font-weight: bold; color: #374151; margin: 0.35em 0 0.2em; }
  .heart-btn {
    background: none; border: none; cursor: pointer;
    font-size: 1.1em; color: #17458F; padding: 2px 4px;
    display: inline-flex; align-items: center; gap: 0.25em;
    border-radius: 4px; line-height: 1;
  }
  .heart-btn:hover:not(:disabled) { background: #eef3fb; }
  .heart-btn:disabled { color: #c0392b; cursor: default; }
  .heart-count { font-size: 0.88em; font-family: Arial, sans-serif; }
  .note-toggle {
    font-size: 0.82em; color: #17458F; cursor: pointer;
    background: none; border: none; padding: 0;
    text-decoration: underline; font-family: Arial, sans-serif;
  }
  .note-form { margin-top: 0.6em; display: none; }
  .note-form.open { display: block; }
  .note-form textarea {
    width: 100%; box-sizing: border-box;
    border: 1px solid #bbb; border-radius: 4px;
    padding: 6px 8px; font-size: 0.88em;
    font-family: Arial, sans-serif; resize: vertical; min-height: 60px;
  }
  .note-form textarea:focus { outline: 2px solid #17458F; border-color: #17458F; }
  .note-submit {
    margin-top: 0.4em;
    background: #17458F; color: #fff; border: none;
    padding: 5px 14px; border-radius: 4px; font-size: 0.85em; cursor: pointer;
  }
  .note-submit:disabled { background: #888; cursor: default; }
  .note-ok { font-size: 0.82em; color: #166534; margin-top: 0.3em; display: none; }
  #sp-error { color: #b91c1c; font-family: Arial, sans-serif; font-size: 0.95em; }
  #sp-loading { font-family: Arial, sans-serif; color: #888; }
</style>

<div class="sp-list">
<p style="font-family:Arial,sans-serif;color:#555;font-size:0.95em;margin-bottom:1.2em;">
These are speakers our members have requested or suggested.
Click ♡ to show support — it helps us prioritize scheduling.
You can also leave a private note for the speaker committee.
</p>
<div id="sp-loading">Loading…</div>
<div id="sp-error" style="display:none"></div>
<div id="sp-cards"></div>
</div>

<script>
const SP_API = '{{ site.apps_script_url }}';

// ── cookies ──────────────────────────────────────────────────────
function setCookie(name, val, days) {
  var exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + exp + ';path=/;SameSite=Lax';
}
function getCookie(name) {
  return document.cookie.split(';').reduce(function(acc, c) {
    var kv = c.trim().split('=');
    return kv[0] === name ? decodeURIComponent(kv[1] || '') : acc;
  }, '');
}
function hasHearted(ri) { return getCookie('sp_h_' + ri) === '1'; }
function setHearted(ri) { setCookie('sp_h_' + ri, '1', 365); }

// ── iframe POST (same pattern as speak.md / request.md) ──────────
function postAction(data) {
  var iname = 'sp-if-' + Date.now();
  var ifr = document.createElement('iframe');
  ifr.name = iname; ifr.style.display = 'none';
  document.body.appendChild(ifr);
  var f = document.createElement('form');
  f.method = 'POST'; f.action = SP_API; f.target = iname; f.style.display = 'none';
  Object.keys(data).forEach(function(k) {
    var inp = document.createElement('input');
    inp.type = 'hidden'; inp.name = k; inp.value = String(data[k]);
    f.appendChild(inp);
  });
  document.body.appendChild(f);
  f.submit();
  setTimeout(function() {
    try { document.body.removeChild(ifr); document.body.removeChild(f); } catch(_) {}
  }, 8000);
}

// ── helpers ──────────────────────────────────────────────────────
function fmtDate(s) {
  var m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Drive "uc?export=view" / "/d/<id>" links don't render in <img>; convert to the
// thumbnail endpoint, which does. Non-Drive URLs pass through unchanged.
function driveThumb(u, size) {
  if (!u) return '';
  var id = '', i = u.indexOf('id=');
  if (i >= 0) { id = u.substring(i + 3).split('&')[0]; }
  else { var j = u.indexOf('/d/'); if (j >= 0) id = u.substring(j + 3).split('/')[0]; }
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + (size || 200) : u;
}

// ── lightweight markdown ─────────────────────────────────────────
// Inline spans on already-HTML-escaped text: markdown links, bare URLs,
// bold, italic. Existing links/URLs are stashed so later passes (and the
// bare-URL linkifier) don't re-process text already inside an <a>.
function mdInline(s) {
  var stash = [];
  function keep(html) { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; }
  // [text](url) markdown links first. Also tolerate the reversed form
  // [url](label) that ClubRunner email exports produce: if the bracket text
  // is the URL and the target isn't, swap them so the label stays clickable.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, t, u) {
    var tUrl = /^https?:\/\//i.test(t), uUrl = /^https?:\/\//i.test(u);
    if (uUrl) return keep('<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>');
    if (tUrl) return keep('<a href="' + t + '" target="_blank" rel="noopener">' + u + '</a>');
    return keep(t);
  });
  // bare http(s) URLs → clickable, trimming trailing sentence punctuation
  s = s.replace(/https?:\/\/[^\s<]+/g, function(u) {
    var trail = '', m = u.match(/[).,;:!?]+$/);
    if (m) { trail = m[0]; u = u.slice(0, -trail.length); }
    return keep('<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>') + trail;
  });
  // emphasis
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>');
  // restore stashed anchors
  return s.replace(/\u0000(\d+)\u0000/g, function(_, i) { return stash[+i]; });
}
// Block-level: headings, bullet lists, paragraphs with <br> for soft breaks.
function mdToHtml(raw) {
  var lines = esc(raw).split(/\r?\n/);
  var html = '', inP = false, inUl = false;
  function closeP() { if (inP) { html += '</p>'; inP = false; } }
  function closeUl() { if (inUl) { html += '</ul>'; inUl = false; } }
  lines.forEach(function(line) {
    var h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      closeP(); closeUl();
      var lvl = Math.min(h[1].length + 2, 6);
      html += '<h' + lvl + ' class="sp-md-h">' + mdInline(h[2]) + '</h' + lvl + '>';
      return;
    }
    var li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      closeP();
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += '<li>' + mdInline(li[1]) + '</li>';
      return;
    }
    if (line.trim() === '') { closeP(); closeUl(); return; }
    closeUl();
    if (!inP) { html += '<p>'; inP = true; } else { html += '<br>'; }
    html += mdInline(line);
  });
  closeP(); closeUl();
  return html;
}
// Always render through the lightweight markdown/linkify pass: it escapes
// HTML first, turns bare URLs and [text](url) into links, honors # headings,
// -/* bullets and **bold**/*italic*, and converts soft line breaks to <br>.
function renderSummary(s) {
  return mdToHtml(s);
}

// ── render ───────────────────────────────────────────────────────
function renderSpeakers(speakers) {
  var wrap = document.getElementById('sp-cards');
  if (!speakers.length) {
    wrap.innerHTML = '<p style="font-family:Arial,sans-serif;color:#888">No speakers in the pipeline yet.</p>';
    return;
  }
  var prioMap = {
    high:   { cls: 'sp-prio-high',   label: 'Strongly Recommended' },
    medium: { cls: 'sp-prio-medium', label: 'Recommended' },
    low:    { cls: 'sp-prio-low',    label: 'Idea' }
  };
  wrap.innerHTML = speakers.map(function(sp) {
    var ri = sp.rowIndex;
    var hearted = hasHearted(ri);
    var badgeClass = {
      'scheduled':   'sp-badge-scheduled',
      'in-progress': 'sp-badge-in-progress',
      'new':         'sp-badge-new'
    }[sp.status] || 'sp-badge-new';
    var dateStr = sp.tentativeDate ? fmtDate(sp.tentativeDate) : '';
    var badgeLabel = sp.status === 'scheduled'   ? ('Scheduled' + (dateStr ? ': ' + dateStr : '')) :
                     sp.status === 'in-progress' ? 'In Progress' : 'New Request';
    // "Requested to speak" = a speaker who offered via the speak.md form (source=offer);
    // otherwise show the committee's priority, if one was set.
    var prio = sp.source === 'offer'
      ? { cls: 'sp-prio-request', label: 'Requested to speak' }
      : prioMap[(sp.priority || '').toLowerCase()];
    var prioBadge = prio ? '<span class="sp-badge ' + prio.cls + '">' + prio.label + '</span>' : '';
    // Scheduled cards show the date inside their status badge; others get a chip.
    var dateChip = (sp.status !== 'scheduled' && dateStr)
      ? '<span class="sp-date">Tentative: ' + esc(dateStr) + '</span>' : '';
    var photoImg = sp.photo
      ? '<img class="sp-photo" src="' + esc(driveThumb(sp.photo, 128)) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    return '<div class="sp-card" id="sp-card-' + ri + '">' +
      '<div class="sp-card-body">' +
        '<div class="sp-card-main">' +
          '<div class="sp-name">' + esc(sp.speakerName) + '</div>' +
          '<div class="sp-badges">' +
            prioBadge +
            '<span class="sp-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
            dateChip +
          '</div>' +
          (sp.topic ? '<div class="sp-topic">' + esc(sp.topic) + '</div>' : '') +
          (sp.summary ? '<div class="sp-summary">' + renderSummary(sp.summary) + '</div>' : '') +
        '</div>' +
        photoImg +
      '</div>' +
      '<div class="sp-meta">' +
        '<button class="heart-btn" id="hbtn-' + ri + '" onclick="doHeart(' + ri + ')"' + (hearted ? ' disabled' : '') + '>' +
          '<span id="hico-' + ri + '">' + (hearted ? '♥' : '♡') + '</span>' +
          '<span class="heart-count" id="hcnt-' + ri + '">' + sp.hearts + '</span>' +
        '</button>' +
        '<button class="note-toggle" onclick="toggleNote(' + ri + ')">Leave a note ↗</button>' +
      '</div>' +
      '<div class="note-form" id="nf-' + ri + '">' +
        '<textarea id="nt-' + ri + '" placeholder="Private note for the speaker committee…" rows="2"></textarea>' +
        '<div><button class="note-submit" id="nsub-' + ri + '" onclick="submitNote(' + ri + ')">Send Note</button></div>' +
        '<div class="note-ok" id="nok-' + ri + '">Note sent — thank you!</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── actions ──────────────────────────────────────────────────────
function doHeart(ri) {
  if (hasHearted(ri)) return;
  setHearted(ri);
  var ico = document.getElementById('hico-' + ri);
  var cnt = document.getElementById('hcnt-' + ri);
  var btn = document.getElementById('hbtn-' + ri);
  if (ico) ico.textContent = '♥';
  if (cnt) cnt.textContent = (parseInt(cnt.textContent) || 0) + 1;
  if (btn) btn.disabled = true;
  postAction({ action: 'heartSpeaker', rowIndex: ri });
}

function toggleNote(ri) {
  var nf = document.getElementById('nf-' + ri);
  if (!nf) return;
  nf.classList.toggle('open');
  if (nf.classList.contains('open')) {
    var ta = document.getElementById('nt-' + ri);
    if (ta) ta.focus();
  }
}

function submitNote(ri) {
  var ta   = document.getElementById('nt-' + ri);
  var btn  = document.getElementById('nsub-' + ri);
  var ok   = document.getElementById('nok-' + ri);
  var text = ta ? ta.value.trim() : '';
  if (!text) { if (ta) ta.focus(); return; }
  if (btn) btn.disabled = true;
  postAction({ action: 'noteSpeaker', rowIndex: ri, noteText: text });
  if (ta) ta.value = '';
  if (ok) ok.style.display = 'block';
  setTimeout(function() {
    var nf = document.getElementById('nf-' + ri);
    if (nf) nf.classList.remove('open');
    if (ok) ok.style.display = 'none';
    if (btn) btn.disabled = false;
  }, 2000);
}

// ── JSONP load ───────────────────────────────────────────────────
window.speakersCallback = function(data) {
  document.getElementById('sp-loading').style.display = 'none';
  if (data && data.error) {
    var err = document.getElementById('sp-error');
    err.style.display = '';
    err.textContent = 'Could not load speakers: ' + data.error;
    return;
  }
  renderSpeakers((data && data.speakers) || []);
};

(function() {
  var s = document.createElement('script');
  s.src = SP_API + '?app=publicSpeakers&callback=speakersCallback&_=' + Date.now();
  s.onerror = function() {
    document.getElementById('sp-loading').style.display = 'none';
    var err = document.getElementById('sp-error');
    err.style.display = '';
    err.textContent = 'Could not load speaker list. Please try again later.';
  };
  document.head.appendChild(s);
})();
</script>
