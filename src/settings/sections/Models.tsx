import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { api, errorText } from "../../lib/api";
import type { ProviderConfig } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Button, Card, Field, SectionHeader, Select, TextInput } from "../ui";

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

function useModelList() {
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  const load = async (p: ProviderConfig) => {
    setLoading(p.id);
    setError((e) => ({ ...e, [p.id]: "" }));
    try {
      const models = await api.listModels(p);
      setLists((l) => ({ ...l, [p.id]: models }));
    } catch (e) {
      setError((er) => ({ ...er, [p.id]: errorText(e) }));
    } finally {
      setLoading(null);
    }
  };
  return { lists, loading, error, load };
}

/** Advanced: exact model ids and generation limits. Providers themselves are chosen in Setup. */
export function ModelsSection({ draft, update }: SectionProps) {
  const models = useModelList();
  const llm = draft.providers.find((p) => p.id === draft.llm.provider_id);
  const stt = draft.providers.find((p) => p.id === draft.stt.provider_id);

  const options = (p?: ProviderConfig) =>
    p ? Array.from(new Set([...(models.lists[p.id] ?? []), ...p.suggested_models])) : [];

  const modelField = (
    label: string,
    p: ProviderConfig | undefined,
    value: string,
    set: (v: string) => void,
    listId: string,
  ) => (
    <Field
      label={`${label}${p ? ` · ${p.label}` : ""}`}
      hint={
        models.error[p?.id ?? ""] ||
        (models.lists[p?.id ?? ""] ? `${models.lists[p!.id].length} models available` : "Type an id or load the list")
      }
    >
      <div className="flex gap-2">
        <TextInput list={listId} value={value} placeholder="model id" spellCheck={false} onChange={(e) => set(e.target.value)} />
        <Button
          onClick={() => p && models.load(p)}
          disabled={!p || models.loading === p.id}
          title="Load models from the provider"
        >
          <RefreshCw size={13} className={models.loading === p?.id ? "animate-spin" : ""} />
        </Button>
      </div>
      <datalist id={listId}>
        {options(p).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  );

  return (
    <div>
      <SectionHeader title="Models" description="Fluke picks these automatically. Override them here if you want a specific one." />
      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {modelField("Answer model", llm, draft.llm.model, (v) => update((d) => void (d.llm.model = v)), "llm-models")}
          {modelField("Transcription model", stt, draft.stt.model, (v) => update((d) => void (d.stt.model = v)), "stt-models")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {llm?.kind === "anthropic" && (
            <Field
              label="Effort"
              hint="Lower effort answers faster. Use model default for older Claude models that don't support it."
            >
              <Select
                value={draft.behavior.anthropic_effort ?? ""}
                onChange={(e) => update((d) => void (d.behavior.anthropic_effort = e.target.value || null))}
              >
                {EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    {x || "Model default"}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Max answer length (tokens)" hint="Upper bound per answer, including any reasoning.">
            <TextInput
              type="number"
              min={256}
              max={128000}
              step={256}
              value={draft.behavior.max_output_tokens}
              onChange={(e) => update((d) => void (d.behavior.max_output_tokens = Number(e.target.value) || 16000))}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
