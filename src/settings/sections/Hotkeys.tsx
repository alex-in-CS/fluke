import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import clsx from "clsx";

import { acceleratorFromEvent } from "../../lib/hotkeys";
import type { Hotkeys } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Kbd } from "../../components/Kbd";
import { Button, Card, SectionHeader } from "../ui";

const ROWS: [keyof Hotkeys, string][] = [
  ["ask", "Answer what's happening now"],
  ["toggle_listen", "Start / stop listening"],
  ["focus_input", "Type a question"],
  ["toggle_overlay", "Show / hide Fluke"],
  ["click_through", "Toggle click-through"],
  ["move_up", "Move overlay up"],
  ["move_down", "Move overlay down"],
  ["move_left", "Move overlay left"],
  ["move_right", "Move overlay right"],
];

const DEFAULTS: Hotkeys = {
  toggle_overlay: "CommandOrControl+Shift+Space",
  ask: "CommandOrControl+Shift+Enter",
  toggle_listen: "CommandOrControl+Shift+L",
  focus_input: "CommandOrControl+Shift+K",
  click_through: "CommandOrControl+Shift+X",
  move_up: "CommandOrControl+Shift+Up",
  move_down: "CommandOrControl+Shift+Down",
  move_left: "CommandOrControl+Shift+Left",
  move_right: "CommandOrControl+Shift+Right",
};

export function HotkeysSection({ draft, update }: SectionProps) {
  const [recording, setRecording] = useState<keyof Hotkeys | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      if (e.key === "Backspace" || e.key === "Delete") {
        update((d) => void (d.hotkeys[recording] = ""));
        return setRecording(null);
      }
      const accel = acceleratorFromEvent(e);
      if (accel) {
        update((d) => void (d.hotkeys[recording] = accel));
        setRecording(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, update]);

  const values = Object.values(draft.hotkeys).filter(Boolean);
  const dupes = new Set(values.filter((v, i) => values.indexOf(v) !== i));

  return (
    <>
      <SectionHeader
        title="Hotkeys"
        description="Global shortcuts work from any app, so you never have to click away from the call. Click a shortcut, then press the new combination (Backspace clears it, Esc cancels)."
      />
      <Card className="divide-y divide-white/5 p-0">
        {ROWS.map(([id, label]) => (
          <div key={id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 text-[13px] text-ink-200">{label}</span>
            {dupes.has(draft.hotkeys[id]) && <span className="text-[11.5px] text-amber-300">duplicate</span>}
            <button
              onClick={() => setRecording(recording === id ? null : id)}
              className={clsx(
                "min-w-44 rounded-lg border px-3 py-1.5 text-right transition",
                recording === id
                  ? "border-lime-400/60 bg-lime-400/8 text-[12px] text-lime-400"
                  : "border-white/8 bg-ink-850 hover:border-white/20",
              )}
            >
              {recording === id ? (
                "Press keys…"
              ) : draft.hotkeys[id] ? (
                <Kbd accel={draft.hotkeys[id]} />
              ) : (
                <span className="text-[12px] text-ink-400">Not set</span>
              )}
            </button>
          </div>
        ))}
      </Card>
      <Button variant="ghost" className="mt-3" onClick={() => update((d) => void (d.hotkeys = { ...DEFAULTS }))}>
        <RotateCcw size={13} /> Restore defaults
      </Button>
    </>
  );
}
