# YGBeatz [Beats-Forge-Studio]

> A fully browser-based Digital Audio Workstation — no backend, no plugins, no install.

Built on **Next.js 15**, **Tone.js**, **Zustand**, and **Meyda**. Everything runs client-side: synthesis, sequencing, mixing, recording, and AI-assisted beat generation.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Feature Overview](#feature-overview)
3. [Architecture Overview](#architecture-overview)
4. [Module Deep-Dives](#module-deep-dives)
   - [State Management — `lib/store.ts`](#state-management--libstorets)
   - [Audio Engine — `lib/audioEngine.ts`](#audio-engine--libaudioenginets)
   - [Type System — `lib/types.ts`](#type-system--libtypests)
   - [Persistence — `lib/idb-storage.ts`](#persistence--libidb-storagets)
   - [Recording — `lib/recorder.ts`](#recording--librecorderts)
5. [Component Hierarchy](#component-hierarchy)
   - [DAWShell](#dawshell)
   - [TopBar](#topbar)
   - [ChannelRack](#channelrack)
   - [PianoRoll](#pianoroll)
   - [Mixer](#mixer)
   - [Playlist](#playlist)
   - [BeatGenerator](#beatgenerator)
   - [SampleSlicer](#sampleslicer)
6. [Data Flow Diagrams](#data-flow-diagrams)
7. [Audio Signal Chain](#audio-signal-chain)
8. [Beat Generation Pipeline](#beat-generation-pipeline)
9. [Initialization Sequence](#initialization-sequence)
10. [Import Graph](#import-graph)
11. [Styling System](#styling-system)
12. [Key Technical Decisions](#key-technical-decisions)

---

## Quick Start

```bash
# Prerequisites: Node.js 23+ (installed via Scoop on Windows)
export PATH="/c/Users/{name}/scoop/apps/nodejs/23.1.0:$PATH"

npm install
npm run dev      # Turbopack dev server
npm run build    # Production build
npm run lint     # ESLint
```

> **Windows note**: Node binaries are not on the default PATH in non-interactive shells. Prefix all commands with the `export PATH` line above, or add it to your shell profile.

---

## Feature Overview

| Feature | Description |
|---|---|
| **Step Sequencer** | 16-step grid per channel, up to unlimited channels per pattern |
| **Piano Roll** | Note editor with quantize, drag/resize, pitch preview |
| **Mixer** | Per-channel volume, pan, mute/solo with knob drag UI |
| **Playlist** | Song arrangement — place pattern clips on 8 tracks |
| **Beat Generator** | Upload an audio file; AI detects BPM and generates a pattern |
| **Sample Slicer** | Visual waveform editor; slice samples into channels |
| **Themes** | 6 animated themes (Classic, Noir, Clouds, Forest, Aurora, Sunset) |
| **Export** | Record the master output and download as `.webm` |
| **Persistence** | Full state persisted to IndexedDB (survives page refresh) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser Tab                             │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Next.js App Router                    │  │
│  │   app/page.tsx  ──(dynamic import, ssr:false)──►         │  │
│  │                        DAWShell                          │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                   │
│           ┌─────────────────▼──────────────────┐               │
│           │          Zustand Store              │               │
│           │       lib/store.ts                 │               │
│           │  (subscribeWithSelector + persist)  │               │
│           └──────┬──────────────────┬──────────┘               │
│                  │  reads/writes    │ subscribes               │
│           ┌──────▼──────┐   ┌──────▼──────────┐               │
│           │  React UI   │   │  Audio Engine   │               │
│           │  Components │   │  lib/audioEngine│               │
│           │  (render)   │   │  (Tone.js)      │               │
│           └─────────────┘   └────────┬────────┘               │
│                                      │                          │
│                             ┌────────▼────────┐                │
│                             │   Web Audio API │                │
│                             │ (AudioContext)  │                │
│                             └─────────────────┘                │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              IndexedDB (lib/idb-storage.ts)            │    │
│  │   ygbeatz-state (Zustand snapshot)                     │    │
│  │   ygbeatz-samples (raw audio ArrayBuffers)             │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

The architecture is intentionally **flat**: there is no server, no REST API, no database. The browser is the entire runtime. This is temporary and built in for easy access + usage for now, *smile*

---

## Module Deep-Dives

### State Management — `lib/store.ts`

The Zustand store is the **single source of truth** for the entire application. UI components read from it; the audio engine subscribes to slices of it.

```
┌──────────────────────────────────────────────────────────────────┐
│                        DAWState (Zustand)                        │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Project   │  │  Transport   │  │    Patterns            │  │
│  │─────────────│  │──────────────│  │────────────────────────│  │
│  │ projectName │  │ isPlaying    │  │ patterns[]             │  │
│  │ bpm         │  │ isRecording  │  │   └─ id, name          │  │
│  │ timeSignat. │  │ currentStep  │  │   └─ channels[]        │  │
│  └─────────────┘  └──────────────┘  │        └─ steps[0..15] │  │
│                                      │   └─ pianoRollNotes{}  │  │
│  ┌─────────────┐  ┌──────────────┐  │        └─ Note[]       │  │
│  │   Playlist  │  │   Mixer      │  └────────────────────────┘  │
│  │─────────────│  │──────────────│                              │
│  │ playlistClip│  │ mixerChannels│  ┌──────────────────────┐    │
│  │ playlistBars│  │ masterVolume │  │        UI            │    │
│  │ playlistStep│  └──────────────┘  │──────────────────────│    │
│  └─────────────┘                    │ activeView           │    │
│                                     │ pianoRollChannelId   │    │
│                                     │ beatGeneratorOpen    │    │
│                                     │ sampleSlicerOpen     │    │
│                                     │ theme                │    │
│                                     └──────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**Middleware stack** (applied innermost-first):

```
createStore(
  subscribeWithSelector(   ← lets audio engine subscribe to slices
    persist(               ← auto-saves to IndexedDB on every change
      immer(               ← draft mutations (structural sharing)
        stateCreator
      )
    )
  )
)
```

**Pattern mutation rules**: Mutations to `channels` always target `patterns[activePatternId]` only. The active pattern ID is just a string pointer; switching patterns is O(1) — no data copying.

```
patterns: [
  { id: "p1", name: "Pattern 1", channels: [ ... ], pianoRollNotes: { ... } },
  { id: "p2", name: "Pattern 2", channels: [ ... ], pianoRollNotes: { ... } },
]
activePatternId: "p1"   ← UI + audio engine read only this pattern
```

---

### Audio Engine — `lib/audioEngine.ts`

The engine is a **singleton** that bridges the Zustand store and Tone.js.

```
                    AudioEngine.getInstance()
                           │
                    ┌──────▼──────┐
                    │   init()    │ ← called once by useAudioEngine() hook
                    └──────┬──────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
    createMasterGain  syncChannels()  subscribeToStore()
                           │                │
                    ┌──────▼──────┐         │ isPlaying changes
                    │ buildSignal │         ▼
                    │   Chain()   │   _transportStart()
                    └──────┬──────┘         │
                           │         await Tone.start()
                           ▼                │
                  Synth / Player            ▼
                       │            transport.start()
                       ▼                    │
              [Distortion?]         scheduleRepeat('16n')
                       │                    │
               [Reverb?]            ┌───────▼────────┐
                       │            │  _onStep(i,t)  │◄── every 16th note
               [FeedbackDelay?]     └───────┬────────┘
                       │                    │
                    Panner           for each channel
                       │            if steps[i] → triggerAttack
                  Channel Gain               │
                       │            Tone.getDraw().schedule()
                  Master Gain                │
                       │            setCurrentStep(i)  ← UI update
                  Destination                   (deferred to draw frame)
```

**Synth type mapping**:

```
Channel Type   │  Tone.js Synth     │  Oscillator / Source
───────────────┼────────────────────┼──────────────────────
kick, perc     │  MembraneSynth     │  Sine with pitch decay
hihat, openhat │  MetalSynth        │  Metallic FM partials
snare, clap    │  NoiseSynth        │  White noise burst
bass           │  Synth             │  Sawtooth oscillator
synth (default)│  Synth             │  Triangle oscillator
fm             │  FMSynth           │  FM modulation
am             │  AMSynth           │  AM modulation
sample         │  Player            │  Decoded AudioBuffer
```

**Critical: AudioContext unlock sequence**

Web browsers suspend the AudioContext until the user interacts with the page. The engine handles this in `_transportStart()`:

```typescript
// WRONG — transport may start before context is resumed:
Tone.start();          // fire-and-forget, still suspended
transport.start();     // silent

// CORRECT — wait for context unlock:
await Tone.start();    // resolves after context.resume()
transport.start();     // context is live, audio flows
```

---

### Type System — `lib/types.ts`

All shared TypeScript interfaces are centralized here. No types are defined in component files.

```
types.ts exports
│
├── ChannelType (union)
│     'kick' | 'snare' | 'hihat' | 'openhat' | 'clap' | 'perc'
│     'bass' | 'pad' | 'lead' | 'synth' | 'fm' | 'am' | 'sample'
│
├── InstrumentSettings
│     synthType, tune, pitch, attack, decay, sustain, release
│     distortion (0–1), reverb (0–1), delay (0–1)
│
├── Channel
│     id, name, type: ChannelType, color
│     volume (0–1), pan (-1 to 1), muted, solo
│     steps: boolean[16]
│     instrument?: InstrumentSettings
│     sampleId?, sampleUrl?, sampleStart?, sampleEnd?
│
├── Note
│     id, pitch (0–127 MIDI), start (16th-note units)
│     duration (16th-note units), velocity (0–1)
│
├── Pattern
│     id, name
│     channels: Channel[]
│     pianoRollNotes: Record<channelId, Note[]>
│     bars: number
│
├── PlaylistClip
│     id, patternId, track (0–7), startBar, lengthBars
│
├── MixerChannel
│     id, name, linkedChannelId
│     volume, pan, muted, solo
│     eq: { low, mid, high }
│
├── DEFAULT_CHANNELS        ← 8 pre-configured starter channels
├── CHANNEL_COLORS          ← 12-color palette for channel strips
├── SOUND_PRESETS           ← 30+ named presets with tags
├── midiToNoteName(midi)    ← 60 → "C4"
└── noteNameToMidi(name)    ← "C4" → 60
```

---

### Persistence — `lib/idb-storage.ts`

IndexedDB is used instead of `localStorage` because audio ArrayBuffers can be megabytes in size.

```
IndexedDB: "ygbeatz-db"
│
├── Store: "ygbeatz-state"
│     key: "state"
│     value: serialized Zustand snapshot
│     Note: blob: URLs are stripped on serialize
│           (they die on page refresh — sampleId is kept for re-loading)
│
└── Store: "ygbeatz-samples"
      key: sampleId (string)
      value: ArrayBuffer (raw PCM/compressed audio)
      Note: loaded back via createObjectURL() on hydration
```

**Hydration flow** (in `DAWShell.tsx`):

```
DAWShell mounts
      │
      ▼
for each channel in activePattern
  if channel.sampleId && !channel.sampleUrl
    │
    ▼
  loadSampleFromIDB(sampleId)
    → ArrayBuffer → Blob → createObjectURL()
    │
    ▼
  updateChannel({ sampleUrl: freshBlobUrl })
    │
    ▼
  engine.rebuildChannel(channel)
```

---

### Recording — `lib/recorder.ts`

`BeatRecorder` is a singleton (same pattern as `AudioEngine`) that taps the master output.

```
Tone.Destination (master output)
       │
       ▼ (connect)
MediaStreamAudioDestinationNode
       │
       ▼ (stream)
MediaRecorder
       │  chunks collected on 'dataavailable'
       ▼
stopAndDownload(filename)
       │
       ▼
new Blob(chunks, { type: 'audio/webm' })
       │
       ▼
URL.createObjectURL(blob) → <a download> → click()
```

---

## Component Hierarchy

```
app/page.tsx  (SSR disabled)
└── DAWShell
    ├── ThemeBackground          (animated bg layer, z-0)
    ├── RecordExportBar          (record/export controls)
    ├── TopBar                   (transport + view switcher)
    ├── [activeView switch]
    │   ├── ChannelRack          (activeView === 'channelrack')
    │   ├── PianoRoll            (activeView === 'piano-roll')
    │   ├── Mixer                (activeView === 'mixer')
    │   └── Playlist             (activeView === 'playlist')
    ├── BeatGenerator (modal)    (beatGeneratorOpen === true)
    ├── SampleSlicer  (modal)    (sampleSlicerOpen === true)
    └── ThemePicker  (overlay)   (shown via state flag)
```

---

### DAWShell

[components/daw/DAWShell.tsx](components/daw/DAWShell.tsx)

The root component of the DAW. Its responsibilities:

- Call `useAudioEngine()` to initialize and hold the audio engine alive for the component lifetime
- Rehydrate sample `blob:` URLs from IndexedDB on mount
- Sync the audio engine whenever `activePatternId` changes
- Conditionally render the active view and overlays
- Apply the active theme class to the root `<div>`

```
DAWShell mounts
    │
    ├── useAudioEngine() ──────► AudioEngine.getInstance().init()
    │
    ├── useEffect [mount]
    │       └── rehydrate sample blob: URLs from IDB
    │
    ├── useEffect [activePatternId]
    │       └── engine.syncChannels(activePattern.channels)
    │
    └── render
            ├── <ThemeBackground theme={theme} />
            ├── <RecordExportBar />
            ├── <TopBar />
            ├── {activeView === 'channelrack' && <ChannelRack />}
            ├── {activeView === 'piano-roll'  && <PianoRoll />}
            ├── {activeView === 'mixer'       && <Mixer />}
            ├── {activeView === 'playlist'    && <Playlist />}
            ├── {beatGeneratorOpen && <BeatGenerator />}
            └── {sampleSlicerOpen  && <SampleSlicer />}
```

---

### TopBar

[components/daw/TopBar.tsx](components/daw/TopBar.tsx)

The control strip at the top of the DAW.

| Section | Controls |
|---|---|
| Left | Logo, editable project name, pattern selector |
| Center | Play/Stop, Tap Tempo, BPM input, time position display |
| Right | View tabs (CHANNEL RACK / PIANO ROLL / MIXER / PLAYLIST), master volume, Beat Generator toggle |

**Tap Tempo algorithm**: stores timestamps of the last 5 taps; averages the intervals between them; converts to BPM via `60000 / avgInterval`.

---

### ChannelRack

[components/daw/ChannelRack.tsx](components/daw/ChannelRack.tsx)

The 16-step sequencer grid.

```
ChannelRack
├── Beat labels row  [1.1] [1.2] [1.3] [1.4] [2.1] … [4.4]
│
└── For each channel in activePattern.channels:
    ├── Left panel
    │   ├── Color swatch (click → color picker)
    │   ├── Channel name (double-click → rename input)
    │   ├── [M] Mute button
    │   ├── [S] Solo button
    │   ├── Volume slider
    │   └── [PR] Open Piano Roll button
    │
    └── Right: 16 × StepButton
                │
                └── onClick → toggleStep(channelId, stepIndex)
                    style  → active (orange glow)
                             isCurrent (scale + pulse animation)
                             isPlaying
```

`StepButton` is memoized with a custom `areEqual` comparator to prevent re-renders on unrelated store updates. This is critical for performance with many channels.

---

### PianoRoll

[components/daw/PianoRoll.tsx](components/daw/PianoRoll.tsx)

Full note editor for melodic/harmonic channels.

```
PianoRoll
├── Left: Piano keyboard (C1–C8, 84 keys)
│         White keys: C D E F G A B  (click → previewNote)
│         Black keys: overlaid absolutely
│
├── Top ruler: time positions (bars, beats, 16th notes)
│
└── Grid canvas
    ├── Horizontal lines: pitch rows (one per semitone)
    ├── Vertical lines: beat/bar dividers
    │
    └── For each Note in pianoRollNotes[channelId]:
        └── <NoteRect>
            ├── Position: left = start × colWidth × zoomX
            ├── Width:    duration × colWidth × zoomX
            ├── Top:      (maxPitch - pitch) × rowHeight
            ├── Drag body    → moveNote (quantized to quantize setting)
            └── Drag right edge → resizeNote duration
```

**Quantize options**: `1/16` (1 step), `1/8` (2 steps), `1/4` (4 steps), `1/2` (8 steps), `1 bar` (16 steps).

---

### Mixer

[components/daw/Mixer.tsx](components/daw/Mixer.tsx)

Vertical channel strips, one per `mixerChannels` entry plus a master strip.

```
Mixer
├── For each mixerChannel:
│   └── ChannelStrip (vertical)
│       ├── Channel name
│       ├── EQ knobs: Low / Mid / High (stub — visual only)
│       ├── Pan knob (−1 … +1)
│       ├── Volume knob (0 … 1)  ← drag up/down
│       ├── [M] Mute
│       └── [S] Solo
│
└── Master strip
    └── Volume knob → setMasterVolume()
```

**Knob drag interaction**: `mousedown` captures initial value; `document.mousemove` calculates `deltaY` (negative = clockwise = higher value); `mouseup` releases. Value is clamped to `[min, max]` range.

---

### Playlist

[components/daw/Playlist.tsx](components/daw/Playlist.tsx)

Song arrangement editor. Places pattern clips on 8 tracks across a bar timeline.

```
Playlist
├── Track headers (left column)
│   └── For each track (0–7):
│       ├── Track name (editable)
│       ├── [M] Mute
│       └── [S] Solo
│
├── Timeline ruler (top row)
│   └── Bar numbers: 1, 2, 3, … playlistBars
│
└── Clip grid
    └── For each track row:
        ├── Empty cells (click → addPlaylistClip referencing activePattern)
        └── For each PlaylistClip on this track:
            └── <PlaylistClip>
                ├── Shows pattern name + color
                ├── Drag → movePlaylistClip(id, newTrack, newStartBar)
                └── Drag right edge → resizePlaylistClip(id, newLength)
```

---

### BeatGenerator

[components/daw/BeatGenerator.tsx](components/daw/BeatGenerator.tsx)

Modal overlay for AI-assisted beat generation. See [Beat Generation Pipeline](#beat-generation-pipeline) for the full algorithm.

---

### SampleSlicer

[components/daw/SampleSlicer.tsx](components/daw/SampleSlicer.tsx)

Visual waveform editor for slicing imported audio.

```
SampleSlicer
├── Waveform canvas
│   ├── Draws PCM amplitude as filled waveform
│   ├── Time ruler with bar/beat markers
│   ├── Slice markers (draggable vertical lines)
│   └── Selection region (drag to create)
│
├── Slice list
│   └── For each slice: [name] [start] [end] [Create Channel ▶]
│
└── Actions
    ├── Add slice at selection
    ├── Auto-detect transients
    └── Create channel from slice
            │
            └── saveSampleToIDB(sliceId, sliceBuffer)
                addChannel({ type: 'sample', sampleId, sampleUrl })
```

---

## Data Flow Diagrams

### User Toggles a Step Button

```
User clicks step button
        │
        ▼
StepButton onClick
        │
        ▼
store.toggleStep(channelId, stepIndex)
        │
        ├── patterns[activePatternId]
        │     .channels[channelId]
        │     .steps[stepIndex] = !prev
        │
        └── (Zustand notifies subscribers)
                │
                ├── React re-renders StepButton (active prop changed)
                │
                └── Audio engine subscription fires?
                        No — step arrays are read directly on each _onStep()
                        call; no subscription needed
```

### User Presses Play

```
User clicks Play button (TopBar)
        │
        ▼
store.togglePlay()  →  isPlaying: true
        │
        ▼
AudioEngine store subscription fires
        │
        ▼
_transportStart()
        │
        ├── await Tone.start()   ← unlock AudioContext (user gesture)
        │
        ├── Tone.Transport.bpm.value = store.bpm
        │
        └── Tone.Transport.scheduleRepeat(callback, '16n')
                        │
              every 16th note (~93ms at 120 BPM)
                        │
                        ▼
              _onStep(stepIndex, time)
                        │
              for each channel in activePattern:
                  if channel.steps[stepIndex]:
                      synth.triggerAttack(note, time)
                        │
              Tone.getDraw().schedule(() => {
                  store.setCurrentStep(stepIndex)  ← deferred to next frame
              }, time)
```

### User Opens Piano Roll

```
User clicks [PR] button on a channel row
        │
        ▼
store.openPianoRoll(channelId)
        │
        ├── pianoRollChannelId = channelId
        └── activeView = 'piano-roll'
                │
                ▼
        DAWShell re-renders
                │
        renders <PianoRoll />
                │
        PianoRoll reads:
          pattern.pianoRollNotes[pianoRollChannelId]
                │
        Displays notes as rectangles in the grid
```

### Adding a Note in Piano Roll

```
User clicks empty grid cell
        │
        ▼
grid onMouseDown handler
        │
        ├── calculate pitch from Y position
        ├── calculate start from X position (snapped to quantize)
        └── store.addNote(channelId, { pitch, start, duration: quantize })
                │
                ▼
        patterns[activePatternId]
          .pianoRollNotes[channelId]
          .push(newNote)
                │
        PianoRoll re-renders → new NoteRect appears
```

---

## Audio Signal Chain

```
                    ┌─────────────┐
  'kick' channel    │MembraneSynth│
  'perc' channel    └──────┬──────┘
                           │
                    ┌─────────────┐
  'hihat' channel   │ MetalSynth  │
  'openhat' channel └──────┬──────┘
                           │
                    ┌─────────────┐
  'snare' channel   │ NoiseSynth  │
  'clap'  channel   └──────┬──────┘
                           │
                    ┌─────────────┐
  'bass'   channel  │    Synth    │ (sawtooth)
  'lead'   channel  │    Synth    │ (triangle)
                    └──────┬──────┘
                           │
                    ┌─────────────┐
  'fm' channel      │  FMSynth   │
                    └──────┬──────┘
                           │
                    ┌─────────────┐
  'am' channel      │  AMSynth   │
                    └──────┬──────┘
                           │
                    ┌─────────────┐
  'sample' channel  │   Player   │ (AudioBuffer)
                    └──────┬──────┘
                           │
               ┌───────────┴───────────┐
               │  instrument.distortion │
               │  (BitCrusher? WaveSha.?)│
               │  [if distortion > 0]  │
               └───────────┬───────────┘
                           │
               ┌───────────┴───────────┐
               │   instrument.reverb    │
               │   (Reverb node)        │
               │   [if reverb > 0]     │
               └───────────┬───────────┘
                           │
               ┌───────────┴───────────┐
               │  instrument.delay      │
               │  (FeedbackDelay)       │
               │  [if delay > 0]       │
               └───────────┬───────────┘
                           │
                    ┌──────┴──────┐
                    │   Panner    │ ← channel.pan (-1 to +1)
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │Channel Gain │ ← channel.volume (0 to 1)
                    └──────┬──────┘
                           │
                           │ (all channels merge here)
                           ▼
                    ┌─────────────┐
                    │ Master Gain │ ← store.masterVolume
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │Tone.Destinat│ ← AudioContext.destination
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ Speakers /  │
                    │ Headphones  │
                    └─────────────┘
```

---

## Beat Generation Pipeline

```
User uploads audio file (MP3 / WAV)
          │
          ▼
FileReader → ArrayBuffer
          │
          ▼
AudioContext.decodeAudioData(buffer)
  → AudioBuffer (capped at 30 seconds)
          │
          ├──────────────────────────────────────────────┐
          ▼                                              ▼
web-audio-beat-detector                              Meyda
   .guess(buffer)                              feature extraction
          │                                      (512-sample frames)
          ├── bpm    (e.g. 140.0)                        │
          └── offset (beat phase)                        ├── spectralCentroid
                                                         │    (brightness)
                                                         ├── energy
                                                         ├── rms
                                                         └── spectralFlux

          │                                              │
          └────────────────────┬─────────────────────────┘
                               ▼
                        detectStyle()
                               │
                               ├── bpm < 100         → "slow hip-hop"
                               ├── 100 ≤ bpm < 115   → "hip-hop"
                               ├── 115 ≤ bpm < 130   → "house"
                               ├── 130 ≤ bpm < 160   → "trap" (if bright)
                               │                     → "techno"
                               └── bpm ≥ 160         → "drum & bass"
                               │
                               ▼
                        generatePattern(style, features)
                               │
   ┌───────────────────────────┼───────────────────────────┐
   ▼                           ▼                           ▼
Kick pattern               Hi-Hat pattern             Snare pattern
  sparse: [0,8]             centroid > 4000:           always: [4, 12]
  dense:  [0,4,8,12]          16th-note density        + probabilistic extras
                             centroid 2000-4000:        based on energy
                               8th-note density
                             centroid < 2000:
                               quarter notes
   ▼                           ▼                           ▼
Bass follows kick          Synth/Perc: random         Clap (style-specific)
                           density weighted
                           by energy/RMS

                               │
                               ▼
                      applyGeneratedPattern(result)
                               │
                      ┌────────┴────────┐
                      ▼                 ▼
             store.setBpm(bpm)   merge steps into
                              activePattern.channels[]
```

---

## Initialization Sequence

```
Browser navigates to /
        │
        ▼
Next.js renders app/page.tsx
        │  (SSR disabled — dynamic import with ssr: false)
        ▼
DAWShell React component mounts
        │
        ├── useAudioEngine() hook called
        │       │
        │       └── AudioEngine.getInstance()
        │               │
        │               ├── (first call) new AudioEngine()
        │               └── engine.init()
        │                       │
        │                       ├── Tone.setContext(new AudioContext)
        │                       ├── masterGain = new Tone.Gain().toDestination()
        │                       ├── Tone.Transport.bpm.value = store.bpm
        │                       ├── syncChannels(store.activePattern.channels)
        │                       │       └── _buildChannelSignalChain() per channel
        │                       ├── subscribeToStore()
        │                       │       ├── isPlaying    → _transportStart/Stop
        │                       │       ├── bpm          → Transport.bpm
        │                       │       ├── masterVolume → masterGain.gain.rampTo
        │                       │       └── mixerChannels → channel volume/pan/mute
        │                       └── Tone.start().catch() // non-blocking unlock attempt
        │
        ├── useEffect [mount]: rehydrate sample blob: URLs from IndexedDB
        │
        ├── Zustand persist middleware: rehydrates state from IndexedDB
        │
        └── render(): UI appears immediately with persisted state
```

---

## Import Graph

```
app/page.tsx
    └── components/daw/DAWShell.tsx
            ├── lib/audioEngine.ts
            │       ├── tone  (→ aliased to tone/build/esm/index.js by next.config.ts)
            │       └── lib/store.ts
            │               └── lib/types.ts
            │               └── lib/idb-storage.ts
            │
            ├── lib/store.ts
            │
            ├── components/daw/TopBar.tsx
            │       └── lib/store.ts
            │
            ├── components/daw/ChannelRack.tsx
            │       ├── lib/store.ts
            │       └── lib/types.ts
            │
            ├── components/daw/PianoRoll.tsx
            │       ├── lib/store.ts
            │       ├── lib/types.ts
            │       └── lib/audioEngine.ts  (for previewNote)
            │
            ├── components/daw/Mixer.tsx
            │       └── lib/store.ts
            │
            ├── components/daw/Playlist.tsx
            │       └── lib/store.ts
            │
            ├── components/daw/BeatGenerator.tsx
            │       ├── lib/store.ts
            │       ├── web-audio-beat-detector
            │       └── meyda
            │
            ├── components/daw/SampleSlicer.tsx
            │       ├── lib/store.ts
            │       └── lib/idb-storage.ts
            │
            ├── components/daw/RecordExportBar.tsx
            │       ├── lib/recorder.ts
            │       │       └── tone
            │       └── lib/store.ts
            │
            ├── components/daw/ThemeBackground.tsx
            │       └── lib/store.ts
            │
            └── components/daw/ThemePicker.tsx
                    └── lib/store.ts

External dependencies of note:
    tone                    → tone/build/esm/index.js (next.config.ts alias)
    zustand                 → state management + subscribeWithSelector + persist
    immer                   → draft mutations in Zustand
    meyda                   → audio feature extraction (spectralCentroid, energy, rms)
    web-audio-beat-detector → BPM detection from audio buffers
    idb                     → IndexedDB wrapper (used by idb-storage.ts)
```

---

## Styling System

### Theme Architecture

Six themes are defined as CSS variable sets in `app/globals.css`. Switching themes applies a class to the root `<div>` in `DAWShell`.

```
theme: 'classic'          → class="theme-classic"
theme: 'classic-noir'     → class="theme-classic-noir"
theme: 'clouds'           → class="theme-clouds"
theme: 'forest'           → class="theme-forest"
theme: 'aurora'           → class="theme-aurora"
theme: 'sunset'           → class="theme-sunset"
```

Each theme overrides CSS custom properties used by Tailwind via `@layer base`:

```css
.theme-classic {
  --daw-bg:       #0a0a0a;
  --daw-panel:    #141414;
  --daw-card:     #1e1e1e;
  --daw-accent:   #ff8c00;   /* orange */
  --daw-stepOn:   #ff8c00;
  --daw-stepOff:  #2a2a2a;
  --daw-stepHover:#3a3a3a;
}
```

### Tailwind Color Tokens

All colors in component `className` strings use the `daw-*` namespace — never raw hex values.

| Token | Role |
|---|---|
| `daw-bg` | Main application background |
| `daw-panel` | Panel and sidebar backgrounds |
| `daw-card` | Input fields, cards, buttons |
| `daw-accent` | Primary accent color (orange → theme-specific) |
| `daw-text` | Primary text |
| `daw-muted` | Secondary / muted text |
| `daw-border` | Borders and dividers |
| `daw-stepOn` | Active step button color |
| `daw-stepOff` | Inactive step button color |
| `daw-stepHover` | Step button hover state |

### Animated Backgrounds

`ThemeBackground.tsx` renders SVG/canvas animations matched to each theme:

| Theme | Animation |
|---|---|
| Classic | Static gradient |
| Classic Noir | Scanline effect |
| Clouds | Floating ellipses with gaussian blur |
| Forest | Fog drift + green particle float |
| Aurora | Wave-like translucent color layers |
| Sunset | Warm radial gradient pulse |

---

## Key Technical Decisions

### 1. SSR Completely Disabled

`app/page.tsx` uses `dynamic(() => import('../components/daw/DAWShell'), { ssr: false })`. The Web Audio API, Tone.js, IndexedDB, and canvas APIs do not exist in Node.js. Any attempt to render server-side would throw. The dynamic import with `ssr: false` ensures none of the DAW code ever runs in Node.

### 2. Turbopack + Tone.js ESM Alias

Tone.js ships a `browser` field in its `package.json` pointing to a UMD bundle (`build/Tone.js`). Turbopack resolves the `browser` field in browser contexts, which means `import { Synth } from 'tone'` finds no named exports in the UMD bundle and fails.

The fix in `next.config.ts`:

```typescript
experimental: {
  turbo: {
    resolveAlias: {
      tone: 'tone/build/esm/index.js',  // force the ESM build
    },
  },
},
```

Webpack (production builds) does not have this problem because it processes the ESM entry point by default.

### 3. Audio Engine as Singleton

`AudioEngine.getInstance()` prevents duplicate audio contexts from being created if `useAudioEngine()` is called from multiple components or during React Strict Mode double-invocation. Only one `AudioContext` and one set of Tone.js nodes ever exist.

### 4. `subscribeWithSelector` for Engine Subscriptions

The audio engine needs to react to specific slices of the store (e.g., `bpm`, `isPlaying`, `masterVolume`) without re-running logic on every unrelated state update. `subscribeWithSelector` middleware enables:

```typescript
store.subscribe(
  (state) => state.bpm,
  (bpm) => { Tone.Transport.bpm.value = bpm; }
)
```

This subscription fires only when `bpm` changes — not on channel rename, not on UI state changes.

### 5. Draw-Frame Deferred UI Updates

The step sequencer runs on the audio thread (via `Tone.Transport.scheduleRepeat`). Calling React state setters (`setCurrentStep`) directly from the audio thread callback can cause tearing or missed frames. The fix:

```typescript
Tone.getDraw().schedule(() => {
  store.setCurrentStep(stepIndex);
}, time);
```

`Tone.getDraw()` defers the callback to the next `requestAnimationFrame` after the audio event time, keeping UI updates synchronized with visual frame rendering rather than audio scheduling.

### 6. CSS Import Order (Turbopack)

Turbopack enforces strict `@import` ordering. In `app/globals.css`, all `@import` statements must appear before any `@tailwind` directives. Violating this causes a Turbopack parse error at dev-server startup.

### 7. Piano Roll Notes in 16th-Note Units

`Note.start` and `Note.duration` are stored as integers in 16th-note units rather than seconds or beats. This makes quantization trivial (snap to nearest integer), makes pattern length changes non-destructive, and keeps the data model BPM-independent. The audio engine converts to seconds at playback time: `steps = note.duration / 4 + 'n'`.

---

## Project Structure

```
beat-forge-studio/
├── app/
│   ├── globals.css          # Theme CSS variables, animations, scrollbars
│   ├── layout.tsx           # <html> root, metadata, font loading
│   └── page.tsx             # Entry: dynamic import DAWShell (ssr: false)
│
├── components/daw/
│   ├── DAWShell.tsx         # Root shell, view router, engine init
│   ├── TopBar.tsx           # Transport, BPM, view tabs, project name
│   ├── ChannelRack.tsx      # 16-step sequencer grid
│   ├── PianoRoll.tsx        # Note editor (pitch × time grid)
│   ├── Mixer.tsx            # Channel strips with knobs
│   ├── Playlist.tsx         # Song arrangement (clips on tracks)
│   ├── BeatGenerator.tsx    # AI beat generation modal
│   ├── SampleSlicer.tsx     # Waveform slice editor
│   ├── RecordExportBar.tsx  # Master record & download
│   ├── ThemeBackground.tsx  # Animated per-theme backgrounds
│   └── ThemePicker.tsx      # Theme selector UI
│
├── lib/
│   ├── store.ts             # Zustand store (entire app state)
│   ├── audioEngine.ts       # Tone.js engine singleton
│   ├── types.ts             # All TypeScript interfaces + presets
│   ├── idb-storage.ts       # IndexedDB read/write helpers
│   └── recorder.ts          # Web Audio MediaRecorder wrapper
│
├── next.config.ts           # Turbopack alias, webpack fs stub
├── tailwind.config.ts       # daw-* color token definitions
├── tsconfig.json
├── package.json
└── CLAUDE.md                # AI assistant guidance for this repo
```
