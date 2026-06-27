---
layout: page
title: Offer to Speak
permalink: /speak/
---

Interested in speaking at an SLV Rotary meeting? We welcome presentations on
almost any topic — your work, travels, community projects, or areas of
expertise. Talks are typically **10–20 minutes**.

<style>
  .sp-form { max-width: 640px; font-family: Arial, sans-serif; font-size: 0.97em; }
  .sp-form .section-head {
    color: #17458F; font-size: 1.05em; font-weight: bold;
    border-bottom: 2px solid #17458F; padding-bottom: 0.2em;
    margin: 1.6em 0 0.8em;
  }
  .sp-form .field { margin-bottom: 0.9em; }
  .sp-form label { display: block; font-weight: bold; margin-bottom: 0.2em; color: #222; }
  .sp-form .hint { font-weight: normal; color: #666; font-size: 0.88em; }
  .sp-form input[type=text],
  .sp-form input[type=email],
  .sp-form input[type=tel],
  .sp-form textarea {
    width: 100%; box-sizing: border-box;
    padding: 7px 9px; border: 1px solid #bbb; border-radius: 4px;
    font-size: 0.97em; font-family: inherit; color: #222;
  }
  .sp-form textarea { resize: vertical; min-height: 80px; }
  .sp-form input:focus, .sp-form textarea:focus {
    outline: 2px solid #17458F; border-color: #17458F;
  }
  .sp-form .check-group {
    display: flex; flex-wrap: wrap; gap: 0.5em 1.4em; margin-top: 0.3em;
  }
  .sp-form .check-group label {
    font-weight: normal; display: flex; align-items: center; gap: 0.35em; cursor: pointer;
  }
  .sp-form .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1em; }
  .sp-form .req { color: #c00; }
  .sp-submit {
    background: #17458F; color: #fff; border: none;
    padding: 10px 28px; border-radius: 4px; font-size: 1em;
    cursor: pointer; margin-top: 1em;
  }
  .sp-submit:disabled { background: #888; cursor: default; }
  #sp-status { margin-top: 1em; font-size: 0.95em; min-height: 1.4em; }
  #sp-status.ok  { color: #166534; font-weight: bold; }
  #sp-status.err { color: #b91c1c; }
  .sp-pot { display: none; }
  @media (max-width: 520px) { .sp-form .two-col { grid-template-columns: 1fr; } }
</style>

<div id="sp-wrap">
<p>Fill out the form below and the speaker organizer will follow up within a week to discuss scheduling.</p>
<p style="background:#eef3fb;border-left:4px solid #17458F;border-radius:4px;padding:0.7em 1em;font-size:0.92em;color:#333;margin:1em 0;">
SLV Rotary is non-political and non-religious. Your presentation should focus on the topic itself rather than donation requests, sales pitches, or sponsorship asks. If you'd like, you're welcome to leave information or materials on the table for members to pick up on their own.
</p>
<p style="font-size:0.9em;color:#555;">Fields marked <span style="color:#c00;">*</span> are required.</p>

<form class="sp-form" id="sp-form" novalidate>

  <div class="section-head">About You</div>
  <div class="two-col">
    <div class="field">
      <label>Your Name <span class="req">*</span></label>
      <input type="text" name="speakerName" required autocomplete="name">
    </div>
    <div class="field">
      <label>City / Location</label>
      <input type="text" name="speakerCity" placeholder="e.g. Boulder Creek">
    </div>
  </div>
  <div class="two-col">
    <div class="field">
      <label>Email <span class="req">*</span></label>
      <input type="email" name="speakerEmail" required autocomplete="email">
    </div>
    <div class="field">
      <label>Phone <span class="hint">(optional)</span></label>
      <input type="tel" name="speakerPhone" autocomplete="tel">
    </div>
  </div>

  <div class="section-head">Your Talk</div>
  <div class="field">
    <label>Topic <span class="req">*</span></label>
    <input type="text" name="topic" required placeholder="What would you speak about?">
  </div>
  <div class="field">
    <div class="check-group">
      <label><input type="checkbox" name="isRotarian"> I am a Rotarian</label>
      <label><input type="checkbox" name="isLocal"> Local to the Santa Cruz Mountains area</label>
      <label><input type="checkbox" name="fundraisingLiterature"> I may want to leave fundraising or donation materials on the table for attendees</label>
    </div>
  </div>

  <div class="section-head">Scheduling</div>
  <div class="field">
    <label>Available Dates or Timeframe <span class="hint">(optional)</span></label>
    <textarea name="suggestedDates" rows="2"
      placeholder="e.g. Any Tuesday evening, prefer fall 2026, not available July…"></textarea>
  </div>
  <div class="field">
    <div class="check-group">
      <label><input type="checkbox" name="zoomOnly"> Zoom only (not in person)</label>
    </div>
  </div>

  <div class="section-head">Comments <span class="hint">(optional)</span></div>
  <div class="field">
    <textarea name="comments" rows="3"
      placeholder="Questions, special needs, equipment requests…"></textarea>
  </div>

  <div class="sp-pot">
    <label>Leave this blank <input type="text" name="_pot"></label>
  </div>

  <button type="submit" class="sp-submit">Submit Offer</button>
  <div id="sp-status"></div>
</form>
</div>

<div id="sp-success" style="display:none; max-width:640px;">
  <p style="color:#166534; font-size:1.1em; font-weight:bold; font-family:Arial,sans-serif;">
    ✓ Thank you for your offer to speak!
  </p>
  <p style="font-family:Arial,sans-serif; color:#333;">
    The speaker organizer will be in touch within a week to discuss scheduling. We look forward to having you!
  </p>
  <p style="font-family:Arial,sans-serif; color:#333;">
    In the meantime, <a href="/speakers/">browse our speaker lineup</a> to see who else is coming up.
  </p>
</div>

<script>
const SP_URL = '{{ site.apps_script_url }}';

document.getElementById('sp-form').addEventListener('submit', function (e) {
  e.preventDefault();
  const form   = e.target;
  const status = document.getElementById('sp-status');

  if (form._pot && form._pot.value) return;

  const missing = ['speakerName', 'speakerEmail', 'topic']
    .filter(n => !form[n].value.trim());
  if (missing.length) {
    status.className = 'err';
    status.textContent = 'Please fill in all required fields.';
    form[missing[0]].focus();
    return;
  }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled    = true;
  btn.textContent = 'Submitting…';
  status.className = '';
  status.textContent = '';

  const data = {
    action:         'speakerOffer',
    speakerName:    form.speakerName.value.trim(),
    speakerEmail:   form.speakerEmail.value.trim(),
    speakerPhone:   form.speakerPhone.value.trim(),
    speakerCity:    form.speakerCity.value.trim(),
    topic:          form.topic.value.trim(),
    isRotarian:     form.isRotarian.checked,
    isLocal:        form.isLocal.checked,
    fundraisingLiterature: form.fundraisingLiterature.checked,
    suggestedDates: form.suggestedDates.value.trim(),
    comments:       form.comments.value.trim(),
    zoomOnly:       form.zoomOnly.checked,
  };

  const iframeName = 'sp-iframe-' + Date.now();
  const iframe = document.createElement('iframe');
  iframe.name  = iframeName;
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const hiddenForm = document.createElement('form');
  hiddenForm.method = 'POST';
  hiddenForm.action = SP_URL;
  hiddenForm.target = iframeName;
  hiddenForm.style.display = 'none';

  Object.entries(data).forEach(function (kv) {
    const input = document.createElement('input');
    input.type  = 'hidden';
    input.name  = kv[0];
    input.value = String(kv[1]);
    hiddenForm.appendChild(input);
  });
  document.body.appendChild(hiddenForm);
  hiddenForm.submit();

  setTimeout(function () {
    iframe.onload = function () {
      document.getElementById('sp-wrap').style.display    = 'none';
      document.getElementById('sp-success').style.display = 'block';
      document.body.removeChild(iframe);
      document.body.removeChild(hiddenForm);
    };
  }, 0);
});
</script>

---

### What to expect

- The speaker organizer will follow up within a week to discuss scheduling.
- Meetings are typically **Tuesday evenings at 7 PM** or **Tuesday mornings at 8 AM**.
- The program runs about 20 minutes; a Google Meet link is available for hybrid attendance.
- You're welcome to bring slides or handouts — a laptop and projector are on site.

### Questions?

Contact the club secretary or speaker organizer directly, or note your question in the comments field above.
