<p align="center">
  <img src="app-icon.svg" width="96" alt="Fluke logo" />
</p>

<h1 align="center">Fluke</h1>

<p align="center">
  A real-time AI copilot for calls and meetings. It hears both sides, reads your screen when you ask,
  remembers past meetings, and streams answers from <b>the model you choose, with your own API keys</b>.
</p>

<p align="center">
  Tauri 2 · Rust · React 19 · TypeScript · ~10 MB installer · Windows / macOS / Linux
</p>

---

## Why Fluke

Desktop meeting copilots tend to be heavy Electron apps tied to one vendor's backend, where your audio,
screen and transcripts pass through someone else's servers. Fluke is the opposite:

| | Fluke |
|---|---|
| **Your keys, any model** | Anthropic, OpenAI, Gemini, Groq, OpenRouter, DeepSeek, xAI, Mistral, Ollama, LM Studio, or any OpenAI-compatible endpoint |
| **Keys never touch the UI** | Stored in the OS keychain (Windows Credential Manager / macOS Keychain / Secret Service), read only by the Rust core |
| **Knows who said what** | Mic ("You") and system audio ("Them") are captured and transcribed as separate streams, with no virtual audio cable needed |
| **Proactive** | Detects when the other side asks you a question and drafts an answer as soon as they stop talking |
| **Context that sticks** | Per-profile instructions, linked reference files (PDF, DOCX, Markdown…) and **meeting memory**: notes from past meetings are fed back in automatically |
| **Private by design** | No servers, no telemetry. History lives in a local SQLite file. The overlay can be excluded from screen sharing |
| **Light** | Native Rust core and system WebView, with no bundled Chromium |

## Features

- **Floating overlay**: always-on-top, translucent, draggable, and sized exactly to its content so it never blocks clicks. Click-through mode lets you work "through" it.
- **Live transcript** of both sides with interim results (Deepgram streaming) or utterance-level transcription (any OpenAI-compatible `/audio/transcriptions`, such as OpenAI, Groq, Mistral or a local Whisper server).
- **Ask anything**: one hotkey answers "what's happening now" using the transcript plus an optional screenshot. Or type a question.
- **Auto-answer**: question detection on the other side's speech, with a settle timer so it waits until they finish.
- **Profiles**: Sales call, Meeting, Interview prep, or your own. Each has instructions, background notes, **linked context files** and a **meeting-memory** setting.
- **Meeting memory**: when a session ends, Fluke writes notes (decisions, action items, open questions, details worth remembering). The next meetings in that profile get the latest *N* notes as context. Notes are editable in History.
- **Linked files**: attach agendas, specs, running notes or a resume. Text is extracted locally, and if the file changes on disk, the next answer uses the new version.
- **Prompt caching**: stable context (profile + files + memory) goes in a cached system block on Anthropic, so follow-up questions are cheaper and faster.
- **Global hotkeys** (configurable):

  | Action | Default |
  |---|---|
  | Answer what's happening now | `Ctrl/⌘ + Shift + Enter` |
  | Start / stop listening | `Ctrl/⌘ + Shift + L` |
  | Type a question | `Ctrl/⌘ + Shift + K` |
  | Show / hide overlay | `Ctrl/⌘ + Shift + Space` |
  | Click-through | `Ctrl/⌘ + Shift + X` |
  | Move overlay | `Ctrl/⌘ + Shift + Arrows` |

- **History**: every session's transcript, answers and notes; copy or export to Markdown (`Documents/Fluke`).

## Architecture

