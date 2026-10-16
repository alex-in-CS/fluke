import { keyParts } from "../lib/hotkeys";

export function Kbd({ accel, className = "" }: { accel: string; className?: string }) {
  if (!accel) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {keyParts(accel).map((k, i) => (
        <kbd
          key={i}
          className="rounded border border-white/10 bg-white/5 px-1 py-px text-[10px] leading-none font-medium text-ink-300"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
