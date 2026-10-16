import { useEffect, useState } from "react";
import { BrainCircuit, ClipboardCopy, FileDown, Pencil, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";

import { api, errorText, events, subscribeAll } from "../../lib/api";
import type { SessionDetail, SessionSummary } from "../../lib/types";
import { Markdown } from "../../components/Markdown";
import { Button, Card, SectionHeader, TextArea } from "../ui";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistorySection() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = () => api.listSessions().then(setSessions).catch((e) => setNote(errorText(e)));
  const reloadDetail = (id: string) =>
    api.getSession(id).then(setDetail).catch((e) => setNote(errorText(e)));
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    setDetail(null);
    setNote(null);
    if (selected) reloadDetail(selected);
  }, [selected]);
  // Notes written in the background (after "New session") show up live.
  useEffect(
    () =>
      subscribeAll([
        events.history((id) => {
          refresh();
          if (id === selected) reloadDetail(id);
        }),
      ]),
    [selected],
  );

  const copyMd = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(await api.sessionMarkdown(selected));
    setNote("Copied as Markdown.");
  };
  const exportMd = async () => {
    if (!selected) return;
    try {
      setNote(`Saved to ${await api.exportSession(selected)}`);
    } catch (e) {
      setNote(errorText(e));
    }
  };
  const remove = async () => {
    if (!selected) return;
    await api.deleteSession(selected);
    setSelected(null);
    refresh();
  };
  const removeAll = async () => {
    await api.deleteAllSessions();
    setConfirmAll(false);
    setSelected(null);
    refresh();
  };

  // Interleave transcript lines and answers by time.
  const timeline = detail
    ? [
        ...detail.segments.map((s) => ({ t: s.ts, seg: s, ans: null })),
        ...detail.answers.map((a) => ({ t: a.created_at, seg: null, ans: a })),
      ].sort((a, b) => a.t - b.t)
    : [];

  return (
    <>
      <SectionHeader
        title="History"
        description="Every session's transcript and answers are kept in a local SQLite database on this computer. Nothing is uploaded anywhere except the requests you make to your own providers."
      />
      <div className="flex gap-5">
        <div className="w-64 shrink-0">
          <div className="max-h-[calc(100vh-240px)] space-y-1 overflow-y-auto pr-1">
            {sessions?.length === 0 && <p className="text-[12.5px] text-ink-400">No sessions yet.</p>}
            {sessions?.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={clsx(
                  "block w-full rounded-lg px-3 py-2 text-left transition",
                  selected === s.id ? "bg-white/8" : "hover:bg-white/5",
                )}
              >
                <span className="block truncate text-[13px] text-ink-100">{s.title || "Untitled session"}</span>
                <span className="text-[11.5px] text-ink-400">
                  {fmt(s.started_at)} · {s.answer_count} answers
                </span>
              </button>
            ))}
          </div>
          {!!sessions?.length &&
            (confirmAll ? (
              <div className="mt-3 flex gap-2">
                <Button variant="danger" onClick={removeAll}>
                  Delete everything
                </Button>
                <Button variant="ghost" onClick={() => setConfirmAll(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="mt-3" onClick={() => setConfirmAll(true)}>
                <Trash2 size={13} /> Delete all history
              </Button>
            ))}
        </div>

        <div className="min-w-0 flex-1">
          {!selected && <p className="pt-2 text-[13px] text-ink-400">Select a session to view it.</p>}
          {detail && (
            <Card className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {detail.session.title || "Untitled session"}
                  </div>
                  <div className="text-[12px] text-ink-400">{fmt(detail.session.started_at)}</div>
                </div>
                <Button onClick={copyMd} title="Copy as Markdown">
                  <ClipboardCopy size={13} />
                </Button>
                <Button onClick={exportMd} title="Save to Documents/Fluke">
                  <FileDown size={13} />
                </Button>
                <Button variant="danger" onClick={remove} title="Delete session">
                  <Trash2 size={13} />
                </Button>
              </div>
              {note && <p className="selectable text-[12px] text-lime-400">{note}</p>}
              <MeetingNotes
                key={detail.session.id}
                sessionId={detail.session.id}
                summary={detail.session.summary}
                onSaved={() => {
                  reloadDetail(detail.session.id);
                  refresh();
                }}
              />
              <div className="max-h-[calc(100vh-300px)] space-y-2 overflow-y-auto pr-1">
                {timeline.map((item, i) =>
                  item.seg ? (
                    <div key={`s${i}`} className="flex gap-2 text-[12.5px] leading-relaxed">
                      <span
                        className={clsx(
                          "w-10 shrink-0 pt-px text-right text-[10.5px] font-semibold uppercase",
                          item.seg.speaker === "me" ? "text-lime-400" : "text-sky-300",
                        )}
                      >
                        {item.seg.speaker === "me" ? "You" : "Them"}
                      </span>
                      <span className="selectable text-ink-200">{item.seg.text}</span>
                    </div>
                  ) : item.ans ? (
                    <div key={`a${i}`} className="rounded-lg border border-lime-400/15 bg-lime-400/4 p-3">
                      <div className="mb-1 text-[11.5px] text-ink-400">
                        <span className="font-medium text-lime-400">Fluke</span> · {item.ans.question}
                      </div>
                      <Markdown text={item.ans.answer} />
                    </div>
                  ) : null,
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** The meeting's notes: what gets remembered for future meetings in the same profile. */
function MeetingNotes({
  sessionId,
  summary,
  onSaved,
}: {
  sessionId: string;
  summary: string | null;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(summary ?? "");

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.summarizeSession(sessionId);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    await api.setSessionSummary(sessionId, text);
    setEditing(false);
    onSaved();
  };

  return (
    <div className="rounded-lg border border-white/7 bg-ink-850 p-3">
      <div className="mb-2 flex items-center gap-2">
        <BrainCircuit size={14} className="text-lime-400" />
        <span className="flex-1 text-[12.5px] font-semibold">Meeting notes (memory)</span>
        {summary && !editing && (
          <Button variant="ghost" onClick={() => (setText(summary), setEditing(true))} title="Edit notes">
            <Pencil size={12} />
          </Button>
        )}
        <Button variant="ghost" onClick={generate} disabled={busy} title={summary ? "Regenerate" : "Summarize"}>
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          {summary ? "" : busy ? "Writing…" : "Summarize"}
        </Button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <TextArea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save notes
            </Button>
          </div>
        </div>
      ) : summary ? (
        <Markdown text={summary} />
      ) : (
        <p className="text-[12px] text-ink-400">
          No notes yet. They're written automatically when a session ends, or summarize now with your current
          model.
        </p>
      )}
      {error && <p className="selectable mt-2 text-[12px] text-rose-400">{error}</p>}
    </div>
  );
}
