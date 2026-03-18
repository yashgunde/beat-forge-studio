'use client';

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { idbStorage } from './idb-storage';
import {
  Channel,
  Pattern,
  PlaylistClip,
  MixerChannel,
  Note,
  ViewType,
  BeatGenerationResult,
  DEFAULT_CHANNELS,
} from './types';

function createDefaultPattern(): Pattern {
  const channels: Channel[] = DEFAULT_CHANNELS.map((ch) => ({
    ...ch,
    id: uuidv4(),
    steps: Array(16).fill(false),
  }));

  // Default kick pattern
  const kickChannel = channels.find(c => c.type === 'kick');
  if (kickChannel) {
    kickChannel.steps = [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false];
  }
  // Default hi-hat pattern
  const hihatChannel = channels.find(c => c.type === 'hihat');
  if (hihatChannel) {
    hihatChannel.steps = [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false];
  }
  // Default clap/snare pattern
  const clapChannel = channels.find(c => c.type === 'clap');
  if (clapChannel) {
    clapChannel.steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
  }

  return {
    id: uuidv4(),
    name: 'Pattern 1',
    channels,
    pianoRollNotes: {},
    length: 1,
    bars: 1,
  };
}

function createDefaultMixerChannels(channels: Channel[]): MixerChannel[] {
  const mixerChannels: MixerChannel[] = channels.map((ch) => ({
    id: uuidv4(),
    name: ch.name,
    linkedChannelId: ch.id,
    volume: ch.volume,
    pan: ch.pan,
    muted: ch.muted,
    solo: ch.solo,
    eq: { low: 0, mid: 0, high: 0 },
  }));

  mixerChannels.push({
    id: 'master',
    name: 'Master',
    volume: 0.9,
    pan: 0,
    muted: false,
    solo: false,
    eq: { low: 0, mid: 0, high: 0 },
  });

  return mixerChannels;
}

export type AudioLatencyHint = 'interactive' | 'balanced' | 'playback';
export type AudioSampleRate = 44100 | 48000 | 96000;

interface DAWState {
  // Project
  projectName: string;
  bpm: number;
  timeSignature: [number, number];

  // Transport
  isPlaying: boolean;
  isRecording: boolean;
  currentStep: number;

  // Patterns
  patterns: Pattern[];
  activePatternId: string;

  // Playlist
  playlistClips: PlaylistClip[];
  playlistBars: number;
  playlistStep: number; // global step counter for playlist playback

  // Mixer
  mixerChannels: MixerChannel[];
  masterVolume: number;

  // Audio settings
  audioLatency: AudioLatencyHint;
  audioSampleRate: AudioSampleRate;

  // UI
  activeView: ViewType;
  pianoRollChannelId: string | null;
  beatGeneratorOpen: boolean;
  sampleSlicerOpen: boolean;
  lastGenerationResult: BeatGenerationResult | null;
  theme: string;

