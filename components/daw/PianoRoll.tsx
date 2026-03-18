'use client';

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import { useDAWStore } from '@/lib/store';
import { midiToNoteName } from '@/lib/types';
import type { Note } from '@/lib/types';
import { AudioEngine } from '@/lib/audioEngine';

// ─────────────────────────── constants ───────────────────────────

const NOTE_HEIGHT = 20; // px per semitone row
const MIN_COL_WIDTH = 20; // px per 16th-note column at zoom 1x
const PIANO_WIDTH = 64; // px — left piano-key panel
const HEADER_HEIGHT = 24; // px — time ruler at top of grid
const TOOLBAR_HEIGHT = 40; // px — top toolbar

// Visible pitch range: C2 (36) – C8 (96)
const MIN_PITCH = 24; // C1 — a bit below to give room
const MAX_PITCH = 108; // C8

const TOTAL_PITCHES = MAX_PITCH - MIN_PITCH + 1; // rows in the grid

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // semitone offsets within octave
const isBlackKey = (midi: number) => BLACK_KEYS.has(midi % 12);

// Default grid length: 2 bars = 32 sixteenth-note columns
const DEFAULT_COLS = 32;

const QUANTIZE_OPTIONS: { label: string; value: number }[] = [
  { label: '1/16', value: 1 },
  { label: '1/8', value: 2 },
  { label: '1/4', value: 4 },
  { label: '1/2', value: 8 },
  { label: '1 bar', value: 16 },
];

// ─────────────────────────── helpers ─────────────────────────────

function pitchToY(pitch: number): number {
  // Top of the grid = MAX_PITCH; each semitone = NOTE_HEIGHT px
  return (MAX_PITCH - pitch) * NOTE_HEIGHT;
}

function yToPitch(y: number): number {
  return MAX_PITCH - Math.floor(y / NOTE_HEIGHT);
}

function colToX(col: number, colWidth: number): number {
  return col * colWidth;
}

function xToCol(x: number, colWidth: number): number {
  return Math.floor(x / colWidth);
}

// ─────────────────────────── sub-components ──────────────────────

interface PianoKeyProps {
  midi: number;
  height: number;
  onPress: (midi: number) => void;
}

const PianoKey = React.memo(function PianoKey({ midi, height, onPress }: PianoKeyProps) {
  const black = isBlackKey(midi);
  const name = midiToNoteName(midi);
  const isC = midi % 12 === 0;

  return (
    <div
      className={[
        'relative flex items-center select-none cursor-pointer border-b',
        'border-daw-border transition-opacity active:opacity-70',
        black
          ? 'bg-daw-card text-daw-textMuted justify-end pr-1'
          : 'bg-daw-text text-daw-bg justify-end pr-1',
        isC ? 'border-b-2 border-b-daw-accent/60' : '',
      ].join(' ')}
      style={{ height, minHeight: height }}
      onMouseDown={(e) => {
        e.preventDefault();
        onPress(midi);
      }}
    >
      {/* Note label — only on white keys that are C notes, or every white key if space allows */}
      {!black && (isC || height >= 18) && (
        <span
          className={[
            'text-[10px] font-mono leading-none pointer-events-none',
            isC ? 'font-bold text-daw-bg' : 'text-daw-bg/60',
          ].join(' ')}
        >
          {name}
        </span>
      )}
    </div>
  );
});

// ─────────────────────────── main component ──────────────────────

