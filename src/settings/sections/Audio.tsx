import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { api, errorText } from "../../lib/api";
import type { DeviceList } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Button, Card, Field, SectionHeader, Select, Toggle } from "../ui";

export function AudioSection({ draft, update }: SectionProps) {
  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const b = draft.behavior;

  const load = () => {
    setError(null);
    api
      .listAudioDevices()
      .then(setDevices)
      .catch((e) => setError(errorText(e)));
  };
  useEffect(load, []);

  return (
    <>
      <SectionHeader
        title="Audio"
        description="Fluke records two sources separately, so it always knows who said what: your microphone (You) and your computer's output (Them: everyone else on the call)."
      />
      <Card className="mb-4 space-y-3">
        <Toggle
          checked={b.capture_mic}
          onChange={(v) => update((d) => void (d.behavior.capture_mic = v))}
          label="Microphone (You)"
          description="Lets Fluke follow your side of the conversation."
        />
        <Field label="Input device">
          <Select
            disabled={!b.capture_mic}
            value={b.mic_device ?? ""}
            onChange={(e) => update((d) => void (d.behavior.mic_device = e.target.value || null))}
          >
            <option value="">System default</option>
            {devices?.inputs.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card className="mb-4 space-y-3">
        <Toggle
          checked={b.capture_system}
          onChange={(v) => update((d) => void (d.behavior.capture_system = v))}
          label="System audio (Them)"
          description="Captures what you hear (Zoom, Meet, Teams, a browser tab) via loopback. No virtual cable needed."
        />
        <Field
          label="Output device to capture"
          hint="Pick the device your call audio plays through, usually your headphones."
        >
          <Select
            disabled={!b.capture_system}
            value={b.output_device ?? ""}
            onChange={(e) => update((d) => void (d.behavior.output_device = e.target.value || null))}
          >
            <option value="">System default</option>
            {devices?.outputs.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={load}>
          <RefreshCw size={13} /> Refresh devices
        </Button>
        {error && <span className="text-[12.5px] text-rose-400">{error}</span>}
      </div>
      <ul className="mt-5 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-400">
        <li>Wear headphones if you can. On speakers, your mic also picks up the other side.</li>
        <li>Changes apply the next time you start listening.</li>
      </ul>
    </>
  );
}
