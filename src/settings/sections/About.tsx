import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { Card, SectionHeader } from "../ui";

export function AboutSection() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const items: [string, string][] = [
    ["Your keys", "Stored in the OS credential store and read only by Fluke's native core. The UI never receives them."],
    ["Your audio", "Streamed only to the speech-to-text provider you picked, while listening is on. Never recorded to disk."],
    ["Your screen", "Captured only when you ask with a screenshot, and sent only to your chosen model."],
    ["Your history", "Transcripts and answers live in a local SQLite file. Delete any session, or all of them, from History."],
    ["Telemetry", "None. Fluke has no servers and makes no calls except to the providers you configure."],
  ];

  return (
    <>
      <SectionHeader title="Privacy & about" description={`Fluke ${version}: an open-source real-time copilot for calls and meetings.`} />
      <Card className="divide-y divide-white/5 p-0">
        {items.map(([title, text]) => (
          <div key={title} className="flex gap-4 px-4 py-3">
            <span className="w-28 shrink-0 text-[13px] font-medium text-ink-100">{title}</span>
            <span className="text-[13px] leading-relaxed text-ink-300">{text}</span>
          </div>
        ))}
      </Card>
      <p className="mt-5 text-[12.5px] leading-relaxed text-ink-400">
        Use Fluke where you're allowed to. Many exams, interviews and workplaces have rules about assistive
        tools and recording; tell people when you're transcribing a conversation if the law where you are
        requires consent.
      </p>
    </>
  );
}
