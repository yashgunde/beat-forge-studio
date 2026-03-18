/**
 * Beat Analysis Web Worker
 *
 * Performs CPU-heavy audio analysis off the main thread:
 *   - BPM detection via autocorrelation
 *   - Spectral feature extraction (spectral centroid, energy, RMS, spectral flux)
 *   - Genre-aware pattern generation
 *
 * Communication protocol
 * ----------------------
 * IN  (main -> worker):
 *   {
 *     type: 'analyze',
 *     channelData: Float32Array,   // transferred
 *     sampleRate: number,
 *     existingPattern: Pattern     // serialised JSON-safe object
 *   }
 *
 * OUT (worker -> main):
 *   { type: 'result', result: BeatGenerationResult, style: string }
 *   { type: 'error',  message: string }
 */

// ─── BPM Detection (autocorrelation) ────────────────────────────────────────

function detectBPM(channelData, sampleRate) {
  // Downsample to ~4 kHz for faster processing
  var targetRate = 4000;
  var decimation = Math.max(1, Math.floor(sampleRate / targetRate));
  var len = Math.floor(channelData.length / decimation);
  var data = new Float32Array(len);
  for (var i = 0; i < len; i++) {
    data[i] = channelData[i * decimation];
  }

  var effectiveRate = sampleRate / decimation;

  // Low-pass energy envelope — square, smooth with a running average
  var envLen = data.length;
  var envelope = new Float32Array(envLen);
  for (var i = 0; i < envLen; i++) {
    envelope[i] = data[i] * data[i];
  }

  // Smooth with a ~30 ms window
  var smoothSamples = Math.max(1, Math.round(effectiveRate * 0.03));
  var smoothed = new Float32Array(envLen);
  var runSum = 0;
  for (var i = 0; i < envLen; i++) {
    runSum += envelope[i];
    if (i >= smoothSamples) runSum -= envelope[i - smoothSamples];
    smoothed[i] = runSum / Math.min(i + 1, smoothSamples);
  }

  // Autocorrelation over a range of lags corresponding to 50-200 BPM
  var minBPM = 50;
  var maxBPM = 200;
  var minLag = Math.floor(effectiveRate * 60 / maxBPM);
  var maxLag = Math.ceil(effectiveRate * 60 / minBPM);
  var corrLen = Math.min(smoothed.length, maxLag + 1);

  // Normalise smoothed signal (subtract mean)
  var mean = 0;
  for (var i = 0; i < corrLen; i++) mean += smoothed[i];
  mean /= corrLen;
  var norm = new Float32Array(corrLen);
  for (var i = 0; i < corrLen; i++) norm[i] = smoothed[i] - mean;

  var bestLag = minLag;
  var bestCorr = -Infinity;

  for (var lag = minLag; lag <= maxLag && lag < corrLen; lag++) {
    var sum = 0;
    var n = corrLen - lag;
    for (var i = 0; i < n; i++) {
      sum += norm[i] * norm[i + lag];
    }
    sum /= n;
    if (sum > bestCorr) {
      bestCorr = sum;
      bestLag = lag;
    }
  }

  var bpm = (effectiveRate * 60) / bestLag;

  // Snap to reasonable range and prefer common tempos
  if (bpm < 60) bpm *= 2;
  if (bpm > 200) bpm /= 2;

  return { bpm: Math.round(bpm * 10) / 10, offset: 0 };
}

// ─── Spectral Feature Extraction ─────────────────────────────────────────────

