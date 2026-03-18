'use client';

import { useState, useCallback } from 'react';
import { useDAWStore } from '@/lib/store';
import { saveSampleToIDB } from '@/lib/idb-storage';
import { v4 as uuidv4 } from 'uuid';

interface VideoInfo {
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function YouTubeConverter() {
  const setYoutubeConverterOpen = useDAWStore((s) => s.setYoutubeConverterOpen);
  const addChannel = useDAWStore((s) => s.addChannel);

  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [status, setStatus] = useState<'idle' | 'fetching' | 'downloading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [mp3Blob, setMp3Blob] = useState<Blob | null>(null);
  const [loadingIntoDaw, setLoadingIntoDaw] = useState(false);

  const fetchInfo = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('fetching');
    setError('');
    setVideoInfo(null);
    setMp3Blob(null);

    try {
      const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');
      setVideoInfo(data);
      setStatus('idle');
    } catch (err: unknown) {
      setError((err as Error).message);
      setStatus('error');
    }
  }, [url]);

  const downloadMp3 = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('downloading');
    setError('');

    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), title: videoInfo?.title }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Download failed');
      }

      const blob = await res.blob();
      setMp3Blob(blob);
      setStatus('done');
    } catch (err: unknown) {
      setError((err as Error).message);
      setStatus('error');
    }
  }, [url, videoInfo]);

  const saveToDisk = useCallback(() => {
    if (!mp3Blob) return;
    const fileName = videoInfo?.title
      ? `${videoInfo.title.replace(/[<>:"/\\|?*]/g, '_')}.mp3`
      : 'download.mp3';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(mp3Blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [mp3Blob, videoInfo]);

  const loadIntoDaw = useCallback(async () => {
    if (!mp3Blob) return;
    setLoadingIntoDaw(true);
    try {
      const arrayBuffer = await mp3Blob.arrayBuffer();
      const sampleId = uuidv4();
      await saveSampleToIDB(sampleId, arrayBuffer);
      const blobUrl = URL.createObjectURL(mp3Blob);
      const name = videoInfo?.title
        ? videoInfo.title.slice(0, 20)
        : 'YT Sample';

      addChannel({
        name,
        type: 'sample',
        sampleId,
        sampleUrl: blobUrl,
        color: '#ff4444',
      });
    } catch (err: unknown) {
      setError('Failed to load into DAW: ' + (err as Error).message);
    } finally {
      setLoadingIntoDaw(false);
    }
  }, [mp3Blob, videoInfo, addChannel]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // Clipboard access denied — ignore
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && url.trim()) {
        if (!videoInfo) {
          fetchInfo();
        } else if (status !== 'downloading') {
          downloadMp3();
        }
      }
    },
    [url, videoInfo, status, fetchInfo, downloadMp3],
  );

  const reset = useCallback(() => {
    setUrl('');
    setVideoInfo(null);
    setMp3Blob(null);
    setStatus('idle');
    setError('');
  }, []);

  return (
    <div className="w-full max-w-lg mx-auto bg-daw-panel border border-daw-border rounded-xl shadow-2xl overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-daw-border bg-daw-card/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">▶</span>
          <h2 className="text-sm font-bold text-daw-text tracking-wider">
            YOUTUBE TO MP3
          </h2>
        </div>
        <button
          onClick={() => setYoutubeConverterOpen(false)}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-daw-card text-daw-textMuted hover:text-daw-text transition-colors text-xs"
        >
          ✕
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* ── URL Input ──────────────────────────────────────── */}
        <div className="space-y-2">
          <label className="text-[10px] text-daw-textMuted tracking-widest uppercase">
            YouTube URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 bg-daw-card border border-daw-border text-daw-text text-xs rounded-lg px-3 py-2.5 outline-none focus:border-daw-accent transition-colors font-mono placeholder:text-daw-textMuted/50"
            />
            <button
              onClick={handlePaste}
              className="px-3 py-2 bg-daw-card border border-daw-border text-daw-textMuted text-[10px] rounded-lg hover:border-daw-accent hover:text-daw-accent transition-colors font-mono tracking-wider"
              title="Paste from clipboard"
            >
              PASTE
            </button>
          </div>
        </div>

        {/* ── Fetch Info Button ──────────────────────────────── */}
        {!videoInfo && (
          <button
            onClick={fetchInfo}
            disabled={!url.trim() || status === 'fetching'}
            className="w-full py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider transition-all bg-gradient-to-r from-daw-red to-daw-accent text-white hover:shadow-lg hover:shadow-daw-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'fetching' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                FETCHING INFO...
              </span>
            ) : (
              'FETCH VIDEO INFO'
            )}
          </button>
        )}

        {/* ── Video Info Card ────────────────────────────────── */}
        {videoInfo && (
          <div className="bg-daw-card border border-daw-border rounded-lg overflow-hidden">
            <div className="flex gap-3 p-3">
              {videoInfo.thumbnail && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={videoInfo.thumbnail}
                  alt=""
                  className="w-28 h-20 object-cover rounded flex-none"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-daw-text font-bold leading-tight line-clamp-2">
                  {videoInfo.title}
                </p>
                <p className="text-[10px] text-daw-textMuted mt-1">
                  {videoInfo.uploader}
                </p>
                <p className="text-[10px] text-daw-accent mt-1 font-mono">
                  {formatDuration(videoInfo.duration)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Download Button ────────────────────────────────── */}
        {videoInfo && status !== 'done' && (
          <button
            onClick={downloadMp3}
            disabled={status === 'downloading'}
            className="w-full py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider transition-all bg-gradient-to-r from-daw-red to-daw-accent text-white hover:shadow-lg hover:shadow-daw-accent/25 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === 'downloading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                CONVERTING TO MP3...
              </span>
            ) : (
              'DOWNLOAD MP3'
            )}
          </button>
        )}

        {/* ── Done Actions ───────────────────────────────────── */}
        {status === 'done' && mp3Blob && (
          <div className="space-y-2">
            <div className="text-center">
              <span className="text-daw-green text-xs font-mono font-bold tracking-wider">
                CONVERSION COMPLETE
              </span>
              <p className="text-[10px] text-daw-textMuted mt-1">
                {(mp3Blob.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveToDisk}
                className="flex-1 py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider bg-daw-green text-white hover:shadow-lg hover:shadow-daw-green/25 transition-all"
              >
                SAVE TO DISK
              </button>
              <button
                onClick={loadIntoDaw}
                disabled={loadingIntoDaw}
                className="flex-1 py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider bg-gradient-to-r from-daw-accent to-daw-purple text-white hover:shadow-lg hover:shadow-daw-accent/25 transition-all disabled:opacity-60"
              >
                {loadingIntoDaw ? 'LOADING...' : 'LOAD INTO DAW'}
              </button>
            </div>
          </div>
        )}

        {/* ── Error Display ──────────────────────────────────── */}
        {error && (
          <div className="bg-daw-red/10 border border-daw-red/30 rounded-lg px-3 py-2">
            <p className="text-[10px] text-daw-red font-mono leading-relaxed">
              {error}
            </p>
          </div>
        )}

        {/* ── Footer actions ─────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-daw-border pt-3">
          {videoInfo && (
            <button
              onClick={reset}
              className="text-[10px] text-daw-textMuted hover:text-daw-text font-mono tracking-wider transition-colors"
            >
              RESET
            </button>
          )}
          <p className="text-[9px] text-daw-textMuted/60 leading-relaxed ml-auto">
            Requires{' '}
            <span className="text-daw-textMuted">yt-dlp</span> and{' '}
            <span className="text-daw-textMuted">ffmpeg</span> on your system
          </p>
        </div>
      </div>
    </div>
  );
}
