import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Cpu,
  History as HistoryIcon,
  Keyboard,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import clsx from "clsx";

import { api, errorText, events, subscribeAll } from "../lib/api";
import type { KeyInfo, Settings } from "../lib/types";
import { FlukeMark } from "../components/FlukeMark";
import { Button } from "./ui";
import { ModelsSection } from "./sections/Models";
import { ProvidersSection } from "./sections/Providers";
import { ProfilesSection } from "./sections/Profiles";
import { AudioSection } from "./sections/Audio";
import { BehaviorSection } from "./sections/Behavior";
import { HotkeysSection } from "./sections/Hotkeys";
import { HistorySection } from "./sections/History";
import { AboutSection } from "./sections/About";

export interface SectionProps {
  draft: Settings;
  update: (mutate: (d: Settings) => void) => void;
  keys: KeyInfo[];
  refreshKeys: () => void;
}

const SECTIONS = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "providers", label: "Providers & keys", icon: KeyRound },
  { id: "profiles", label: "Profiles", icon: UserRound },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "behavior", label: "Behavior", icon: SlidersHorizontal },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "about", label: "Privacy & about", icon: ShieldCheck },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsApp() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [section, setSection] = useState<SectionId>("models");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refreshKeys = useCallback(() => {
    api.keyStatus().then(setKeys).catch(console.error);
  }, []);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSaved(s);
      setDraft(structuredClone(s));
    });
    refreshKeys();
    return subscribeAll([
      events.action((a) => {
        if (a.startsWith("section:")) {
          const id = a.slice("section:".length) as SectionId;
          if (SECTIONS.some((s) => s.id === id)) setSection(id);
        }
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
    setMessage(null);
  }, []);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api.saveSettings({ ...draft, onboarded: true });
      setSaved(next);
      setDraft(structuredClone(next));
      setMessage({ tone: "ok", text: "Saved" });
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
      // Settings were still saved if only hotkeys failed; reload to stay in sync.
      api.getSettings().then(setSaved).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return <div className="grid h-full place-items-center text-ink-400">Loading…</div>;
  }

  const props: SectionProps = { draft, update, keys, refreshKeys };
  const usesDraft = section !== "history" && section !== "about";

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-white/6 bg-ink-900/60 p-3">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <FlukeMark className="h-5 w-5 text-lime-400" />
          <span className="text-[15px] font-semibold tracking-tight">fluke</span>
          <span className="ml-auto text-[11px] text-ink-400">settings</span>
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
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-3xl">
            {section === "models" && <ModelsSection {...props} />}
            {section === "providers" && <ProvidersSection {...props} />}
            {section === "profiles" && <ProfilesSection {...props} />}
            {section === "audio" && <AudioSection {...props} />}
            {section === "behavior" && <BehaviorSection {...props} />}
            {section === "hotkeys" && <HotkeysSection {...props} />}
            {section === "history" && <HistorySection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>

        {usesDraft && (
          <footer className="flex items-center gap-3 border-t border-white/6 bg-ink-900/70 px-8 py-3">
            {message && (
              <span
                className={clsx(
                  "selectable text-[12.5px]",
                  message.tone === "ok" ? "text-lime-400" : "text-rose-400",
                )}
              >
                {message.text}
              </span>
            )}
            {!message && dirty && <span className="text-[12.5px] text-ink-400">Unsaved changes</span>}
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                disabled={!dirty || saving}
                onClick={() => saved && setDraft(structuredClone(saved))}
              >
                Discard
              </Button>
              <Button variant="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}
