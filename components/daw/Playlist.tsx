'use client';

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useDAWStore } from '@/lib/store';
import { PlaylistClip, Pattern } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TRACK_COUNT = 8;
const TRACK_HEIGHT = 72;
const HEADER_HEIGHT = 32;
const TRACK_HEADER_WIDTH = 172;
const BAR_HEADER_HEIGHT = 24;
const DEFAULT_BAR_WIDTH = 80;
const MIN_BAR_WIDTH = 30;
const MAX_BAR_WIDTH = 200;

const TRACK_COLORS = [
  '#ff4444',
  '#ff8800',
  '#ffcc00',
  '#88cc00',
  '#00ccff',
  '#aa44ff',
  '#ff44aa',
  '#4488ff',
];

const DEFAULT_TRACK_NAMES = [
  'Track 1',
  'Track 2',
  'Track 3',
  'Track 4',
  'Track 5',
  'Track 6',
  'Track 7',
  'Track 8',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, val));
}

// ─── Track Header ─────────────────────────────────────────────────────────────

interface TrackHeaderProps {
  index: number;
  name: string;
  color: string;
  muted: boolean;
  solo: boolean;
  onNameChange: (name: string) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
}

function TrackHeader({
  index,
  name,
  color,
  muted,
  solo,
  onNameChange,
  onMuteToggle,
  onSoloToggle,
}: TrackHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    onNameChange(draft.trim() || name);
    setEditing(false);
  };

  return (
    <div
      className="flex items-center gap-1.5 px-2 border-b border-white/5 shrink-0 relative overflow-hidden"
      style={{
        width: TRACK_HEADER_WIDTH,
        height: TRACK_HEIGHT,
        background: `linear-gradient(90deg, ${color}1a 0%, transparent 100%)`,
      }}
    >
      <div
        className="shrink-0 rounded-sm"
        style={{
          width: 3,
          height: TRACK_HEIGHT - 16,
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />

      <span
        className="font-mono text-[10px] shrink-0 w-4 text-center"
        style={{ color: 'rgba(255,255,255,0.3)' }}
      >
        {index + 1}
      </span>

      <div className="flex-1 overflow-hidden">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded px-1 text-[10px] font-mono outline-none"
            style={{
              background: 'var(--daw-bg)',
              border: '1px solid #ff8c00',
              color: '#fff',
            }}
          />
        ) : (
          <span
            className="block truncate text-[10px] font-mono cursor-pointer transition-colors"
            style={{ color: 'rgba(255,255,255,0.7)' }}
            onDoubleClick={startEdit}
            title="Double-click to rename"
          >
            {name}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          onClick={onMuteToggle}
          className="w-5 h-5 rounded text-[8px] font-mono font-bold transition-all focus:outline-none"
          style={{
            background: muted ? '#cc3333' : 'rgba(255,255,255,0.06)',
            color: muted ? '#fff' : 'rgba(255,255,255,0.3)',
            boxShadow: muted ? '0 0 4px rgba(204,51,51,0.5)' : 'none',
          }}
          title="Mute"
        >
          M
        </button>
        <button
          onClick={onSoloToggle}
          className="w-5 h-5 rounded text-[8px] font-mono font-bold transition-all focus:outline-none"
          style={{
            background: solo ? '#ffbb00' : 'rgba(255,255,255,0.06)',
            color: solo ? '#000' : 'rgba(255,255,255,0.3)',
            boxShadow: solo ? '0 0 4px rgba(255,187,0,0.5)' : 'none',
          }}
          title="Solo"
        >
          S
        </button>
      </div>
    </div>
  );
}

// ─── Clip ─────────────────────────────────────────────────────────────────────

interface ClipProps {
  clip: PlaylistClip;
  patternName: string;
  barWidth: number;
  trackHeight: number;
  onRemove: () => void;
  onDragStart: (e: ReactMouseEvent, clip: PlaylistClip) => void;
  onResizeStart: (e: ReactMouseEvent, clip: PlaylistClip) => void;
}

function Clip({
  clip,
  patternName,
  barWidth,
  trackHeight,
  onRemove,
  onDragStart,
  onResizeStart,
}: ClipProps) {
  const left = clip.startBar * barWidth;
  const width = Math.max(clip.lengthBars * barWidth - 2, 4);
  const clipColor = clip.color ?? '#ff8c00';

  const handleContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    onRemove();
  };

  return (
    <div
      className="absolute select-none group"
      style={{
        left,
        top: 3,
        width,
        height: trackHeight - 6,
        borderRadius: 6,
        background: `linear-gradient(180deg, ${clipColor}cc 0%, ${clipColor}99 100%)`,
        border: `1px solid ${clipColor}cc`,
        boxShadow: `0 2px 8px ${clipColor}44, inset 0 1px 0 rgba(255,255,255,0.15)`,
        cursor: 'grab',
      }}
      onMouseDown={(e) => {
        if (e.button === 0) onDragStart(e, clip);
      }}
      onContextMenu={handleContextMenu}
      title={`${patternName} — right-click to delete`}
    >
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: 3,
          borderRadius: '6px 6px 0 0',
          background: 'rgba(255,255,255,0.3)',
        }}
      />
      <span
        className="absolute top-1 bottom-1 text-[9px] font-mono font-bold truncate flex items-center"
        style={{ color: 'rgba(0,0,0,0.8)', left: 6, right: 14 }}
      >
        {patternName}
      </span>

      {/* Resize handle — right edge */}
      <div
        className="absolute top-0 bottom-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        style={{ width: 10, cursor: 'ew-resize', borderRadius: '0 6px 6px 0' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) onResizeStart(e, clip);
        }}
        title="Drag to resize"
      >
        <div
          style={{
            width: 3,
            height: '50%',
            borderRadius: 2,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      </div>
    </div>
  );
}

