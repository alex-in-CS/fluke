import type { SectionProps } from "../SettingsApp";
import { Card, Field, SectionHeader, Select, Toggle } from "../ui";

const WINDOWS = [
  [120, "Last 2 minutes"],
  [300, "Last 5 minutes"],
  [600, "Last 10 minutes"],
  [1800, "Last 30 minutes"],
  [3600, "Last hour"],
] as const;

export function BehaviorSection({ draft, update }: SectionProps) {
  const b = draft.behavior;
  return (
    <>
      <SectionHeader title="Behavior" description="How and when Fluke steps in." />
      <Card className="mb-4 divide-y divide-white/5">
        <Toggle
          checked={b.auto_answer}
          onChange={(v) => update((d) => void (d.behavior.auto_answer = v))}
          label="Answer questions automatically"
          description="When the other side asks you something, Fluke drafts an answer as soon as they stop talking."
        />
        <Toggle
          checked={b.screen_on_ask}
          onChange={(v) => update((d) => void (d.behavior.screen_on_ask = v))}
          label="Include a screenshot when you press Ask"
          description="Lets the model see code, slides or documents on your screen. Needs a vision-capable model."
        />
        <Toggle
          checked={b.hide_from_capture}
          onChange={(v) => update((d) => void (d.behavior.hide_from_capture = v))}
          label="Hide Fluke from screen sharing and recordings"
          description="Your private notes stay private when you present. Fluke's windows are excluded from capture by the OS."
        />
      </Card>

      <Card className="grid grid-cols-2 gap-5">
        <Field label="Transcript sent with each request" hint="More context helps, but costs more tokens.">
          <Select
            value={b.transcript_window_secs}
            onChange={(e) => update((d) => void (d.behavior.transcript_window_secs = Number(e.target.value)))}
          >
            {WINDOWS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Overlay opacity: ${Math.round(b.opacity * 100)}%`}>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.02}
            value={b.opacity}
            onChange={(e) => update((d) => void (d.behavior.opacity = Number(e.target.value)))}
            className="mt-2 w-full accent-lime-400"
          />
        </Field>
      </Card>
    </>
  );
}
