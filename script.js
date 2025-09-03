document.addEventListener("DOMContentLoaded", () => {
  const cake = document.querySelector(".cake");
  const micStatus = document.getElementById("micStatus");
  const tapToBlow = document.getElementById("tapToBlow");
  const relightBtn = document.getElementById("relightBtn");

  // Song bar
  const songToggle = document.getElementById("songToggle");
  const songProgressFill = document.getElementById("songProgressFill");
  const songTime = document.getElementById("songTime");

  // Meter UI
  const micMeter = document.getElementById("micMeter");
  const micMeterFill = document.getElementById("micMeterFill");
  const micMeterThresh = document.getElementById("micMeterThresh");

  let candles = [];
  let blown = false;

  // Audio (music)
  let audioCtx, masterGain;
  // Mic
  let micStream, micSource, analyser;
  // Loops
  let rafIdMeter = null,
    rafIdProgress = null;

  // Playback state
  let isPlaying = false;
  let startAt = 0;
  let totalDur = 0;
  let notes = [];
  let scheduledOnce = false;

  // Colors (deterministic cycle)
  const palette = [
    "#7B020B",
    "#2E86AB",
    "#82CAFF",
    "#A0E39A",
    "#FF9ECD",
    "#FFD166",
    "#6C63FF",
    "#FF6F61",
    "#FFA07A",
    "#7F00FF",
  ];

  /* -------------------------------------------------------------------------- */
  /*                        DETERMINISTIC CANDLES (EVEN RINGS)                  */
  /* -------------------------------------------------------------------------- */
  function placeCandlesEvenRings() {
    const COUNT = 67;

    const W = cake.getBoundingClientRect().width; // px
    const cx = 50;
    const cy = 28;
    const squish = 0.45;

    const candlePx = 10;
    const gapPx = clamp(W * 0.022, 8, 12); // keep bases from touching
    const minCenterDistPx = candlePx + gapPx;

    const R_OUT = 46;
    const R_IN = 8;

    const minDistPct = (minCenterDistPx / W) * 100;
    const dR = (minDistPct / squish) * 1.05;

    const rings = [];
    for (let r = R_OUT; r >= R_IN; r -= dR) rings.push(r);

    let remaining = COUNT;
    let idx = 0;

    for (let i = 0; i < rings.length && remaining > 0; i++) {
      const r = rings[i];

      const circPx = 2 * Math.PI * ((r / 100) * W) * squish;
      let maxOnRing = Math.floor(circPx / minCenterDistPx);
      if (maxOnRing < 1) continue;
      if (i > 0) maxOnRing = Math.floor(maxOnRing * 0.92);

      const ringsLeft = rings.length - i;
      let target = Math.ceil(remaining / ringsLeft);
      let n = Math.min(target, maxOnRing, remaining);
      if (n < 4 && remaining >= 4 && maxOnRing >= 4) n = 4;

      const step = (2 * Math.PI) / n;
      const offset = i % 2 ? step / 2 : step / 3;

      for (let k = 0; k < n; k++) {
        const a = offset + k * step;
        const x = cx + r * Math.cos(a);
        const y = cy + r * squish * Math.sin(a);

        const color = palette[idx % palette.length];
        const height = 26 + (idx % 4) * 2;
        createStickCandle(x, y, color, height, idx);
        idx++;
      }
      remaining -= n;
    }

    if (remaining > 0) {
      fillRemainder(rings, cx, cy, squish, W, minCenterDistPx, remaining, idx);
    }
  }

  function fillRemainder(
    rings,
    cx,
    cy,
    squish,
    W,
    minCenterDistPx,
    remaining,
    startIdx
  ) {
    let idx = startIdx;
    for (let i = 0; i < rings.length && remaining > 0; i++) {
      const r = rings[i];
      const circPx = 2 * Math.PI * ((r / 100) * W) * squish;
      const maxOnRing = Math.max(1, Math.floor(circPx / minCenterDistPx));
      const step = (2 * Math.PI) / maxOnRing;
      const offset = i % 2 ? step / 2 : step / 3;

      for (let k = 0; k < maxOnRing && remaining > 0; k++) {
        const a = offset + k * step;
        const x = cx + r * Math.cos(a);
        const y = cy + r * squish * Math.sin(a);

        const color = palette[idx % palette.length];
        const height = 26 + (idx % 4) * 2;
        createStickCandle(x, y, color, height, idx);
        idx++;
        remaining--;
      }
    }
  }

  function createStickCandle(
    xPercent,
    yPercent,
    colorHex,
    heightPx,
    indexForFlicker
  ) {
    const candle = document.createElement("div");
    candle.className = "candle";
    candle.style.left = xPercent + "%";
    candle.style.top = yPercent + "%";
    candle.style.setProperty("--candle", colorHex);
    candle.style.height = (heightPx || 28) + "px";

    const flame = document.createElement("div");
    flame.className = "flame";
    const dur = 0.85 + (indexForFlicker % 5) * 0.08; // deterministic flicker
    flame.style.animationDuration = dur.toFixed(2) + "s";
    candle.appendChild(flame);

    cake.appendChild(candle);
    candles.push(candle);
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  /* -------------------------------------------------------------------------- */
  /*                               MUSIC (MELODY)                               */
  /* -------------------------------------------------------------------------- */
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
    buildMelody();
    updateTimeUI(0, totalDur);
  }

  function playNote(freq, start, dur, type = "triangle") {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(masterGain);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function buildMelody() {
    const q = 0.42,
      d = q * 1.5;
    const C4 = 261.63,
      D4 = 293.66,
      E4 = 329.63,
      F4 = 349.23,
      G4 = 392.0,
      A4 = 440.0,
      B4 = 493.88,
      C5 = 523.25;
    const D5 = 587.33,
      E5 = 659.25,
      F5 = 698.46,
      G5 = 783.99;
    const seq = [
      [G4, q],
      [G4, q],
      [A4, d],
      [G4, d],
      [C5, d],
      [B4, q * 2],
      [G4, q],
      [G4, q],
      [A4, d],
      [G4, d],
      [D5, d],
      [C5, q * 2],
      [G4, q],
      [G4, q],
      [G5, d],
      [E5, d],
      [C5, d],
      [B4, q],
      [A4, q * 2],
      [F5, q],
      [F5, q],
      [E5, d],
      [C5, d],
      [D5, d],
      [C5, q * 2],
    ];
    notes = [];
    let t = 0;
    seq.forEach(([f, dur]) => {
      notes.push({ f, d: dur, t });
      t += dur * 1.04;
    });
    totalDur = t + 0.25; // tail
  }

  function scheduleMelody() {
    const base = audioCtx.currentTime + 0.05;
    startAt = base;
    notes.forEach((n) => playNote(n.f, base + n.t, n.d));
    scheduledOnce = true;
  }

  /* -------------------------------------------------------------------------- */
  /*                    MIC / BLOW DETECTION — MORE SENSITIVE                    */
  /* -------------------------------------------------------------------------- */
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Tunable knobs (lower = more sensitive)
  const TARGET_RMS = 0.25; // for meter scaling
  const BASE_MARGIN = isMobile ? 0.02 : 0.025; // add to noise floor
  const ABS_MIN = isMobile ? 0.04 : 0.045; // ignore very tiny signals
  const BURST_SOFT = isMobile ? 120 : 160; // ms above gate to trigger
  const BURST_STRONG = isMobile ? 90 : 120; // if far above gate, trigger faster
  const STRONG_MULT = 1.35; // "far above" factor

  async function startMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e1) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        console.warn("Mic error", e2);
        micStatus.textContent =
          "Microphone blocked. Use the backup “Tap to blow”.";
        micStatus.className = "status warn";
        tapToBlow.style.display = "inline-flex";
        micMeter?.classList.remove("listening");
        return;
      }
    }

    micSource = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6; // faster response → more sensitive
    micSource.connect(analyser);

    micStatus.textContent =
      "Microphone: listening… blow to put out the candles";
    micStatus.className = "status good";
    tapToBlow.style.display = "inline-flex";

    meterLoop_reset();
    micMeter?.classList.add("listening");
    meterLoop();
  }

  function stopMic() {
    if (rafIdMeter) cancelAnimationFrame(rafIdMeter);
    rafIdMeter = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    analyser = null;
    micMeter?.classList.remove("listening");
    if (micMeterFill) micMeterFill.style.width = "0%";
  }

  const timeBuf = new Uint8Array(2048);
  let noiseFloor = 0;
  let armed = false;
  let accumMs = 0;

  function meterLoop_reset() {
    noiseFloor = 0;
    armed = false;
    accumMs = 0;
    meterLoop._last = performance.now();
    meterLoop._armTimer = 0;
  }

  function meterLoop() {
    if (!analyser) {
      rafIdMeter = requestAnimationFrame(meterLoop);
      return;
    }

    const now = performance.now();
    const dt = Math.min(120, now - (meterLoop._last || now));
    meterLoop._last = now;

    analyser.getByteTimeDomainData(timeBuf);

    // RMS + peak (helps fast strong bursts trigger sooner)
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = (timeBuf[i] - 128) / 128;
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / timeBuf.length);

    // Adaptive noise floor (slow EMA so it doesn't rise too quickly)
    const alpha = 0.02;
    noiseFloor =
      noiseFloor === 0 ? rms : rms * alpha + noiseFloor * (1 - alpha);

    // Small calibration delay
    if (!armed) {
      if ((meterLoop._armTimer || 0) > 300) {
        armed = true;
      } else {
        meterLoop._armTimer = (meterLoop._armTimer || 0) + dt;
      }
    }

    // Dynamic gate
    const gate = Math.max(noiseFloor + BASE_MARGIN, ABS_MIN);

    if (isPlaying && armed && rms > gate) {
      const strong = rms > gate * STRONG_MULT || peak > 0.55;
      const weight = 1 + Math.min((rms - gate) / gate, 1); // faster when well above gate
      accumMs += dt * weight;
      const need = strong ? BURST_STRONG : BURST_SOFT;
      if (accumMs >= need) {
        extinguish();
        accumMs = 0;
      }
    } else {
      // decay slowly so short pauses don't reset everything
      accumMs = Math.max(0, accumMs - dt * 0.5);
    }

    // Meter UI updates
    const norm = clamp(rms / TARGET_RMS, 0, 1) * 100;
    const gatePct = clamp(gate / TARGET_RMS, 0, 1) * 100;
    if (micMeterFill) micMeterFill.style.width = norm.toFixed(1) + "%";
    if (micMeterThresh) micMeterThresh.style.left = gatePct.toFixed(1) + "%";

    rafIdMeter = requestAnimationFrame(meterLoop);
  }

  function extinguish() {
    if (blown) return;
    blown = true;
    candles.forEach((c) => c.classList.add("out"));
    relightBtn.disabled = false;
    micStatus.textContent = "Make a wish! Candles are out 🎉";
    micStatus.className = "status good";
  }

  function relight() {
    blown = false;
    candles.forEach((c) => c.classList.remove("out"));
    relightBtn.disabled = true;
    if (isPlaying) micStatus.textContent = "Candles relit. Blow again!";
    else micStatus.textContent = "Press Play to enable blowing again.";
    micStatus.className = "status good";
  }

  /* -------------------------------------------------------------------------- */
  /*                             SONG BAR CONTROLS                              */
  /* -------------------------------------------------------------------------- */
  songToggle.addEventListener("click", async () => {
    initAudio();

    if (!isPlaying && audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    if (!isPlaying) {
      if (!scheduledOnce) scheduleMelody();
      isPlaying = true;
      songToggle.textContent = "⏸️ Pause";
      await startMic();
      progressLoop();
    } else if (audioCtx.state === "running") {
      await audioCtx.suspend();
      isPlaying = false;
      songToggle.textContent = "▶️ Resume";
      stopMic();
    } else if (audioCtx.state === "suspended") {
      await audioCtx.resume();
      isPlaying = true;
      songToggle.textContent = "⏸️ Pause";
      await startMic();
      progressLoop();
    }
  });

  function progressLoop() {
    if (!audioCtx) return;

    const elapsed = Math.max(0, audioCtx.currentTime - startAt);
    const clamped = Math.min(totalDur, elapsed);
    songProgressFill.style.width = (clamped / totalDur) * 100 + "%";
    updateTimeUI(clamped, totalDur);

    if (clamped >= totalDur - 0.02) {
      isPlaying = false;
      scheduledOnce = false;
      songToggle.textContent = "▶️ Play again";
      stopMic();
    } else {
      rafIdProgress = requestAnimationFrame(progressLoop);
    }
  }

  function updateTimeUI(elapsed, total) {
    songTime.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
  }
  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // Init candles (deterministic layout)
  placeCandlesEvenRings();

  // Relight + backup tap
  relightBtn.addEventListener("click", relight);
  tapToBlow.addEventListener("click", () => {
    if (isPlaying) extinguish();
  });

  window.addEventListener("pagehide", () => {
    stopMic();
    if (audioCtx && audioCtx.state === "running") audioCtx.close();
  });
});
