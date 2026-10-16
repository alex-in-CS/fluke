import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { api, errorText } from "../../lib/api";
import type { ProviderConfig } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Badge, Button, Card, Field, SectionHeader, Select, TextInput } from "../ui";

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const LANGUAGES = ["en", "multi", "hi", "es", "fr", "de", "pt", "ja", "zh", "ko", "it", "nl", "ru"];

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

export function ModelsSection({ draft, update, keys }: SectionProps) {
  const models = useModelList();
  const llmProviders = draft.providers.filter((p) => p.kind !== "deepgram");
  const sttProviders = draft.providers.filter((p) => p.kind === "deepgram" || p.kind === "openai_compat");
  const llm = draft.providers.find((p) => p.id === draft.llm.provider_id);
  const stt = draft.providers.find((p) => p.id === draft.stt.provider_id);

  const keyBadge = (p?: ProviderConfig) => {
    if (!p) return null;
    if (!p.needs_key) return <Badge>no key needed</Badge>;
    return keys.find((k) => k.provider_id === p.id)?.has_key ? (
      <Badge tone="ok">key saved</Badge>
    ) : (
      <Badge tone="warn">no key yet</Badge>
    );
  };

  const options = (p?: ProviderConfig) =>
    p ? Array.from(new Set([...(models.lists[p.id] ?? []), ...p.suggested_models])) : [];

  return (
    <>
      <SectionHeader
        title="Models"
        description="Pick who answers and who transcribes. Any provider works as long as you have a key for it; keys live in your OS keychain."
      />

      <Card className="mb-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">Answers (LLM)</h3>
          {keyBadge(llm)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Provider">
            <Select
              value={draft.llm.provider_id}
              onChange={(e) =>
                update((d) => {
                  d.llm.provider_id = e.target.value;
                  const p = d.providers.find((x) => x.id === e.target.value);
                  d.llm.model = p?.suggested_models[0] ?? "";
                })
              }
            >
              {llmProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Model"
            hint={
              models.error[llm?.id ?? ""] ||
              (models.lists[llm?.id ?? ""] ? `${models.lists[llm!.id].length} models available` : "Type an id or load the list")
            }
          >
            <div className="flex gap-2">
              <TextInput
                list="llm-models"
                value={draft.llm.model}
                placeholder="model id"
                onChange={(e) => update((d) => void (d.llm.model = e.target.value))}
              />
              <Button
                onClick={() => llm && models.load(llm)}
                disabled={!llm || models.loading === llm.id}
                title="Load models from the provider"
              >
                <RefreshCw size={13} className={models.loading === llm?.id ? "animate-spin" : ""} />
              </Button>
            </div>
            <datalist id="llm-models">
              {options(llm).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {llm?.kind === "anthropic" && (
            <Field
              label="Effort"
              hint="Lower effort answers faster. Leave on model default for older Claude models that don't support it."
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
          <Field label="Max output tokens" hint="Upper bound per answer, including any reasoning tokens.">
            <TextInput
              type="number"
              min={256}
              max={128000}
              step={256}
              value={draft.behavior.max_output_tokens}
              onChange={(e) =>
                update((d) => void (d.behavior.max_output_tokens = Number(e.target.value) || 16000))
              }
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">Transcription (speech-to-text)</h3>
          {keyBadge(stt)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Provider">
            <Select
              value={draft.stt.provider_id}
              onChange={(e) =>
                update((d) => {
                  d.stt.provider_id = e.target.value;
                  const p = d.providers.find((x) => x.id === e.target.value);
                  d.stt.model = p?.suggested_models[0] ?? "";
                })
              }
            >
              {sttProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model" hint={models.error[stt?.id ?? ""] || undefined}>
            <div className="flex gap-2">
              <TextInput
                list="stt-models"
                value={draft.stt.model}
                placeholder="e.g. nova-3"
                onChange={(e) => update((d) => void (d.stt.model = e.target.value))}
              />
              <Button
                onClick={() => stt && models.load(stt)}
                disabled={!stt || models.loading === stt.id}
                title="Load models from the provider"
              >
                <RefreshCw size={13} className={models.loading === stt?.id ? "animate-spin" : ""} />
              </Button>
            </div>
            <datalist id="stt-models">
              {options(stt).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Language" hint={`"multi" = auto-detect`}>
            <TextInput
              list="stt-langs"
              value={draft.stt.language}
              onChange={(e) => update((d) => void (d.stt.language = e.target.value))}
            />
            <datalist id="stt-langs">
              {LANGUAGES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-400">
          {stt?.kind === "deepgram"
            ? "Deepgram streams words as they're spoken (lowest latency). Recommended."
            : "OpenAI-compatible transcription uploads each utterance when the speaker pauses, so text appears a beat later. Works with OpenAI, Groq, Mistral or a local Whisper server; the model must be a transcription model."}
        </p>
      </Card>
    </>
  );
}
