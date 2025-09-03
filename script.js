document.addEventListener("DOMContentLoaded", () => {
  const cake = document.querySelector(".cake");
  const micStatus = document.getElementById("micStatus");
  const tapToBlow = document.getElementById("tapToBlow");
  const relightBtn = document.getElementById("relightBtn");

  // Song bar
  const songToggle = document.getElementById("songToggle");
  const songProgressFill = document.getElementById("songProgressFill");
  const songTime = document.getElementById("songTime");

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

  // -------------------- EVEN RINGS (deterministic, no touching) --------------------
  function placeCandlesEvenRings() {
    const COUNT = 67;

    // Geometry in cake-relative units
    const W = cake.getBoundingClientRect().width; // px
    const cx = 50; // %
    const cy = 28; // % (center of top layer)
    const squish = 0.45; // vertical squash of ellipse

    // Candle base is 10px wide; add gap so bases never touch.
    const candlePx = 10;
    const gapPx = clamp(W * 0.022, 8, 12); // 8–12px depending on cake size
    let minCenterDistPx = candlePx + gapPx; // guaranteed base-to-base clearance

    // Outer usable horizontal radius on top layer (in % of cake width)
    const R_OUT = 46; // conservative; stays inside the icing
    const R_IN = 8; // don't place too close to center to avoid crowding

    // Radial step (worst case when θ ≈ 90°, y separation is squished)
    const minDistPct = (minCenterDistPx / W) * 100;
    const dR = (minDistPct / squish) * 1.05; // safety factor

    const rings = [];
    for (let r = R_OUT; r >= R_IN; r -= dR) rings.push(r);

    // Place rings from outside in, distributing counts to hit exactly 67
    let remaining = COUNT;
    let idx = 0;

    for (let i = 0; i < rings.length && remaining > 0; i++) {
      const r = rings[i];

      // Conservative circumference using squished radius
      const circPx = 2 * Math.PI * ((r / 100) * W) * squish;
      let maxOnRing = Math.floor(circPx / minCenterDistPx);
      if (maxOnRing < 1) continue;

      // Also ensure adjacent ring angular neighbors don't collide:
      // leave at least 1.15x spacing margin on inner rings
      if (i > 0) maxOnRing = Math.floor(maxOnRing * 0.92);

      // Try to distribute remaining evenly across remaining rings
      const ringsLeft = rings.length - i;
      let target = Math.ceil(remaining / ringsLeft);

      // Cap by physical max
      let n = Math.min(target, maxOnRing);

      // Never exceed remaining
      n = Math.min(n, remaining);

      // Avoid tiny 1–2 clusters by bumping up to at least 4 per ring if possible
      if (n < 4 && remaining >= 4 && maxOnRing >= 4) n = 4;

      // Even angular spacing with staggered phase to avoid radial alignment
      const step = (2 * Math.PI) / n;
      const offset = i % 2 ? step / 2 : step / 3;

      for (let k = 0; k < n; k++) {
        const a = offset + k * step;
        const x = cx + r * Math.cos(a);
        const y = cy + r * squish * Math.sin(a);

        // Create candle with deterministic color/height/flicker
        const color = palette[idx % palette.length];
        const height = 26 + (idx % 4) * 2; // 26/28/30/32 pattern
        createStickCandle(x, y, color, height, idx);
        idx++;
      }

      remaining -= n;
    }

    // If due to extreme constraints we still didn't place all, gently reduce spacing once.
    if (remaining > 0) {
      const shrink = 0.94;
      minCenterDistPx = Math.max(14, minCenterDistPx * shrink);
      // recurse one quick pass with reduced spacing to fill the remainder
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

  // -------------------- Music: WebAudio Happy Birthday --------------------
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

  // -------------------- Mic & Blow Detection (only while playing) --------------------
  async function startMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micSource = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      micSource.connect(analyser);
      micStatus.textContent =
        "Microphone: listening… blow to put out the candles";
      micStatus.className = "status good";
      tapToBlow.style.display = "inline-flex";
      meterLoop(); // begin detection
    } catch (err) {
      console.warn("Mic error", err);
      micStatus.textContent =
        "Microphone blocked. Use the backup “Tap to blow”.";
      micStatus.className = "status warn";
      tapToBlow.style.display = "inline-flex";
    }
  }

  function stopMic() {
    if (rafIdMeter) cancelAnimationFrame(rafIdMeter);
    rafIdMeter = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    analyser = null;
  }

  function meterLoop() {
    if (!analyser) {
      rafIdMeter = requestAnimationFrame(meterLoop);
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length) / 255;

    if (!meterLoop._accum) meterLoop._accum = 0;
    const threshold = 0.18;
    const dt = 1000 / 60;

    if (isPlaying && rms > threshold) meterLoop._accum += dt;
    else meterLoop._accum = Math.max(0, meterLoop._accum - dt * 0.9);

    if (isPlaying && meterLoop._accum > 650) {
      extinguish();
      meterLoop._accum = 0;
    }

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

  // -------------------- Song Bar Controls --------------------
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

  // Place candles (deterministic, evenly spaced)
  placeCandlesEvenRings();

  // Relight + backup tap (backup only while playing)
  relightBtn.addEventListener("click", relight);
  tapToBlow.addEventListener("click", () => {
    if (isPlaying) extinguish();
  });

  window.addEventListener("pagehide", () => {
    stopMic();
    if (audioCtx && audioCtx.state === "running") audioCtx.close();
  });
});
