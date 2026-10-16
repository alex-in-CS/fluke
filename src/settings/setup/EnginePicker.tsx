import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, LoaderCircle } from "lucide-react";
import clsx from "clsx";

import { api, errorText } from "../../lib/api";
import {
  LANGUAGES,
  LLM_FEATURED,
  LLM_MORE,
  STT_FEATURED,
  STT_MORE,
  catalogEntry,
  pickLlmModel,
  pickSttModel,
  type CatalogEntry,
  type Role,
} from "../../lib/catalog";
import { friendlyError } from "../../lib/friendly";
import type { SectionProps } from "../SettingsApp";
import { Button, Select, TextInput } from "../ui";

type CheckState = { state: "idle" } | { state: "checking" } | { state: "ok"; model: string } | { state: "error"; message: string; raw: string };

/** Provider cards + key entry. A provider only becomes the active one once it connects. */
export function EnginePicker({
  role,
  draft,
  update,
  keys,
  refreshKeys,
  onStatus,
}: SectionProps & { role: Role; onStatus?: (connected: boolean) => void }) {
  const active = role === "llm" ? draft.llm : draft.stt;
  const [choice, setChoice] = useState(active.provider_id);
  const featured = role === "llm" ? LLM_FEATURED : STT_FEATURED;
  const more = role === "llm" ? LLM_MORE : STT_MORE;
  const [showMore, setShowMore] = useState(() => more.some((e) => e.id === active.provider_id));
  // The tick marks a provider that actually connected, not just the default selection.
  const [connected, setConnected] = useState<string | null>(null);
  const report = useCallback(
    (id: string, ok: boolean) => {
      setConnected((c) => (ok ? id : c === id ? null : c));
      onStatus?.(ok);
    },
    [onStatus],
  );

  const cards = (entries: CatalogEntry[], compact = false) =>
    entries
      .filter((e) => draft.providers.some((p) => p.id === e.id))
      .map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => setChoice(e.id)}
          className={clsx(
            "group relative rounded-xl border text-left transition",
            compact ? "px-3 py-2.5" : "px-4 py-3.5",
            choice === e.id
              ? "border-lime-400/55 bg-lime-400/[0.06] shadow-[0_0_0_3px_rgba(182,243,107,0.08)]"
              : "border-white/8 bg-ink-900 hover:border-white/16 hover:bg-ink-850",
          )}
        >
          <span className={clsx("block font-semibold tracking-tight text-ink-100", compact ? "text-[13px]" : "text-[14.5px]")}>
            {e.name}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-400">{e.tagline}</span>
          {connected === e.id && (
            <span className="absolute top-2.5 right-2.5 grid h-4 w-4 place-items-center rounded-full bg-lime-400 text-ink-950">
              <Check size={10} strokeWidth={3} />
            </span>
          )}
        </button>
      ));

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5">{cards(featured)}</div>
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[12px] text-ink-400 transition hover:text-ink-100"
      >
        More options <ChevronDown size={13} className={clsx("transition", showMore && "rotate-180")} />
      </button>
      {showMore && <div className="mt-2.5 grid grid-cols-4 gap-2">{cards(more, true)}</div>}

      <Connect
        key={choice}
        role={role}
        providerId={choice}
        draft={draft}
        update={update}
        keys={keys}
        refreshKeys={refreshKeys}
        onStatus={(ok) => report(choice, ok)}
      />

      {role === "stt" && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[12.5px] text-ink-300">Language spoken on calls</span>
          <Select
            className="w-48"
            value={draft.stt.language}
            onChange={(e) => update((d) => void (d.stt.language = e.target.value))}
          >
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
            {!LANGUAGES.some(([c]) => c === draft.stt.language) && (
              <option value={draft.stt.language}>{draft.stt.language}</option>
            )}
          </Select>
        </div>
      )}
    </div>
  );
}

