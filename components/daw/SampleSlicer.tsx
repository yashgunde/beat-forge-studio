'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDAWStore } from '@/lib/store';
import type { ChannelType } from '@/lib/types';
import { saveSampleToIDB } from '@/lib/idb-storage';

// ─── Constants ──────────────────────────────────────────────────────────────────

const WAVEFORM_HEIGHT = 160;
const SLICE_COLORS = [
  '#00ffaa', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a78bfa',
  '#f472b6', '#38bdf8', '#fb923c', '#34d399', '#c084fc',
];

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Slice {
  id: string;
  name: string;
  start: number; // seconds
  end: number;   // seconds
  color: string;
}

// ─── Waveform drawing ───────────────────────────────────────────────────────────

function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  slices: Slice[],
  selection: { start: number; end: number } | null,
  hoverTime: number | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const duration = audioBuffer.duration;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);

  ctx.clearRect(0, 0, width, height);

  // Draw existing slice regions (background highlights)
  for (const slice of slices) {
    const x1 = (slice.start / duration) * width;
    const x2 = (slice.end / duration) * width;
    ctx.fillStyle = slice.color + '18';
    ctx.fillRect(x1, 0, x2 - x1, height);
    // Slice boundary lines
    ctx.strokeStyle = slice.color + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, 0); ctx.lineTo(x1, height);
    ctx.moveTo(x2, 0); ctx.lineTo(x2, height);
    ctx.stroke();
  }

  // Draw active selection
  if (selection && selection.end > selection.start) {
    const x1 = (selection.start / duration) * width;
    const x2 = (selection.end / duration) * width;
    ctx.fillStyle = 'rgba(255,140,0,0.15)';
    ctx.fillRect(x1, 0, x2 - x1, height);
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, 0); ctx.lineTo(x1, height);
    ctx.moveTo(x2, 0); ctx.lineTo(x2, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw waveform
  const mid = height / 2;
  ctx.fillStyle = '#ff8c00';
  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    const start = i * step;
    for (let j = 0; j < step && start + j < data.length; j++) {
      const val = data[start + j];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const barHeight = Math.max(1, ((max - min) / 2) * height);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i, mid - barHeight / 2, 1, barHeight);
  }
  ctx.globalAlpha = 1;

  // Draw center line
  ctx.strokeStyle = 'rgba(255,140,0,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  // Draw hover cursor
  if (hoverTime !== null) {
    const hx = (hoverTime / duration) * width;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, 0);
    ctx.lineTo(hx, height);
    ctx.stroke();
  }

  // Draw time markers
  const interval = duration > 10 ? 5 : duration > 4 ? 1 : 0.5;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  for (let t = interval; t < duration; t += interval) {
    const x = (t / duration) * width;
    ctx.fillRect(x, 0, 1, 8);
    ctx.fillText(`${t.toFixed(1)}s`, x, 18);
  }
}

