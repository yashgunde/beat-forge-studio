/**
 * StepSchedulerProcessor — AudioWorklet processor for sample-accurate step scheduling.
 *
 * Runs on the audio rendering thread. Counts samples internally and posts a
 * message back to the main thread whenever a 16th-note boundary is crossed.
 *
 * Messages IN (main → worklet):
 *   { type: 'start' }
 *   { type: 'stop' }
 *   { type: 'setBpm', bpm: number }
 *   { type: 'setTotalSteps', totalSteps: number }
 *
 * Messages OUT (worklet → main):
 *   { type: 'step', step: number }
 *   { type: 'stopped' }
 */
class StepSchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** @type {number} Current BPM */
    this._bpm = 120;

    /** @type {number} Total steps before wrapping (default 16) */
    this._totalSteps = 16;

    /** @type {boolean} Whether the scheduler is actively counting */
    this._running = false;

    /** @type {number} Accumulated sample count within the current step */
    this._sampleCount = 0;

    /** @type {number} Current step index */
    this._currentStep = 0;

    /** @type {number} Samples per 16th note — recomputed when BPM changes */
    this._samplesPerStep = this._computeSamplesPerStep();

    this.port.onmessage = (event) => {
      const data = event.data;

      switch (data.type) {
        case 'start':
          this._running = true;
          this._sampleCount = 0;
          this._currentStep = 0;
          this._samplesPerStep = this._computeSamplesPerStep();
          // Fire the first step immediately
          this.port.postMessage({ type: 'step', step: 0 });
          break;

        case 'stop':
          this._running = false;
          this._sampleCount = 0;
          this._currentStep = 0;
          this.port.postMessage({ type: 'stopped' });
          break;

        case 'setBpm':
          this._bpm = data.bpm;
          this._samplesPerStep = this._computeSamplesPerStep();
          break;

        case 'setTotalSteps':
          this._totalSteps = data.totalSteps;
          // If current step is beyond new total, wrap it
          if (this._currentStep >= this._totalSteps) {
            this._currentStep = this._currentStep % this._totalSteps;
          }
          break;

        default:
          break;
      }
    };
  }

  /**
   * Compute the number of samples per 16th note at the current BPM.
   * Formula: (60 / bpm / 4) * sampleRate
   *   - 60 / bpm = seconds per beat (quarter note)
   *   - / 4 = seconds per 16th note
   *   - * sampleRate = samples per 16th note
   */
  _computeSamplesPerStep() {
    const secondsPerStep = 60.0 / this._bpm / 4.0;
    return secondsPerStep * sampleRate;
  }

  /**
   * Called by the audio rendering thread for each 128-sample block.
   * We don't produce audio — we just count samples and fire step messages.
   * Must return true to keep the processor alive.
   */
  process(inputs, outputs, parameters) {
    if (!this._running) {
      return true;
    }

    // Each render quantum is 128 samples
    const blockSize = 128;

    // Walk through the block sample-by-sample (logically) to detect
    // step boundaries. For efficiency, we jump directly to the next boundary.
    let samplesRemaining = blockSize;

    while (samplesRemaining > 0) {
      const samplesUntilNextStep = this._samplesPerStep - this._sampleCount;

      if (samplesRemaining >= samplesUntilNextStep) {
        // We cross a step boundary within this block
        samplesRemaining -= samplesUntilNextStep;
        this._sampleCount = 0;

        // Advance to the next step
        this._currentStep = (this._currentStep + 1) % this._totalSteps;

        // Notify the main thread
        this.port.postMessage({ type: 'step', step: this._currentStep });
      } else {
        // No boundary crossing — accumulate and move on
        this._sampleCount += samplesRemaining;
        samplesRemaining = 0;
      }
    }

    return true;
  }
}

registerProcessor('step-scheduler-processor', StepSchedulerProcessor);
