import { create } from "zustand";
import type {
  AnswerEvent,
  KeyInfo,
  LevelsEvent,
  Segment,
  Settings,
  Snapshot,
  Speaker,
  StatusEvent,
  ToastEvent,
  TranscriptEvent,
} from "../lib/types";

export type AnswerStatus = "streaming" | "done" | "error" | "cancelled";

export interface Answer {
  id: string;
  question: string;
  text: string;
  model: string;
  withScreen: boolean;
  auto: boolean;
  createdAt: number;
  status: AnswerStatus;
  error?: string;
}

export interface Toast extends ToastEvent {
  id: number;
}

interface OverlayState {
  status: StatusEvent | null;
  settings: Settings | null;
  keys: KeyInfo[];
  segments: Segment[];
  interim: Record<Speaker, string>;
  answers: Answer[];
  /** Index into `answers` being viewed; null = follow latest. */
  viewing: number | null;
  levels: LevelsEvent;
  toasts: Toast[];
  panel: "answer" | "transcript";

  loadSnapshot: (s: Snapshot) => void;
  setStatus: (s: StatusEvent) => void;
  setSettings: (s: Settings) => void;
  setKeys: (k: KeyInfo[]) => void;
  onTranscript: (e: TranscriptEvent) => void;
  onAnswer: (e: AnswerEvent) => void;
  setLevels: (l: LevelsEvent) => void;
  pushToast: (t: ToastEvent) => void;
  dismissToast: (id: number) => void;
  view: (index: number | null) => void;
  setPanel: (p: "answer" | "transcript") => void;
  resetSession: () => void;
}

let toastSeq = 0;
const MAX_SEGMENTS = 500;

export const useOverlay = create<OverlayState>((set, get) => ({
  status: null,
  settings: null,
  keys: [],
  segments: [],
  interim: { me: "", them: "" },
  answers: [],
  viewing: null,
  levels: { me: 0, them: 0 },
  toasts: [],
  panel: "answer",

  loadSnapshot: (s) =>
    set({
      status: s.status,
      segments: s.segments.slice(-MAX_SEGMENTS),
      answers: s.answers.map((a) => ({
        id: a.id,
        question: a.question,
        text: a.answer,
        model: a.model,
        withScreen: a.with_screen,
        auto: false,
        createdAt: a.created_at,
        status: "done",
      })),
    }),

  setStatus: (status) => {
    const prev = get().status;
    if (prev && prev.session_id !== status.session_id) {
      // A new session started elsewhere (tray, hotkey): clear local view.
      set({ segments: [], answers: [], interim: { me: "", them: "" }, viewing: null });
    }
    set({ status });
  },

  setSettings: (settings) => {
    document.documentElement.style.setProperty("--glass-alpha", String(settings.behavior.opacity));
    set({ settings });
  },

  setKeys: (keys) => set({ keys }),

  onTranscript: (e) =>
    set((st) => {
      if (!e.final) {
        return { interim: { ...st.interim, [e.speaker]: e.text } };
      }
      const seg: Segment = { id: e.id ?? -e.ts, speaker: e.speaker, text: e.text, ts: e.ts };
      return {
        segments: [...st.segments, seg].slice(-MAX_SEGMENTS),
        interim: { ...st.interim, [e.speaker]: "" },
      };
    }),

  onAnswer: (e) =>
    set((st) => {
      if (e.kind === "start") {
        const a: Answer = {
          id: e.id,
          question: e.question,
          text: "",
          model: e.model,
          withScreen: e.with_screen,
          auto: e.auto,
          createdAt: e.created_at,
          status: "streaming",
        };
        // Jump to the new answer.
        return { answers: [...st.answers, a], viewing: null, panel: "answer" };
      }
      const answers = st.answers.map((a) => {
        if (a.id !== e.id) return a;
        switch (e.kind) {
          case "delta":
            return { ...a, text: a.text + e.text };
          case "done":
            return { ...a, status: "done" as const };
          case "error":
            return { ...a, status: "error" as const, error: e.message };
          case "cancelled":
            return { ...a, status: "cancelled" as const };
        }
      });
      return { answers };
    }),

  setLevels: (levels) => set({ levels }),

  pushToast: (t) => {
    const id = ++toastSeq;
    set((st) => ({ toasts: [...st.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.level === "error" ? 8000 : 5000);
  },

  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  view: (viewing) => set({ viewing }),

  setPanel: (panel) => set({ panel }),

  resetSession: () =>
    set({ segments: [], answers: [], interim: { me: "", them: "" }, viewing: null }),
}));
