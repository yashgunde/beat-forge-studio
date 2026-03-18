'use client';

/**
 * Beat Forge Studio — BeatRecorder
 *
 * Records the master Tone.js output via the Web Audio API MediaRecorder,
 * then offers download as a WebM/Opus file.
 *
 * Architecture:
 *   Tone.Destination → MediaStreamAudioDestinationNode → MediaRecorder → Blob → download
 */

import { useEffect, useRef } from 'react';
import * as Tone from 'tone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds as "mm:ss".
 * e.g. 75 → "01:15"
 */
export function formatDuration(s: number): string {
  const totalSeconds = Math.max(0, Math.floor(s));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Pick the best supported MIME type for the MediaRecorder.
 * Prefers Opus inside WebM for broad browser support and good compression.
 */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm';
  }
  // Fallback for Safari
  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    return 'audio/mp4';
  }
  return '';
}

// ---------------------------------------------------------------------------
// BeatRecorder
// ---------------------------------------------------------------------------

export class BeatRecorder {
  private static _instance: BeatRecorder | null = null;

  /** Returns the singleton instance (lazily created). */
  static getInstance(): BeatRecorder {
    if (!BeatRecorder._instance) {
      BeatRecorder._instance = new BeatRecorder();
    }
    return BeatRecorder._instance;
  }

  // ---- internal state -------------------------------------------------------
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private _isRecording = false;
  private startTime = 0;
  private _isSetup = false;

  // Private constructor — use getInstance()
  private constructor() {}

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /**
   * Wire Tone.js master output → MediaStreamAudioDestinationNode.
   * Must be called once (idempotent) before calling `start()`.
   * SSR-safe: no-ops on the server.
   */
  setup(): void {
    if (typeof window === 'undefined') return;
    if (this._isSetup) return;

    try {
      const ctx = Tone.getContext().rawContext as AudioContext;
      this.streamDest = ctx.createMediaStreamDestination();

      // Connect Tone.js master destination to the stream capture node.
      // Tone.Destination is a ToneAudioNode with a standard connect() method.
      Tone.getDestination().connect(
        this.streamDest as unknown as Tone.ToneAudioNode
      );

      this._isSetup = true;
    } catch (err) {
      console.error('[BeatRecorder] setup() failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  /**
   * Begin recording. Calls `setup()` automatically if not already done.
   * No-op if already recording or if the environment is not a browser.
   */
  start(): void {
    if (typeof window === 'undefined') return;
    if (this._isRecording) return;

    // Ensure the audio graph is wired up
    this.setup();

    if (!this.streamDest) {
      console.error('[BeatRecorder] start() called but streamDest is null — setup() may have failed.');
      return;
    }

    const mimeType = pickMimeType();
    const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};

    try {
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.streamDest.stream, recorderOptions);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // collect chunks every 100 ms
      this.startTime = Date.now();
      this._isRecording = true;
    } catch (err) {
      console.error('[BeatRecorder] start() failed:', err);
      this.mediaRecorder = null;
      this.chunks = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Stop helpers
  // ---------------------------------------------------------------------------

  /**
   * Internal: stop the MediaRecorder and resolve with the recorded Blob once
   * the `onstop` event fires.
   */
  private _stopAndCollect(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('[BeatRecorder] No active MediaRecorder to stop.'));
        return;
      }

      const recorder = this.mediaRecorder;
      const mimeType = recorder.mimeType || 'audio/webm';

      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        this.chunks = [];
        this._isRecording = false;
        this.mediaRecorder = null;
        resolve(blob);
      };

      recorder.onerror = (event: Event) => {
        this._isRecording = false;
        this.mediaRecorder = null;
        reject(new Error(`[BeatRecorder] MediaRecorder error: ${(event as Event & { error?: { message?: string } }).error?.message ?? 'unknown'}`));
      };

      try {
        recorder.stop();
      } catch (err) {
        this._isRecording = false;
        this.mediaRecorder = null;
        reject(err);
      }
    });
  }

  /**
   * Stop recording and trigger a browser file download.
   * @param filename  Optional filename (defaults to "beat-forge-<timestamp>.webm")
   */
  async stopAndDownload(filename?: string): Promise<void> {
    if (!this._isRecording) return;

    const blob = await this._stopAndCollect();

    // Derive a sensible extension from the MIME type
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = filename ?? `beat-forge-${Date.now()}.${ext}`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Revoke after a short delay so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * Stop recording and return the recorded audio as a Blob (for preview/processing).
   */
  async stopAndGetBlob(): Promise<Blob> {
    if (!this._isRecording) {
      return new Blob([], { type: 'audio/webm' });
    }
    return this._stopAndCollect();
  }

  /**
   * Cancel recording without saving any data.
   */
  cancel(): void {
    if (!this._isRecording || !this.mediaRecorder) return;

    try {
      // Override onstop so we don't accidentally collect data
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    } catch {
      // Ignore errors during cancel
    }

    this.chunks = [];
    this._isRecording = false;
    this.mediaRecorder = null;
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /** Whether a recording is currently in progress. */
  get isRecording(): boolean {
    return this._isRecording;
  }

  /** Elapsed time in seconds since recording started (0 if not recording). */
  get durationSeconds(): number {
    if (!this._isRecording) return 0;
    return (Date.now() - this.startTime) / 1000;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * `useBeatRecorder()` — Returns the BeatRecorder singleton and ensures that
 * `setup()` is called once on the client. SSR-safe.
 */
export function useBeatRecorder(): BeatRecorder {
  const recorderRef = useRef<BeatRecorder | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const recorder = BeatRecorder.getInstance();
    recorderRef.current = recorder;

    // Wire up the audio graph on first mount.
    // setup() is idempotent, so repeated calls are safe.
    recorder.setup();
  }, []);

  return BeatRecorder.getInstance();
}

export default BeatRecorder;
