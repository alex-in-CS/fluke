import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  Keyboard,
  Mic,
  MonitorUp,
  MousePointerClick,
  RotateCcw,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import clsx from "clsx";

import { api, errorText, events, subscribeAll } from "../lib/api";
import { useOverlay, type Answer } from "./store";
import { Markdown } from "../components/Markdown";
import { Kbd } from "../components/Kbd";
import { LevelMeter } from "../components/LevelMeter";
import { FlukeMark } from "../components/FlukeMark";

const WIDTH = 760;

export function Overlay() {
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputOpen, setInputOpen] = useState(false);

  const st = useOverlay();
  const { status, settings, answers, panel, keys } = st;

  // --- wiring -------------------------------------------------------------------------------
  useEffect(() => {
    const s = useOverlay.getState();
    api.snapshot().then(s.loadSnapshot).catch(console.error);
    api.getSettings().then(s.setSettings).catch(console.error);
    api.keyStatus().then(s.setKeys).catch(console.error);
    return subscribeAll([
      events.status(s.setStatus),
      events.transcript(s.onTranscript),
      events.answer(s.onAnswer),
      events.levels(s.setLevels),
      events.toast(s.pushToast),
      events.settings((next) => {
        s.setSettings(next);
        api.keyStatus().then(s.setKeys).catch(console.error);
      }),
      events.action((action) => {
        if (action === "focus_input") {
          setInputOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }),
    ]);
  }, []);

  // The window is exactly as tall as the content, so empty space never blocks clicks.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const win = getCurrentWindow();
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== last && h > 0) {
        last = h;
        win.setSize(new LogicalSize(WIDTH, h)).catch(() => {});
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- derived ------------------------------------------------------------------------------
  const llmProvider = settings?.providers.find((p) => p.id === settings.llm.provider_id);
  const needsKey =
    !!settings && !!llmProvider && llmProvider.needs_key && !keys.find((k) => k.provider_id === llmProvider.id)?.has_key;
  const viewingIndex = st.viewing ?? answers.length - 1;
  const current: Answer | undefined = answers[viewingIndex];
  const expanded = needsKey || answers.length > 0 || inputOpen || panel === "transcript";

  // --- actions ------------------------------------------------------------------------------
  const report = useCallback((e: unknown) => {
    useOverlay.getState().pushToast({ level: "error", message: errorText(e) });
  }, []);

  const toggleListen = () => {
    if (status?.listening) api.stopListening().then(st.setStatus).catch(report);
    else api.startListening().then(st.setStatus).catch(report);
  };
  const askNow = (prompt?: string) => {
    api.ask(prompt, settings?.behavior.screen_on_ask).catch(() => {
      /* error is shown on the answer card */
    });
  };
  const newSession = () => {
    st.resetSession();
    api.newSession().then(st.setStatus).catch(report);
  };

  return (
    <div ref={root} className="p-2 text-ink-100">
      <div className="glass overflow-hidden rounded-2xl">
        <Bar
          onListen={toggleListen}
          onAsk={() => askNow()}
          onType={() => {
            setInputOpen((v) => !v);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          inputOpen={inputOpen}
          onNewSession={newSession}
        />

        {expanded && (
          <div className="border-t border-white/6">
            {needsKey ? (
              <Onboarding providerLabel={llmProvider?.label ?? "your provider"} />
            ) : panel === "transcript" ? (
              <Transcript />
            ) : current ? (
              <AnswerView
                answer={current}
                index={viewingIndex}
                total={answers.length}
                onNav={(i) => st.view(i >= answers.length - 1 ? null : i)}
              />
            ) : (
              <EmptyHints />
            )}
            {!needsKey && (inputOpen || answers.length > 0) && (
              <AskBox
                inputRef={inputRef}
                onSubmit={(q) => askNow(q)}
                onClose={() => setInputOpen(false)}
              />
            )}
          </div>
        )}
      </div>
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Bar(props: {
  onListen: () => void;
  onAsk: () => void;
  onType: () => void;
  inputOpen: boolean;
  onNewSession: () => void;
}) {
  const { status, settings, levels, panel, setPanel } = useOverlay();
  const listening = !!status?.listening;
  const hk = settings?.hotkeys;
  const sourceError = [status?.me, status?.them].find((s) => s?.state === "error");
  const connecting = [status?.me, status?.them].some((s) => s?.state === "connecting");

  return (
    <div data-tauri-drag-region className="flex h-12 items-center gap-1.5 px-2.5">
      <div data-tauri-drag-region className="mr-1 flex items-center gap-1.5 pl-0.5">
        <FlukeMark className="pointer-events-none h-[18px] w-[18px] text-lime-400" />
        <span className="pointer-events-none text-[13px] font-semibold tracking-tight text-ink-100">
          fluke
        </span>
      </div>

      <button
        onClick={props.onListen}
        className={clsx(
          "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium transition",
          listening
            ? "bg-rose-400/12 text-rose-400 hover:bg-rose-400/18"
            : "bg-white/6 text-ink-200 hover:bg-white/10",
        )}
        title={`${listening ? "Stop" : "Start"} listening (${hk?.toggle_listen ?? ""})`}
      >
        {listening ? (
          <>
            <span className="live-dot h-2 w-2 rounded-full bg-rose-400" />
            <span>{connecting ? "Connecting" : "Live"}</span>
            <span className="ml-0.5 flex items-center gap-1.5">
              <LevelMeter level={levels.me} color="var(--color-lime-400)" label="You" />
              <LevelMeter level={levels.them} color="var(--color-sky-300)" label="Them" />
            </span>
          </>
        ) : (
          <>
            <Mic size={14} />
            <span>Listen</span>
          </>
        )}
      </button>

      <button
        onClick={props.onAsk}
        className="flex h-8 items-center gap-2 rounded-lg bg-lime-400 px-2.5 text-[12.5px] font-semibold text-ink-950 transition hover:bg-lime-500 active:scale-[0.98]"
        title="Answer what's happening now"
      >
        {status?.answering ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" /> : <Sparkles size={14} />}
        <span>Ask</span>
        {hk && <Kbd accel={hk.ask} className="[&_kbd]:border-ink-950/15 [&_kbd]:bg-ink-950/10 [&_kbd]:text-ink-950/70" />}
      </button>

      <IconButton
        active={props.inputOpen}
        onClick={props.onType}
        title={`Type a question (${hk?.focus_input ?? ""})`}
      >
        <Keyboard size={15} />
      </IconButton>
      <IconButton
        active={panel === "transcript"}
        onClick={() => setPanel(panel === "transcript" ? "answer" : "transcript")}
        title="Live transcript"
      >
        <Captions size={15} />
      </IconButton>

      <div data-tauri-drag-region className="h-full flex-1" />

      {sourceError && (
        <span className="text-amber-300" title={sourceError.message ?? "Audio problem"}>
          <AlertTriangle size={15} />
        </span>
      )}
      {status?.click_through && (
        <span
          className="flex items-center gap-1 rounded-md bg-sky-300/10 px-1.5 py-1 text-[11px] text-sky-300"
          title={`Click-through is on (${hk?.click_through ?? ""})`}
        >
          <MousePointerClick size={12} /> pass-through
        </span>
      )}
      {settings?.behavior.hide_from_capture && (
        <span className="text-ink-400" title="Hidden from screen sharing and recordings">
          <EyeOff size={14} />
        </span>
      )}
      <IconButton onClick={props.onNewSession} title="New session">
        <RotateCcw size={14} />
      </IconButton>
      <IconButton onClick={() => api.openSettings()} title="Settings">
        <SettingsIcon size={15} />
      </IconButton>
      <IconButton onClick={() => api.hideOverlay()} title={`Hide (${hk?.toggle_overlay ?? ""})`}>
        <X size={15} />
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "grid h-8 w-8 place-items-center rounded-lg transition",
        active ? "bg-white/12 text-ink-100" : "text-ink-300 hover:bg-white/8 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

function AnswerView({
  answer,
  index,
  total,
  onNav,
}: {
  answer: Answer;
  index: number;
  total: number;
  onNav: (i: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [copied, setCopied] = useState(false);
  const streaming = answer.status === "streaming";

  // Follow the stream unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [answer.text]);
  useEffect(() => {
    stick.current = true;
  }, [answer.id]);

  const copy = async () => {
    await navigator.clipboard.writeText(answer.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
            {answer.auto && (
              <span className="rounded bg-sky-300/12 px-1.5 py-px font-medium text-sky-300">heard</span>
            )}
            {answer.withScreen && (
              <span className="flex items-center gap-1 rounded bg-white/6 px-1.5 py-px">
                <MonitorUp size={10} /> screen
              </span>
            )}
            <span className="truncate">{answer.model}</span>
          </div>
          <div className="truncate text-[12.5px] font-medium text-ink-200" title={answer.question}>
            {answer.question}
          </div>
        </div>
        {total > 1 && (
          <div className="flex items-center text-[11px] text-ink-400">
            <button
              className="rounded p-1 hover:bg-white/8 disabled:opacity-30"
              disabled={index === 0}
              onClick={() => onNav(index - 1)}
              title="Previous answer"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="tabular-nums">
              {index + 1}/{total}
            </span>
            <button
              className="rounded p-1 hover:bg-white/8 disabled:opacity-30"
              disabled={index >= total - 1}
              onClick={() => onNav(index + 1)}
              title="Next answer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        {streaming ? (
          <button
            onClick={() => api.cancelAnswer()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-300 hover:bg-white/8"
            title="Stop"
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          answer.text && (
            <button
              onClick={copy}
              className="rounded-md p-1.5 text-ink-300 hover:bg-white/8 hover:text-ink-100"
              title="Copy answer"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )
        )}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-[440px] overflow-y-auto px-3.5 pb-3"
      >
        {answer.text ? (
          <Markdown text={answer.text} streaming={streaming} />
        ) : streaming ? (
          <ThinkingDots />
        ) : null}
        {answer.status === "error" && (
          <div className="selectable mt-1 rounded-lg border border-rose-400/25 bg-rose-400/8 px-3 py-2 text-[12.5px] text-rose-400">
            {answer.error}
            {/key/i.test(answer.error ?? "") && (
              <button className="ml-2 underline" onClick={() => api.openSettings("providers")}>
                Open settings
              </button>
            )}
          </div>
        )}
        {answer.status === "cancelled" && <div className="mt-1 text-[11.5px] text-ink-400">Stopped.</div>}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-lime-400/80"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function AskBox({
  inputRef,
  onSubmit,
  onClose,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: (q: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const settings = useOverlay((s) => s.settings);
  const screen = settings?.behavior.screen_on_ask ?? false;

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    onSubmit(q);
    setValue("");
  };

  return (
    <div className="flex items-end gap-2 border-t border-white/6 px-2.5 py-2">
      <textarea
        ref={inputRef}
        value={value}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value);
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
            onClose();
          }
        }}
        placeholder="Ask anything about the call or your screen…"
        className="selectable max-h-[120px] min-h-8 flex-1 resize-none rounded-lg bg-white/5 px-3 py-[7px] text-[13px] text-ink-100 placeholder:text-ink-400 outline-none focus:bg-white/8"
      />
      <span
        className={clsx("mb-2 flex items-center", screen ? "text-lime-400" : "text-ink-600")}
        title={screen ? "Screenshot attached (change in Settings → Behavior)" : "No screenshot"}
      >
        <MonitorUp size={15} />
      </span>
      <button
        onClick={submit}
        disabled={!value.trim()}
        className="grid h-8 w-8 place-items-center rounded-lg bg-white/8 text-ink-200 transition hover:bg-lime-400 hover:text-ink-950 disabled:opacity-40 disabled:hover:bg-white/8 disabled:hover:text-ink-200"
        title="Send (Enter)"
      >
        <Send size={14} />
      </button>
    </div>
  );
}

function Transcript() {
  const { segments, interim } = useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => segments.slice(-60), [segments]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recent, interim]);

  const line = (speaker: "me" | "them", text: string, key: string | number, live = false) => (
    <div key={key} className="flex gap-2 text-[12.5px] leading-relaxed">
      <span
        className={clsx(
          "w-10 shrink-0 pt-px text-right text-[10.5px] font-semibold tracking-wide uppercase",
          speaker === "me" ? "text-lime-400" : "text-sky-300",
        )}
      >
        {speaker === "me" ? "You" : "Them"}
      </span>
      <span className={clsx("selectable", live ? "text-ink-400 italic" : "text-ink-200")}>{text}</span>
    </div>
  );

  return (
    <div ref={ref} className="max-h-[360px] space-y-1.5 overflow-y-auto px-3.5 py-3">
      {recent.length === 0 && !interim.me && !interim.them && (
        <div className="py-4 text-center text-[12.5px] text-ink-400">
          Nothing yet. Press <span className="text-ink-200">Listen</span> to transcribe both sides of the call.
        </div>
      )}
      {recent.map((s) => line(s.speaker, s.text, s.id))}
      {interim.them && line("them", interim.them, "i-them", true)}
      {interim.me && line("me", interim.me, "i-me", true)}
    </div>
  );
}

function EmptyHints() {
  const hk = useOverlay((s) => s.settings?.hotkeys);
  if (!hk) return null;
  const rows: [string, string][] = [
    ["Answer what's happening now", hk.ask],
    ["Start / stop listening", hk.toggle_listen],
    ["Type a question", hk.focus_input],
    ["Show / hide Fluke", hk.toggle_overlay],
    ["Click-through mode", hk.click_through],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-4 py-3">
      {rows.map(([label, accel]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-[12px] text-ink-300">
          <span>{label}</span>
          <Kbd accel={accel} />
        </div>
      ))}
    </div>
  );
}

function Onboarding({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex-1">
        <div className="text-[13px] font-medium text-ink-100">Add an API key to get started</div>
        <div className="text-[12px] text-ink-400">
          Fluke uses your own keys. The selected model needs a {providerLabel} key; pick any provider in
          Settings.
        </div>
      </div>
      <button
        onClick={() => api.openSettings("providers")}
        className="rounded-lg bg-lime-400 px-3 py-1.5 text-[12.5px] font-semibold text-ink-950 hover:bg-lime-500"
      >
        Open settings
      </button>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useOverlay();
  if (toasts.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "glass flex items-start gap-2 rounded-xl px-3 py-2 text-[12px]",
            t.level === "error" ? "text-rose-400" : t.level === "warn" ? "text-amber-300" : "text-ink-200",
          )}
        >
          <span className="selectable flex-1">{t.message}</span>
          <button onClick={() => dismissToast(t.id)} className="text-ink-400 hover:text-ink-100">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
