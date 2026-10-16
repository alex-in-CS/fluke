import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AddDocsResult,
  AnswerEvent,
  ContextDoc,
  DeviceList,
  KeyInfo,
  LevelsEvent,
  ProviderConfig,
  SessionDetail,
  SessionSummary,
  Settings,
  Snapshot,
  StatusEvent,
  ToastEvent,
  TranscriptEvent,
} from "./types";

// Typed wrappers over the Rust commands in src-tauri/src/commands.rs.
export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  keyStatus: () => invoke<KeyInfo[]>("key_status"),
  setApiKey: (providerId: string, key: string) =>
    invoke<void>("set_api_key", { providerId, key }),
  deleteApiKey: (providerId: string) => invoke<void>("delete_api_key", { providerId }),
  listModels: (provider: ProviderConfig) => invoke<string[]>("list_models", { provider }),
  listAudioDevices: () => invoke<DeviceList>("list_audio_devices"),
  startListening: () => invoke<StatusEvent>("start_listening"),
  stopListening: () => invoke<StatusEvent>("stop_listening"),
  ask: (prompt?: string, withScreen?: boolean) =>
    invoke<string>("ask", { prompt: prompt ?? null, withScreen: withScreen ?? null }),
  cancelAnswer: () => invoke<void>("cancel_answer"),
  newSession: () => invoke<StatusEvent>("new_session"),
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  listSessions: () => invoke<SessionSummary[]>("list_sessions"),
  getSession: (id: string) => invoke<SessionDetail | null>("get_session", { id }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  deleteAllSessions: () => invoke<void>("delete_all_sessions"),
  sessionMarkdown: (id: string) => invoke<string>("session_markdown", { id }),
  exportSession: (id: string) => invoke<string>("export_session", { id }),
  openSettings: (section?: string) => invoke<void>("open_settings", { section: section ?? null }),
  hideOverlay: () => invoke<void>("hide_overlay"),
  setClickThrough: (on: boolean) => invoke<void>("set_click_through", { on }),
  quit: () => invoke<void>("quit"),

  listContextDocs: (profileId: string) => invoke<ContextDoc[]>("list_context_docs", { profileId }),
  addContextFiles: (profileId: string, paths: string[]) =>
    invoke<AddDocsResult>("add_context_files", { profileId, paths }),
  removeContextDoc: (id: number) => invoke<void>("remove_context_doc", { id }),
  reloadContextDoc: (id: number) => invoke<ContextDoc>("reload_context_doc", { id }),
  contextFileTypes: () => invoke<string>("context_file_types"),
  summarizeSession: (id: string) => invoke<string>("summarize_session", { id }),
  setSessionSummary: (id: string, summary: string) =>
    invoke<void>("set_session_summary", { id, summary }),
};

export const events = {
  transcript: (cb: (e: TranscriptEvent) => void) =>
    listen<TranscriptEvent>("fluke://transcript", (e) => cb(e.payload)),
  answer: (cb: (e: AnswerEvent) => void) =>
    listen<AnswerEvent>("fluke://answer", (e) => cb(e.payload)),
  status: (cb: (e: StatusEvent) => void) =>
    listen<StatusEvent>("fluke://status", (e) => cb(e.payload)),
  levels: (cb: (e: LevelsEvent) => void) =>
    listen<LevelsEvent>("fluke://levels", (e) => cb(e.payload)),
  settings: (cb: (e: Settings) => void) =>
    listen<Settings>("fluke://settings", (e) => cb(e.payload)),
  action: (cb: (action: string) => void) =>
    listen<string>("fluke://action", (e) => cb(e.payload)),
  toast: (cb: (e: ToastEvent) => void) =>
    listen<ToastEvent>("fluke://toast", (e) => cb(e.payload)),
  /** A stored session changed (e.g. notes were written); payload is its id. */
  history: (cb: (sessionId: string) => void) =>
    listen<string>("fluke://history", (e) => cb(e.payload)),
};

/** Subscribe to several events; returns one cleanup function for useEffect. */
export function subscribeAll(subs: Promise<UnlistenFn>[]): () => void {
  let disposed = false;
  const fns: UnlistenFn[] = [];
  subs.forEach((p) =>
    p.then((fn) => {
      if (disposed) fn();
      else fns.push(fn);
    }),
  );
  return () => {
    disposed = true;
    fns.forEach((fn) => fn());
  };
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
