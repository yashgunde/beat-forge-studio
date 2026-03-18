# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node is installed via Scoop. The `node`/`npm` binaries are not on the default PATH in non-interactive shells. Prefix all commands:

```bash
export PATH="/c/Users/Yash/scoop/apps/nodejs/23.1.0:$PATH"
```

| Task | Command |
|---|---|
| Dev server (Turbopack) | `npm run dev` |
| Production build | `npm run build` |
| Start production server | `npm run start` |
| Lint | `npm run lint` |
| Install deps | `npm install` |

No test runner is configured. There are no test files.

## Architecture

### Core constraint: client-side first

This is a browser DAW. The DAW UI and audio engine run entirely client-side with SSR disabled. `app/page.tsx` must have `'use client'` and uses `dynamic(() => import(...), { ssr: false })` to load `DAWShell`. All `components/daw/` files and `lib/audioEngine.ts` require `'use client'`. The webpack config (`next.config.ts`) stubs out `fs`, `path`, and `os` because audio libraries attempt to import them.

**Exception**: The YouTube to MP3 converter uses Next.js API routes (`app/api/youtube/`) which run server-side. These routes shell out to `yt-dlp` and `ffmpeg` via `child_process`.

### State: single Zustand store

**`lib/store.ts`** is the single source of truth for the entire application. All views read from and write to `useDAWStore`. The store uses `subscribeWithSelector` middleware, which is critical — the audio engine subscribes to specific slices (`isPlaying`, `bpm`, `masterVolume`) rather than the whole store.

Key state shape:
- **Project**: `bpm`, `projectName`, `timeSignature`
- **Patterns**: `patterns[]` + `activePatternId` — each `Pattern` contains its own `channels[]` and `pianoRollNotes` (keyed by channelId). Mutations to channels always target the active pattern only.
- **Transport**: `isPlaying`, `currentStep` (0-15, set by the audio engine on each 16th-note tick)
- **UI**: `activeView`, `pianoRollChannelId`, `beatGeneratorOpen`

### Audio engine: singleton in `lib/audioEngine.ts`

`AudioEngine.getInstance()` returns a singleton. It must not be constructed directly. The `useAudioEngine()` React hook is the correct way to get/initialise it from components.

**Critical**: `DAWShell` must import the real hook — `import { useAudioEngine } from '@/lib/audioEngine'`. Never replace this with a stub or inline placeholder; doing so silently disconnects all audio and breaks the step sequencer (the step counter will freeze at 0 and no sound will play).

Signal chain per channel:
```
Synth → [Distortion?] → [Reverb?] → [FeedbackDelay?] → Panner → Channel Gain → Master Gain → Tone.Destination
```

The engine subscribes to the Zustand store internally — **do not manually call `engine.start()`/`engine.stop()` in response to store changes**; toggling `isPlaying` in the store is enough. The store subscription handles it. The only time you call engine methods directly is to `syncChannels()` after a pattern change, or `previewNote()` from the piano roll.

`Tone.Transport.scheduleRepeat` at `'16n'` drives the step clock. UI sync (`setCurrentStep`) is deferred to the draw frame via `Tone.getDraw().schedule()` to avoid calling React state from the audio thread.

**Web Audio context unlock**: The browser suspends the AudioContext until a user gesture occurs. `_transportStart` must `await Tone.start()` inside a `.then()` before calling `transport.start()` — never call `transport.start()` synchronously alongside a fire-and-forget `Tone.start()`, or the transport will start while the context is still suspended and produce no audio.

### Beat generation API

`web-audio-beat-detector` exports two functions with different return types:
- `analyze(buffer)` → `Promise<number>` — BPM only
- `guess(buffer)` → `Promise<{ bpm: number; offset: number }>` — BPM + beat offset

Use `guess()` when both values are needed. Using `analyze()` and trying to destructure `.bpm` from it is a TypeScript error.

### Synth type mapping

| Channel type | Tone.js synth |
|---|---|
| `kick`, `perc` | `MembraneSynth` |
| `hihat`, `openhat` | `MetalSynth` |
| `snare`, `clap` | `NoiseSynth` |
| `bass` | `Synth` (sawtooth) |
| `synth` / `fm` | `FMSynth` |
| `am` | `AMSynth` |
| default tonal | `Synth` (triangle) |

### Views

`DAWShell` renders one of four views based on `activeView`:

- **`channelrack`** — `ChannelRack`: 16-step grid. Each channel row has a left panel (name, M/S, volume) and right grid. `currentStep` prop drives column highlighting during playback.
- **`piano-roll`** — `PianoRoll`: opens for the channel in `pianoRollChannelId`. Notes are stored in `pattern.pianoRollNotes[channelId]` as `Note[]` where `start`/`duration` are in 16th-note units.
- **`mixer`** — `Mixer`: vertical channel strips with knob drag interaction (mousedown → document mousemove delta-Y).
- **`playlist`** — `Playlist`: song arrangement grid. `PlaylistClip` references a `patternId` and is positioned by `track` (0-7) and `startBar`.

`BeatGenerator` is a modal overlay rendered in `DAWShell` when `beatGeneratorOpen` is true.
`YouTubeConverter` is a modal overlay rendered when `youtubeConverterOpen` is true. It calls `/api/youtube/info` and `/api/youtube/download` API routes which run `yt-dlp` server-side.

### Beat generation flow

1. User uploads an MP3/WAV via `BeatGenerator`
2. `AudioContext.decodeAudioData()` decodes it (capped at 30 seconds)
3. `web-audio-beat-detector` (`analyze()`) detects BPM — falls back to ~120 if it throws
4. `Meyda` extracts `spectralCentroid`, `energy`, `rms` across 512-sample frames
5. `generatePattern()` builds a `Pattern` using genre-aware rules (spectral centroid drives hi-hat density; BPM thresholds distinguish trap vs. house vs. D&B patterns)
6. `applyGeneratedPattern(result)` in the store merges the generated steps into the active pattern and sets the BPM

### Turbopack + Tone.js

Tone.js `package.json` has a `browser` field pointing to `build/Tone.js` (a UMD bundle with no named ESM exports). Turbopack prefers the `browser` field in browser contexts, so `import * as Tone from 'tone'` resolves to the UMD bundle and all named exports appear missing. The fix in `next.config.ts` aliases `tone` → `tone/build/esm/index.js` under `experimental.turbo.resolveAlias` (Next.js 15.2.x — the top-level `turbopack` key only exists in 15.3+). If this alias is ever removed, every `Tone.*` import will break with "Export X doesn't exist in target module".

### CSS import ordering

Turbopack (used in `npm run dev`) enforces strict CSS `@import` ordering. In `app/globals.css`, `@import` statements must appear before `@tailwind` directives. Placing them after causes a Turbopack parse error at runtime.

### Tailwind theme

All DAW colours are under the `daw` namespace in `tailwind.config.ts`. Use `bg-daw-*` / `text-daw-*` / `border-daw-*` exclusively — never raw hex values in className. Key tokens: `daw-bg` (main bg), `daw-panel` (panels), `daw-card` (cards/inputs), `daw-accent` (orange #ff8c00), `daw-stepOn`/`daw-stepOff`/`daw-stepHover` (step buttons).

### Type system

All shared types live in `lib/types.ts`. `DEFAULT_CHANNELS` (8 pre-configured channels) and `CHANNEL_COLORS` (12-color palette) are also exported from there. `midiToNoteName` / `noteNameToMidi` helpers are in the same file. Import from `@/lib/types`.
