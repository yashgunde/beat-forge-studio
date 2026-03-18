'use client';

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { useDAWStore } from '@/lib/store';
import { AudioEngine } from '@/lib/audioEngine';
import { Channel, SOUND_PRESETS, SoundPreset } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────────

// Quick-add type labels shown at the top of the preset picker
const QUICK_ADD_TYPES = [
  { label: 'Kick',     type: 'kick'    as const, color: '#ff4444' },
  { label: 'Snare',    type: 'snare'   as const, color: '#00ccff' },
  { label: 'Hi-Hat',   type: 'hihat'   as const, color: '#ffcc00' },
  { label: 'Clap',     type: 'clap'    as const, color: '#ff8800' },
  { label: 'Bass',     type: 'bass'    as const, color: '#ff44aa' },
  { label: 'Sub 808',  type: 'sub808'  as const, color: '#cc2200' },
  { label: 'Lead',     type: 'lead'    as const, color: '#00aaff' },
  { label: 'Pad',      type: 'pad'     as const, color: '#6600cc' },
];

// Filter tag definitions for the preset picker
const FILTER_TAGS = [
  { label: 'All',      match: null },
  { label: 'Kick',     match: 'kick' },
  { label: 'Snare',    match: 'snare' },
  { label: 'Clap',     match: 'clap' },
  { label: 'Hat',      match: 'hihat' },
  { label: 'Perc',     match: 'perc' },
  { label: 'Bass/808', match: '808' },
  { label: 'Pads',     match: 'pad' },
  { label: 'Leads',    match: 'lead' },
  { label: 'Keys',     match: 'keys' },
  { label: 'Bells',    match: 'bell' },
  { label: 'Pluck',    match: 'pluck' },
  { label: 'FX',       match: 'fx' },
  { label: 'House',    match: 'house' },
  { label: 'Techno',   match: 'techno' },
  { label: 'DnB',      match: 'dnb' },
  { label: 'Lo-Fi',    match: 'lo-fi' },
  { label: 'Ambient',  match: 'ambient' },
  { label: 'Latin',    match: 'latin' },
  { label: 'Afro',     match: 'afro' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an AudioBuffer to a WAV Blob for frozen channel playback. */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channel data as 16-bit PCM
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/** Build beat labels like "1.1", "1.2", … "2.1" … for totalSteps steps. */
function buildBeatLabels(totalSteps: number): string[] {
  const labels: string[] = [];
  const totalBeats = totalSteps / 4;
  for (let beat = 0; beat < totalBeats; beat++) {
    const bar = Math.floor(beat / 4) + 1;
    const beatInBar = (beat % 4) + 1;
    labels.push(`${bar}.${beatInBar}`);
  }
  return labels;
}

/** Build step groups: arrays of step indices in groups of 4. */
function buildStepGroups(totalSteps: number): number[][] {
  const groups: number[][] = [];
  for (let g = 0; g < totalSteps / 4; g++) {
    groups.push([g * 4, g * 4 + 1, g * 4 + 2, g * 4 + 3]);
  }
  return groups;
}

// ─── Context menu types ───────────────────────────────────────────────────────

interface ContextMenuState {
  channelId: string;
  x: number;
  y: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ChannelNameEditorProps {
  name: string;
  onSave: (name: string) => void;
}

const ChannelNameEditor = React.memo(function ChannelNameEditor({
  name,
  onSave,
}: ChannelNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = useCallback(() => {
    setDraft(name);
    setEditing(true);
  }, [name]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    setEditing(false);
  }, [draft, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') setEditing(false);
    },
    [commit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="
          w-[11ch] bg-daw-bg border border-daw-accent rounded px-1
          text-white text-[10px] font-mono outline-none
          focus:ring-1 focus:ring-daw-accent
        "
        maxLength={20}
      />
    );
  }

  return (
    <span
      title="Double-click to rename"
      onDoubleClick={handleDoubleClick}
      className="
        w-[11ch] truncate text-white text-[10px] font-mono
        cursor-text select-none
        hover:text-[#ff8c00] transition-colors
      "
    >
      {name}
    </span>
  );
});

// ─── Step button ──────────────────────────────────────────────────────────────

interface StepButtonProps {
  active: boolean;
  stepIndex: number;
  channelColor: string;
  onToggle: () => void;
}

const StepButton = React.memo(function StepButton({
  active,
  stepIndex,
  channelColor,
  onToggle,
}: StepButtonProps) {
  return (
    <button
      data-step={stepIndex}
      onClick={onToggle}
      style={
        {
          '--ch-color': channelColor,
          backgroundColor: active ? channelColor : 'var(--daw-step-off)',
          border: active ? 'none' : '1px solid var(--daw-border)',
        } as React.CSSProperties
      }
      className={`w-full h-10 cursor-pointer focus:outline-none step-btn ${active ? 'step-btn-on' : ''}`}
      aria-pressed={active}
    />
  );
});

// ─── Channel row ──────────────────────────────────────────────────────────────

interface ChannelRowProps {
  channel: Channel;
  rowIndex: number;
  totalSteps: number;
  onContextMenu: (e: React.MouseEvent, channelId: string) => void;
}

const ChannelRow = React.memo(function ChannelRow({
  channel,
  rowIndex,
  totalSteps,
  onContextMenu,
}: ChannelRowProps) {
  const { toggleStep, updateChannel, openPianoRoll, freezeChannel, unfreezeChannel } = useDAWStore();
  const [freezing, setFreezing] = useState(false);

  const handleToggleStep = useCallback(
    (stepIdx: number) => {
      toggleStep(channel.id, stepIdx);
    },
    [toggleStep, channel.id],
  );

  const handleMute = useCallback(() => {
    updateChannel(channel.id, { muted: !channel.muted });
  }, [updateChannel, channel.id, channel.muted]);

  const handleSolo = useCallback(() => {
    updateChannel(channel.id, { solo: !channel.solo });
  }, [updateChannel, channel.id, channel.solo]);

  const handleVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateChannel(channel.id, { volume: parseFloat(e.target.value) });
    },
    [updateChannel, channel.id],
  );

  const handleNameSave = useCallback(
    (name: string) => {
      updateChannel(channel.id, { name });
    },
    [updateChannel, channel.id],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu(e, channel.id);
    },
    [onContextMenu, channel.id],
  );

  const handlePianoRoll = useCallback(() => {
    openPianoRoll(channel.id);
  }, [openPianoRoll, channel.id]);

  const handleFreeze = useCallback(async () => {
    if (channel.frozen) {
      // Unfreeze: dispose the frozen player and clear frozen state
      const engine = AudioEngine.getInstance();
      engine.disposeFrozenPlayer(channel.id);
      // Revoke the old blob URL to free memory
      if (channel.frozenBufferUrl) {
        URL.revokeObjectURL(channel.frozenBufferUrl);
      }
      unfreezeChannel(channel.id);
      return;
    }

    // Freeze: render the channel to a buffer
    if (channel.type === 'sample') return; // sample channels can't be frozen
    setFreezing(true);
    try {
      const engine = AudioEngine.getInstance();
      const state = useDAWStore.getState();
      const pattern = state.getActivePattern();
      if (!pattern) return;
      const pianoNotes = pattern.pianoRollNotes[channel.id] ?? [];

      const audioBuffer = await engine.renderChannelToBuffer(
        channel,
        state.bpm,
        totalSteps,
        pianoNotes
      );

      // Convert AudioBuffer to WAV blob URL
      const wavBlob = audioBufferToWavBlob(audioBuffer);
      const blobUrl = URL.createObjectURL(wavBlob);

      // Load the frozen player into the engine
      await engine.loadFrozenPlayer(channel.id, blobUrl);

      // Update store
      freezeChannel(channel.id, blobUrl);
    } catch (err) {
      console.error('[ChannelRack] Freeze failed:', err);
    } finally {
      setFreezing(false);
    }
  }, [channel, totalSteps, freezeChannel, unfreezeChannel]);

  // Compute step groups for rendering — dynamic based on totalSteps
  const stepGroups = useMemo(() => buildStepGroups(totalSteps), [totalSteps]);
  const numBars = totalSteps / 16;

  const rowBg =
    rowIndex % 2 === 0
      ? 'rgba(30,30,46,0.9)'
      : 'rgba(22,22,34,0.9)';

  return (
    <div
      onContextMenu={handleContextMenu}
      className={`flex items-center h-14 border-b border-white/5 group relative${channel.frozen ? ' opacity-70' : ''}`}
      style={{ background: channel.frozen ? 'rgba(0,60,80,0.35)' : rowBg }}
    >
      {/* ── Left panel ── */}
      <div
        className="flex items-center gap-1.5 min-w-[220px] w-[220px] h-full px-2 border-r border-white/5 channel-strip-gradient flex-shrink-0"
        style={{ borderLeft: `3px solid ${channel.color}` }}
      >
        {/* Channel name */}
        <ChannelNameEditor name={channel.name} onSave={handleNameSave} />

        {/* Mute */}
        <button
          title={channel.muted ? 'Unmute' : 'Mute'}
          onClick={handleMute}
          className={[
            'flex-shrink-0 w-5 h-5 rounded text-[9px] font-bold font-mono',
            'transition-colors focus:outline-none',
            channel.muted
              ? 'bg-[#1a1a2e] text-[#666]'
              : 'bg-emerald-600 text-white',
          ].join(' ')}
        >
          M
        </button>

        {/* Solo */}
        <button
          title={channel.solo ? 'Unsolo' : 'Solo'}
          onClick={handleSolo}
          className={[
            'flex-shrink-0 w-5 h-5 rounded text-[9px] font-bold font-mono',
            'transition-colors focus:outline-none',
            channel.solo
              ? 'bg-amber-400 text-black'
              : 'bg-[#1e1e2e] text-[#666] hover:bg-[#2a2a3e]',
          ].join(' ')}
        >
          S
        </button>

        {/* Volume slider */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={channel.volume}
          onChange={handleVolume}
          title={`Volume: ${Math.round(channel.volume * 100)}%`}
          className="w-[48px] h-1 flex-shrink-0 cursor-pointer appearance-none rounded bg-daw-card"
          style={{ accentColor: 'var(--daw-accent)' }}
        />

        {/* Piano Roll button */}
        <button
          title="Open Piano Roll"
          onClick={handlePianoRoll}
          className="
            flex-shrink-0 px-1 h-5 rounded text-[8px] font-bold font-mono
            bg-daw-card text-daw-textMuted
            hover:bg-daw-accent hover:text-white
            transition-colors focus:outline-none
          "
        >
          PR
        </button>

        {/* Freeze button */}
        {channel.type !== 'sample' && (
          <button
            title={channel.frozen ? 'Unfreeze channel (restore live synth)' : 'Freeze channel (pre-render to audio)'}
            onClick={handleFreeze}
            disabled={freezing}
            className={[
              'flex-shrink-0 w-5 h-5 rounded text-[9px] font-bold',
              'transition-colors focus:outline-none',
              freezing
                ? 'bg-daw-card text-daw-accent animate-pulse'
                : channel.frozen
                  ? 'bg-cyan-600/80 text-white'
                  : 'bg-[#1e1e2e] text-[#666] hover:bg-[#2a2a3e] hover:text-cyan-400',
            ].join(' ')}
          >
            {freezing ? '...' : '*'}
          </button>
        )}
      </div>

      {/* ── Step grid ── */}
      <div className="flex items-center flex-1 h-full px-2 gap-1 relative z-[1] overflow-x-auto">
        {stepGroups.map((group, groupIdx) => {
          // A bar boundary falls every 4 groups (16 steps = 4 groups of 4)
          const isBarBoundary = groupIdx > 0 && groupIdx % 4 === 0;
          // A beat boundary is every group that is NOT a bar boundary
          const isBeatBoundary = groupIdx > 0 && !isBarBoundary;

          return (
            <React.Fragment key={groupIdx}>
              {/* Bar separator — 2px, thicker */}
              {isBarBoundary && (
                <div
                  className="w-[2px] h-8 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: `${channel.color}99` }}
                />
              )}
              {/* Beat separator — 1px, subtle */}
              {isBeatBoundary && (
                <div
                  className="w-[2px] h-8 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: `${channel.color}4d` }}
                />
              )}

              {/* Step group */}
              <div
                className="flex gap-[4px]"
                style={{ flex: numBars > 2 ? '0 0 auto' : '1' }}
              >
                {group.map((stepIdx) => (
                  <StepButton
                    key={stepIdx}
                    active={channel.steps[stepIdx] ?? false}
                    stepIndex={stepIdx}
                    channelColor={channel.color}
                    onToggle={() => handleToggleStep(stepIdx)}
                  />
                ))}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});

// ─── Beat marker header ───────────────────────────────────────────────────────

interface BeatMarkerHeaderProps {
  totalSteps: number;
}

const BeatMarkerHeader = React.memo(function BeatMarkerHeader({
  totalSteps,
}: BeatMarkerHeaderProps) {
  const beatLabels = useMemo(() => buildBeatLabels(totalSteps), [totalSteps]);
  const numBars = totalSteps / 16;

  return (
    <div
      className="flex items-stretch border-b border-white/10"
      style={{ background: 'var(--daw-bg)', height: 28 }}
    >
      {/* Spacer matching left panel */}
      <div className="w-[220px] min-w-[220px] flex-shrink-0 border-r border-white/5" />

      {/* Beat labels */}
      <div className="flex items-stretch flex-1 px-2 gap-1 overflow-x-auto">
        {beatLabels.map((label, groupIdx) => {
          const isBarBoundary = groupIdx > 0 && groupIdx % 4 === 0;
          const isBeatBoundary = groupIdx > 0 && !isBarBoundary;

          return (
            <React.Fragment key={groupIdx}>
              {isBarBoundary && (
                <div className="w-[2px] self-stretch my-1 flex-shrink-0 rounded-full bg-daw-accent/40" />
              )}
              {isBeatBoundary && (
                <div className="w-[2px] self-stretch my-1 flex-shrink-0 rounded-full bg-white/10" />
              )}
              <div
                className="flex flex-col justify-center"
                style={{ flex: numBars > 2 ? '0 0 auto' : '1' }}
              >
                <span className="text-[10px] font-bold font-mono text-daw-accent pl-0.5 neon-accent whitespace-nowrap">
                  {label}
                </span>
                {/* Tick marks */}
                <div className="flex gap-[4px] mt-0.5 pl-0.5">
                  {[0, 1, 2, 3].map((t) => (
                    <div
                      key={t}
                      className="flex-1 rounded-full"
                      style={{
                        height: t === 0 ? 4 : 2,
                        backgroundColor:
                          t === 0
                            ? 'rgba(255,140,0,0.6)'
                            : 'rgba(255,255,255,0.15)',
                        minWidth: 3,
                      }}
                    />
                  ))}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  menu: ContextMenuState;
  totalSteps: number;
  onClose: () => void;
}

const ContextMenu = React.memo(function ContextMenu({
  menu,
  totalSteps,
  onClose,
}: ContextMenuProps) {
  const { openPianoRoll, clearAllSteps, removeChannel, setChannelSteps } =
    useDAWStore();

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const handleOpenPianoRoll = useCallback(() => {
    openPianoRoll(menu.channelId);
    onClose();
  }, [openPianoRoll, menu.channelId, onClose]);

  const handleClearSteps = useCallback(() => {
    clearAllSteps(menu.channelId);
    onClose();
  }, [clearAllSteps, menu.channelId, onClose]);

  const handleDeleteChannel = useCallback(() => {
    removeChannel(menu.channelId);
    onClose();
  }, [removeChannel, menu.channelId, onClose]);

  const handleRandomPattern = useCallback(() => {
    const steps = Array.from(
      { length: totalSteps },
      () => Math.random() < 0.4,
    );
    setChannelSteps(menu.channelId, steps);
    onClose();
  }, [setChannelSteps, menu.channelId, totalSteps, onClose]);

  const menuItems = useMemo(
    () => [
      { label: 'Open Piano Roll', action: handleOpenPianoRoll },
      { label: 'Clear Steps', action: handleClearSteps },
      { label: 'Random Pattern', action: handleRandomPattern },
      { label: '──────────', action: null },
      { label: 'Delete Channel', action: handleDeleteChannel, danger: true },
    ],
    [
      handleOpenPianoRoll,
      handleClearSteps,
      handleRandomPattern,
      handleDeleteChannel,
    ],
  );

  return (
    <div
      ref={containerRef}
      style={{ top: menu.y, left: menu.x }}
      className="
        fixed z-50 min-w-[160px] py-1
        bg-[#1a1a2e] border border-white/10
        rounded-md shadow-2xl shadow-black/70
        glass-panel
      "
    >
      {menuItems.map((item, idx) =>
        item.action === null ? (
          <div
            key={idx}
            className="px-3 py-0.5 text-[10px] text-white/20 select-none"
          >
            {item.label}
          </div>
        ) : (
          <button
            key={idx}
            onClick={item.action}
            className={[
              'w-full text-left px-3 py-1.5 text-[11px] font-mono',
              'transition-colors focus:outline-none',
              item.danger
                ? 'text-red-400 hover:bg-red-500/20'
                : 'text-[#ccc] hover:bg-white/5',
            ].join(' ')}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
});

// ─── Bar selector ─────────────────────────────────────────────────────────────

interface BarSelectorProps {
  patternId: string;
  currentBars: number;
}

const BAR_OPTIONS = [1, 2, 4, 8] as const;

const BarSelector = React.memo(function BarSelector({
  patternId,
  currentBars,
}: BarSelectorProps) {
  const { setPatternBars } = useDAWStore();

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-mono text-white/30 mr-0.5 tracking-wider">BARS:</span>
      {BAR_OPTIONS.map((b) => (
        <button
          key={b}
          onClick={() => setPatternBars(patternId, b)}
          className="w-6 h-5 rounded text-[10px] font-bold font-mono transition-colors focus:outline-none"
          style={{
            backgroundColor: currentBars === b ? 'var(--daw-accent)' : 'var(--daw-card)',
            color: currentBars === b ? '#000' : 'var(--daw-text-muted)',
          }}
        >
          {b}
        </button>
      ))}
    </div>
  );
});

// ─── Preset picker ────────────────────────────────────────────────────────────

interface PresetPickerProps {
  onSelect: (preset: SoundPreset) => void;
  onQuickAdd: (type: typeof QUICK_ADD_TYPES[number]) => void;
  onClose: () => void;
}

const PresetPicker = React.memo(function PresetPicker({
  onSelect,
  onQuickAdd,
  onClose,
}: PresetPickerProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on click-outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const filteredPresets = useMemo(() => {
    let presets = SOUND_PRESETS;

    if (activeFilter) {
      presets = presets.filter(
        (p) =>
          p.tags.some((t) => t.toLowerCase().includes(activeFilter.toLowerCase())) ||
          p.type.toLowerCase().includes(activeFilter.toLowerCase()),
      );
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      presets = presets.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return presets;
  }, [search, activeFilter]);

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="
          bg-[#13131f] border border-white/10 rounded-lg shadow-2xl shadow-black/60
          flex flex-col
          w-[640px] max-w-[96vw]
        "
        style={{ maxHeight: '70vh' }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0"
          style={{ borderLeft: '4px solid var(--daw-accent)' }}
        >
          <span className="text-[13px] font-bold tracking-widest text-daw-accent uppercase font-mono neon-accent">
            Add Sound
          </span>
          <button
            onClick={onClose}
            className="
              w-6 h-6 rounded text-[#888] hover:text-white hover:bg-white/10
              text-[14px] font-bold transition-colors focus:outline-none
            "
          >
            ✕
          </button>
        </div>

        {/* ── Quick-add row ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 flex-shrink-0 flex-wrap">
          <span className="text-[9px] font-mono text-white/30 tracking-wider mr-1 flex-shrink-0">
            QUICK ADD:
          </span>
          {QUICK_ADD_TYPES.map((qt) => (
            <button
              key={qt.type}
              onClick={() => onQuickAdd(qt)}
              className="
                px-2 py-0.5 rounded text-[10px] font-bold font-mono
                hover:brightness-125 active:scale-95 transition-all focus:outline-none
                border border-white/10
              "
              style={{ backgroundColor: `${qt.color}22`, color: qt.color, borderColor: `${qt.color}44` }}
            >
              {qt.label}
            </button>
          ))}
        </div>

        {/* ── Search + filter ── */}
        <div className="flex flex-col gap-2 px-4 pt-3 pb-2 flex-shrink-0">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search presets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="
              w-full bg-[#0f0f18] border border-white/10 rounded px-3 py-1.5
              text-white text-[11px] font-mono placeholder-white/25
              focus:outline-none focus:border-[#ff8c00]/60
            "
          />
          {/* Filter tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {FILTER_TAGS.map((ft) => {
              const isActive = activeFilter === ft.match;
              return (
                <button
                  key={ft.label}
                  onClick={() => setActiveFilter(isActive ? null : ft.match)}
                  className="
                    px-2 py-0.5 rounded text-[9px] font-bold font-mono tracking-wide
                    transition-colors focus:outline-none
                  "
                  style={{
                    backgroundColor: isActive ? 'var(--daw-accent)' : 'var(--daw-card)',
                    color: isActive ? '#000' : 'var(--daw-text-muted)',
                  }}
                >
                  {ft.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Preset grid ── */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {filteredPresets.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-white/30 text-[11px] font-mono">
              No presets match your search.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filteredPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onSelect(preset)}
                  className="
                    text-left p-2.5 rounded-md border border-white/5
                    bg-[#1a1a2e] hover:bg-[#22223a] hover:border-white/15
                    active:scale-[0.98] transition-all focus:outline-none
                    flex flex-col gap-1
                  "
                >
                  {/* Name row */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="text-white text-[10px] font-bold font-mono truncate leading-tight">
                      {preset.name}
                    </span>
                  </div>
                  {/* Description */}
                  <p className="text-[9px] text-white/40 font-mono leading-snug line-clamp-2">
                    {preset.description}
                  </p>
                  {/* Tags */}
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {preset.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-1 py-px rounded text-[8px] font-mono"
                        style={{
                          backgroundColor: `${preset.color}22`,
                          color: preset.color,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChannelRack() {
  const {
    getActivePattern,
    addChannel,
  } = useDAWStore();

  const pattern = getActivePattern();
  const patternBars = pattern?.bars ?? 1;
  const totalSteps = patternBars * 16;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  // ── Direct DOM step highlight — bypasses React render cycle entirely ──
  useEffect(() => {
    let prevStep = -1;
    const unsub = useDAWStore.subscribe(
      (s) => ({ step: s.currentStep, playing: s.isPlaying }),
      ({ step, playing }) => {
        // Remove highlight from previous step
        if (prevStep >= 0) {
          const prev = document.querySelectorAll(`[data-step="${prevStep}"]`);
          prev.forEach((el) => el.classList.remove('step-playhead'));
        }
        // Apply highlight to current step if playing
        if (playing) {
          const next = document.querySelectorAll(`[data-step="${step}"]`);
          next.forEach((el) => el.classList.add('step-playhead'));
        }
        prevStep = step;
      },
    );
    return unsub;
  }, []);

  // ── Open preset picker ──
  const handleAddChannel = useCallback(() => {
    setShowPresetPicker(true);
  }, []);

  // ── Add channel from a full preset ──
  const handleSelectPreset = useCallback(
    (preset: SoundPreset) => {
      addChannel({
        name: preset.name,
        type: preset.type,
        color: preset.color,
        instrument: preset.instrument,
      });
      setShowPresetPicker(false);
    },
    [addChannel],
  );

  // ── Quick-add a bare channel of a given type ──
  const handleQuickAdd = useCallback(
    (qt: typeof QUICK_ADD_TYPES[number]) => {
      addChannel({ name: qt.label, type: qt.type, color: qt.color });
      setShowPresetPicker(false);
    },
    [addChannel],
  );

  const handleClosePresetPicker = useCallback(() => {
    setShowPresetPicker(false);
  }, []);

  // ── Context menu ──
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, channelId: string) => {
      e.preventDefault();
      setContextMenu({ channelId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const channels: Channel[] = useMemo(
    () => pattern?.channels ?? [],
    [pattern],
  );

  const patternName = pattern?.name ?? 'No Pattern';

  return (
    <div
      className="flex flex-col w-full h-full font-mono select-none overflow-hidden relative"
      style={{ background: 'var(--daw-bg)' }}
    >
      {/* Scanline overlay */}
      <div className="scanline-overlay" />

      {/* ── Header bar ── */}
      <div
        className="flex items-center justify-between h-9 min-h-[36px] px-3 border-b border-white/10 flex-shrink-0 relative z-10"
        style={{
          background: `linear-gradient(90deg, var(--daw-panel) 0%, var(--daw-bg) 100%)`,
          borderLeft: '4px solid var(--daw-accent)',
        }}
      >
        {/* Title */}
        <span className="text-[11px] font-bold tracking-widest neon-accent uppercase">
          Channel Rack
        </span>

        {/* Pattern name */}
        <span className="text-[10px] font-mono text-white/40 truncate max-w-[160px]">
          {patternName}
        </span>

        <div className="flex items-center gap-3">
          {/* Bar count selector */}
          {pattern && (
            <BarSelector patternId={pattern.id} currentBars={patternBars} />
          )}

          {/* Add channel button */}
          <button
            onClick={handleAddChannel}
            className="
              px-2 py-0.5 text-[10px] font-bold font-mono tracking-wide
              bg-daw-accent text-black rounded
              hover:bg-daw-accentLight active:scale-95
              transition-all focus:outline-none
            "
          >
            + ADD CHANNEL
          </button>
        </div>
      </div>

      {/* ── Beat markers ── */}
      <BeatMarkerHeader totalSteps={totalSteps} />

      {/* ── Channel list ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative z-[1]">
        {channels.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-full gap-2 text-white/30 text-xs"
            style={{ minHeight: 120 }}
          >
            <span className="text-2xl">+</span>
            <span>No channels. Click &quot;+ ADD CHANNEL&quot; to get started.</span>
          </div>
        ) : (
          channels.map((channel, idx) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              rowIndex={idx}
              totalSteps={totalSteps}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          totalSteps={totalSteps}
          onClose={handleCloseContextMenu}
        />
      )}

      {/* ── Preset picker modal ── */}
      {showPresetPicker && (
        <PresetPicker
          onSelect={handleSelectPreset}
          onQuickAdd={handleQuickAdd}
          onClose={handleClosePresetPicker}
        />
      )}
    </div>
  );
}