export default function PianoRoll() {
  // ── store ──
  const {
    getActivePattern,
    pianoRollChannelId,
    closePianoRoll,
    addNote,
    removeNote,
    updateNote,
  } = useDAWStore();

  const pattern = getActivePattern();
  const channel = pattern?.channels.find((c) => c.id === pianoRollChannelId);
  const notes: Note[] = useMemo(
    () => (pattern && pianoRollChannelId ? (pattern.pianoRollNotes[pianoRollChannelId] ?? []) : []),
    [pattern, pianoRollChannelId]
  );

  // ── local state ──
  const [quantize, setQuantize] = useState(1); // 1 = 1/16 note
  const [zoomX, setZoomX] = useState(1);

  // Resize-drag state
  const [resizingNote, setResizingNote] = useState<{
    noteId: string;
    startX: number;
    origDuration: number;
  } | null>(null);

  // ── refs ──
  // vertScrollRef: the single scroll container for both axes (wraps time ruler + grid body)
  // pianoScrollRef: piano key panel — overflow:hidden, scrollTop driven programmatically
  const pianoScrollRef = useRef<HTMLDivElement>(null);
  const vertScrollRef = useRef<HTMLDivElement>(null);

  // ── derived ──
  const colWidth = MIN_COL_WIDTH * zoomX;
  const totalCols = Math.max(DEFAULT_COLS, notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0) + 16);
  const gridWidth = totalCols * colWidth;
  const gridHeight = TOTAL_PITCHES * NOTE_HEIGHT;

  // ── initial scroll to C4 on mount ──
  useEffect(() => {
    const el = vertScrollRef.current;
    if (!el) return;
    // C4 = MIDI 60; center it vertically
    const c4Y = pitchToY(60);
    const viewH = el.clientHeight;
    el.scrollTop = Math.max(0, c4Y - viewH / 2 + NOTE_HEIGHT / 2);
  }, []); // run only once on mount

  // ── sync vertical scroll between piano and grid ──
  const syncScrollFromVert = useCallback(() => {
    const st = vertScrollRef.current?.scrollTop ?? 0;
    if (pianoScrollRef.current) pianoScrollRef.current.scrollTop = st;
  }, []);

  // ── key preview ──
  const handleKeyPress = useCallback((midi: number) => {
    if (!channel) return;
    try {
      AudioEngine.getInstance().previewNote(channel, midi, '8n');
    } catch (err) {
      console.warn('[PianoRoll] previewNote failed:', err);
    }
  }, [channel]);

  // ── note grid mouse interactions ──
  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!pianoRollChannelId) return;
      if (e.button !== 0) return; // left click only

      const target = e.target as HTMLElement;
      const noteEl = target.closest('[data-note-id]') as HTMLElement | null;

      if (noteEl) {
        const noteId = noteEl.dataset.noteId!;
        const isResizeHandle = target.closest('[data-resize-handle]');
        if (isResizeHandle) {
          // Begin resize drag
          const existingNote = notes.find((n) => n.id === noteId);
          if (!existingNote) return;
          e.preventDefault();
          setResizingNote({
            noteId,
            startX: e.clientX,
            origDuration: existingNote.duration,
          });
          return;
        }
        // Click on note body = delete
        e.preventDefault();
        removeNote(pianoRollChannelId, noteId);
        return;
      }

      // Click on empty space = add note.
      // getBoundingClientRect() already incorporates scroll offset, so we only
      // subtract rect.left/top — no need to add scrollLeft/scrollTop separately.
      const gridEl = e.currentTarget as HTMLDivElement;
      const rect = gridEl.getBoundingClientRect();

      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      const rawCol = xToCol(relX, colWidth);
      const col = Math.floor(rawCol / quantize) * quantize;
      const pitch = yToPitch(relY);

      if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
      if (col < 0 || col >= totalCols) return;

      e.preventDefault();
      addNote(pianoRollChannelId, {
        pitch,
        start: col,
        duration: quantize,
        velocity: 0.8,
      });
    },
    [pianoRollChannelId, notes, colWidth, quantize, totalCols, addNote, removeNote]
  );

  // ── resize drag handlers ──
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizingNote || !pianoRollChannelId) return;
      const dx = e.clientX - resizingNote.startX;
      const deltaCols = Math.round(dx / colWidth);
      const newDuration = Math.max(quantize, resizingNote.origDuration + deltaCols * quantize);
      updateNote(pianoRollChannelId, resizingNote.noteId, { duration: newDuration });
    },
    [resizingNote, pianoRollChannelId, colWidth, quantize, updateNote]
  );

  const handleMouseUp = useCallback(() => {
    setResizingNote(null);
  }, []);

  useEffect(() => {
    if (!resizingNote) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingNote, handleMouseMove, handleMouseUp]);

  // ── clear all notes ──
  const handleClearAll = useCallback(() => {
    if (!pianoRollChannelId || !pattern) return;
    const channelNotes = pattern.pianoRollNotes[pianoRollChannelId] ?? [];
    channelNotes.forEach((n) => removeNote(pianoRollChannelId, n.id));
  }, [pianoRollChannelId, pattern, removeNote]);

  // ── zoom ──
  const zoomIn = () => setZoomX((z) => Math.min(4, parseFloat((z + 0.5).toFixed(1))));
  const zoomOut = () => setZoomX((z) => Math.max(0.5, parseFloat((z - 0.5).toFixed(1))));

  // ── render pitches array (high → low) ──
  const pitches = useMemo(() => {
    const arr: number[] = [];
    for (let p = MAX_PITCH; p >= MIN_PITCH; p--) arr.push(p);
    return arr;
  }, []);

  // ── column header labels ──
  const headerLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    for (let col = 0; col < totalCols; col++) {
      const bar = Math.floor(col / 16) + 1;
      const beat = Math.floor((col % 16) / 4) + 1;
      if (col % 4 === 0) {
        labels.push({ col, label: `${bar}.${beat}` });
      }
    }
    return labels;
  }, [totalCols]);

  // ── playback cursor — direct DOM update to avoid re-renders on every step ──
  const cursorRef = useRef<HTMLDivElement>(null);
  const colWidthRef = useRef(colWidth);
  colWidthRef.current = colWidth;
  useEffect(() => {
    const unsub = useDAWStore.subscribe(
      (s) => ({ step: s.currentStep, playing: s.isPlaying }),
      ({ step, playing }) => {
        if (cursorRef.current) {
          if (playing) {
            cursorRef.current.style.display = 'block';
            cursorRef.current.style.left = `${(step / 16) * colWidthRef.current * 16}px`;
          } else {
            cursorRef.current.style.display = 'none';
          }
        }
      },
    );
    return unsub;
  }, []);

  if (!channel) {
    const availableChannels = pattern?.channels ?? [];
    return (
      <div className="flex flex-col items-center justify-center h-full bg-daw-bg gap-6">
        <div className="text-center">
          <div className="text-daw-textMuted font-mono text-xs tracking-widest mb-1">PIANO ROLL</div>
          <div className="text-daw-text font-mono text-sm">Select a channel to edit</div>
        </div>
        {availableChannels.length > 0 ? (
          <div className="flex flex-col gap-1.5 w-64">
            {availableChannels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => useDAWStore.getState().openPianoRoll(ch.id)}
                className="flex items-center gap-3 px-4 py-2.5 rounded bg-daw-card border border-daw-border hover:border-daw-accent transition-colors text-left"
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="text-daw-text text-xs font-mono">{ch.name}</span>
                <span className="ml-auto text-daw-textMuted text-[10px]">{ch.type}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-daw-textMuted text-xs">No channels in active pattern.</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full h-full bg-daw-bg font-mono overflow-hidden"
      style={{ userSelect: resizingNote ? 'none' : undefined }}
    >
      {/* ───────────────── TOOLBAR ───────────────── */}
      <div
        className="flex items-center gap-3 px-3 border-b border-daw-border bg-daw-panel shrink-0"
        style={{ height: TOOLBAR_HEIGHT }}
      >
        {/* Back button */}
        <button
          onClick={closePianoRoll}
          className="flex items-center gap-1 px-2 py-1 text-xs text-daw-textMuted hover:text-daw-text border border-daw-border rounded transition-colors"
        >
          ← BACK
        </button>

        {/* Channel indicator */}
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: channel.color }}
          />
          <span className="text-xs text-daw-text truncate max-w-[120px]">{channel.name}</span>
        </div>

        <span className="text-xs text-daw-textMuted hidden sm:block">PIANO ROLL</span>

        <div className="flex-1" />

        {/* Quantize selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-daw-textMuted hidden sm:block">QUANTIZE</span>
          <select
            value={quantize}
            onChange={(e) => setQuantize(Number(e.target.value))}
            className="bg-daw-card border border-daw-border text-daw-text text-xs rounded px-1 py-0.5 cursor-pointer focus:outline-none focus:border-daw-accent"
          >
            {QUANTIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-daw-textMuted hidden sm:block">ZOOM</span>
          <button
            onClick={zoomOut}
            className="w-6 h-6 flex items-center justify-center bg-daw-card border border-daw-border text-daw-text text-sm rounded hover:border-daw-accent transition-colors"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-daw-textMuted w-8 text-center">{zoomX}x</span>
          <button
            onClick={zoomIn}
            className="w-6 h-6 flex items-center justify-center bg-daw-card border border-daw-border text-daw-text text-sm rounded hover:border-daw-accent transition-colors"
            title="Zoom in"
          >
            +
          </button>
        </div>

        {/* Clear all */}
        <button
          onClick={handleClearAll}
          className="px-2 py-1 text-xs text-red-400 border border-red-400/30 rounded hover:bg-red-400/10 transition-colors"
        >
          CLEAR ALL
        </button>
      </div>

      {/* ───────────────── MAIN AREA ───────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Piano keys column ── */}
        <div
          className="shrink-0 flex flex-col"
          style={{ width: PIANO_WIDTH }}
        >
          {/* Spacer to align with time ruler header */}
          <div
            className="shrink-0 bg-daw-panel border-b border-r border-daw-border"
            style={{ height: HEADER_HEIGHT }}
          />
          {/* Scrollable piano keys — synced with vertical scroll */}
          <div
            ref={pianoScrollRef}
            className="flex-1 overflow-hidden border-r border-daw-border"
            style={{ overflowY: 'hidden' }}
          >
            <div style={{ height: gridHeight }}>
              {pitches.map((midi) => (
                <PianoKey
                  key={midi}
                  midi={midi}
                  height={NOTE_HEIGHT}
                  onPress={handleKeyPress}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Note grid column ── */}
        <div
          ref={vertScrollRef}
          className="flex-1 min-w-0 overflow-auto"
          onScroll={syncScrollFromVert}
        >
          {/* inner wrapper: full grid dimensions */}
          <div style={{ width: gridWidth, minHeight: gridHeight + HEADER_HEIGHT }}>

            {/* Time ruler */}
            <div
              className="sticky top-0 z-10 bg-daw-panel border-b border-daw-border"
              style={{ height: HEADER_HEIGHT, width: gridWidth }}
            >
              <div className="relative h-full">
                {headerLabels.map(({ col, label }) => {
                  const isBar = col % 16 === 0;
                  return (
                    <div
                      key={col}
                      className="absolute top-0 flex items-end pb-0.5"
                      style={{
                        left: colToX(col, colWidth),
                        height: HEADER_HEIGHT,
                      }}
                    >
                      <div
                        className={[
                          'absolute top-0 bottom-0 w-px',
                          isBar ? 'bg-daw-text/30' : 'bg-daw-border',
                        ].join(' ')}
                      />
                      <span
                        className={[
                          'text-[9px] pl-1 leading-none',
                          isBar ? 'text-daw-text' : 'text-daw-textMuted',
                        ].join(' ')}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Note grid body */}
            <div
              className="relative"
              style={{ width: gridWidth, height: gridHeight }}
              onMouseDown={handleGridMouseDown}
            >
              {/* ── Row backgrounds (pitch rows) ── */}
              {pitches.map((midi) => {
                const black = isBlackKey(midi);
                const y = pitchToY(midi);
                return (
                  <div
                    key={midi}
                    className={[
                      'absolute left-0 right-0 border-b border-daw-border/40',
                      black ? 'bg-daw-bg/80' : 'bg-transparent',
                    ].join(' ')}
                    style={{ top: y, height: NOTE_HEIGHT }}
                  />
                );
              })}

              {/* ── Column grid lines ── */}
              {Array.from({ length: totalCols + 1 }, (_, col) => {
                const isBar = col % 16 === 0;
                const isBeat = col % 4 === 0;
                if (!isBeat && !isBar) return null;
                return (
                  <div
                    key={`col-${col}`}
                    className={[
                      'absolute top-0 bottom-0 w-px pointer-events-none',
                      isBar
                        ? 'bg-daw-text/25'
                        : 'bg-daw-border/60',
                    ].join(' ')}
                    style={{ left: colToX(col, colWidth) }}
                  />
                );
              })}

              {/* Fine column lines (every step) */}
              {Array.from({ length: totalCols + 1 }, (_, col) => {
                if (col % 4 === 0) return null; // already drawn above
                return (
                  <div
                    key={`fine-${col}`}
                    className="absolute top-0 bottom-0 w-px pointer-events-none bg-daw-border/20"
                    style={{ left: colToX(col, colWidth) }}
                  />
                );
              })}

              {/* ── Notes ── */}
              {notes.map((note) => {
                const x = colToX(note.start, colWidth);
                const y = pitchToY(note.pitch);
                const w = Math.max(8, note.duration * colWidth - 2);
                const h = NOTE_HEIGHT - 2;
                const opacity = 0.4 + note.velocity * 0.6;
                const noteName = midiToNoteName(note.pitch);
                const showLabel = w > 28;

                return (
                  <div
                    key={note.id}
                    data-note-id={note.id}
                    className="absolute rounded-sm flex items-center overflow-hidden cursor-pointer z-10 group"
                    style={{
                      left: x,
                      top: y + 1,
                      width: w,
                      height: h,
                      backgroundColor: channel.color,
                      opacity,
                      borderRadius: 2,
                    }}
                    title={`${noteName} vel:${Math.round(note.velocity * 100)}% dur:${note.duration}`}
                  >
                    {/* Note label */}
                    {showLabel && (
                      <span className="text-[9px] font-mono text-white/90 pl-1 pointer-events-none truncate leading-none">
                        {noteName}
                      </span>
                    )}

                    {/* Resize handle — right edge */}
                    <div
                      data-resize-handle="true"
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity bg-white/20"
                      title="Drag to resize"
                    />
                  </div>
                );
              })}

              {/* ── Playback cursor — positioned via ref, not React state ── */}
              <div
                ref={cursorRef}
                className="absolute top-0 bottom-0 w-0.5 bg-daw-accent z-20 pointer-events-none"
                style={{ display: 'none', left: 0 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
