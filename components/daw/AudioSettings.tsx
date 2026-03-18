'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDAWStore } from '@/lib/store';
import type { AudioLatencyHint, AudioSampleRate } from '@/lib/store';

const LATENCY_OPTIONS: { value: AudioLatencyHint; label: string; desc: string }[] = [
  { value: 'interactive', label: 'Low Latency', desc: 'Lowest latency, higher CPU' },
  { value: 'balanced', label: 'Balanced', desc: 'Good balance of latency & stability' },
  { value: 'playback', label: 'High Stability', desc: 'Most stable, higher latency' },
];

const SAMPLE_RATE_OPTIONS: { value: AudioSampleRate; label: string }[] = [
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
  { value: 96000, label: '96 kHz' },
];

export default function AudioSettings() {
  const audioLatency = useDAWStore((s) => s.audioLatency);
  const audioSampleRate = useDAWStore((s) => s.audioSampleRate);
  const setAudioLatency = useDAWStore((s) => s.setAudioLatency);
  const setAudioSampleRate = useDAWStore((s) => s.setAudioSampleRate);

  const [open, setOpen] = useState(false);

  // Live read of actual context values (updated when popover opens)
  const [actualLatency, setActualLatency] = useState<number | null>(null);
  const [actualSampleRate, setActualSampleRate] = useState<number | null>(null);

  const readContextInfo = useCallback(() => {
    try {
      // Dynamic import to avoid SSR issues — Tone is already loaded by the engine
      import('tone').then((Tone) => {
        const rawCtx = Tone.getContext().rawContext as AudioContext;
        if (rawCtx) {
          setActualLatency(rawCtx.baseLatency ?? null);
          setActualSampleRate(rawCtx.sampleRate ?? null);
        }
      });
    } catch {
      // Non-fatal
    }
  }, []);

  // Re-read context info whenever popover opens or settings change
  useEffect(() => {
    if (open) {
      // Small delay to let the context reinit settle
      const timer = setTimeout(readContextInfo, 200);
      return () => clearTimeout(timer);
    }
  }, [open, audioLatency, audioSampleRate, readContextInfo]);

  return (
    <div className="relative flex-none">
      {/* Gear icon button */}
      <button
        onClick={() => setOpen(!open)}
        className={[
          'w-7 h-7 flex items-center justify-center rounded text-xs transition-all',
          open
            ? 'bg-daw-accent text-white'
            : 'bg-daw-card text-daw-textMuted hover:bg-daw-card hover:text-daw-text border border-transparent hover:border-daw-border',
        ].join(' ')}
        title="Audio Settings"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Popover dropdown */}
      {open && (
        <>
          {/* Backdrop to close on click-outside */}
          <div
            className="fixed inset-0 z-[199]"
            onClick={() => setOpen(false)}
          />

          <div
            className="absolute top-full right-0 mt-2 z-[200] rounded-lg overflow-hidden"
            style={{
              background: 'var(--daw-panel)',
              border: '1px solid var(--daw-border)',
              boxShadow:
                '0 8px 40px rgba(0,0,0,0.5), 0 0 30px var(--daw-glow-color)',
              minWidth: 240,
              backdropFilter: 'blur(20px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 text-[9px] font-mono tracking-[0.2em] uppercase border-b"
              style={{
                color: 'var(--daw-text-muted)',
                borderColor: 'var(--daw-border)',
              }}
            >
              Audio Settings
            </div>

            <div className="p-3 flex flex-col gap-3">
              {/* Latency mode selector */}
              <div>
                <label className="text-[9px] font-mono tracking-widest text-daw-textMuted uppercase mb-1.5 block">
                  Latency Mode
                </label>
                <div className="flex flex-col gap-1">
                  {LATENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAudioLatency(opt.value)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-all text-[11px] font-mono"
                      style={{
                        color:
                          audioLatency === opt.value
                            ? 'var(--daw-text)'
                            : 'var(--daw-text-muted)',
                        background:
                          audioLatency === opt.value
                            ? 'var(--daw-card)'
                            : 'transparent',
                        borderLeft:
                          audioLatency === opt.value
                            ? '2px solid var(--daw-accent)'
                            : '2px solid transparent',
                      }}
                    >
                      <div className="flex flex-col">
                        <span className="tracking-wider">{opt.label}</span>
                        <span
                          className="text-[9px]"
                          style={{ color: 'var(--daw-text-muted)' }}
                        >
                          {opt.desc}
                        </span>
                      </div>
                      {audioLatency === opt.value && (
                        <span
                          className="ml-auto w-1.5 h-1.5 rounded-full flex-none"
                          style={{
                            backgroundColor: 'var(--daw-accent)',
                            boxShadow: '0 0 6px var(--daw-accent)',
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sample rate selector */}
              <div>
                <label className="text-[9px] font-mono tracking-widest text-daw-textMuted uppercase mb-1.5 block">
                  Sample Rate
                </label>
                <div className="flex gap-1">
                  {SAMPLE_RATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAudioSampleRate(opt.value)}
                      className="flex-1 px-2 py-1.5 rounded text-[10px] font-mono tracking-wider transition-all text-center"
                      style={{
                        color:
                          audioSampleRate === opt.value
                            ? 'white'
                            : 'var(--daw-text-muted)',
                        background:
                          audioSampleRate === opt.value
                            ? 'var(--daw-accent)'
                            : 'var(--daw-card)',
                        border:
                          audioSampleRate === opt.value
                            ? '1px solid var(--daw-accent)'
                            : '1px solid var(--daw-border)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actual context info readout */}
              <div
                className="rounded px-2 py-2 text-[9px] font-mono flex flex-col gap-1"
                style={{
                  background: 'var(--daw-bg)',
                  border: '1px solid var(--daw-border)',
                }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--daw-text-muted)' }}>
                    Base Latency
                  </span>
                  <span className="text-daw-text tabular-nums">
                    {actualLatency !== null
                      ? `${(actualLatency * 1000).toFixed(1)} ms`
                      : '--'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--daw-text-muted)' }}>
                    Actual Sample Rate
                  </span>
                  <span className="text-daw-text tabular-nums">
                    {actualSampleRate !== null
                      ? `${(actualSampleRate / 1000).toFixed(1)} kHz`
                      : '--'}
                  </span>
                </div>
              </div>

              {/* Warning note */}
              <p
                className="text-[9px] font-mono leading-relaxed"
                style={{ color: 'var(--daw-text-muted)' }}
              >
                Changing settings will briefly stop playback while the audio
                engine reinitialises.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
