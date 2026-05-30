---
layout: page
title: Duty Editor
permalink: /duty/
---

<style>
  #duty-frame {
    width: 100%;
    height: calc(100vh - 130px);
    min-height: 600px;
    border: none;
    display: block;
  }
  #duty-fallback {
    display: none;
    padding: 2em 0;
    text-align: center;
    color: #555;
    font-family: Arial, sans-serif;
  }
  #duty-fallback a {
    display: inline-block;
    background: #17458F;
    color: #fff;
    padding: 10px 24px;
    border-radius: 4px;
    text-decoration: none;
    font-size: 1em;
    margin-top: 0.8em;
  }
</style>

<iframe id="duty-frame"
  src="{{ site.apps_script_url }}"
  title="SLV Rotary Duty Editor">
</iframe>

<div id="duty-fallback">
  <p>The Duty Editor could not be embedded here (browser security policy).</p>
  <a href="{{ site.apps_script_url }}"
     target="_blank">Open Duty Editor in new tab &rarr;</a>
</div>

<script>
// Detect a blocked iframe: after load, try reading contentDocument.
// A same-origin frame allows this; a blocked/cross-origin one throws.
// If the frame is blank (blocked by CSP/X-Frame-Options), show the fallback.
(function () {
  var frame = document.getElementById('duty-frame');
  frame.addEventListener('load', function () {
    try {
      // If blocked, contentDocument.body is null or access throws
      var doc = frame.contentDocument || frame.contentWindow.document;
      if (!doc || !doc.body || doc.body.innerHTML === '') {
        throw new Error('empty');
      }
    } catch (e) {
      frame.style.display = 'none';
      document.getElementById('duty-fallback').style.display = 'block';
    }
  });
})();
</script>
