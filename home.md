---
layout: page
title: Home
permalink: /home/
---

<style>
  #gallery-wrap { max-width: 900px; }

  #stage {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
  }
  #stage img.slide {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Fallback crop point for before JS has analyzed the photo (or if it
       fails) — see the skin-tone-based auto-focal-point logic below, which
       overrides this per photo via inline style. */
    object-position: 50% 32%;
    transform-origin: 50% 32%;
    opacity: 0;
    transition: opacity 0.7s ease;
    will-change: transform;
  }
  #stage img.slide.visible { opacity: 1; }

  #caption {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    padding: 0.6em 0.9em 0.55em;
    background: linear-gradient(transparent, rgba(0,0,0,0.72));
    color: #fff;
    font-size: 0.9em;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  #caption .album-tag { color: #cfe0ff; font-size: 0.85em; }

  .stage-zone {
    position: absolute;
    top: 0; bottom: 0;
    width: 30%;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .stage-zone.left  { left: 0; }
  .stage-zone.right { right: 0; }

  #controls {
    display: flex;
    align-items: center;
    gap: 0.5em;
    flex-wrap: wrap;
    margin-top: 0.7em;
  }
  #controls button {
    background: #17458F;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 0.95em;
    cursor: pointer;
    line-height: 1;
  }
  #controls button:hover { background: #1a56db; }
  #counter { color: #666; font-size: 0.85em; margin-left: auto; }

  /* Full-screen mode: a fixed overlay that fills the viewport. Used instead
     of relying solely on the browser Fullscreen API since iOS Safari won't
     let an arbitrary <div> go fullscreen — this works identically on every
     device. requestFullscreen() is still attempted where supported (it also
     hides the browser chrome), and this class stays in sync either way. */
  #gallery-wrap.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 9999;
    max-width: none;
    width: 100vw;
    height: 100vh;
    background: #000;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  #gallery-wrap.fullscreen #stage {
    flex: 1;
    width: 100%;
    height: 100%;
    aspect-ratio: unset;
    border-radius: 0;
  }
  #gallery-wrap.fullscreen #controls {
    background: #000;
    padding: 0.5em 0.8em calc(0.5em + env(safe-area-inset-bottom));
    margin-top: 0;
  }
  #gallery-wrap.fullscreen #counter { color: #aaa; }
  #gallery-wrap:not(.fullscreen) #exit-btn { display: none; }
</style>

<div id="gallery-wrap">
  <div id="stage">
    <img class="slide" id="imgA" alt="">
    <img class="slide" id="imgB" alt="">
    <button class="stage-zone left" id="zone-prev" aria-label="Previous photo"></button>
    <button class="stage-zone right" id="zone-next" aria-label="Next photo"></button>
    <div id="caption"></div>
  </div>
  <div id="controls">
    <button id="prev-btn" title="Previous">⏮</button>
    <button id="play-btn" title="Pause">⏸</button>
    <button id="next-btn" title="Next">⏭</button>
    <button id="fs-btn" title="Full screen">🔳 Full Screen</button>
    <button id="exit-btn" title="Exit full screen">✕ Exit</button>
    <span id="counter"></span>
  </div>
</div>

<p style="color:#888;font-size:0.85em;max-width:900px;margin-top:0.8em">
  Fellowship, service, and social photos from the last five years of club events, pulled
  from our <a href="https://portal.clubrunner.ca/6779/photoalbums" target="_blank" rel="noopener">ClubRunner photo albums</a>
  and <a href="https://portal.clubrunner.ca/6779/Stories" target="_blank" rel="noopener">club stories</a>.
</p>

