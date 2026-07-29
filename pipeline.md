---
layout: page
title: Tools
permalink: /pipeline/
---

<style>
  .tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1em; max-width: 860px; margin: 1.2em 0; }
  .tool-card { border: 1px solid #c5cae9; border-radius: 8px; padding: 1.1em 1.2em; background: #fafafa; text-decoration: none; color: inherit; display: block; transition: box-shadow 0.15s; }
  .tool-card:hover { box-shadow: 0 3px 10px rgba(0,0,0,0.1); text-decoration: none; }
  .tool-card h2 { color: #17458F; font-size: 1.05em; margin: 0 0 0.3em; }
  .tool-card p { color: #555; font-size: 0.88em; margin: 0; line-height: 1.45; }
  .tool-badge { display: inline-block; font-size: 0.75em; font-weight: bold; background: #e8eaf0; color: #374151; border-radius: 10px; padding: 1px 8px; margin-bottom: 0.4em; }
  .section-label { font-size: 0.82em; font-weight: bold; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5em 0 0.5em; }
</style>

<p style="color:#555;max-width:640px">Tools for SLV Rotary members (most password-protected).
Share this URL with your team.</p>

<div class="section-label">Calendar Tools</div>
<div class="tool-grid">

<a class="tool-card" href="{{ site.apps_script_url }}" target="_blank">
  <div class="tool-badge">📝 Duties</div>
  <h2>Duty Editor</h2>
  <p>Assign MC, greeter, AV/Zoom, and other meeting roles for upcoming meetings.</p>
</a>

<a class="tool-card" href="{{ site.apps_script_url }}?app=events" target="_blank">
  <div class="tool-badge">✏️ Events</div>
  <h2>Event Editor</h2>
  <p>Add or edit socials, service projects, fundraisers, and other club dates without touching the spreadsheet.</p>
</a>

<a class="tool-card" href="{{ site.apps_script_url }}?app=assistant" target="_blank">
  <div class="tool-badge">🤖 AI</div>
  <h2>Calendar Assistant</h2>
  <p>AI chat interface for adding, updating, or cancelling calendar events in natural language.</p>
</a>

<a class="tool-card" href="{{ site.apps_script_url }}?app=agenda" target="_blank">
  <div class="tool-badge">📋 Agenda</div>
  <h2>Meeting Agenda Generator</h2>
  <p>Printable agenda for the next meeting, pulled from duties and speaker info. Print it or export to a Google Doc.</p>
</a>

<a class="tool-card" href="/roster/">
  <div class="tool-badge">🖨️ Roster</div>
  <h2>Duty Sign-Up Sheet</h2>
  <p>Printable duty roster for the next 4/8/12 weeks — pass it around on a clipboard for members to sign up or cross out. Static page, no login needed.</p>
</a>

</div>

<div class="section-label">Speaker Pipeline</div>
<div class="tool-grid">

<a class="tool-card" href="{{ site.apps_script_url }}?app=pipeline" target="_blank">
  <div class="tool-badge">📊 Table</div>
  <h2>Pipeline Table</h2>
  <p>Sortable, filterable list of all speakers, with an upcoming-meetings sidebar on desktop. Click any row to open the full editor panel — works great on phones.</p>
</a>

<a class="tool-card" href="{{ site.apps_script_url }}?app=kanban" target="_blank">
  <div class="tool-badge">🗂️ Kanban</div>
  <h2>Kanban Board</h2>
  <p>Drag-and-drop cards across columns: New → Outreach → Limbo → Confirmed → Scheduled → Done.</p>
</a>

</div>

<div class="section-label">Deprecated Tools</div>
<div class="tool-grid">

<a class="tool-card" href="{{ site.apps_script_url }}?app=speaker-pipeline" target="_blank">
  <div class="tool-badge">📋 Status (retired)</div>
  <h2>Pipeline Status</h2>
  <p>Replaced by the Pipeline Table, which now has the same meeting sidebar and editor panel. Kept here for anyone who still prefers the grouped-by-stage view.</p>
</a>

</div>

<p style="margin-top:1.5em;font-size:0.85em;color:#888">
  All tools use the same Apps Script deployment — password is set separately per tool.<br>
  To add yourself as an assignable member, ask Eric to add you to the members tab of the SLV Rotary Master google spreadsheet and run <strong>Setup Members Tab</strong> from the Rotary Sync menu in the spreadsheet.
</p>
