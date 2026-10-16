import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import clsx from "clsx";

import { LANGUAGES, catalogEntry, type Role } from "../../lib/catalog";
import type { SectionProps } from "../SettingsApp";
import { EnginePicker } from "../setup/EnginePicker";
import { Button, SectionHeader } from "../ui";
import { ModelsSection } from "./Models";
import { ProvidersSection } from "./Providers";

export function SetupSection(props: SectionProps & { onRerun: () => void }) {
  const [advanced, setAdvanced] = useState(false);
  const { onRerun, ...p } = props;

  return (
    <>
      <SectionHeader
        title="Setup"
        description="The model that answers and the service that transcribes your calls. Keys are stored in Windows Credential Manager."
      />

      <div className="space-y-3">
        <Engine role="llm" title="Answers" {...p} />
        <Engine role="stt" title="Transcription" {...p} />
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button variant="ghost" onClick={onRerun}>
          <RotateCcw size={13} /> Run the setup flow again
        </Button>
      </div>

      <div className="mt-8 border-t border-white/6 pt-5">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink-300 transition hover:text-ink-100"
        >
          Advanced
          <ChevronDown size={14} className={clsx("transition", advanced && "rotate-180")} />
        </button>
        <p className="mt-1 text-[12px] text-ink-400">
          Exact model ids, reasoning effort, answer length, every provider and custom endpoints.
        </p>
        {advanced && (
          <div className="rise mt-6 space-y-10">
            <ModelsSection {...p} />
            <ProvidersSection {...p} />
          </div>
        )}
      </div>
    </>
  );
}

function Engine({ role, title, ...props }: SectionProps & { role: Role; title: string }) {
  const [open, setOpen] = useState(false);
  const ref = role === "llm" ? props.draft.llm : props.draft.stt;
  const provider = props.draft.providers.find((p) => p.id === ref.provider_id);
  const name = catalogEntry(role, ref.provider_id)?.name ?? provider?.label ?? "Not set";
  const ready = !!provider && (!provider.needs_key || props.keys.some((k) => k.provider_id === provider.id && k.has_key));
  const language = role === "stt" ? LANGUAGES.find(([c]) => c === props.draft.stt.language)?.[1] ?? props.draft.stt.language : null;

  return (
    <div className="rounded-xl border border-white/7 bg-ink-900">
      <div className="flex items-center gap-4 px-4 py-3.5">
        <div className="w-28 shrink-0 text-[12px] text-ink-400">{title}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-tight text-ink-100">{name}</div>
          <div className="truncate font-mono text-[11.5px] text-ink-400">
            {ref.model || "no model yet"}
            {language && <span className="font-sans"> · {language}</span>}
          </div>
        </div>
        <span className={clsx("flex items-center gap-1.5 text-[12px]", ready ? "text-ink-300" : "text-amber-300")}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", ready ? "bg-lime-400" : "bg-amber-300")} />
          {ready ? "Ready" : "Needs a key"}
        </span>
        <Button onClick={() => setOpen((v) => !v)}>{open ? "Done" : "Change"}</Button>
      </div>
      {open && (
        <div className="rise border-t border-white/6 px-4 pt-4 pb-4">
          <EnginePicker role={role} {...props} />
        </div>
      )}
    </div>
  );
}