<script>
(function () {
  var BASE = "{{ '/assets/slideshow-photos/' | relative_url }}";
  var ADVANCE_MS = 5000;

  // Ken Burns pan/zoom: a slow, randomized scale+drift on each photo while
  // it's on screen. Driven by the Web Animations API rather than a CSS
  // transition so it runs independently of (and never fights with) the
  // opacity crossfade already on these elements. Runs a little longer than
  // ADVANCE_MS so the motion is already underway — not starting from a
  // dead stop — by the time an image finishes fading in.
  function kenBurns(img, durationMs) {
    if (!img.animate) return; // very old browsers: just skip the effect
    img.getAnimations().forEach(function (a) { a.cancel(); });
    var zoomIn = Math.random() < 0.5;
    var scaleA = zoomIn ? 1.0 : 1.05;
    var scaleB = zoomIn ? 1.05 : 1.0;
    // Drift is small and symmetric in both directions — safe to do now that
    // the zoom itself is anchored (via transform-origin, set by
    // applyFocalPoint below) to wherever the photo's subject actually is,
    // rather than a fixed edge.
    var maxDrift = 1.5;
    var xA = (Math.random() * maxDrift * 2 - maxDrift).toFixed(2);
    var yA = (Math.random() * maxDrift * 2 - maxDrift).toFixed(2);
    var xB = (Math.random() * maxDrift * 2 - maxDrift).toFixed(2);
    var yB = (Math.random() * maxDrift * 2 - maxDrift).toFixed(2);
    img.animate([
      { transform: "scale(" + scaleA + ") translate(" + xA + "%, " + yA + "%)" },
      { transform: "scale(" + scaleB + ") translate(" + xB + "%, " + yB + "%)" }
    ], { duration: durationMs, easing: "linear", fill: "forwards" });
  }

  // Auto-focal-point: since there's no real face detection available here,
  // approximate it — downsample the photo onto a small canvas and look for
  // skin-tone-colored pixels (a well-known cheap heuristic: see the RGB
  // rule below). For each column, only the TOPMOST skin-toned pixel counts
  // — heads are (barring someone's arm raised straight up) always the
  // highest skin-toned thing in any given column, above arms, hands, and
  // legs. Taking the median of those per-column top rows finds the head
  // band even in photos where bare arms/hands cover more total area than
  // faces do, which a simple center-of-mass over all skin pixels does not
  // (it gets pulled down toward the arms). Falls back to a fixed, moderate
  // default ("upper third") for photos with no real skin-tone match — a
  // painted face, a scenic shot with no people, etc.
  var DEFAULT_FOCAL_Y = 0.32;
  var focalCache = {};

  function computeFocalY(img) {
    try {
      var w = 48;
      var h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      function isSkin(r, g, b) {
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        return r > 95 && g > 40 && b > 20 && (max - min) > 15 &&
          Math.abs(r - g) > 15 && r > g && r > b;
      }
      var topRows = [];
      for (var x = 0; x < w; x++) {
        for (var y = 0; y < h; y++) {
          var idx = (y * w + x) * 4;
          if (isSkin(data[idx], data[idx + 1], data[idx + 2])) {
            topRows.push(y);
            break; // only the first (highest) skin pixel in this column
          }
        }
      }
      if (topRows.length < w * 0.08) return DEFAULT_FOCAL_Y; // too few hits to trust
      topRows.sort(function (a, b) { return a - b; });
      var median = topRows[Math.floor(topRows.length / 2)];
      // A little slack above the detected hairline so foreheads/hair
      // aren't sitting right at the crop edge.
      var focalY = Math.max(0, median / (h - 1 || 1) - 0.05);
      return Math.max(0.03, Math.min(0.7, focalY));
    } catch (e) {
      return DEFAULT_FOCAL_Y; // canvas failed for any reason — safe fallback
    }
  }

  function applyFocalPoint(imgEl, file) {
    var focalY = focalCache.hasOwnProperty(file) ? focalCache[file] : DEFAULT_FOCAL_Y;
    var pct = Math.round(focalY * 100) + "%";
    imgEl.style.objectPosition = "50% " + pct;
    imgEl.style.transformOrigin = "50% " + pct;
  }

  // Fellowship, service, and social photos from the last five years,
  // newest first. Pulled from ClubRunner's Photo Albums (full albums of
  // event photos) and from individual Stories posts (meeting recaps) —
  // deliberately excluding the single-speaker headshots that make up most
  // of the Stories archive, in favor of genuine group/fellowship shots.
  var PHOTOS = [
    { file: "new-members-2026_elle-cassie-tina-lori.jpg", caption: "Elle, Cassie, Tina & Lori", album: "New Members · Jul 2026" },

    { file: "halloween-2025_justin-and-tracy.jpg", caption: "Justin & Tracy", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_linda.jpg", caption: "Linda & Viking Woman", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_nine.jpg", caption: "Gilligan & Mary Ann", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_four.jpg", caption: "Wizards on the town", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_one.jpg", caption: "Astronaut & cow", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_two.jpg", caption: "Costume contest, father & daughter", album: "Halloween 2025 · Nov 2025" },
    { file: "halloween-2025_roger.jpg", caption: "Directing trick-or-treat traffic", album: "Halloween 2025 · Nov 2025" },

    { file: "day-out-thomas-tank-2025_cindy-linda.jpg", caption: "Cindy & Linda", album: "Day Out with Thomas the Tank · Sep 2025" },
    { file: "day-out-thomas-tank-2025_scott-linda.jpg", caption: "With the conductor", album: "Day Out with Thomas the Tank · Sep 2025" },
    { file: "day-out-thomas-tank-2025_thomas.jpg", caption: "All aboard", album: "Day Out with Thomas the Tank · Sep 2025" },

    { file: "mpf-lobster-feed-2024_8310.jpg", caption: "Volunteers at check-in", album: "MPF Lobster Feed · Nov 2024" },
    { file: "mpf-lobster-feed-2024_8311.jpg", caption: "Mountain Parks Foundation Lobster Feed fundraiser", album: "MPF Lobster Feed · Nov 2024" },
    { file: "mpf-lobster-feed-2024_8321.jpg", caption: "Fresh off the boil", album: "MPF Lobster Feed · Nov 2024" },
    { file: "mpf-lobster-feed-2024_8336.jpg", caption: "Live music at the fundraiser", album: "MPF Lobster Feed · Nov 2024" },

    { file: "february-2024-meetings_middle-school-speech.jpg", caption: "Youth speech contest", album: "February 2024 Meetings" },
    { file: "speaker_kevin-andrew.jpg", caption: "A wildlife rescue demo — falcon and owl up close", album: "September/October Meetings 2023" },

    { file: "november-meetings-2023_dictionaries.jpg", caption: "Dictionaries for 4th graders", album: "November Meetings · Nov 2023" },

    { file: "induction-2022_group.jpg", caption: "New member induction", album: "Induction at Bret Harte Hall · May 2022" },
    { file: "laughter-2022_comedian.jpg", caption: "Two thumbs up from our comedy-night speaker", album: "Building Community Through Laughter · Mar 2022" },

    { file: "meeting-2021-10-28_club-group.jpg", caption: "District Governor Richard Flanders visits the club", album: "Weekly Meeting · Oct 2021" },
    { file: "meeting-2021-10-28_flanders-sekkel.jpg", caption: "District Governor Richard Flanders visits the club", album: "Weekly Meeting · Oct 2021" },
    { file: "meeting-2021-10-14_induction.jpg", caption: "New member induction", album: "Weekly Meeting · Oct 2021" },
    { file: "meeting-2021-09-15_terry-jeanie-howard.jpg", caption: "Terry & Jeanie Howard, with a rescued falcon and owl", album: "Weekly Meeting · Sep 2021" },
    { file: "meeting-2021-08-04_inductees.jpg", caption: "New member induction", album: "Weekly Meeting · Aug 2021" },

    { file: "new-teacher-breakfast-2021_6761.jpg", caption: "New Teacher Breakfast", album: "New Teacher Breakfast · Aug 2021" },
    { file: "new-teacher-breakfast-2021_6762.jpg", caption: "New Teacher Breakfast", album: "New Teacher Breakfast · Aug 2021" },
    { file: "new-teacher-breakfast-2021_6763.jpg", caption: "New Teacher Breakfast", album: "New Teacher Breakfast · Aug 2021" },
    { file: "new-teacher-breakfast-2021_6767.jpg", caption: "New Teacher Breakfast", album: "New Teacher Breakfast · Aug 2021" },
    { file: "new-teacher-breakfast-2021_6768.jpg", caption: "New Teacher Breakfast", album: "New Teacher Breakfast · Aug 2021" },

    { file: "meeting-2021-07-07_three-presidents.jpg", caption: "Three club presidents", album: "Weekly Meeting · Jul 2021" },
    { file: "meeting-2021-07-07_two-new-members.jpg", caption: "New member induction", album: "Weekly Meeting · Jul 2021" },

    { file: "community-tool-shed-2021_group-with-check.jpg", caption: "$10,000 to the Community Tool Shed", album: "Community Tool Shed · Jun 2021" },

    { file: "speaker_amber-rowland.jpg", caption: "Amber Rowland out on the water", album: "February 2024 Meetings" },
    { file: "speaker_hung-wei.jpg", caption: "A hands-on craft demonstration for the club", album: "August 2023 Meetings" },

    // Photos Eric added directly to the folder.
    { file: "added_guitars-not-guns.jpg", caption: "Guitars Not Guns music program", album: "Community Service" },
    { file: "added_katie-joe.jpg", caption: "Katie & Joe — scholarship check presentation", album: "Community Service" },
    { file: "added_community-tool-shed-donation.jpg", caption: "$10,000 to the Community Tool Shed", album: "Community Tool Shed" },
    { file: "added_img-7216.jpg", caption: "Club outing among the redwoods", album: "Club Outing" },
    { file: "added_img-7032.jpg", caption: "RYLA delegates with Cindy Sekkel", album: "RYLA" },
    { file: "added_bde3e841.jpg", caption: "RYLA delegates", album: "RYLA" },
    { file: "added_img-7183.jpg", caption: "Fellowship dinner", album: "Fellowship" },
    { file: "added_img-6754.jpg", caption: "Egg Turn-In — community Easter event", album: "Easter Egg Hunt" },
    { file: "added_img-6726.jpg", caption: "Accessible Egg Hunt volunteers", album: "Easter Egg Hunt" },
    { file: "added_img-5976.jpg", caption: "Student speakers at the podium", album: "Weekly Meeting" },
    { file: "added_unnamed1.jpg", caption: "Boulder Creek Vax & Boost clinic volunteers", album: "Vax the Valley" },
    { file: "added_quail-hollow-volunteer-day.jpg", caption: "Quail Hollow Park volunteer day", album: "Community Service" },
    { file: "added_scan-20251109.jpg", caption: "Club members at the San Lorenzo Valley welcome sign", album: "From the Archives" },
    { file: "added_ron-sekkel-gil-marge.jpg", caption: "Ron Sekkel, Gil & Marge", album: "Weekly Meeting" },
    { file: "added_delle-townsend.jpg", caption: "Delle Townsend", album: "Weekly Meeting" }
  ];

  // Drop a photo directly into assets/slideshow-photos/ and it shows up
  // here automatically, no editing required — anything in that folder
  // that isn't already listed above gets appended with a generic caption.
  var ALL_FILES = [{% for f in site.static_files %}{% if f.path contains '/assets/slideshow-photos/' %}"{{ f.name }}",{% endif %}{% endfor %}];
  (function () {
    var known = {};
    PHOTOS.forEach(function (p) { known[p.file] = true; });
    ALL_FILES.forEach(function (name) {
      if (!known[name]) PHOTOS.push({ file: name, caption: "", album: "Recently added" });
    });
  })();

  // Shuffle into a fresh random order on every page load — this is the
  // home page now, seen many times over, and a fixed sequence means the
  // same photo greets every visit. Fisher-Yates.
  for (var shuffleI = PHOTOS.length - 1; shuffleI > 0; shuffleI--) {
    var shuffleJ = Math.floor(Math.random() * (shuffleI + 1));
    var shuffleTmp = PHOTOS[shuffleI];
    PHOTOS[shuffleI] = PHOTOS[shuffleJ];
    PHOTOS[shuffleJ] = shuffleTmp;
  }

  var wrap = document.getElementById("gallery-wrap");
  var imgs = [document.getElementById("imgA"), document.getElementById("imgB")];
  var frontIdx = 0; // which of imgs[] is currently visible
  var index = 0;    // which PHOTOS entry is currently shown
  var timer = null;
  var playing = true;

  var captionEl = document.getElementById("caption");
  var counterEl = document.getElementById("counter");
  var playBtn = document.getElementById("play-btn");

  function preload(i) {
    var file = PHOTOS[i].file;
    var im = new Image();
    // Piggyback the focal-point analysis on the preload that's already
    // happening one photo ahead of when it's shown, so by render time the
    // crop/zoom anchor is ready with no extra network cost or delay.
    im.onload = function () {
      if (!focalCache.hasOwnProperty(file)) focalCache[file] = computeFocalY(im);
    };
    im.src = BASE + file;
  }

  function render(i, animate) {
    var back = imgs[1 - frontIdx];
    var front = imgs[frontIdx];
    var photo = PHOTOS[i];

    function reveal() {
      back.classList.add("visible");
      front.classList.remove("visible");
      frontIdx = 1 - frontIdx;
    }

    applyFocalPoint(back, photo.file); // uses cached value, or the default
    back.onload = function () {
      // First time this particular photo has ever loaded in this session
      // (i.e. it wasn't preloaded a step ahead — true for whichever photo
      // the slideshow opens on): analyze it now and correct the crop.
      if (!focalCache.hasOwnProperty(photo.file)) {
        focalCache[photo.file] = computeFocalY(back);
        applyFocalPoint(back, photo.file);
      }
      if (animate) reveal();
    };
    back.src = BASE + photo.file;
    kenBurns(back, ADVANCE_MS + 2000);
    if (!animate) reveal();

    captionEl.innerHTML = "<div>" + photo.caption + "</div><div class='album-tag'>" + photo.album + "</div>";
    counterEl.textContent = (i + 1) + " / " + PHOTOS.length;

    preload((i + 1) % PHOTOS.length);
  }

  function goTo(i, animate) {
    index = (i + PHOTOS.length) % PHOTOS.length;
    render(index, animate !== false);
  }

  function next() { goTo(index + 1); resetTimer(); }
  function prev() { goTo(index - 1); resetTimer(); }

  function resetTimer() {
    if (timer) clearInterval(timer);
    if (playing) timer = setInterval(function () { goTo(index + 1); }, ADVANCE_MS);
  }

  function setPlaying(p) {
    playing = p;
    playBtn.textContent = playing ? "⏸" : "▶";
    playBtn.title = playing ? "Pause" : "Play";
    resetTimer();
  }

  document.getElementById("prev-btn").addEventListener("click", prev);
  document.getElementById("next-btn").addEventListener("click", next);
  document.getElementById("zone-prev").addEventListener("click", prev);
  document.getElementById("zone-next").addEventListener("click", next);
  playBtn.addEventListener("click", function () { setPlaying(!playing); });

  // --- Full screen toggle -----------------------------------------------
  // Try the real Fullscreen API (hides browser chrome on browsers that
  // support arbitrary-element fullscreen), and always toggle the CSS
  // fallback class so the effect is consistent on iOS Safari too. Full
  // screen just enlarges the same single-photo stage — no separate layout.
  var fsBtn = document.getElementById("fs-btn");
  var exitBtn = document.getElementById("exit-btn");

  function enterFullscreen() {
    wrap.classList.add("fullscreen");
    var req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (req) { try { req.call(wrap); } catch (e) {} }
  }
  function exitFullscreen() {
    wrap.classList.remove("fullscreen");
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (exit) { try { exit.call(document); } catch (e) {} }
    }
  }
  fsBtn.addEventListener("click", enterFullscreen);
  exitBtn.addEventListener("click", exitFullscreen);
  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement) wrap.classList.remove("fullscreen");
  });
  document.addEventListener("webkitfullscreenchange", function () {
    if (!document.webkitFullscreenElement) wrap.classList.remove("fullscreen");
  });
  var MIN_ADVANCE_MS = 1500;
  var MAX_ADVANCE_MS = 15000;
  var SPEED_STEP_MS = 500;

  function changeSpeed(deltaMs) {
    ADVANCE_MS = Math.max(MIN_ADVANCE_MS, Math.min(MAX_ADVANCE_MS, ADVANCE_MS + deltaMs));
    resetTimer();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") exitFullscreen();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowUp") { e.preventDefault(); changeSpeed(-SPEED_STEP_MS); }
    else if (e.key === "ArrowDown") { e.preventDefault(); changeSpeed(SPEED_STEP_MS); }
  });

  // Simple swipe support for touch devices (single-photo view only).
  var touchStartX = null;
  document.getElementById("stage").addEventListener("touchstart", function (e) {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  document.getElementById("stage").addEventListener("touchend", function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
    touchStartX = null;
  }, { passive: true });

  goTo(0, false);
  resetTimer();
})();
</script>
