---
layout: page
title: Request a Speaker
permalink: /request/
---

<style>
  .rq-form { max-width: 640px; font-family: Arial, sans-serif; font-size: 0.97em; }
  .rq-form .section-head {
    color: #17458F; font-size: 1.05em; font-weight: bold;
    border-bottom: 2px solid #17458F; padding-bottom: 0.2em;
    margin: 1.6em 0 0.8em;
  }
  .rq-form .field { margin-bottom: 0.9em; }
  .rq-form label { display: block; font-weight: bold; margin-bottom: 0.2em; color: #222; }
  .rq-form .hint { font-weight: normal; color: #666; font-size: 0.88em; }
  .rq-form input[type=text],
  .rq-form input[type=email],
  .rq-form input[type=tel],
  .rq-form textarea {
    width: 100%; box-sizing: border-box;
    padding: 7px 9px; border: 1px solid #bbb; border-radius: 4px;
    font-size: 0.97em; font-family: inherit; color: #222;
  }
  .rq-form textarea { resize: vertical; min-height: 80px; }
  .rq-form input:focus, .rq-form textarea:focus {
    outline: 2px solid #17458F; border-color: #17458F;
  }
  .rq-form .radio-group, .rq-form .check-group {
    display: flex; flex-wrap: wrap; gap: 0.5em 1.4em; margin-top: 0.3em;
  }
  .rq-form .radio-group label,
  .rq-form .check-group label {
    font-weight: normal; display: flex; align-items: center; gap: 0.35em; cursor: pointer;
  }
  .rq-form .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1em; }
  .rq-form .req { color: #c00; }
  .rq-submit {
    background: #17458F; color: #fff; border: none;
    padding: 10px 28px; border-radius: 4px; font-size: 1em;
    cursor: pointer; margin-top: 1em;
  }
  .rq-submit:disabled { background: #888; cursor: default; }
  #rq-status { margin-top: 1em; font-size: 0.95em; min-height: 1.4em; }
  #rq-status.ok  { color: #166534; font-weight: bold; }
  #rq-status.err { color: #b91c1c; }
  /* honeypot */
  .rq-pot { display: none; }
  @media (max-width: 520px) { .rq-form .two-col { grid-template-columns: 1fr; } }
</style>

<p>Know someone who would make a great speaker, or have a topic you'd like the club to explore?
Fill out the form below — the speaker organizer will follow up with you.</p>
<p style="font-size:0.9em;color:#555;">Fields marked <span style="color:#c00;">*</span> are required.</p>

<form class="rq-form" id="rq-form" novalidate>

  <div class="section-head">Your Information</div>
  <div class="two-col">
    <div class="field">
      <label>Name <span class="req">*</span></label>
      <input type="text" name="requestorName" required autocomplete="name">
    </div>
    <div class="field">
      <label>Phone <span class="hint">(optional)</span></label>
      <input type="tel" name="requestorPhone" autocomplete="tel">
    </div>
  </div>
  <div class="field">
    <label>Email <span class="req">*</span></label>
    <input type="email" name="requestorEmail" required autocomplete="email">
  </div>

  <div class="section-head">About the Speaker</div>
  <div class="two-col">
    <div class="field">
      <label>Speaker Name <span class="req">*</span></label>
      <input type="text" name="speakerName" required>
    </div>
    <div class="field">
      <label>Speaker City / Location</label>
      <input type="text" name="speakerCity" placeholder="e.g. Boulder Creek">
    </div>
  </div>
  <div class="two-col">
    <div class="field">
      <label>Speaker Email <span class="hint">(optional)</span></label>
      <input type="email" name="speakerEmail">
    </div>
    <div class="field">
      <label>Speaker Phone <span class="hint">(optional)</span></label>
      <input type="tel" name="speakerPhone">
    </div>
  </div>
  <div class="field">
    <label>Topic <span class="req">*</span></label>
    <input type="text" name="topic" required placeholder="What would they speak about?">
  </div>
  <div class="field">
    <label>Brief Bio <span class="hint">(who are they and why would members enjoy this?)</span></label>
    <textarea name="bio" rows="3"></textarea>
  </div>

  <div class="section-head">Scheduling</div>
  <div class="field">
    <label>Approximate Date Recommendations <span class="hint">(optional)</span></label>
    <textarea name="suggestedDates" rows="2"
      placeholder="e.g. Spring 2026, after March, avoids summer…"></textarea>
  </div>
  <div class="field">
    <label>Preferred Meeting Time</label>
    <div class="radio-group">
      <label><input type="radio" name="timePreference" value="Morning"> Morning</label>
      <label><input type="radio" name="timePreference" value="Evening"> Evening</label>
      <label><input type="radio" name="timePreference" value="Either" checked> Either</label>
    </div>
  </div>
  <div class="field">
    <label>Speaker Availability / Format</label>
    <div class="check-group">
      <label><input type="checkbox" name="availMorning"> Available mornings</label>
      <label><input type="checkbox" name="availEvening"> Available evenings</label>
      <label><input type="checkbox" name="zoomOnly"> Zoom only (not in person)</label>
    </div>
  </div>

  <div class="section-head">Coordination</div>
  <div class="field">
    <label>Have you already spoken with&hellip;</label>
    <div class="check-group">
      <label><input type="checkbox" name="spokeToOrganizer"> The speaker organizer</label>
      <label><input type="checkbox" name="spokeToPresident"> The president</label>
    </div>
  </div>

  <div class="section-head">Anything Else?</div>
  <div class="field">
    <div class="check-group" style="margin-bottom:0.6em;">
      <label><input type="checkbox" name="otherSuggestions"> I have other suggestions (see comments)</label>
    </div>
    <label>Comments <span class="hint">(optional)</span></label>
    <textarea name="comments" rows="3"
      placeholder="Anything else we should know…"></textarea>
  </div>

  <!-- honeypot: bots fill this, humans don't see it -->
  <div class="rq-pot">
    <label>Leave this blank <input type="text" name="_pot"></label>
  </div>

  <button type="submit" class="rq-submit">Submit Request</button>
  <div id="rq-status"></div>
</form>

<script>
const RQ_URL = 'https://script.google.com/macros/s/AKfycbzJUnhSnRKTjA-JwHa07El5kVnpwa7AKYIkk2ivY3PGIUiwsr7LXYP0Ls7SceyUuCEU/exec';

document.getElementById('rq-form').addEventListener('submit', function (e) {
  e.preventDefault();
  const form   = e.target;
  const status = document.getElementById('rq-status');

  // Honeypot check
  if (form._pot && form._pot.value) return;

  // Basic required-field validation
  const missing = ['requestorName', 'requestorEmail', 'speakerName', 'topic']
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
    action:           'speakerRequest',
    requestorName:    form.requestorName.value.trim(),
    requestorEmail:   form.requestorEmail.value.trim(),
    requestorPhone:   form.requestorPhone.value.trim(),
    speakerName:      form.speakerName.value.trim(),
    speakerEmail:     form.speakerEmail.value.trim(),
    speakerPhone:     form.speakerPhone.value.trim(),
    speakerCity:      form.speakerCity.value.trim(),
    topic:            form.topic.value.trim(),
    bio:              form.bio.value.trim(),
    suggestedDates:   form.suggestedDates.value.trim(),
    timePreference:   (form.timePreference
                        ? [...form.querySelectorAll('[name=timePreference]')]
                            .find(r => r.checked)?.value || ''
                        : ''),
    comments:         form.comments.value.trim(),
    spokeToOrganizer: form.spokeToOrganizer.checked,
    spokeToPresident: form.spokeToPresident.checked,
    availMorning:     form.availMorning.checked,
    availEvening:     form.availEvening.checked,
    zoomOnly:         form.zoomOnly.checked,
    otherSuggestions: form.otherSuggestions.checked,
  };

  // Use text/plain to avoid CORS preflight — Apps Script parses the JSON body regardless
  fetch(RQ_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(data),
  })
  .then(r => r.json())
  .then(function (res) {
    if (res.ok) {
      form.style.display  = 'none';
      status.className    = 'ok';
      status.textContent  = '✓ Request submitted! The speaker organizer will be in touch.';
    } else {
      throw new Error(res.error || 'Unknown error');
    }
  })
  .catch(function (err) {
    btn.disabled    = false;
    btn.textContent = 'Submit Request';
    status.className    = 'err';
    status.textContent  = 'Something went wrong — please try again or email us directly. (' + err.message + ')';
  });
});
</script>
