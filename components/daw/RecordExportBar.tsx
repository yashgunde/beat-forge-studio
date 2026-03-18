'use client';

/**
 * Beat Forge Studio — RecordExportBar
 *
 * A slim full-width bar (≈40px) rendered below the TopBar.
 * Provides one-click beat recording via the Web Audio MediaRecorder API and
 * browser-triggered WebM download.
 *
 * States:
 *   idle       → "⏺ RECORD" + "💾 EXPORT" buttons
 *   recording  → pulsing indicator + live mm:ss timer + "⏹ STOP & SAVE" + "✕ CANCEL"
 *   processing → spinner + "Preparing download..."
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBeatRecorder, formatDuration } from '@/lib/recorder';
import { useDAWStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BarState = 'idle' | 'recording' | 'processing';

// ---------------------------------------------------------------------------
// Animated waveform bars (shown while recording)
// ---------------------------------------------------------------------------

function WaveformAnimation() {
  return (
    <span className="inline-flex items-end gap-px h-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-0.5 bg-daw-red rounded-full"
          style={{
            height: '100%',
            animation: `recBar 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes recBar {
          from { transform: scaleY(0.25); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 border-2 border-daw-textMuted border-t-daw-accent rounded-full"
      style={{ animation: 'spin 0.7s linear infinite' }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </span>
  );
}

// ---------------------------------------------------------------------------
// RecordExportBar
// ---------------------------------------------------------------------------

export default function RecordExportBar() {
  const recorder = useBeatRecorder();
  const isPlaying = useDAWStore((s) => s.isPlaying);
  const activeView = useDAWStore((s) => s.activeView);

  const [barState, setBarState] = useState<BarState>('idle');
  const [displayDuration, setDisplayDuration] = useState('00:00');
  // Track whether we started playback so we can stop it after recording
  const autoStartedPlay = useRef(false);

  // -------------------------------------------------------------------------
  // Duration ticker — updates every second while recording
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (barState !== 'recording') {
      setDisplayDuration('00:00');
      return;
    }

    const id = setInterval(() => {
      setDisplayDuration(formatDuration(recorder.durationSeconds));
    }, 1000);

    return () => clearInterval(id);
  }, [barState, recorder]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleRecord = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Ensure audio context is set up, then start recording
    recorder.setup();
    recorder.start();

    // Only enter recording state if recorder actually started
    if (!recorder.isRecording) {
      console.error('[RecordExportBar] recorder.start() failed — audio context may not be running yet. Click play first.');
      return;
    }

    setBarState('recording');
    setDisplayDuration('00:00');

    // Auto-start playback if not already playing
    if (!isPlaying) {
      autoStartedPlay.current = true;
      useDAWStore.getState().togglePlay();
    } else {
      autoStartedPlay.current = false;
    }
  }, [recorder, isPlaying]);

  const handleStopAndSave = useCallback(async () => {
    // Always transition away from 'recording' state — even if recorder
    // is not active (prevents the UI getting permanently stuck).
    setBarState('processing');

    if (recorder.isRecording) {
      try {
        await recorder.stopAndDownload('my-beat.webm');
      } catch (err) {
        console.error('[RecordExportBar] stopAndDownload failed:', err);
      }
    }

    // Stop transport if we auto-started it
    if (autoStartedPlay.current) {
      useDAWStore.getState().stop();
      autoStartedPlay.current = false;
    }

    setBarState('idle');
  }, [recorder]);

  const handleCancel = useCallback(() => {
    recorder.cancel();

    if (autoStartedPlay.current) {
      useDAWStore.getState().stop();
      autoStartedPlay.current = false;
    }

    setBarState('idle');
    setDisplayDuration('00:00');
  }, [recorder]);

  // "💾 EXPORT" button — alias to record flow; a tooltip guides the user
  const handleExport = useCallback(() => {
    handleRecord();
  }, [handleRecord]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const baseBar = [
    'w-full flex items-center gap-2 px-3',
    'border-b border-daw-border',
    'text-daw-text font-mono text-[11px]',
    'select-none overflow-hidden',
  ].join(' ');

  // Recording state gets a pulsing red left border
  const recordingAccent = barState === 'recording'
    ? 'border-l-4 border-l-daw-red'
    : 'border-l-4 border-l-transparent';

  return (
    <div
      className={`${baseBar} ${recordingAccent} transition-all`}
      style={{
        height: '40px',
        minHeight: '40px',
        background: 'var(--daw-panel-glass)',
        backdropFilter: 'blur(16px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
      }}
      role="toolbar"
      aria-label="Record and export"
    >

      {/* ------------------------------------------------------------------ */}
      {/* IDLE STATE                                                           */}
      {/* ------------------------------------------------------------------ */}
      {barState === 'idle' && (
        <>
          {/* Label */}
          <span className="text-daw-textMuted tracking-widest text-[10px] flex-none">
            REC / EXPORT
          </span>

          <div className="w-px h-5 bg-daw-border flex-none mx-1" />

          {/* Record button */}
          <button
            onClick={handleRecord}
            className={[
              'flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold tracking-wider',
              'border border-daw-red text-daw-red',
              'hover:bg-daw-red hover:text-white transition-all',
              'focus:outline-none focus:ring-1 focus:ring-daw-red',
            ].join(' ')}
            title="Start recording the master output"
          >
            <span>⏺</span>
            <span>RECORD</span>
          </button>

          {/* Export (record-then-download) button */}
          <button
            onClick={handleExport}
            className={[
              'flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold tracking-wider',
              'border border-daw-green text-daw-green',
              'hover:bg-daw-green hover:text-white transition-all',
              'focus:outline-none focus:ring-1 focus:ring-daw-green',
            ].join(' ')}
            title="Export as WebM — plays your beat and records to a file"
          >
            <span>💾</span>
            <span>EXPORT</span>
          </button>

          {/* Hint */}
          <span className="text-daw-textMuted text-[10px] ml-2 hidden sm:block">
            {activeView === 'playlist'
              ? 'Records playlist arrangement'
              : 'Play your beat then click Stop & Save'}
          </span>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* RECORDING STATE                                                      */}
      {/* ------------------------------------------------------------------ */}
      {barState === 'recording' && (
        <>
          {/* Pulsing indicator */}
          <span
            className="flex-none w-2.5 h-2.5 rounded-full bg-daw-red"
            style={{ animation: 'recPulse 1s ease-in-out infinite' }}
            aria-label="Recording"
          />
          <style>{`
            @keyframes recPulse {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.3; }
            }
          `}</style>

          <span className="text-daw-red font-bold tracking-widest text-[10px] flex-none">
            REC
          </span>

          {/* Waveform animation */}
          <WaveformAnimation />

          {/* Duration */}
          <span
            className="px-2 py-0.5 bg-daw-card border border-daw-border rounded text-daw-accent tabular-nums tracking-wider flex-none"
            aria-live="polite"
            aria-label={`Recording duration: ${displayDuration}`}
          >
            {displayDuration}
          </span>

          <div className="flex-1" />

          {/* Stop & Save */}
          <button
            onClick={handleStopAndSave}
            className={[
              'flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold tracking-wider',
              'bg-daw-green text-white',
              'hover:opacity-80 transition-opacity',
              'focus:outline-none focus:ring-1 focus:ring-daw-green',
            ].join(' ')}
            title="Stop recording and download"
          >
            <span>⏹</span>
            <span>STOP &amp; SAVE</span>
          </button>

          {/* Cancel */}
          <button
            onClick={handleCancel}
            className={[
              'flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold tracking-wider',
              'border border-daw-border text-daw-textMuted',
              'hover:border-daw-red hover:text-daw-red transition-colors',
              'focus:outline-none focus:ring-1 focus:ring-daw-red',
            ].join(' ')}
            title="Cancel recording without saving"
          >
            <span>✕</span>
            <span className="hidden sm:inline">CANCEL</span>
          </button>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PROCESSING STATE                                                     */}
      {/* ------------------------------------------------------------------ */}
      {barState === 'processing' && (
        <>
          <Spinner />
          <span className="text-daw-textMuted tracking-wider text-[10px]">
            Preparing download...
          </span>
        </>
      )}
    </div>
  );
}
