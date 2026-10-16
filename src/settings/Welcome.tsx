import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import clsx from "clsx";

import { api, errorText, events, subscribeAll } from "../lib/api";
import { friendlyError } from "../lib/friendly";
import type { StatusEvent } from "../lib/types";
import { FlukeMark } from "../components/FlukeMark";
import { Kbd } from "../components/Kbd";
import type { SectionProps } from "./SettingsApp";
import { EnginePicker } from "./setup/EnginePicker";
import { Button } from "./ui";

const STEPS = [
  {
    title: "Answers",
    blurb: "The model that writes replies",
    heading: "Choose the model that answers.",
    sub: "Fluke runs on your own API key. It's kept in Windows Credential Manager and only ever sent to the provider you pick.",
  },
  {
    title: "Transcription",
    blurb: "How Fluke hears the call",
    heading: "Choose how Fluke hears the call.",
    sub: "Your mic and the other side are transcribed separately, so Fluke always knows who said what.",
  },
  {
    title: "Check",
    blurb: "A ten-second test",
    heading: "Make sure it hears you.",
    sub: "Start the test and play any video with sound: that's the other side. Your own voice is only transcribed while you hold the talk shortcut, so try that too.",
  },
] as const;

export function Welcome({ flush, ...props }: SectionProps & { flush: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState<[boolean, boolean]>([false, false]);
  const [finishing, setFinishing] = useState(false);
  const onLlm = useCallback((ok: boolean) => setReady((r) => [ok, r[1]]), []);
  const onStt = useCallback((ok: boolean) => setReady((r) => [r[0], ok]), []);
  const canContinue = step === 2 || ready[step as 0 | 1];
  const s = STEPS[step];

  const finish = async () => {
    setFinishing(true);
    try {
      await flush();
      await api.stopListening().catch(() => {});
      await api.finishOnboarding();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="relative flex h-full overflow-hidden bg-ink-950">
      <div className="setup-glow pointer-events-none absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full" />

      <aside className="relative z-10 flex w-[290px] shrink-0 flex-col border-r border-white/6 px-8 py-9">
        <div className="flex items-center gap-2">
          <FlukeMark className="h-6 w-6 text-lime-400" />
          <span className="text-[17px] font-semibold tracking-tight">fluke</span>
        </div>
        <svg viewBox="0 0 220 28" className="mt-8 h-7 w-full text-lime-400/70" fill="none" aria-hidden="true">
          <path
            pathLength={1}
            className="draw"
            d="M0 14h40l6-8 7 16 7-22 7 28 7-20 6 12 5-6h135"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ink-400 uppercase">Setup · about two minutes</p>

        <ol className="mt-5 space-y-1">
          {STEPS.map((x, i) => {
            const done = i < step;
            return (
              <li key={x.title}>
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => setStep(i)}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                    i === step ? "bg-white/[0.06]" : "hover:bg-white/[0.03] disabled:hover:bg-transparent",
                  )}
                >
                  <span
                    className={clsx(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-[11px] transition",
                      done && "border-lime-400 bg-lime-400 text-ink-950",
                      i === step && "border-lime-400/70 text-lime-400",
                      i > step && "border-white/12 text-ink-400",
                    )}
                  >
                    {done ? <Check size={13} strokeWidth={3} /> : `0${i + 1}`}
                  </span>
                  <span>
                    <span className={clsx("block text-[13.5px] font-medium", i > step ? "text-ink-400" : "text-ink-100")}>
                      {x.title}
                    </span>
                    <span className="block text-[11.5px] text-ink-400">{x.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          onClick={finish}
          className="mt-auto self-start text-[12px] text-ink-400 transition hover:text-ink-100"
        >
          Skip setup
        </button>
      </aside>

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-12 pt-14 pb-8">
          <div key={step} className="rise mx-auto max-w-[620px]">
            <p className="font-mono text-[11px] tracking-[0.14em] text-lime-400 uppercase">
              Step 0{step + 1} / 03
            </p>
            <h1 className="mt-3 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink-100">
              {s.heading}
            </h1>
            <p className="mt-3 max-w-[540px] text-[14px] leading-relaxed text-ink-300">{s.sub}</p>

            <div className="mt-9">
              {step === 0 && <EnginePicker role="llm" {...props} onStatus={onLlm} />}
              {step === 1 && <EnginePicker role="stt" {...props} onStatus={onStt} />}
              {step === 2 && (
                <LiveCheck
                  flush={flush}
                  hotkey={props.draft.hotkeys.toggle_overlay}
                  talk={props.draft.hotkeys.push_to_talk}
                />
              )}
            </div>
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-white/6 px-12 py-4">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={14} /> Back
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {!canContinue && <span className="text-[12px] text-ink-400">Connect a provider to continue</span>}
            {step < 2 ? (
              <Button variant="primary" className="px-5 py-2.5 text-[13px]" disabled={!canContinue} onClick={() => setStep(step + 1)}>
                Continue <ArrowRight size={14} />
              </Button>
            ) : (
              <Button variant="primary" className="px-5 py-2.5 text-[13px]" disabled={finishing} onClick={finish}>
                {finishing ? <LoaderCircle size={14} className="animate-spin" /> : null}
                Start using Fluke <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

type Line = { speaker: "me" | "them"; text: string; key: number };

/** Runs the real pipeline (capture → transcription) for a few seconds and shows what it hears. */
function LiveCheck({ flush, hotkey, talk }: { flush: () => Promise<void>; hotkey: string; talk: string }) {
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [levels, setLevels] = useState({ me: 0, them: 0 });
  const [heard, setHeard] = useState({ me: false, them: false });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const listening = !!status?.listening;

  useEffect(() => {
    const unsub = subscribeAll([
      events.status(setStatus),
      events.levels((l) => {
        setLevels(l);
        if (l.me > 0.08 || l.them > 0.08)
          setHeard((h) => ({ me: h.me || l.me > 0.08, them: h.them || l.them > 0.08 }));
      }),
      events.transcript((t) => {
        if (!t.final || !t.text.trim()) return;
        setHeard((h) => ({ ...h, [t.speaker]: true }));
        setLines((ls) => [...ls.slice(-3), { speaker: t.speaker, text: t.text, key: t.ts + Math.random() }]);
      }),
    ]);
    return () => {
      unsub();
      api.stopListening().catch(() => {});
    };
  }, []);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await flush();
      setStatus(await api.startListening());
    } catch (e) {
      setError(friendlyError(errorText(e)).message);
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => setStatus(await api.stopListening());

  const sourceError = [status?.me, status?.them].find((x) => x?.state === "error")?.message;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Meter label="You" detail={<>Hold <Kbd accel={talk} /> to talk</>} level={levels.me} ok={heard.me} color="var(--color-lime-400)" />
        <Meter label="Them" detail="System audio" level={levels.them} ok={heard.them} color="var(--color-sky-300)" />
      </div>

      <div className="min-h-[132px] rounded-xl border border-white/7 bg-ink-900/70 px-4 py-3">
        {lines.length === 0 ? (
          <p className="pt-9 text-center text-[12.5px] text-ink-400">
            {listening ? "Listening… play a video, or hold the talk shortcut and speak." : "What Fluke hears will appear here."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {lines.map((l) => (
              <li key={l.key} className="rise flex gap-3 text-[13px] leading-relaxed">
                <span className={clsx("w-10 shrink-0 font-medium", l.speaker === "me" ? "text-lime-400" : "text-sky-300")}>
                  {l.speaker === "me" ? "You" : "Them"}
                </span>
                <span className="selectable text-ink-100">{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        {listening ? (
          <Button onClick={stop}>Stop test</Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={starting}>
            {starting && <LoaderCircle size={14} className="animate-spin" />} Start test
          </Button>
        )}
        {(error || sourceError) && (
          <span className="selectable text-[12.5px] text-rose-400">{error ?? friendlyError(sourceError!).message}</span>
        )}
      </div>

      <p className="flex items-center gap-2 pt-2 text-[12.5px] text-ink-400">
        Fluke floats above your apps. <Kbd accel={hotkey} /> shows or hides it at any time.
      </p>
    </div>
  );
}

function Meter({
  label,
  detail,
  level,
  ok,
  color,
}: {
  label: string;
  detail: React.ReactNode;
  level: number;
  ok: boolean;
  color: string;
}) {
  const bars = 24;
  const lit = Math.round(Math.min(1, level * 1.4) * bars);
  return (
    <div className="rounded-xl border border-white/7 bg-ink-900/70 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span>
          <span className="text-[13.5px] font-medium text-ink-100">{label}</span>
          <span className="ml-2 text-[12px] text-ink-400">{detail}</span>
        </span>
        <span
          className={clsx(
            "grid h-5 w-5 place-items-center rounded-full transition",
            ok ? "bg-lime-400 text-ink-950" : "border border-white/12",
          )}
        >
          {ok && <Check size={11} strokeWidth={3} />}
        </span>
      </div>
      <div className="mt-3 flex h-6 items-end gap-[3px]">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className="flex-1 rounded-full transition-[height,opacity] duration-75"
            style={{
              height: `${30 + 70 * Math.abs(Math.sin(i * 1.7))}%`,
              background: color,
              opacity: i < lit ? 0.95 : 0.12,
            }}
          />
        ))}
      </div>
    </div>
  );
}