// ─── Playlist ─────────────────────────────────────────────────────────────────

export default function Playlist() {
  const playlistClips = useDAWStore((s) => s.playlistClips);
  const playlistBars = useDAWStore((s) => s.playlistBars);
  const patterns = useDAWStore((s) => s.patterns);
  const activePatternId = useDAWStore((s) => s.activePatternId);
  const bpm = useDAWStore((s) => s.bpm);
  const playlistStep = useDAWStore((s) => s.playlistStep);
  const isPlaying = useDAWStore((s) => s.isPlaying);
  const addPlaylistClip = useDAWStore((s) => s.addPlaylistClip);
  const removePlaylistClip = useDAWStore((s) => s.removePlaylistClip);
  const movePlaylistClip = useDAWStore((s) => s.movePlaylistClip);
  const resizePlaylistClip = useDAWStore((s) => s.resizePlaylistClip);

  // Compute estimated total duration
  const totalSeconds = (playlistBars * 4 * 60) / bpm;
  const totalMins = Math.floor(totalSeconds / 60);
  const totalSecs = Math.floor(totalSeconds % 60);
  const totalTimeDisplay = `${totalMins}:${String(totalSecs).padStart(2, '0')}`;

  const [barWidth, setBarWidth] = useState(DEFAULT_BAR_WIDTH);
  const [trackNames, setTrackNames] = useState<string[]>(
    DEFAULT_TRACK_NAMES.slice(),
  );
  const [trackMuted, setTrackMuted] = useState<boolean[]>(
    Array(TRACK_COUNT).fill(false),
  );
  const [trackSolo, setTrackSolo] = useState<boolean[]>(
    Array(TRACK_COUNT).fill(false),
  );
  const [selectedPatternId, setSelectedPatternId] =
    useState<string>(activePatternId);

  useEffect(() => {
    setSelectedPatternId(activePatternId);
  }, [activePatternId]);

  // Drag state
  const draggingClip = useRef<{
    clip: PlaylistClip;
    offsetBar: number;
    offsetTrack: number;
    ghostLeft: number;
    ghostTop: number;
  } | null>(null);
  const [ghostPos, setGhostPos] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Resize state
  const resizingClip = useRef<{
    clip: PlaylistClip;
    ghostLengthBars: number;
  } | null>(null);
  const [resizeGhost, setResizeGhost] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  const getPatternName = useCallback(
    (patternId: string) =>
      patterns.find((p: Pattern) => p.id === patternId)?.name ?? 'Unknown',
    [patterns],
  );

  // Get the pattern's bar count for clip length
  const getPatternBars = useCallback(
    (patternId: string) => {
      const p = patterns.find((pat: Pattern) => pat.id === patternId);
      return p?.bars ?? 1;
    },
    [patterns],
  );

  // ── Grid click → add clip ──────────────────────────────────────────────────
  const handleGridMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, trackIndex: number) => {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const x =
        e.clientX - rect.left + (e.currentTarget.parentElement?.scrollLeft ?? 0);
      const barIndex = Math.floor(x / barWidth);
      if (barIndex < 0 || barIndex >= playlistBars) return;

      const patBars = getPatternBars(selectedPatternId);

      const existing = playlistClips.find(
        (c: PlaylistClip) =>
          c.track === trackIndex &&
          barIndex >= c.startBar &&
          barIndex < c.startBar + c.lengthBars,
      );
      if (existing) return;

      addPlaylistClip({
        patternId: selectedPatternId,
        track: trackIndex,
        startBar: barIndex,
        lengthBars: patBars,
        color: TRACK_COLORS[trackIndex % TRACK_COLORS.length],
      });
    },
    [barWidth, playlistBars, playlistClips, selectedPatternId, addPlaylistClip, getPatternBars],
  );

  // ── Clip drag ──────────────────────────────────────────────────────────────
  const handleClipDragStart = useCallback(
    (e: ReactMouseEvent, clip: PlaylistClip) => {
      e.stopPropagation();
      if (!gridRef.current) return;
      const gridRect = gridRef.current.getBoundingClientRect();
      const scrollLeft = gridRef.current.scrollLeft;
      const scrollTop = gridRef.current.scrollTop;

      const clipLeft = clip.startBar * barWidth;
      const clipTop = clip.track * TRACK_HEIGHT;
      const offsetBar = Math.floor(
        (e.clientX - gridRect.left + scrollLeft - clipLeft) / barWidth,
      );
      const offsetTrack = Math.floor(
        (e.clientY - gridRect.top + scrollTop - BAR_HEADER_HEIGHT - clipTop) /
          TRACK_HEIGHT,
      );

      draggingClip.current = {
        clip,
        offsetBar: clamp(offsetBar, 0, clip.lengthBars - 1),
        offsetTrack: clamp(offsetTrack, 0, TRACK_COUNT - 1),
        ghostLeft: clipLeft,
        ghostTop: clipTop,
      };
      setGhostPos({ left: clipLeft, top: clipTop + BAR_HEADER_HEIGHT });

      const onMove = (ev: MouseEvent) => {
        if (!draggingClip.current || !gridRef.current) return;
        const gr = gridRef.current.getBoundingClientRect();
        const sl = gridRef.current.scrollLeft;
        const st = gridRef.current.scrollTop;
        const rawBar =
          Math.floor((ev.clientX - gr.left + sl) / barWidth) -
          draggingClip.current.offsetBar;
        const rawTrack =
          Math.floor(
            (ev.clientY - gr.top + st - BAR_HEADER_HEIGHT) / TRACK_HEIGHT,
          ) - draggingClip.current.offsetTrack;

        const newBar = clamp(
          rawBar,
          0,
          playlistBars - draggingClip.current.clip.lengthBars,
        );
        const newTrack = clamp(rawTrack, 0, TRACK_COUNT - 1);

        setGhostPos({
          left: newBar * barWidth,
          top: newTrack * TRACK_HEIGHT + BAR_HEADER_HEIGHT,
        });
        draggingClip.current.ghostLeft = newBar * barWidth;
        draggingClip.current.ghostTop = newTrack * TRACK_HEIGHT;
      };

      const onUp = () => {
        if (draggingClip.current) {
          const newBar = Math.round(draggingClip.current.ghostLeft / barWidth);
          const newTrack = Math.round(
            draggingClip.current.ghostTop / TRACK_HEIGHT,
          );
          movePlaylistClip(
            draggingClip.current.clip.id,
            clamp(newTrack, 0, TRACK_COUNT - 1),
            clamp(newBar, 0, playlistBars - 1),
          );
        }
        draggingClip.current = null;
        setGhostPos(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [barWidth, playlistBars, movePlaylistClip],
  );

  // ── Clip resize ────────────────────────────────────────────────────────────
  const handleClipResizeStart = useCallback(
    (e: ReactMouseEvent, clip: PlaylistClip) => {
      e.stopPropagation();
      if (!gridRef.current) return;

      resizingClip.current = { clip, ghostLengthBars: clip.lengthBars };
      setResizeGhost({
        left: clip.startBar * barWidth,
        top: clip.track * TRACK_HEIGHT + BAR_HEADER_HEIGHT + 3,
        width: Math.max(clip.lengthBars * barWidth - 2, 4),
      });

      const onMove = (ev: MouseEvent) => {
        if (!resizingClip.current || !gridRef.current) return;
        const gr = gridRef.current.getBoundingClientRect();
        const sl = gridRef.current.scrollLeft;
        const rawX = ev.clientX - gr.left + sl;
        const newLengthBars = Math.max(
          1,
          Math.round((rawX - resizingClip.current.clip.startBar * barWidth) / barWidth),
        );
        resizingClip.current.ghostLengthBars = newLengthBars;
        setResizeGhost((prev) =>
          prev ? { ...prev, width: Math.max(newLengthBars * barWidth - 2, 4) } : prev,
        );
      };

      const onUp = () => {
        if (resizingClip.current) {
          resizePlaylistClip(
            resizingClip.current.clip.id,
            resizingClip.current.ghostLengthBars,
          );
        }
        resizingClip.current = null;
        setResizeGhost(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [barWidth, resizePlaylistClip],
  );

  // Playhead position — uses playlistStep when playing in playlist mode, otherwise 0
  const playheadLeft = isPlaying ? (playlistStep / 16) * barWidth : 0;

  const totalGridWidth = playlistBars * barWidth;

  // CSS background for grid lines — replaces thousands of DOM elements
  const gridBgStyle = useCallback(
    (isEven: boolean) => {
      const baseBg = isEven ? 'rgba(30,30,46,0.9)' : 'rgba(22,22,34,0.9)';
      // Bar lines (solid) + beat lines (dotted at 1/4 intervals)
      return {
        backgroundColor: baseBg,
        backgroundImage: [
          // Bar border (every barWidth px)
          `repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${barWidth}px)`,
          // Beat gridlines at 1/4 bar
          `repeating-linear-gradient(90deg, transparent 0px, transparent ${barWidth * 0.25 - 0.5}px, rgba(255,255,255,0.03) ${barWidth * 0.25 - 0.5}px, rgba(255,255,255,0.03) ${barWidth * 0.25 + 0.5}px, transparent ${barWidth * 0.25 + 0.5}px, transparent ${barWidth}px)`,
        ].join(', '),
        backgroundSize: `${barWidth}px ${TRACK_HEIGHT}px`,
      };
    },
    [barWidth],
  );

  // Bar header background — CSS gradient instead of per-bar DOM elements
  const barHeaderBg = useCallback(() => {
    // Accent every 4 bars
    const fourBarWidth = barWidth * 4;
    return {
      backgroundImage: [
        // Bar borders
        `repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ${barWidth}px)`,
        // 4-bar accent
        `repeating-linear-gradient(90deg, rgba(255,140,0,0.04) 0px, rgba(255,140,0,0.04) ${fourBarWidth}px, transparent ${fourBarWidth}px, transparent ${fourBarWidth * 2}px)`,
      ].join(', '),
      backgroundSize: `${barWidth}px ${BAR_HEADER_HEIGHT}px, ${fourBarWidth * 2}px ${BAR_HEADER_HEIGHT}px`,
    };
  }, [barWidth]);

  // Generate bar number labels — only render numbers at reasonable intervals
  const barLabels = React.useMemo(() => {
    const labels: { bar: number; left: number; isAccent: boolean }[] = [];
    // Decide label interval based on zoom
    let interval = 1;
    if (barWidth < 40) interval = 4;
    else if (barWidth < 60) interval = 2;

    for (let b = 0; b < playlistBars; b += interval) {
      labels.push({
        bar: b + 1,
        left: b * barWidth,
        isAccent: b % 4 === 0,
      });
    }
    return labels;
  }, [playlistBars, barWidth]);

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden font-mono"
      style={{ background: 'var(--daw-bg)' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 shrink-0 border-b border-white/10"
        style={{
          height: HEADER_HEIGHT,
          background: `linear-gradient(90deg, var(--daw-panel) 0%, var(--daw-bg) 100%)`,
          borderLeft: '4px solid var(--daw-accent)',
        }}
      >
        <span className="font-mono text-xs font-bold tracking-widest neon-accent">
          PLAYLIST
        </span>

        <div className="flex items-center gap-4">
          {/* Pattern selector */}
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-[10px] tracking-wider">
              PATTERN
            </span>
            <select
              value={selectedPatternId}
              onChange={(e) => setSelectedPatternId(e.target.value)}
              className="rounded px-1.5 py-0.5 outline-none cursor-pointer text-[10px] font-mono"
              style={{
                background: 'var(--daw-card)',
                border: '1px solid var(--daw-border)',
                color: 'var(--daw-text)',
              }}
            >
              {patterns.map((p: Pattern) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bars display + total time */}
          <div className="flex items-center gap-1.5">
            <span className="text-white/30 text-[10px] tracking-wider">
              {playlistBars} BARS
            </span>
            <span className="text-white/20 text-[10px]">·</span>
            <span className="text-daw-accent/70 text-[10px] font-mono tracking-wider">
              {totalTimeDisplay}
            </span>
          </div>

          {/* Extend button */}
          <button
            onClick={() =>
              useDAWStore.setState((s) => ({ playlistBars: Math.min(s.playlistBars + 16, 128) }))
            }
            className="px-2 py-0.5 text-[10px] font-bold font-mono rounded transition-colors focus:outline-none"
            style={{
              background: 'rgba(255,140,0,0.15)',
              border: '1px solid rgba(255,140,0,0.3)',
              color: 'var(--daw-accent)',
            }}
            title="Add 16 bars"
          >
            EXTEND +
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <span className="text-white/30 text-[10px] tracking-wider">
              ZOOM
            </span>
            <button
              onClick={() =>
                setBarWidth((w) => clamp(w - 10, MIN_BAR_WIDTH, MAX_BAR_WIDTH))
              }
              className="w-5 h-5 rounded text-xs transition-colors flex items-center justify-center focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#aaa',
              }}
              title="Zoom out"
            >
              −
            </button>
            <span className="text-white/30 text-[10px] w-8 text-center">
              {barWidth}px
            </span>
            <button
              onClick={() =>
                setBarWidth((w) => clamp(w + 10, MIN_BAR_WIDTH, MAX_BAR_WIDTH))
              }
              className="w-5 h-5 rounded text-xs transition-colors flex items-center justify-center focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#aaa',
              }}
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Track headers */}
        <div
          className="shrink-0 flex flex-col border-r border-white/5 overflow-y-hidden"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          <div
            className="shrink-0 border-b border-white/5 flex items-center px-2"
            style={{
              height: BAR_HEADER_HEIGHT,
              background: 'var(--daw-bg)',
            }}
          >
            <span className="text-white/20 text-[9px] tracking-widest uppercase">
              Tracks
            </span>
          </div>

          {Array.from({ length: TRACK_COUNT }).map((_, i) => (
            <TrackHeader
              key={i}
              index={i}
              name={trackNames[i] ?? `Track ${i + 1}`}
              color={TRACK_COLORS[i % TRACK_COLORS.length]}
              muted={trackMuted[i] ?? false}
              solo={trackSolo[i] ?? false}
              onNameChange={(name) =>
                setTrackNames((prev) => {
                  const next = [...prev];
                  next[i] = name;
                  return next;
                })
              }
              onMuteToggle={() =>
                setTrackMuted((prev) => {
                  const next = [...prev];
                  next[i] = !next[i];
                  return next;
                })
              }
              onSoloToggle={() =>
                setTrackSolo((prev) => {
                  const next = [...prev];
                  next[i] = !next[i];
                  return next;
                })
              }
            />
          ))}
        </div>

        {/* Arrangement grid */}
        <div
          ref={gridRef}
          className="flex-1 overflow-auto relative"
          style={{ cursor: 'crosshair' }}
        >
          <div
            style={{
              width: totalGridWidth,
              minHeight: TRACK_COUNT * TRACK_HEIGHT + BAR_HEADER_HEIGHT,
              position: 'relative',
            }}
          >
            {/* ── Bar number header — CSS background + sparse labels ──── */}
            <div
              className="sticky top-0 z-20 border-b border-white/10 relative"
              style={{
                height: BAR_HEADER_HEIGHT,
                width: totalGridWidth,
                background: 'var(--daw-bg)',
                ...barHeaderBg(),
              }}
            >
              {barLabels.map((l) => (
                <span
                  key={l.bar}
                  className="absolute text-[9px] font-mono font-bold"
                  style={{
                    left: l.left + 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: l.isAccent ? 'var(--daw-accent)' : 'rgba(255,255,255,0.2)',
                    textShadow: l.isAccent
                      ? '0 0 6px rgba(255,140,0,0.4)'
                      : 'none',
                  }}
                >
                  {l.bar}
                </span>
              ))}

              {/* Playhead line on bar header */}
              {isPlaying && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-30"
                  style={{
                    left: playheadLeft,
                    width: 2,
                    background: 'var(--daw-accent)',
                    boxShadow: '0 0 6px var(--daw-accent)',
                  }}
                />
              )}
            </div>

            {/* ── Track rows — CSS background grids ────────────────────── */}
            {Array.from({ length: TRACK_COUNT }).map((_, trackIndex) => {
              const trackClips = playlistClips.filter(
                (c: PlaylistClip) => c.track === trackIndex,
              );
              const isMuted = trackMuted[trackIndex] ?? false;
              const isEven = trackIndex % 2 === 0;

              return (
                <div
                  key={trackIndex}
                  className="relative border-b border-white/5"
                  style={{
                    width: totalGridWidth,
                    height: TRACK_HEIGHT,
                    opacity: isMuted ? 0.35 : 1,
                    transition: 'opacity 0.15s',
                    ...gridBgStyle(isEven),
                  }}
                  onMouseDown={(e) => handleGridMouseDown(e, trackIndex)}
                >
                  {/* Clips on this track */}
                  {trackClips.map((clip: PlaylistClip) => (
                    <Clip
                      key={clip.id}
                      clip={clip}
                      patternName={getPatternName(clip.patternId)}
                      barWidth={barWidth}
                      trackHeight={TRACK_HEIGHT}
                      onRemove={() => removePlaylistClip(clip.id)}
                      onDragStart={handleClipDragStart}
                      onResizeStart={handleClipResizeStart}
                    />
                  ))}

                  {/* Playhead line on track row */}
                  {isPlaying && (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none z-20"
                      style={{
                        left: playheadLeft,
                        width: 2,
                        background: 'var(--daw-accent)',
                    opacity: 0.7,
                        boxShadow: '0 0 6px var(--daw-accent)',
                      }}
                    />
                  )}
                </div>
              );
            })}

            {/* ── Drag ghost ─────────────────────────────────────────────── */}
            {ghostPos && draggingClip.current && (
              <div
                className="absolute pointer-events-none z-30"
                style={{
                  left: ghostPos.left,
                  top: ghostPos.top,
                  width: Math.max(
                    draggingClip.current.clip.lengthBars * barWidth - 2,
                    4,
                  ),
                  height: TRACK_HEIGHT - 6,
                  backgroundColor:
                    draggingClip.current.clip.color ?? '#ff8c00',
                  opacity: 0.5,
                  borderRadius: 6,
                  border: '2px dashed rgba(255,255,255,0.5)',
                  boxShadow: `0 0 12px ${draggingClip.current.clip.color ?? '#ff8c00'}88`,
                }}
              />
            )}

            {/* ── Resize ghost ────────────────────────────────────────────── */}
            {resizeGhost && resizingClip.current && (
              <div
                className="absolute pointer-events-none z-30"
                style={{
                  left: resizeGhost.left,
                  top: resizeGhost.top,
                  width: resizeGhost.width,
                  height: TRACK_HEIGHT - 6,
                  backgroundColor:
                    resizingClip.current.clip.color ?? '#ff8c00',
                  opacity: 0.5,
                  borderRadius: 6,
                  border: '2px dashed rgba(255,255,255,0.5)',
                  boxShadow: `0 0 12px ${resizingClip.current.clip.color ?? '#ff8c00'}88`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
