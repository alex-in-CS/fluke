import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";

import { api, errorText } from "../../lib/api";
import type { KeyInfo, ProviderConfig, ProviderKind } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Badge, Button, Card, Field, SectionHeader, Select, TextArea, TextInput, Toggle } from "../ui";

const KIND_LABEL: Record<ProviderKind, string> = {
  openai_compat: "OpenAI-compatible",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepgram: "Deepgram STT",
};

const KEY_LINKS: Record<string, string> = {
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com/api-keys",
  gemini: "aistudio.google.com/apikey",
  groq: "console.groq.com/keys",
  openrouter: "openrouter.ai/keys",
  deepseek: "platform.deepseek.com",
  xai: "console.x.ai",
  mistral: "console.mistral.ai",
  deepgram: "console.deepgram.com",
};

export function ProvidersSection({ draft, update, keys, refreshKeys }: SectionProps) {
  const [open, setOpen] = useState<string | null>(null);

  const addCustom = () => {
    const n = draft.providers.filter((p) => p.id.startsWith("custom")).length + 1;
    const id = `custom-${Date.now().toString(36)}`;
    update((d) =>
      d.providers.push({
        id,
        label: `Custom ${n}`,
        kind: "openai_compat",
        base_url: "http://localhost:8000/v1",
        needs_key: true,
        preset: false,
        extra_headers: {},
        extra_body: null,
        suggested_models: [],
      }),
    );
    setOpen(id);
  };

  return (
    <>
      <SectionHeader
        title="Providers & keys"
        description={
          <>
            Keys are written straight to your OS credential store (Windows Credential Manager / macOS
            Keychain) and only ever read by Fluke's native core. They are never stored in the settings file
            or shown back in full.
          </>
        }
      />
      <div className="space-y-2">
        {draft.providers.map((p, i) => (
          <ProviderRow
            key={p.id}
            provider={p}
            keyInfo={keys.find((k) => k.provider_id === p.id)}
            open={open === p.id}
            inUse={draft.llm.provider_id === p.id || draft.stt.provider_id === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
            onChange={(mut) => update((d) => mut(d.providers[i]))}
            onDelete={() =>
              update((d) => {
                d.providers.splice(i, 1);
              })
            }
            refreshKeys={refreshKeys}
          />
        ))}
      </div>
      <Button className="mt-4" onClick={addCustom}>
        <Plus size={14} /> Add OpenAI-compatible provider
      </Button>
      <p className="mt-2 text-[12px] text-ink-400">
        For vLLM, LiteLLM, Together, Fireworks, Azure-style gateways or anything else that speaks the
        OpenAI chat API. Save settings after editing a provider.
      </p>
    </>
  );
}

function ProviderRow({
  provider: p,
  keyInfo,
  open,
  inUse,
  onToggle,
  onChange,
  onDelete,
  refreshKeys,
}: {
  provider: ProviderConfig;
  keyInfo?: KeyInfo;
  open: boolean;
  inUse: boolean;
  onToggle: () => void;
  onChange: (mut: (p: ProviderConfig) => void) => void;
  onDelete: () => void;
  refreshKeys: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [headersText, setHeadersText] = useState(JSON.stringify(p.extra_headers, null, 2));
  const [bodyText, setBodyText] = useState(p.extra_body ? JSON.stringify(p.extra_body, null, 2) : "");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const saveKey = async () => {
    setBusy(true);
    setResult(null);
    try {
      await api.setApiKey(p.id, key);
      setKey("");
      refreshKeys();
      // Validate right away so a typo shows up here, not mid-call.
      const models = await api.listModels(p);
      setResult({ ok: true, text: `Key works: ${models.length} models available.` });
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const models = await api.listModels(p);
      setResult({ ok: true, text: `Connected: ${models.length} models available.` });
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    await api.deleteApiKey(p.id).catch(() => {});
    refreshKeys();
    setResult(null);
  };

  const applyJson = () => {
    try {
      const headers = headersText.trim() ? JSON.parse(headersText) : {};
      const body = bodyText.trim() ? JSON.parse(bodyText) : null;
      if (typeof headers !== "object" || Array.isArray(headers)) throw new Error("Headers must be a JSON object");
      if (body !== null && (typeof body !== "object" || Array.isArray(body)))
        throw new Error("Extra body must be a JSON object");
      setJsonError(null);
      onChange((x) => {
        x.extra_headers = headers;
        x.extra_body = body;
      });
    } catch (e) {
      setJsonError(errorText(e));
    }
  };

  return (
    <Card className="p-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="flex-1">
          <span className="flex items-center gap-2 text-[13.5px] font-medium">
            {p.label}
            {inUse && <Badge tone="ok">in use</Badge>}
          </span>
          <span className="text-[11.5px] text-ink-400">
            {KIND_LABEL[p.kind]} · {p.base_url}
          </span>
        </span>
        {!p.needs_key ? (
          <Badge>local</Badge>
        ) : keyInfo?.has_key ? (
          <Badge tone="ok">key {keyInfo.hint}</Badge>
        ) : (
          <Badge>no key</Badge>
        )}
        <ChevronDown size={16} className={clsx("text-ink-400 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/6 px-4 py-4">
          {p.needs_key && (
            <Field
              label="API key"
              hint={KEY_LINKS[p.id] ? `Get one at ${KEY_LINKS[p.id]}` : undefined}
            >
              <div className="flex gap-2">
                <TextInput
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder={keyInfo?.has_key ? `Saved (${keyInfo.hint}). Paste to replace.` : "Paste your key"}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && key.trim() && saveKey()}
                />
                <Button variant="primary" disabled={!key.trim() || busy} onClick={saveKey}>
                  Save key
                </Button>
                {keyInfo?.has_key && (
                  <Button variant="danger" onClick={removeKey} title="Remove key from keychain">
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <TextInput value={p.label} onChange={(e) => onChange((x) => void (x.label = e.target.value))} />
            </Field>
            <Field label="Type">
              <Select
                value={p.kind}
                disabled={p.preset}
                onChange={(e) => onChange((x) => void (x.kind = e.target.value as ProviderKind))}
              >
                {(Object.keys(KIND_LABEL) as ProviderKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Base URL"
            hint={p.kind === "openai_compat" ? "Up to and including /v1 (Fluke appends /chat/completions)." : undefined}
          >
            <TextInput
              value={p.base_url}
              spellCheck={false}
              onChange={(e) => onChange((x) => void (x.base_url = e.target.value))}
            />
          </Field>
          <Toggle
            checked={p.needs_key}
            onChange={(v) => onChange((x) => void (x.needs_key = v))}
            label="Requires an API key"
            description="Turn off for local servers like Ollama or LM Studio."
          />

          <details className="group">
            <summary className="cursor-pointer text-[12.5px] text-ink-300 hover:text-ink-100">
              Advanced: extra headers and request body
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Extra headers (JSON)">
                <TextArea
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-[12px]"
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  onBlur={applyJson}
                  placeholder='{"HTTP-Referer": "https://example.com"}'
                />
              </Field>
              <Field label="Extra request body (JSON)" hint="Merged into every chat request.">
                <TextArea
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-[12px]"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  onBlur={applyJson}
                  placeholder='{"temperature": 0.3}'
                />
              </Field>
            </div>
            {jsonError && <p className="mt-2 text-[12px] text-rose-400">{jsonError}</p>}
          </details>

          <div className="flex items-center gap-3">
            <Button onClick={test} disabled={busy || (p.needs_key && !keyInfo?.has_key)}>
              {busy ? "Checking…" : "Test connection"}
            </Button>
            {!p.preset && (
              <Button variant="danger" onClick={onDelete} disabled={inUse} title={inUse ? "In use" : undefined}>
                <Trash2 size={13} /> Remove provider
              </Button>
            )}
            {result && (
              <span className={clsx("selectable text-[12.5px]", result.ok ? "text-lime-400" : "text-rose-400")}>
                {result.text}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
