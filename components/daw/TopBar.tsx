'use client';

import { useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { useDAWStore } from '@/lib/store';
import { ViewType } from '@/lib/types';
import AudioSettings from './AudioSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a step index as a DAW position string: "bar.beat.tick" */
function formatPosition(step: number): string {
  const bar = Math.floor(step / 16) + 1;
  const beat = Math.floor((step % 16) / 4) + 1;
  const tick = (step % 4) * 250; // 0 | 250 | 500 | 750
  return `${String(bar).padStart(2, '0')}.${beat}.${String(tick).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Thin vertical divider between sections */
function Divider() {
  return <div className="self-stretch w-px bg-daw-border mx-1 flex-none" />;
}

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

export default function TopBar() {
  // ---- Store ---------------------------------------------------------------
  const projectName = useDAWStore((s) => s.projectName);
  const bpm = useDAWStore((s) => s.bpm);
  const isPlaying = useDAWStore((s) => s.isPlaying);
  const isRecording = useDAWStore((s) => s.isRecording);
  const activeView = useDAWStore((s) => s.activeView);

  // Position display — direct DOM update to avoid re-rendering entire TopBar on every step
  const positionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unsub = useDAWStore.subscribe(
      (s) => s.currentStep,
      (step) => {
        if (positionRef.current) {
          positionRef.current.textContent = formatPosition(step);
        }
      },
    );
    return unsub;
  }, []);
  const beatGeneratorOpen = useDAWStore((s) => s.beatGeneratorOpen);
  const patterns = useDAWStore((s) => s.patterns);
  const activePatternId = useDAWStore((s) => s.activePatternId);
  const masterVolume = useDAWStore((s) => s.masterVolume);
  const timeSignature = useDAWStore((s) => s.timeSignature);

  const setBpm = useDAWStore((s) => s.setBpm);
  const togglePlay = useDAWStore((s) => s.togglePlay);
  const stop = useDAWStore((s) => s.stop);
  const setActiveView = useDAWStore((s) => s.setActiveView);
  const setBeatGeneratorOpen = useDAWStore((s) => s.setBeatGeneratorOpen);
  const sampleSlicerOpen = useDAWStore((s) => s.sampleSlicerOpen);
  const setSampleSlicerOpen = useDAWStore((s) => s.setSampleSlicerOpen);
  const setMasterVolume = useDAWStore((s) => s.setMasterVolume);
  const addPattern = useDAWStore((s) => s.addPattern);
  const setActivePattern = useDAWStore((s) => s.setActivePattern);
  const updatePattern = useDAWStore((s) => s.updatePattern);
  // ---- Tap tempo -----------------------------------------------------------
  const tapTimestamps = useRef<number[]>([]);

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    tapTimestamps.current.push(now);

    // Keep only the last 5 taps (gives 4 intervals)
    if (tapTimestamps.current.length > 5) {
      tapTimestamps.current = tapTimestamps.current.slice(-5);
    }

    if (tapTimestamps.current.length >= 2) {
      const timestamps = tapTimestamps.current;
      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avgInterval);
      setBpm(Math.max(40, Math.min(300, newBpm)));
    }
  }, [setBpm]);

  // ---- Project name editing ------------------------------------------------
  const handleProjectNameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (e.currentTarget as HTMLSpanElement).blur();
      }
    },
    []
  );

  const handleProjectNameBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      const newName = e.currentTarget.textContent?.trim();
      if (newName && newName !== projectName) {
        useDAWStore.setState({ projectName: newName });
      } else {
        // Restore original if blank
        e.currentTarget.textContent = projectName;
      }
    },
    [projectName]
  );

  // ---- View tabs -----------------------------------------------------------
  const views: { id: ViewType; label: string }[] = [
    { id: 'channelrack', label: 'CHANNEL RACK' },
    { id: 'piano-roll', label: 'PIANO ROLL' },
    { id: 'mixer', label: 'MIXER' },
    { id: 'playlist', label: 'PLAYLIST' },
  ];

  // ---- Render --------------------------------------------------------------
  return (
    <header
      className="w-full h-12 flex items-center border-b border-daw-border select-none overflow-x-auto overflow-y-hidden gap-0 px-0"
      style={{
        background: 'var(--daw-panel-glass)',
        backdropFilter: 'blur(16px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
      }}
    >

      {/* ================================================================== */}
      {/* 1. LOGO + PROJECT NAME                                              */}
      {/* ================================================================== */}
      <div className="flex items-center gap-2 px-3 flex-none min-w-[160px]">
        {/* Icon */}
        <div className="flex-none w-7 h-7 rounded-full bg-daw-accent flex items-center justify-center text-sm leading-none">
          🎵
        </div>

        {/* Brand */}
        <div className="flex flex-col leading-none">
          <span className="text-daw-accent font-bold text-xs tracking-wider">YGBeatz</span>
        </div>

        <Divider />

        {/* Editable project name */}
        <span
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={handleProjectNameBlur}
          onKeyDown={handleProjectNameKeyDown}
          className="text-daw-text text-xs outline-none cursor-text min-w-[80px] max-w-[140px] truncate rounded px-1 hover:bg-daw-card focus:bg-daw-card focus:ring-1 focus:ring-daw-accent transition-colors"
          title="Click to rename project"
        >
          {projectName}
        </span>
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 2. TRANSPORT CONTROLS                                               */}
      {/* ================================================================== */}
      <div className="flex items-center gap-1 px-2 flex-none">
        {/* Rewind */}
        <button
          onClick={() => useDAWStore.getState().stop()}
          className="w-7 h-7 flex items-center justify-center rounded text-daw-textMuted hover:bg-daw-card hover:text-daw-text transition-colors text-xs"
          title="Rewind to start"
        >
          ⏮
        </button>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className={[
            'w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-all',
            isPlaying
              ? 'bg-daw-green text-white ring-2 ring-daw-green ring-offset-1 ring-offset-daw-panel'
              : 'bg-daw-card text-daw-green hover:bg-daw-card hover:ring-1 hover:ring-daw-green',
          ].join(' ')}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Stop */}
        <button
          onClick={stop}
          className="w-7 h-7 flex items-center justify-center rounded bg-daw-card text-daw-textMuted hover:bg-daw-card hover:text-daw-text transition-colors text-xs"
          title="Stop"
        >
          ⏹
        </button>

        {/* Record */}
        <button
          className={[
            'w-7 h-7 flex items-center justify-center rounded text-xs transition-all',
            isRecording
              ? 'bg-daw-red text-white ring-2 ring-daw-red ring-offset-1 ring-offset-daw-panel animate-pulse'
              : 'bg-daw-card text-daw-red hover:bg-daw-card hover:ring-1 hover:ring-daw-red',
          ].join(' ')}
          title="Record"
          aria-pressed={isRecording}
        >
          ⏺
        </button>

        {/* Position display — updated via ref, not React state */}
        <div
          ref={positionRef}
          className="ml-1 px-2 py-1 bg-daw-card border border-daw-border rounded text-[10px] text-daw-accent font-mono tracking-wider min-w-[86px] text-center"
        >
          {formatPosition(0)}
        </div>
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 3. BPM + TAP TEMPO                                                  */}
      {/* ================================================================== */}
      <div className="flex items-center gap-1.5 px-2 flex-none">
        <span className="text-daw-textMuted text-[10px] tracking-widest">BPM</span>
        <input
          type="number"
          min={40}
          max={300}
          step={1}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-14 bg-daw-card border border-daw-border text-daw-text text-xs text-center rounded px-1 py-1 outline-none focus:border-daw-accent transition-colors font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          onClick={handleTapTempo}
          className="px-2 py-1 bg-daw-card border border-daw-border text-daw-textMuted text-[10px] rounded hover:bg-daw-accentDark hover:text-white hover:border-daw-accent transition-all font-mono tracking-wider"
          title="Tap to set tempo"
        >
          TAP
        </button>
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 4. TIME SIGNATURE                                                   */}
      {/* ================================================================== */}
      <div className="flex items-center px-2 flex-none">
        <div className="flex flex-col items-center leading-none bg-daw-card border border-daw-border rounded px-2 py-1">
          <span className="text-daw-text text-[10px] font-bold leading-none">{timeSignature[0]}</span>
          <div className="w-3 h-px bg-daw-border my-0.5" />
          <span className="text-daw-text text-[10px] font-bold leading-none">{timeSignature[1]}</span>
        </div>
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 5. PATTERN SELECTOR                                                 */}
      {/* ================================================================== */}
      <div className="flex items-center gap-1 px-2 flex-none">
        <span className="text-daw-textMuted text-[10px] tracking-widest mr-1">PAT</span>

        <div className="relative">
          <select
            value={activePatternId}
            onChange={(e) => setActivePattern(e.target.value)}
            className="bg-daw-card border border-daw-border text-daw-text text-xs rounded px-2 py-1 outline-none focus:border-daw-accent appearance-none cursor-pointer pr-6 max-w-[120px] transition-colors"
          >
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/* Dropdown arrow */}
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-daw-textMuted text-[8px]">
            ▼
          </span>
        </div>

        {/* Pattern name inline editor for active pattern */}
        <input
          type="text"
          value={patterns.find((p) => p.id === activePatternId)?.name ?? ''}
          onChange={(e) =>
            updatePattern(activePatternId, { name: e.target.value })
          }
          className="w-24 bg-daw-card border border-daw-border text-daw-accent text-xs rounded px-2 py-1 outline-none focus:border-daw-accent font-mono transition-colors hidden sm:block"
          placeholder="Pattern name"
        />

        {/* Add pattern */}
        <button
          onClick={addPattern}
          className="w-6 h-6 flex items-center justify-center rounded bg-daw-card border border-daw-border text-daw-textMuted hover:text-daw-accent hover:border-daw-accent transition-colors text-xs font-bold"
          title="Add new pattern"
        >
          +
        </button>
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 6. VIEW TABS                                                        */}
      {/* ================================================================== */}
      <div className="flex items-center gap-0.5 px-2 flex-none">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            className={[
              'px-2.5 py-1 rounded text-[10px] font-mono tracking-wider transition-all',
              activeView === v.id
                ? 'bg-daw-accent text-white font-bold'
                : 'bg-daw-card text-daw-textMuted hover:bg-daw-card hover:text-daw-text border border-transparent hover:border-daw-border',
            ].join(' ')}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 7. AI BEAT GEN + SAMPLE SLICER                                      */}
      {/* ================================================================== */}
      <div className="flex items-center gap-1.5 px-2 flex-none">
        <button
          onClick={() => setBeatGeneratorOpen(!beatGeneratorOpen)}
          className={[
            'px-3 py-1.5 rounded text-[10px] font-mono font-bold tracking-wider transition-all',
            'bg-gradient-to-r from-daw-accent to-daw-purple text-white',
            'hover:from-daw-accentDark hover:to-daw-purple hover:shadow-lg hover:shadow-daw-accent/25',
            beatGeneratorOpen ? 'ring-2 ring-daw-accent ring-offset-1 ring-offset-daw-panel' : '',
          ].join(' ')}
          title="Open AI Beat Generator"
        >
          ✨ AI BEAT
        </button>

        <button
          onClick={() => setSampleSlicerOpen(!sampleSlicerOpen)}
          className={[
            'px-3 py-1.5 rounded text-[10px] font-mono font-bold tracking-wider transition-all',
            'bg-gradient-to-r from-emerald-600 to-teal-700 text-white',
            'hover:from-emerald-500 hover:to-teal-600 hover:shadow-lg hover:shadow-emerald-500/25',
            sampleSlicerOpen ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-daw-panel' : '',
          ].join(' ')}
          title="Open Sample Slicer"
        >
          ✂️ SAMPLE
        </button>

      </div>

      <Divider />

      {/* ================================================================== */}
      {/* 8. MASTER VOLUME                                                    */}
      {/* ================================================================== */}
      <div className="flex items-center gap-1.5 px-3 flex-none ml-auto">
        <span className="text-daw-textMuted text-[10px] tracking-widest">VOL</span>
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            className="w-24 h-1.5 cursor-pointer rounded-full"
            title={`Master Volume: ${Math.round(masterVolume * 100)}%`}
            style={{
              accentColor: 'var(--daw-accent)',
              background: `linear-gradient(to right, var(--daw-accent) ${masterVolume * 100}%, var(--daw-step-off) ${masterVolume * 100}%)`,
            }}
          />
        </div>
        <span className="text-daw-textMuted text-[10px] w-8 text-right tabular-nums">
          {Math.round(masterVolume * 100)}%
        </span>

        {/* Audio settings gear icon */}
        <AudioSettings />
      </div>
    </header>
  );
}