  // Actions - Transport
  setBpm: (bpm: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentStep: (step: number) => void;
  togglePlay: () => void;
  stop: () => void;

  // Actions - Patterns & Channels
  getActivePattern: () => Pattern | undefined;
  addPattern: () => void;
  setActivePattern: (id: string) => void;
  updatePattern: (patternId: string, updates: Partial<Pattern>) => void;
  addChannel: (channel?: Partial<Channel>) => void;
  removeChannel: (channelId: string) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  toggleStep: (channelId: string, step: number) => void;
  setChannelSteps: (channelId: string, steps: boolean[]) => void;
  clearAllSteps: (channelId: string) => void;
  setPatternBars: (patternId: string, bars: 1 | 2 | 4 | 8) => void;
  freezeChannel: (channelId: string, frozenBufferUrl: string) => void;
  unfreezeChannel: (channelId: string) => void;

  // Actions - Piano Roll
  openPianoRoll: (channelId: string) => void;
  closePianoRoll: () => void;
  addNote: (channelId: string, note: Omit<Note, 'id'>) => void;
  removeNote: (channelId: string, noteId: string) => void;
  updateNote: (channelId: string, noteId: string, updates: Partial<Note>) => void;

  // Actions - Playlist
  addPlaylistClip: (clip: Omit<PlaylistClip, 'id'>) => void;
  removePlaylistClip: (clipId: string) => void;
  movePlaylistClip: (clipId: string, track: number, startBar: number) => void;
  resizePlaylistClip: (clipId: string, lengthBars: number) => void;
  setPlaylistStep: (step: number) => void;

  // Actions - Mixer
  updateMixerChannel: (channelId: string, updates: Partial<MixerChannel>) => void;
  setMasterVolume: (volume: number) => void;
  syncMixerFromChannels: () => void;

  // Actions - Audio Settings
  setAudioLatency: (latency: AudioLatencyHint) => void;
  setAudioSampleRate: (sampleRate: AudioSampleRate) => void;

  // Actions - UI
  setActiveView: (view: ViewType) => void;
  setBeatGeneratorOpen: (open: boolean) => void;
  setSampleSlicerOpen: (open: boolean) => void;
  setTheme: (theme: string) => void;
  applyGeneratedPattern: (result: BeatGenerationResult) => void;
}

const defaultPattern = createDefaultPattern();

export const useDAWStore = create<DAWState>()(
  persist(
  subscribeWithSelector((set, get) => ({
    // Initial state
    projectName: 'My YGBeatz Project',
    bpm: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    currentStep: 0,
    patterns: [defaultPattern],
    activePatternId: defaultPattern.id,
    playlistClips: [],
    playlistBars: 32,
    playlistStep: 0,
    mixerChannels: createDefaultMixerChannels(defaultPattern.channels),
    masterVolume: 0.85,
    audioLatency: 'interactive',
    audioSampleRate: 44100,
    activeView: 'channelrack',
    pianoRollChannelId: null,
    beatGeneratorOpen: false,
    sampleSlicerOpen: false,
    lastGenerationResult: null,
    theme: 'classic',

    // Transport actions
    setBpm: (bpm) => set({ bpm: Math.max(40, Math.min(300, bpm)) }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setCurrentStep: (currentStep) => set({ currentStep }),
    togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
    stop: () => set({ isPlaying: false, currentStep: 0 }),

    // Pattern actions
    getActivePattern: () => {
      const s = get();
      return s.patterns.find(p => p.id === s.activePatternId);
    },

    addPattern: () => {
      const newPattern = createDefaultPattern();
      newPattern.name = `Pattern ${get().patterns.length + 1}`;
      set((s) => ({
        patterns: [...s.patterns, newPattern],
        activePatternId: newPattern.id,
      }));
    },

    setActivePattern: (id) => set((s) => {
      const newPattern = s.patterns.find(p => p.id === id);
      if (!newPattern) return { activePatternId: id };
      const updatedMixerChannels = s.mixerChannels.map(mc => {
        const ch = newPattern.channels.find(c => c.id === mc.linkedChannelId);
        if (!ch) return mc;
        return { ...mc, volume: ch.volume, pan: ch.pan, muted: ch.muted };
      });
      return { activePatternId: id, mixerChannels: updatedMixerChannels };
    }),

    updatePattern: (patternId, updates) =>
      set((s) => ({
        patterns: s.patterns.map(p => p.id === patternId ? { ...p, ...updates } : p),
      })),

    addChannel: (partial = {}) => {
      const totalSteps = (get().getActivePattern()?.bars ?? 1) * 16;
      const newChannel: Channel = {
        id: uuidv4(),
        name: partial.name || 'New Channel',
        type: partial.type || 'synth',
        color: partial.color || '#4488ff',
        volume: partial.volume ?? 0.75,
        pan: partial.pan ?? 0,
        muted: false,
        solo: false,
        steps: Array(totalSteps).fill(false),
        instrument: partial.instrument || { synthType: 'synth' },
        sampleUrl: partial.sampleUrl,
        ...partial,
      };
      const newMixerChannel: MixerChannel = {
        id: uuidv4(),
        name: newChannel.name,
        linkedChannelId: newChannel.id,
        volume: newChannel.volume,
        pan: newChannel.pan,
        muted: newChannel.muted,
        solo: newChannel.solo,
        eq: { low: 0, mid: 0, high: 0 },
      };
      set((s) => {
        const master = s.mixerChannels.find(mc => mc.id === 'master');
        const others = s.mixerChannels.filter(mc => mc.id !== 'master');
        return {
          patterns: s.patterns.map(p =>
            p.id === s.activePatternId
              ? { ...p, channels: [...p.channels, newChannel] }
              : p
          ),
          mixerChannels: master
            ? [...others, newMixerChannel, master]
            : [...others, newMixerChannel],
        };
      });
    },

    removeChannel: (channelId) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? { ...p, channels: p.channels.filter(c => c.id !== channelId) }
            : p
        ),
        mixerChannels: s.mixerChannels.filter(mc => mc.linkedChannelId !== channelId),
      })),

    updateChannel: (channelId, updates) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                channels: p.channels.map(c =>
                  c.id === channelId ? { ...c, ...updates } : c
                ),
              }
            : p
        ),
      })),

    toggleStep: (channelId, step) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                channels: p.channels.map(c =>
                  c.id === channelId
                    ? {
                        ...c,
                        steps: c.steps.map((v, i) => (i === step ? !v : v)),
                      }
                    : c
                ),
              }
            : p
        ),
      })),

    setChannelSteps: (channelId, steps) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                channels: p.channels.map(c =>
                  c.id === channelId ? { ...c, steps } : c
                ),
              }
            : p
        ),
      })),

    clearAllSteps: (channelId) => {
      const pattern = get().getActivePattern();
      const totalSteps = (pattern?.bars ?? 1) * 16;
      get().setChannelSteps(channelId, Array(totalSteps).fill(false));
    },

    setPatternBars: (patternId, bars) =>
      set((s) => ({
        patterns: s.patterns.map((p) => {
          if (p.id !== patternId) return p;
          const newStepCount = bars * 16;
          const updatedChannels = p.channels.map((c) => {
            const current = c.steps.length;
            let newSteps: boolean[];
            if (newStepCount > current) {
              // pad with false
              newSteps = [...c.steps, ...Array(newStepCount - current).fill(false)];
            } else {
              // truncate
              newSteps = c.steps.slice(0, newStepCount);
            }
            return { ...c, steps: newSteps };
          });
          return { ...p, bars, channels: updatedChannels };
        }),
      })),

    freezeChannel: (channelId, frozenBufferUrl) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                channels: p.channels.map(c =>
                  c.id === channelId ? { ...c, frozen: true, frozenBufferUrl } : c
                ),
              }
            : p
        ),
      })),

    unfreezeChannel: (channelId) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                channels: p.channels.map(c =>
                  c.id === channelId
                    ? { ...c, frozen: false, frozenBufferUrl: undefined }
                    : c
                ),
              }
            : p
        ),
      })),

    // Piano Roll actions
    openPianoRoll: (channelId) => set({ pianoRollChannelId: channelId, activeView: 'piano-roll' }),
    closePianoRoll: () => set({ pianoRollChannelId: null, activeView: 'channelrack' }),

    addNote: (channelId, note) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                pianoRollNotes: {
                  ...p.pianoRollNotes,
                  [channelId]: [
                    ...(p.pianoRollNotes[channelId] || []),
                    { ...note, id: uuidv4() },
                  ],
                },
              }
            : p
        ),
      })),

    removeNote: (channelId, noteId) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                pianoRollNotes: {
                  ...p.pianoRollNotes,
                  [channelId]: (p.pianoRollNotes[channelId] || []).filter(n => n.id !== noteId),
                },
              }
            : p
        ),
      })),

    updateNote: (channelId, noteId, updates) =>
      set((s) => ({
        patterns: s.patterns.map(p =>
          p.id === s.activePatternId
            ? {
                ...p,
                pianoRollNotes: {
                  ...p.pianoRollNotes,
                  [channelId]: (p.pianoRollNotes[channelId] || []).map(n =>
                    n.id === noteId ? { ...n, ...updates } : n
                  ),
                },
              }
            : p
        ),
      })),

    // Playlist actions
    addPlaylistClip: (clip) =>
      set((s) => ({
        playlistClips: [...s.playlistClips, { ...clip, id: uuidv4() }],
      })),

    removePlaylistClip: (clipId) =>
      set((s) => ({
        playlistClips: s.playlistClips.filter(c => c.id !== clipId),
      })),

    movePlaylistClip: (clipId, track, startBar) =>
      set((s) => ({
        playlistClips: s.playlistClips.map(c =>
          c.id === clipId ? { ...c, track, startBar } : c
        ),
      })),

    resizePlaylistClip: (clipId, lengthBars) =>
      set((s) => ({
        playlistClips: s.playlistClips.map(c =>
          c.id === clipId ? { ...c, lengthBars: Math.max(1, lengthBars) } : c
        ),
      })),

    setPlaylistStep: (playlistStep) => set({ playlistStep }),

    // Mixer actions
    updateMixerChannel: (channelId, updates) =>
      set((s) => ({
        mixerChannels: s.mixerChannels.map(mc =>
          mc.id === channelId ? { ...mc, ...updates } : mc
        ),
      })),

    setMasterVolume: (masterVolume) => set({ masterVolume }),

    syncMixerFromChannels: () => {
      const { patterns, activePatternId, mixerChannels } = get();
      const pattern = patterns.find(p => p.id === activePatternId);
      if (!pattern) return;
      set({
        mixerChannels: mixerChannels.map(mc => {
          const ch = pattern.channels.find(c => c.id === mc.linkedChannelId);
          if (!ch) return mc;
          return { ...mc, volume: ch.volume, pan: ch.pan, muted: ch.muted };
        }),
      });
    },

    // Audio settings actions
    setAudioLatency: (audioLatency) => set({ audioLatency }),
    setAudioSampleRate: (audioSampleRate) => set({ audioSampleRate }),

    // UI actions
    setActiveView: (activeView) => {
      // When switching to piano-roll without a channel selected, auto-select the first one
      if (activeView === 'piano-roll') {
        const state = get();
        if (!state.pianoRollChannelId) {
          const pattern = state.getActivePattern();
          const firstChannel = pattern?.channels[0];
          if (firstChannel) {
            set({ activeView, pianoRollChannelId: firstChannel.id });
            return;
          }
        }
      }
      set({ activeView });
    },
    setBeatGeneratorOpen: (beatGeneratorOpen) => set({ beatGeneratorOpen }),
    setSampleSlicerOpen: (sampleSlicerOpen) => set({ sampleSlicerOpen }),
    setTheme: (theme) => set({ theme }),

    applyGeneratedPattern: (result) => {
      set((s) => {
        const activePattern = s.patterns.find(p => p.id === s.activePatternId);
        if (!activePattern) return {};

        // Merge generated channels into active pattern
        const updatedPattern = {
          ...activePattern,
          channels: result.pattern.channels.map((genCh, i) => {
            const existingCh = activePattern.channels[i];
            if (existingCh) {
              return { ...existingCh, steps: genCh.steps };
            }
            return genCh;
          }),
        };

        return {
          bpm: Math.round(result.bpm),
          patterns: s.patterns.map(p =>
            p.id === s.activePatternId ? updatedPattern : p
          ),
          lastGenerationResult: result,
          beatGeneratorOpen: false,
        };
      });
    },
  })),
  {
    name: 'ygbeatz-project',
    storage: {
      getItem: async (name) => {
        const str = await idbStorage.getItem(name);
        return str ? JSON.parse(str) : null;
      },
      setItem: async (name, value) => {
        await idbStorage.setItem(name, JSON.stringify(value));
      },
      removeItem: async (name) => {
        await idbStorage.removeItem(name);
      },
    },
    // Only persist serializable project state — exclude ephemeral transport/UI state.
    // Strip blob: URLs (they die on refresh) — sampleId is kept for rehydration.
    partialize: (state) => ({
      projectName: state.projectName,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      patterns: state.patterns.map(p => ({
        ...p,
        channels: p.channels.map(c => ({
          ...c,
          sampleUrl: c.sampleUrl?.startsWith('blob:') ? undefined : c.sampleUrl,
          frozen: false,
          frozenBufferUrl: undefined,
        })),
      })),
      activePatternId: state.activePatternId,
      playlistClips: state.playlistClips,
      playlistBars: state.playlistBars,
      mixerChannels: state.mixerChannels,
      masterVolume: state.masterVolume,
      audioLatency: state.audioLatency,
      audioSampleRate: state.audioSampleRate,
      activeView: state.activeView,
      theme: state.theme,
    }) as unknown as DAWState,
  },
  )
);