function extractFeatures(channelData, sampleRate) {
  var FRAME_SIZE = 512;
  var spectralCentroidSum = 0;
  var energySum = 0;
  var rmsSum = 0;
  var spectralFluxSum = 0;
  var frameCount = 0;

  var prevMagnitude = null;

  // Hann window (precomputed)
  var hannWindow = new Float32Array(FRAME_SIZE);
  for (var i = 0; i < FRAME_SIZE; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FRAME_SIZE - 1)));
  }

  for (var offset = 0; offset + FRAME_SIZE <= channelData.length; offset += FRAME_SIZE) {
    // Apply window
    var frame = new Float32Array(FRAME_SIZE);
    var frameEnergy = 0;
    var frameRMS = 0;

    for (var i = 0; i < FRAME_SIZE; i++) {
      frame[i] = channelData[offset + i] * hannWindow[i];
      frameEnergy += frame[i] * frame[i];
      frameRMS += channelData[offset + i] * channelData[offset + i];
    }

    energySum += frameEnergy;
    rmsSum += Math.sqrt(frameRMS / FRAME_SIZE);

    // Simple DFT magnitude (only positive frequencies)
    var halfN = FRAME_SIZE / 2;
    var magnitude = new Float32Array(halfN);

    for (var k = 0; k < halfN; k++) {
      var real = 0;
      var imag = 0;
      for (var n = 0; n < FRAME_SIZE; n++) {
        var angle = -2 * Math.PI * k * n / FRAME_SIZE;
        real += frame[n] * Math.cos(angle);
        imag += frame[n] * Math.sin(angle);
      }
      magnitude[k] = Math.sqrt(real * real + imag * imag);
    }

    // Spectral centroid (in Hz)
    var magSum = 0;
    var weightedSum = 0;
    for (var k = 0; k < halfN; k++) {
      var freq = k * sampleRate / FRAME_SIZE;
      weightedSum += freq * magnitude[k];
      magSum += magnitude[k];
    }
    if (magSum > 0) {
      spectralCentroidSum += weightedSum / magSum;
    }

    // Spectral flux
    if (prevMagnitude) {
      var flux = 0;
      for (var k = 0; k < halfN; k++) {
        var diff = magnitude[k] - prevMagnitude[k];
        if (diff > 0) flux += diff;
      }
      spectralFluxSum += flux;
    }

    prevMagnitude = magnitude;
    frameCount++;
  }

  if (frameCount === 0) {
    return { spectralCentroid: 3000, energy: 0.3, rms: 0.3, spectralFlux: 0 };
  }

  return {
    spectralCentroid: spectralCentroidSum / frameCount,
    energy: Math.min(1, energySum / frameCount),
    rms: Math.min(1, rmsSum / frameCount),
    spectralFlux: spectralFluxSum / frameCount,
  };
}

// ─── Style Detection ─────────────────────────────────────────────────────────

function detectStyle(bpm, features) {
  var spectralCentroid = features.spectralCentroid;
  var energy = features.energy;

  if (bpm >= 60 && bpm <= 90 && spectralCentroid < 2000) return 'Lo-Fi Hip-Hop';
  if (bpm >= 85 && bpm <= 110 && spectralCentroid >= 1500 && spectralCentroid < 4000) return 'Hip-Hop';
  if (bpm >= 120 && bpm <= 135 && spectralCentroid >= 3000) return 'House / Electronic';
  if (bpm >= 135 && bpm <= 185 && energy > 0.6) return 'Drum & Bass';
  if (bpm >= 130 && bpm <= 160) return 'Trap';
  return 'Electronic';
}

// ─── Pattern Generation ──────────────────────────────────────────────────────

