import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { BrainCircuit, Copy, FilePlus2, FileText, Plus, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";

import { api, errorText } from "../../lib/api";
import type { ContextDoc, Profile } from "../../lib/types";
import type { SectionProps } from "../SettingsApp";
import { Badge, Button, Card, Field, SectionHeader, Select, TextArea, TextInput, Toggle } from "../ui";

const FILE_FILTERS = [
  {
    name: "Documents",
    extensions: ["md", "txt", "pdf", "docx", "csv", "json", "markdown", "log", "yaml", "yml", "html"],
  },
  { name: "All files", extensions: ["*"] },
];

const tokens = (chars: number) => Math.round(chars / 4);

export function ProfilesSection({ draft, update }: SectionProps) {
  const activeId = draft.active_profile;
  const index = Math.max(
    0,
    draft.profiles.findIndex((p) => p.id === activeId),
  );
  const profile = draft.profiles[index];
  const [docs, setDocs] = useState<ContextDoc[]>([]);

  const loadDocs = useCallback(() => {
    if (profile) api.listContextDocs(profile.id).then(setDocs).catch(() => setDocs([]));
  }, [profile?.id]);
  useEffect(loadDocs, [loadDocs]);

  const add = (from?: Profile) => {
    const id = `p-${Date.now().toString(36)}`;
    update((d) => {
      d.profiles.push({
        id,
        name: from ? `${from.name} copy` : "New profile",
        instructions: from?.instructions ?? "",
        context: from?.context ?? "",
        memory_enabled: from?.memory_enabled ?? true,
        memory_count: from?.memory_count ?? 5,
      });
      d.active_profile = id;
    });
  };

  const docChars = docs.reduce((n, d) => n + d.chars, 0);

  return (
    <>
      <SectionHeader
        title="Profiles"
        description="A profile tells Fluke what kind of conversation you're in and what it should already know: instructions, reference files and notes from your past meetings. The selected profile is used for answers."
      />
      <div className="flex gap-5">
        <div className="w-52 shrink-0 space-y-1">
          {draft.profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => update((d) => void (d.active_profile = p.id))}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition",
                p.id === activeId ? "bg-white/8 font-medium text-ink-100" : "text-ink-300 hover:bg-white/5",
              )}
            >
              <span className="truncate">{p.name || "Untitled"}</span>
              {p.id === activeId && <Badge tone="ok">active</Badge>}
            </button>
          ))}
          <Button variant="ghost" className="w-full justify-start" onClick={() => add()}>
            <Plus size={14} /> New profile
          </Button>
        </div>

        {profile && (
          <div className="min-w-0 flex-1 space-y-4">
            <Card className="space-y-4">
              <div className="flex items-end gap-3">
                <Field label="Name" className="flex-1">
                  <TextInput
                    value={profile.name}
                    onChange={(e) => update((d) => void (d.profiles[index].name = e.target.value))}
                  />
                </Field>
                <Button onClick={() => add(profile)} title="Duplicate">
                  <Copy size={13} />
                </Button>
                <Button
                  variant="danger"
                  disabled={draft.profiles.length <= 1}
                  onClick={() =>
                    update((d) => {
                      d.profiles.splice(index, 1);
                      d.active_profile = d.profiles[0].id;
                    })
                  }
                  title="Delete profile (its files are removed when you save)"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
              <Field
                label="Instructions"
                hint="How Fluke should help: tone, format, what to focus on. E.g. “I'm the PM. Keep answers to 3 bullets I can say naturally, and flag anything that changes scope.”"
              >
                <TextArea
                  rows={4}
                  value={profile.instructions}
                  onChange={(e) => update((d) => void (d.profiles[index].instructions = e.target.value))}
                />
              </Field>
              <Field
                label="Background notes"
                hint="Quick facts to always keep in mind: who's who, project status, numbers. For longer material, attach files below."
              >
                <TextArea
                  rows={5}
                  value={profile.context}
                  onChange={(e) => update((d) => void (d.profiles[index].context = e.target.value))}
                />
              </Field>
            </Card>

            <ContextFiles profileId={profile.id} docs={docs} onChange={loadDocs} />

            <Card className="space-y-3">
              <div className="flex items-center gap-2">
                <BrainCircuit size={16} className="text-lime-400" />
                <h3 className="text-[14px] font-semibold">Meeting memory</h3>
              </div>
              <Toggle
                checked={profile.memory_enabled}
                onChange={(v) => update((d) => void (d.profiles[index].memory_enabled = v))}
                label="Remember past meetings"
                description="When a session ends (New session, or next launch), Fluke writes short notes: decisions, action items, open questions. Later meetings in this profile get those notes as context."
              />
              <Field label="Meetings to remember" className="max-w-56">
                <Select
                  disabled={!profile.memory_enabled}
                  value={profile.memory_count}
                  onChange={(e) => update((d) => void (d.profiles[index].memory_count = Number(e.target.value)))}
                >
                  {[1, 3, 5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      Last {n} meeting{n > 1 ? "s" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-[12px] text-ink-400">
                Review, edit or regenerate any meeting's notes in History. Notes stay on this computer.
              </p>
            </Card>

            <p className="text-[11.5px] text-ink-400">
              Context sent with each answer: ~
              {tokens(profile.instructions.length + profile.context.length + docChars).toLocaleString()} tokens
              {profile.memory_enabled && " + meeting notes"}. Anthropic requests cache this part, so follow-up
              questions reuse it cheaply.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function ContextFiles({
  profileId,
  docs,
  onChange,
}: {
  profileId: string;
  docs: ContextDoc[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [types, setTypes] = useState("");
  useEffect(() => {
    api.contextFileTypes().then(setTypes).catch(() => {});
  }, []);

  const addFiles = async () => {
    const picked = await open({ multiple: true, directory: false, filters: FILE_FILTERS });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await api.addContextFiles(profileId, paths);
      setErrors(res.errors);
    } catch (e) {
      setErrors([errorText(e)]);
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const reload = async (id: number) => {
    try {
      await api.reloadContextDoc(id);
      setErrors([]);
    } catch (e) {
      setErrors([errorText(e)]);
    }
    onChange();
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-lime-400" />
        <h3 className="flex-1 text-[14px] font-semibold">Context files</h3>
        <Button onClick={addFiles} disabled={busy}>
          <FilePlus2 size={14} /> {busy ? "Reading…" : "Add files"}
        </Button>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-400">
        Agendas, running notes, specs, a resume, last quarter's numbers. Text is extracted on this computer.
        Files stay linked: edit your notes file and Fluke uses the new version on the next answer.
        {types && <> Supported: {types}.</>}
      </p>

      {docs.length > 0 && (
        <div className="divide-y divide-white/5 rounded-lg border border-white/6">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2">
              <FileText size={14} className="shrink-0 text-ink-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink-100">{d.name}</div>
                <div className="truncate text-[11px] text-ink-400" title={d.path}>
                  ~{tokens(d.chars).toLocaleString()} tokens · {d.path}
                </div>
              </div>
              <button
                onClick={() => reload(d.id)}
                className="rounded-md p-1.5 text-ink-400 hover:bg-white/8 hover:text-ink-100"
                title="Re-read file now"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => api.removeContextDoc(d.id).then(onChange)}
                className="rounded-md p-1.5 text-ink-400 hover:bg-rose-400/12 hover:text-rose-400"
                title="Remove from profile"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {errors.map((e) => (
        <p key={e} className="selectable text-[12px] text-rose-400">
          {e}
        </p>
      ))}
    </Card>
  );
}