```
            ┌──────────────────────────── Rust core (src-tauri) ────────────────────────────┐
 mic ──────►│ audio.rs  cpal capture → mono → rubato resample → 16 kHz i16 frames            │
 speakers ─►│           (system audio via WASAPI loopback / CoreAudio process tap)           │
            │      │                                                                         │
            │      ▼                                                                         │
            │ stt.rs    Deepgram websocket (interim+final)  |  VAD segmenter → /audio/transcriptions│
            │      │                                                                         │
            │      ▼                                                                         │
            │ session.rs  transcript ─► question detection (prompt.rs) ─► auto-answer         │
            │             ask() ─► context: profile + files (context.rs) + memory (memory.rs) │
            │                    + transcript window + screenshot (capture.rs, xcap)          │
            │      │                                                                         │
            │      ▼                                                                         │
            │ llm/      openai.rs │ anthropic.rs │ gemini.rs   → SSE token stream             │
            │ secrets.rs (OS keychain)   storage.rs (SQLite)   hotkeys.rs   window.rs (tray)   │
            └──────────────┬─────────────────────────────────────────────────────────────────┘
                           │ Tauri events: transcript · answer deltas · levels · status
                           ▼
            ┌──────── React UI (src) ────────┐
            │ overlay/   floating copilot    │
            │ settings/  providers, models,  │
            │            profiles, history   │
            └────────────────────────────────┘
```

Design notes:

- **Two audio streams, not diarization.** "You" is the mic and "Them" is loopback of the output device, so speaker attribution is exact and free.
- **The UI never holds secrets.** Keys go straight from the settings form to the keychain via a command; the webview only ever sees "key saved (…a1b2)".
- **Stable context first, volatile context last.** The system prompt holds instructions, files and memory (cacheable); the user turn holds the rolling transcript and the request.
- **Overlay sizing.** The transparent window resizes to its content (ResizeObserver → `setSize`), because transparent pixels on Windows still swallow clicks.

## Getting started

### Prerequisites

- [Rust](https://rustup.rs) (stable) and [Node.js](https://nodejs.org) 20+
- Platform prerequisites from the [Tauri guide](https://tauri.app/start/prerequisites/):
  - **Windows**: MSVC Build Tools (C++ x64) + Windows SDK, plus WebView2 (preinstalled on Windows 10/11)
  - **macOS**: Xcode Command Line Tools. System-audio capture needs macOS 14.6+
  - **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator3`, `libasound2-dev`, `libxdo-dev`, `libdbus-1-dev`

### Run

```bash
npm install
npm run tauri dev
```

### Build installers

```bash
npm run tauri build
# Windows: src-tauri/target/release/bundle/{nsis,msi}
```

### First launch

1. The overlay appears at the top of your screen. Click **Settings** (gear) → **Providers & keys**.
2. Paste a key for your LLM provider (e.g. Anthropic) and for speech-to-text (Deepgram is recommended for streaming; Groq or OpenAI work too). Keys are validated immediately.
3. **Models**: pick the answering model and transcription model.
4. **Profiles**: write instructions, attach context files, keep meeting memory on.
5. Press **Listen**, then **Ask** (or let auto-answer handle it).

## Tests

```bash
cd src-tauri && cargo test     # prompt building, question detection, VAD, resampling,
                               # storage + migrations, memory, file extraction
npx tsc --noEmit               # frontend types
```

## Project layout

```
src-tauri/src/
  lib.rs        app setup, plugins, command registry
  session.rs    listening + answering orchestration
  audio.rs      capture, downmix, resample
  stt.rs        Deepgram streaming, chunked Whisper-style STT, VAD
  llm/          provider adapters (OpenAI-compatible, Anthropic, Gemini)
  prompt.rs     system prompt, transcript windowing, question detection
  context.rs    text extraction for linked files (PDF/DOCX/text)
  memory.rs     meeting notes → memory
  storage.rs    SQLite schema + migrations
  secrets.rs    OS keychain
  capture.rs    screenshots
  hotkeys.rs, window.rs, commands.rs, config.rs, state.rs
src/
  overlay/      floating copilot UI
  settings/     settings window (sections/*)
  lib/          typed IPC wrappers and shared types
```

## Responsible use

Fluke is built for meetings, sales calls, demos and research conversations. Follow the rules of wherever
you use it: many exams, interviews and workplaces restrict assistive tools, and some jurisdictions require
everyone's consent before a conversation is transcribed.

## License

[MIT](LICENSE)
