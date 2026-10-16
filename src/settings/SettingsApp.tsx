import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  History as HistoryIcon,
  Keyboard,
  LoaderCircle,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import clsx from "clsx";

import { api, errorText, events, subscribeAll } from "../lib/api";
import { friendlyError } from "../lib/friendly";
import type { KeyInfo, Settings } from "../lib/types";
import { FlukeMark } from "../components/FlukeMark";
import { SetupSection } from "./sections/Setup";
import { ProfilesSection } from "./sections/Profiles";
import { AudioSection } from "./sections/Audio";
import { BehaviorSection } from "./sections/Behavior";
import { HotkeysSection } from "./sections/Hotkeys";
import { HistorySection } from "./sections/History";
import { AboutSection } from "./sections/About";
import { Welcome } from "./Welcome";

export interface SectionProps {
  draft: Settings;
  update: (mutate: (d: Settings) => void) => void;
  keys: KeyInfo[];
  refreshKeys: () => void;
}

const SECTIONS = [
  { id: "setup", label: "Setup", icon: Plug },
  { id: "profiles", label: "Profiles", icon: UserRound },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "behavior", label: "Behavior", icon: SlidersHorizontal },
  { id: "hotkeys", label: "Shortcuts", icon: Keyboard },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "about", label: "Privacy", icon: ShieldCheck },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Older links (overlay buttons, tray) still point at the pre-merge section names. */
const ALIASES: Record<string, SectionId> = { providers: "setup", models: "setup" };

type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

export function SettingsApp() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [section, setSection] = useState<SectionId>("setup");
  const [welcome, setWelcome] = useState(false);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const draftRef = useRef<Settings | null>(null);
  const savedRef = useRef<Settings | null>(null);
  draftRef.current = draft;
  savedRef.current = saved;

  const refreshKeys = useCallback(() => {
    api.keyStatus().then(setKeys).catch(console.error);
  }, []);

  useEffect(() => {
    const go = (raw: string) => {
      if (raw === "welcome") return setWelcome(true);
      const id = ALIASES[raw] ?? (raw as SectionId);
      if (SECTIONS.some((s) => s.id === id)) {
        setWelcome(false);
        setSection(id);
      }
    };
    const initial = new URLSearchParams(window.location.search).get("section");
    api.getSettings().then((s) => {
      setSaved(s);
      setDraft(structuredClone(s));
      if (!s.onboarded) setWelcome(true);
      else if (initial) go(initial);
    });
    refreshKeys();
    return subscribeAll([
      events.action((a) => {
        if (a.startsWith("section:")) go(a.slice("section:".length));
      }),
    ]);
  }, [refreshKeys]);

  const update = useCallback((mutate: (d: Settings) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      mutate(next);
      return next;
    });
  }, []);

  // Changes save themselves a moment after the last edit.
  const persist = useCallback(async (d: Settings) => {
    setSave({ state: "saving" });
    try {
      const next = await api.saveSettings(d);
      setSaved(next);
      // Adopt normalised values unless the user kept typing meanwhile.
      if (draftRef.current === d) setDraft(structuredClone(next));
      setSave({ state: "saved" });
    } catch (e) {
      setSave({ state: "error", message: friendlyError(errorText(e)).message });
      api.getSettings().then(setSaved).catch(() => {});
    }
  }, []);

  const isDirty = (d: Settings | null, s: Settings | null) => !!d && !!s && JSON.stringify(d) !== JSON.stringify(s);

  useEffect(() => {
    if (!isDirty(draft, savedRef.current)) return;
    const t = setTimeout(() => draft && void persist(draft), 600);
    return () => clearTimeout(t);
  }, [draft, persist]);

  useEffect(() => {
    if (save.state !== "saved") return;
    const t = setTimeout(() => setSave({ state: "idle" }), 1800);
    return () => clearTimeout(t);
  }, [save]);

  /** Save right now (used before the setup flow starts listening). */
  const flush = useCallback(async () => {
    const d = draftRef.current;
    if (d && isDirty(d, savedRef.current)) await persist(d);
  }, [persist]);

  if (!draft) {
    return <div className="grid h-full place-items-center text-ink-400">Loading…</div>;
  }

  const props: SectionProps = { draft, update, keys, refreshKeys };

  if (welcome) return <Welcome {...props} flush={flush} />;

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-white/6 bg-ink-900/60 p-3">
        <div className="mb-5 flex items-center gap-2 px-2 pt-1">
          <FlukeMark className="h-5 w-5 text-lime-400" />
          <span className="text-[15px] font-semibold tracking-tight">fluke</span>
        </div>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={clsx(
              "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
              section === id ? "bg-white/8 font-medium text-ink-100" : "text-ink-300 hover:bg-white/5 hover:text-ink-100",
            )}
          >
            <Icon size={15} className={section === id ? "text-lime-400" : ""} />
            {label}
          </button>
        ))}

        <div className="mt-auto min-h-8 px-2.5 pb-1 text-[12px]">
          {save.state === "saving" && (
            <span className="flex items-center gap-1.5 text-ink-400">
              <LoaderCircle size={12} className="animate-spin" /> Saving
            </span>
          )}
          {save.state === "saved" && (
            <span className="rise flex items-center gap-1.5 text-ink-300">
              <Check size={12} className="text-lime-400" /> Saved
            </span>
          )}
          {save.state === "error" && <span className="selectable block leading-snug text-rose-400">{save.message}</span>}
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
        <div key={section} className="rise mx-auto max-w-3xl">
          {section === "setup" && <SetupSection {...props} onRerun={() => setWelcome(true)} />}
          {section === "profiles" && <ProfilesSection {...props} />}
          {section === "audio" && <AudioSection {...props} />}
          {section === "behavior" && <BehaviorSection {...props} />}
          {section === "hotkeys" && <HotkeysSection {...props} />}
          {section === "history" && <HistorySection />}
          {section === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