function generatePattern(detectedBpm, features, existingPattern) {
  var spectralCentroid = features.spectralCentroid;
  var energy = features.energy;
  var rms = features.rms;
  var highEnergy = energy > 0.5 || rms > 0.4;
  var veryHighCentroid = spectralCentroid > 5000;
  var highCentroid = spectralCentroid > 2500;
  var isFast = detectedBpm > 140;

  function rand(threshold) {
    return Math.random() < threshold;
  }

  function buildSteps(indices, baseProbability) {
    if (baseProbability === undefined) baseProbability = 0.9;
    var steps = [];
    for (var i = 0; i < 16; i++) steps.push(false);
    for (var j = 0; j < indices.length; j++) {
      steps[indices[j]] = rand(baseProbability);
    }
    return steps;
  }

  function kickSteps() {
    if (isFast) return buildSteps([0, 6, 10]);
    if (highEnergy) return buildSteps([0, 4, 8, 12]);
    return buildSteps([0, 8]);
  }

  function snareSteps() {
    var base = [4, 12];
    if (highEnergy) return buildSteps(base.concat([6, 14]), 0.7);
    return buildSteps(base);
  }

  function hihatSteps() {
    if (veryHighCentroid) {
      return buildSteps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 0.85);
    }
    if (highCentroid) {
      return buildSteps([0,2,4,6,8,10,12,14], 0.9);
    }
    return buildSteps([0, 4, 8, 12]);
  }

  function openHatSteps() {
    var base = [2, 6, 10, 14];
    var prob = highEnergy ? 0.8 : 0.4;
    return buildSteps(base, prob);
  }

  function clapSteps() {
    var base = [4, 12];
    if (highEnergy) return buildSteps(base.concat([6, 14]), 0.6);
    return buildSteps(base);
  }

  function percSteps() {
    var density = Math.min(0.35, 0.15 + rms * 0.4);
    var steps = [];
    for (var i = 0; i < 16; i++) {
      steps.push(rand(density));
    }
    return steps;
  }

  function bassSteps() {
    if (isFast) return buildSteps([0, 3, 6, 9, 12], 0.85);
    return buildSteps([0, 3, 8, 11]);
  }

  function synthSteps() {
    var density = Math.min(0.3, 0.1 + energy * 0.25);
    var steps = [];
    for (var i = 0; i < 16; i++) {
      steps.push(rand(density));
    }
    return steps;
  }

  var stepGenerators = {
    kick: kickSteps,
    snare: snareSteps,
    hihat: hihatSteps,
    openhat: openHatSteps,
    clap: clapSteps,
    perc: percSteps,
    bass: bassSteps,
    synth: synthSteps,
  };

  var channels = existingPattern.channels.map(function (ch) {
    var gen = stepGenerators[ch.type] || percSteps;
    return Object.assign({}, ch, { steps: gen() });
  });

  return Object.assign({}, existingPattern, { channels: channels });
}

// ─── Waveform Downsampling ───────────────────────────────────────────────────

function generateWaveform(channelData) {
  var waveformPoints = 400;
  var blockSize = Math.floor(channelData.length / waveformPoints);
  var waveformData = new Float32Array(waveformPoints);
  for (var i = 0; i < waveformPoints; i++) {
    var sum = 0;
    for (var j = 0; j < blockSize; j++) {
      sum += Math.abs(channelData[i * blockSize + j] || 0);
    }
    waveformData[i] = sum / blockSize;
  }
  return waveformData;
}

// ─── Main Message Handler ────────────────────────────────────────────────────

self.onmessage = function (e) {
  var data = e.data;

  if (data.type !== 'analyze') return;

  try {
    var channelData = data.channelData;
    var sampleRate = data.sampleRate;
    var existingPattern = data.existingPattern;

    // 1. BPM detection
    var bpmResult = detectBPM(channelData, sampleRate);

    // 2. Feature extraction
    var features = extractFeatures(channelData, sampleRate);

    // 3. Waveform data
    var waveformData = generateWaveform(channelData);

    // 4. Pattern generation
    var pattern = generatePattern(bpmResult.bpm, features, existingPattern);

    // 5. Style detection
    var style = detectStyle(bpmResult.bpm, features);

    self.postMessage({
      type: 'result',
      result: {
        bpm: bpmResult.bpm,
        offset: bpmResult.offset,
        pattern: pattern,
        // Convert Float32Array to regular array for structured clone
        waveformData: Array.from(waveformData),
      },
      style: style,
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'Worker analysis failed',
    });
  }
};
