// Mirrors the Rust structs in src-tauri/src (config.rs, state.rs, storage.rs).

export type ProviderKind = "openai_compat" | "anthropic" | "gemini" | "deepgram";

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  base_url: string;
  needs_key: boolean;
  preset: boolean;
  extra_headers: Record<string, string>;
  extra_body: Record<string, unknown> | null;
  suggested_models: string[];
}

export interface ModelRef {
  provider_id: string;
  model: string;
}

export interface SttSettings {
  provider_id: string;
  model: string;
  language: string;
}

export interface Profile {
  id: string;
  name: string;
  instructions: string;
  context: string;
  memory_enabled: boolean;
  memory_count: number;
}

export interface ContextDoc {
  id: number;
  profile_id: string;
  name: string;
  path: string;
  chars: number;
  added_at: number;
}

export interface AddDocsResult {
  added: ContextDoc[];
  errors: string[];
}

export interface Behavior {
  auto_answer: boolean;
  screen_on_ask: boolean;
  hide_from_capture: boolean;
  capture_mic: boolean;
  capture_system: boolean;
  mic_device: string | null;
  output_device: string | null;
  transcript_window_secs: number;
  anthropic_effort: string | null;
  max_output_tokens: number;
  opacity: number;
  watch_screen: boolean;
  screen_commentary: boolean;
  mic_default_on: boolean;
}

export interface Hotkeys {
  toggle_overlay: string;
  ask: string;
  toggle_listen: string;
  focus_input: string;
  click_through: string;
  push_to_talk: string;
  move_up: string;
  move_down: string;
  move_left: string;
  move_right: string;
}

export interface Settings {
  version: number;
  onboarded: boolean;
  providers: ProviderConfig[];
  llm: ModelRef;
  stt: SttSettings;
  profiles: Profile[];
  active_profile: string;
  behavior: Behavior;
  hotkeys: Hotkeys;
}

export interface KeyInfo {
  provider_id: string;
  has_key: boolean;
  hint: string | null;
}

export type Speaker = "me" | "them";
export type SourceState = "off" | "connecting" | "live" | "error";

export interface SourceStatus {
  state: SourceState;
  message: string | null;
}

export interface StatusEvent {
  listening: boolean;
  me: SourceStatus;
  them: SourceStatus;
  click_through: boolean;
  session_id: string;
  answering: boolean;
  mic_open: boolean;
  watching: boolean;
}

export interface Segment {
  id: number;
  speaker: Speaker;
  text: string;
  ts: number;
}

export interface TranscriptEvent {
  speaker: Speaker;
  text: string;
  final: boolean;
  id: number | null;
  ts: number;
}

export type AnswerEvent =
  | {
      kind: "start";
      id: string;
      question: string;
      model: string;
      with_screen: boolean;
      auto: boolean;
      source: "typed" | "assist" | "heard" | "screen";
      created_at: number;
    }
  | { kind: "delta"; id: string; text: string }
  | { kind: "done"; id: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "cancelled"; id: string };

export interface AnswerRecord {
  id: string;
  question: string;
  answer: string;
  model: string;
  with_screen: boolean;
  created_at: number;
}

export interface LevelsEvent {
  me: number;
  them: number;
}

export interface ToastEvent {
  level: "info" | "warn" | "error";
  message: string;
}

export interface Snapshot {
  status: StatusEvent;
  started_at: number;
  segments: Segment[];
  answers: AnswerRecord[];
  notes: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  profile_id: string;
  started_at: number;
  ended_at: number | null;
  segment_count: number;
  answer_count: number;
  /** Meeting notes written after the session; fed back in as memory. */
  summary: string | null;
}

export interface SessionDetail {
  session: SessionSummary;
  segments: Segment[];
  answers: AnswerRecord[];
}

export interface DeviceList {
  inputs: string[];
  outputs: string[];
}