// ─── Format time helper ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function SampleSlicer() {
  const { setSampleSlicerOpen, addChannel, getActivePattern } = useDAWStore();

  // File state
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const currentSampleId = useRef<string | null>(null);

  // Selection state
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Created slices
  const [slices, setSlices] = useState<Slice[]>([]);
  const sliceCounter = useRef(0);

  // Preview audio
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      previewSourceRef.current?.stop();
      previewCtxRef.current?.close().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── File loading ────────────────────────────────────────────────────────────

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setSlices([]);
    setSelection(null);
    sliceCounter.current = 0;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();

      // Revoke old URL
      if (objectUrl) URL.revokeObjectURL(objectUrl);

      const url = URL.createObjectURL(file);
      setAudioBuffer(decoded);
      setObjectUrl(url);
      setFileName(file.name);

      // Persist audio data in IndexedDB so it survives refresh
      const sampleId = `sample-${Date.now()}-${file.name}`;
      await saveSampleToIDB(sampleId, arrayBuffer);
      currentSampleId.current = sampleId;
    } catch (err) {
      console.error('[SampleSlicer] Failed to decode audio:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectUrl]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a)$/i))) {
      loadFile(file);
    }
  }, [loadFile]);

  // ── Canvas drawing ──────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    // Match canvas resolution to container width
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = WAVEFORM_HEIGHT * window.devicePixelRatio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    // Reset logical dimensions for CSS
    canvas.style.width = rect.width + 'px';
    canvas.style.height = WAVEFORM_HEIGHT + 'px';

    drawWaveform(canvas, audioBuffer, slices, selection, hoverTime);
  }, [audioBuffer, slices, selection, hoverTime]);

  // ── Mouse interaction on canvas ─────────────────────────────────────────────

  const getTimeFromMouseEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !audioBuffer) return 0;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    return (x / rect.width) * audioBuffer.duration;
  }, [audioBuffer]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const time = getTimeFromMouseEvent(e);
    setIsDragging(true);
    setDragStart(time);
    setSelection({ start: time, end: time });
  }, [getTimeFromMouseEvent]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const time = getTimeFromMouseEvent(e);
    setHoverTime(time);
    if (isDragging) {
      const start = Math.min(dragStart, time);
      const end = Math.max(dragStart, time);
      setSelection({ start, end });
    }
  }, [getTimeFromMouseEvent, isDragging, dragStart]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDragging(false);
    // If selection is too small (< 20ms), clear it
    if (selection && (selection.end - selection.start) < 0.02) {
      setSelection(null);
    }
  }, [selection]);

  const handleCanvasMouseLeave = useCallback(() => {
    setHoverTime(null);
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  // ── Preview playback ────────────────────────────────────────────────────────

  const previewSlice = useCallback((start: number, end: number) => {
    if (!audioBuffer) return;

    // Stop any existing preview
    try { previewSourceRef.current?.stop(); } catch { /* ok */ }

    const ctx = previewCtxRef.current ?? new AudioContext();
    previewCtxRef.current = ctx;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0, start, end - start);
    previewSourceRef.current = source;

    source.onended = () => { previewSourceRef.current = null; };
  }, [audioBuffer]);

  const previewSelection = useCallback(() => {
    if (!selection) return;
    previewSlice(selection.start, selection.end);
  }, [selection, previewSlice]);

  // ── Add slice as channel pad ────────────────────────────────────────────────

  const addSliceAsChannel = useCallback(() => {
    if (!selection || !objectUrl || !audioBuffer) return;
    if (selection.end - selection.start < 0.02) return;

    sliceCounter.current += 1;
    const idx = sliceCounter.current;
    const color = SLICE_COLORS[(idx - 1) % SLICE_COLORS.length];

    const newSlice: Slice = {
      id: `slice-${Date.now()}-${idx}`,
      name: `Sample ${idx}`,
      start: selection.start,
      end: selection.end,
      color,
    };

    setSlices((prev) => [...prev, newSlice]);

    // Determine step count from active pattern
    const pattern = getActivePattern();
    const totalSteps = (pattern?.bars ?? 1) * 16;

    // Add as a channel to the store
    addChannel({
      name: newSlice.name,
      type: 'sample' as ChannelType,
      color,
      volume: 0.8,
      pan: 0,
      instrument: { synthType: 'synth' },
      steps: Array(totalSteps).fill(false),
      sampleUrl: objectUrl,
      sampleId: currentSampleId.current ?? undefined,
      sampleStart: selection.start,
      sampleEnd: selection.end,
    });

    // Clear selection for next cut
    setSelection(null);
  }, [selection, objectUrl, audioBuffer, addChannel, getActivePattern]);

  // ── Close ───────────────────────────────────────────────────────────────────

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      setSampleSlicerOpen(false);
    }
  }, [setSampleSlicerOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSampleSlicerOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSampleSlicerOpen]);

  // ── Selection info ──────────────────────────────────────────────────────────

  const selectionDuration = useMemo(() => {
    if (!selection) return 0;
    return Math.max(0, selection.end - selection.start);
  }, [selection]);

  const hasValidSelection = selectionDuration >= 0.02;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={handleOverlayClick}
    >
      <div
        ref={containerRef}
        className="bg-daw-panel border border-daw-border rounded-lg w-[860px] max-w-[96vw] max-h-[90vh] overflow-y-auto shadow-2xl"
        style={{ boxShadow: '0 0 60px rgba(255,140,0,0.06), 0 25px 50px rgba(0,0,0,0.7)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-daw-border sticky top-0 bg-daw-panel z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-daw-accent/10 border border-daw-accent/30 flex items-center justify-center text-lg">
              ✂️
            </div>
            <div>
              <h2 className="text-daw-text font-mono font-bold text-lg leading-none">
                Sample Slicer
              </h2>
              <p className="text-daw-textMuted font-mono text-xs mt-0.5">
                Upload audio, select regions, and add them as pads
              </p>
            </div>
          </div>
          <button
            onClick={() => setSampleSlicerOpen(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center text-daw-textMuted hover:text-daw-text hover:bg-daw-card transition-colors font-mono text-lg"
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div className="p-6 flex flex-col gap-5">

          {/* ── Upload area (shown when no audio loaded) ── */}
          {!audioBuffer && !loading && (
            <div
              className="border-2 border-dashed border-daw-border rounded-lg p-12 text-center cursor-pointer hover:border-daw-accent hover:bg-daw-accent/5 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-daw-card border border-daw-border flex items-center justify-center">
                  <svg className="w-6 h-6 text-daw-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-daw-text font-mono font-semibold">Drop an audio file here</p>
                  <p className="text-daw-textMuted font-mono text-sm mt-1">
                    or <span className="text-daw-accent underline underline-offset-2">click to browse</span>
                  </p>
                </div>
                <p className="text-daw-textMuted font-mono text-xs">MP3, WAV, OGG, FLAC</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12">
              <div className="w-5 h-5 border-2 border-daw-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-daw-textMuted font-mono text-sm">Decoding audio...</span>
            </div>
          )}

          {/* ── Waveform + Slicer ── */}
          {audioBuffer && (
            <>
              {/* File info bar */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-daw-card rounded-lg border border-daw-border">
                <div className="w-7 h-7 rounded-md bg-daw-accent/10 border border-daw-accent/30 flex items-center justify-center shrink-0 text-sm">
                  🎵
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-daw-text font-mono text-sm font-semibold truncate">{fileName}</p>
                  <p className="text-daw-textMuted font-mono text-[10px]">
                    {audioBuffer.duration.toFixed(1)}s · {audioBuffer.sampleRate}Hz · {audioBuffer.numberOfChannels}ch
                  </p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1 bg-daw-panel border border-daw-border rounded text-daw-textMuted font-mono text-xs hover:text-daw-text hover:border-daw-accent transition-colors"
                >
                  Change File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>

              {/* Waveform canvas */}
              <div className="bg-daw-card rounded-lg border border-daw-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-daw-accent text-[10px] font-mono font-bold tracking-widest uppercase">
                    Waveform — Click &amp; Drag to Select Region
                  </span>
                  {hoverTime !== null && (
                    <span className="text-daw-textMuted text-[10px] font-mono">
                      {formatTime(hoverTime)}
                    </span>
                  )}
                </div>
                <canvas
                  ref={canvasRef}
                  className="w-full rounded cursor-crosshair"
                  style={{ height: WAVEFORM_HEIGHT, background: '#0a0a14' }}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseLeave}
                />
              </div>

              {/* Selection info + actions */}
              <div className="flex items-center gap-3">
                {/* Selection display */}
                <div className="flex items-center gap-2 px-3 py-2 bg-daw-card border border-daw-border rounded-lg flex-1">
                  {hasValidSelection ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-daw-accent animate-pulse" />
                      <span className="text-daw-text font-mono text-xs">
                        Selection: {formatTime(selection!.start)} — {formatTime(selection!.end)}
                      </span>
                      <span className="text-daw-textMuted font-mono text-[10px] ml-1">
                        ({formatTime(selectionDuration)} duration)
                      </span>
                    </>
                  ) : (
                    <span className="text-daw-textMuted font-mono text-xs">
                      Click and drag on the waveform to select a region
                    </span>
                  )}
                </div>

                {/* Preview selection */}
                <button
                  disabled={!hasValidSelection}
                  onClick={previewSelection}
                  className="px-3 py-2 bg-daw-card border border-daw-border rounded-lg text-daw-text font-mono text-xs hover:border-daw-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Preview
                </button>

                {/* Add as pad */}
                <button
                  disabled={!hasValidSelection}
                  onClick={addSliceAsChannel}
                  className="px-4 py-2 rounded-lg font-mono text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{
                    background: hasValidSelection
                      ? 'linear-gradient(135deg, #ff8c00, #cc7000)'
                      : '#333',
                    boxShadow: hasValidSelection ? '0 4px 15px rgba(255,140,0,0.3)' : 'none',
                  }}
                >
                  + Add as Pad
                </button>
              </div>

              {/* ── Created slices list ── */}
              {slices.length > 0 && (
                <div className="bg-daw-card rounded-lg border border-daw-border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-daw-accent text-[10px] font-mono font-bold tracking-widest uppercase">
                      Created Pads ({slices.length})
                    </span>
                    <span className="text-daw-textMuted text-[10px] font-mono">
                      Added to Channel Rack
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {slices.map((slice) => (
                      <div
                        key={slice.id}
                        className="flex items-center gap-2.5 px-3 py-2 bg-daw-panel rounded border border-white/5 hover:border-white/10 transition-colors"
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="text-daw-text font-mono text-xs font-bold flex-1">
                          {slice.name}
                        </span>
                        <span className="text-daw-textMuted font-mono text-[10px]">
                          {formatTime(slice.start)} — {formatTime(slice.end)}
                        </span>
                        <span className="text-daw-textMuted font-mono text-[10px]">
                          ({formatTime(slice.end - slice.start)})
                        </span>
                        <button
                          onClick={() => previewSlice(slice.start, slice.end)}
                          className="px-2 py-0.5 rounded text-[10px] font-mono text-daw-textMuted hover:text-daw-accent transition-colors"
                          title="Preview this slice"
                        >
                          ▶
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
