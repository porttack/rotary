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
  .sp-form .radio-group, .sp-form .check-group {
    display: flex; flex-wrap: wrap; gap: 0.5em 1.4em; margin-top: 0.3em;
  }
  .sp-form .radio-group label,
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
  input[type=file] {
    width: 100%; box-sizing: border-box;
    padding: 5px 0; font-size: 0.95em; font-family: inherit;
    border: none; color: #444;
  }
  #sp-photo-preview { margin-top: 0.5em; }
  #sp-photo-preview img {
    max-width: 200px; max-height: 200px;
    border-radius: 4px; border: 1px solid #ddd;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
  #sp-photo-size-warn { color: #b91c1c; font-size: 0.88em; margin-top: 0.3em; display: none; }
  .sp-pot { display: none; }
  @media (max-width: 520px) { .sp-form .two-col { grid-template-columns: 1fr; } }
</style>

<div id="sp-wrap">
<p>Fill out the form below and the speaker organizer will follow up within a week to discuss scheduling.</p>
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
    <label>Preferred Role</label>
    <div class="radio-group">
      <label><input type="radio" name="speakerRole" value="Main Speaker" checked> Main Speaker <span class="hint">(~20 min)</span></label>
      <label><input type="radio" name="speakerRole" value="Opening Speaker"> Opening Speaker <span class="hint">(5–10 min)</span></label>
      <label><input type="radio" name="speakerRole" value="Either"> Either</label>
    </div>
  </div>
  <div class="field">
    <label>Brief Bio / Description <span class="hint">(optional — helps us introduce you)</span></label>
    <textarea name="bio" rows="3" placeholder="Who are you and why would members enjoy this talk?"></textarea>
  </div>
  <div class="field">
    <label>Your Photo <span class="hint">(optional — JPEG or PNG, max 4 MB)</span></label>
    <input type="file" name="speakerPhoto" accept="image/jpeg,image/png,image/webp">
    <div id="sp-photo-preview" style="display:none;"><img id="sp-photo-thumb" alt="preview"></div>
    <div id="sp-photo-size-warn">Image is too large — please choose a file under 4 MB.</div>
  </div>

  <div class="section-head">Scheduling</div>
  <div class="field">
    <label>Available Dates or Timeframe <span class="hint">(optional)</span></label>
    <textarea name="suggestedDates" rows="2"
      placeholder="e.g. Any Tuesday evening, prefer fall 2026, not available July…"></textarea>
  </div>
  <div class="field">
    <label>Meeting Format Preference</label>
    <div class="radio-group">
      <label><input type="radio" name="timePreference" value="Morning"> Morning</label>
      <label><input type="radio" name="timePreference" value="Evening"> Evening</label>
      <label><input type="radio" name="timePreference" value="Either" checked> Either</label>
    </div>
  </div>
  <div class="field">
    <label>Format</label>
    <div class="check-group">
      <label><input type="checkbox" name="availMorning"> Available mornings</label>
      <label><input type="checkbox" name="availEvening"> Available evenings</label>
      <label><input type="checkbox" name="zoomOnly"> Zoom only (not in person)</label>
    </div>
  </div>

  <div class="section-head">Anything Else?</div>
  <div class="field">
    <label>Comments <span class="hint">(optional)</span></label>
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
</div>

<script>
const SP_URL = '{{ site.apps_script_url }}';

document.getElementById('sp-form').speakerPhoto.addEventListener('change', function () {
  const file    = this.files[0];
  const preview = document.getElementById('sp-photo-preview');
  const warn    = document.getElementById('sp-photo-size-warn');
  const thumb   = document.getElementById('sp-photo-thumb');
  warn.style.display = 'none';
  if (!file) { preview.style.display = 'none'; return; }
  if (file.size > 4 * 1024 * 1024) {
    warn.style.display = 'block';
    preview.style.display = 'none';
    return;
  }
  const reader = new FileReader();
  reader.onload = function (ev) {
    thumb.src = ev.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

document.getElementById('sp-form').addEventListener('submit', async function (e) {
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

  let photoBase64 = '', photoMime = '', photoName = '';
  const photoFile = form.speakerPhoto.files[0];
  if (photoFile) {
    if (photoFile.size > 4 * 1024 * 1024) {
      status.className = 'err';
      status.textContent = 'Photo must be under 4 MB — please choose a smaller image.';
      return;
    }
    try {
      photoBase64 = await new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload  = function (ev) { resolve(ev.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(photoFile);
      });
      photoMime = photoFile.type;
      photoName = photoFile.name;
    } catch (_) {}
  }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled    = true;
  btn.textContent = photoFile ? 'Uploading…' : 'Submitting…';
  status.className = '';
  status.textContent = '';

  const data = {
    action:         'speakerOffer',
    speakerName:    form.speakerName.value.trim(),
    speakerEmail:   form.speakerEmail.value.trim(),
    speakerPhone:   form.speakerPhone.value.trim(),
    speakerCity:    form.speakerCity.value.trim(),
    topic:          form.topic.value.trim(),
    speakerRole:    [...form.querySelectorAll('[name=speakerRole]')].find(r => r.checked)?.value || '',
    bio:            form.bio.value.trim(),
    suggestedDates: form.suggestedDates.value.trim(),
    timePreference: [...form.querySelectorAll('[name=timePreference]')].find(r => r.checked)?.value || '',
    comments:       form.comments.value.trim(),
    availMorning:   form.availMorning.checked,
    availEvening:   form.availEvening.checked,
    zoomOnly:       form.zoomOnly.checked,
    photoBase64,
    photoMime,
    photoName,
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
