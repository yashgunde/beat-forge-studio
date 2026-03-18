'use client';

import { useEffect, useRef } from 'react';
import { useDAWStore } from '@/lib/store';
import { useAudioEngine } from '@/lib/audioEngine';
import { loadSampleFromIDB } from '@/lib/idb-storage';
import TopBar from './TopBar';
import RecordExportBar from './RecordExportBar';
import ThemeBackground from './ThemeBackground';

import ChannelRack from './ChannelRack';
import PianoRoll from './PianoRoll';
import Mixer from './Mixer';
import Playlist from './Playlist';
import BeatGenerator from './BeatGenerator';
import SampleSlicer from './SampleSlicer';
import ThemePicker from './ThemePicker';

export default function DAWShell() {
  const engine = useAudioEngine();

  const activeView = useDAWStore((s) => s.activeView);
  const beatGeneratorOpen = useDAWStore((s) => s.beatGeneratorOpen);
  const sampleSlicerOpen = useDAWStore((s) => s.sampleSlicerOpen);
  const activePatternId = useDAWStore((s) => s.activePatternId);
  const getActivePattern = useDAWStore((s) => s.getActivePattern);
  const theme = useDAWStore((s) => s.theme);

  // Apply data-theme to <html> so CSS variables cascade everywhere
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Rehydrate sample blob URLs from IndexedDB after page refresh.
  // On refresh, sampleUrl (blob:) is dead but sampleId is persisted.
  const rehydrated = useRef(false);
  useEffect(() => {
    if (rehydrated.current) return;
    rehydrated.current = true;

    const state = useDAWStore.getState();
    for (const pattern of state.patterns) {
      for (const ch of pattern.channels) {
        if (ch.type === 'sample' && ch.sampleId && !ch.sampleUrl?.startsWith('blob:')) {
          loadSampleFromIDB(ch.sampleId).then((url) => {
            if (url) {
              useDAWStore.getState().updateChannel(ch.id, { sampleUrl: url });
            }
          }).catch(() => {});
        }
      }
    }
  }, []);

  // Sync channels whenever the active pattern changes.
  useEffect(() => {
    try {
      const pattern = getActivePattern();
      if (pattern) {
        engine.syncChannels(pattern.channels);
      }
    } catch (err) {
      console.warn('[DAWShell] Engine channel sync failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatternId]);

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-daw-bg font-mono text-daw-text relative">
      {/* ------------------------------------------------------------------ */}
      {/* Animated theme background                                           */}
      {/* ------------------------------------------------------------------ */}
      <ThemeBackground />

      {/* ------------------------------------------------------------------ */}
      {/* Top bar — fixed height ~48px                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-none h-12 relative z-10">
        <TopBar />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Record / Export bar — slim 40px strip below the TopBar              */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative z-10">
        <RecordExportBar />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main content area — fills remaining height                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 overflow-hidden relative z-10">
        {activeView === 'channelrack' && <ChannelRack />}
        {activeView === 'piano-roll' && <PianoRoll />}
        {activeView === 'mixer' && <Mixer />}
        {activeView === 'playlist' && <Playlist />}

        {/* Beat Generator modal overlay */}
        {beatGeneratorOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <BeatGenerator />
          </div>
        )}
      </div>

      {/* Sample Slicer — full-screen modal */}
      {sampleSlicerOpen && <SampleSlicer />}

      {/* Floating theme picker — bottom-right corner */}
      <ThemePicker />
    </div>
  );
}