function Connect({
  role,
  providerId,
  draft,
  update,
  keys,
  refreshKeys,
  onStatus,
}: SectionProps & { role: Role; providerId: string; onStatus?: (connected: boolean) => void }) {
  const provider = draft.providers.find((p) => p.id === providerId);
  const entry = catalogEntry(role, providerId);
  const keyInfo = keys.find((k) => k.provider_id === providerId);
  const hasKey = !!keyInfo?.has_key;
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [check, setCheck] = useState<CheckState>({ state: "idle" });
  const ran = useRef(false);

  const name = entry?.name ?? provider?.label ?? providerId;
  const active = role === "llm" ? draft.llm : draft.stt;

  // Report only real changes; the callback's identity can change every render.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(check.state === "ok");
  }, [check.state]);

  const verify = useCallback(async () => {
    if (!provider) return;
    setCheck({ state: "checking" });
    try {
      const models = await api.listModels(provider);
      // Keep a model the user already picked for this provider; otherwise choose one.
      const keep = active.provider_id === provider.id && active.model && (models.length === 0 || models.includes(active.model));
      const model = keep
        ? active.model
        : role === "llm"
          ? pickLlmModel(provider.id, models, provider.suggested_models)
          : pickSttModel(provider.id, models, provider.suggested_models);
      update((d) => {
        if (role === "llm") d.llm = { provider_id: provider.id, model };
        else d.stt = { ...d.stt, provider_id: provider.id, model };
      });
      setCheck({ state: "ok", model });
      setReplacing(false);
    } catch (e) {
      const f = friendlyError(errorText(e));
      setCheck({ state: "error", message: f.message, raw: f.raw });
    }
  }, [provider, active.provider_id, active.model, role, update]);

  // Already have what we need (saved key, or a local server)? Check straight away.
  useEffect(() => {
    if (ran.current || !provider) return;
    if (!provider.needs_key || hasKey) {
      ran.current = true;
      void verify();
    }
  }, [provider, hasKey, verify]);

  const connect = async () => {
    const k = key.trim();
    if (!k || !provider) return;
    setCheck({ state: "checking" });
    try {
      await api.setApiKey(provider.id, k);
      setKey("");
      refreshKeys();
      await verify();
    } catch (e) {
      const f = friendlyError(errorText(e));
      setCheck({ state: "error", message: f.message, raw: f.raw });
    }
  };

  if (!provider) return null;
  const askForKey = provider.needs_key && (!hasKey || replacing || check.state === "error");
  const link = entry?.url && (
    <button
      type="button"
      onClick={() => api.openUrl(entry.url!)}
      className="flex items-center gap-0.5 text-[12px] font-medium text-lime-400 transition hover:text-lime-300"
    >
      {entry.urlLabel ?? "Get a key"} <ArrowUpRight size={13} />
    </button>
  );

  return (
    <div className="mt-4 rounded-xl border border-white/7 bg-ink-900/70 p-4">
      {askForKey ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-ink-200">{name} API key</span>
            {link}
          </div>
          <div className="flex gap-2">
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={key}
              placeholder={hasKey ? `Saved key ${keyInfo?.hint ?? ""}. Paste a new one to replace it.` : "Paste your key"}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <Button variant="primary" className="px-4" disabled={!key.trim() || check.state === "checking"} onClick={connect}>
              Connect
            </Button>
          </div>
        </>
      ) : !provider.needs_key && check.state !== "ok" ? (
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-ink-300">
            {name} runs on this PC. Start it, then check the connection.
          </span>
          <div className="flex items-center gap-3">
            {link}
            <Button onClick={() => void verify()} disabled={check.state === "checking"}>
              Check
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className={clsx(
          "flex items-center gap-2 text-[12.5px]",
          askForKey && check.state !== "idle" && "mt-3",
          check.state === "idle" && askForKey && "hidden",
        )}
      >
        {check.state === "checking" && (
          <span className="flex items-center gap-2 text-ink-300">
            <LoaderCircle size={14} className="animate-spin" /> Connecting to {name}…
          </span>
        )}
        {check.state === "ok" && (
          <>
            <span className="grid h-4 w-4 place-items-center rounded-full bg-lime-400 text-ink-950">
              <Check size={10} strokeWidth={3} />
            </span>
            <span className="text-ink-100">Connected</span>
            <span className="truncate font-mono text-[11.5px] text-ink-400">{check.model}</span>
            {provider.needs_key && !replacing && (
              <button className="ml-auto text-[12px] text-ink-400 hover:text-ink-100" onClick={() => setReplacing(true)}>
                Replace key
              </button>
            )}
          </>
        )}
        {check.state === "error" && (
          <span className="selectable text-rose-400" title={check.raw}>
            {check.message}
          </span>
        )}
        {check.state === "idle" && !askForKey && provider.needs_key && (
          <span className="text-ink-400">Key saved {keyInfo?.hint}</span>
        )}
      </div>
    </div>
  );
}
