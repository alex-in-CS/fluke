/** Five-bar VU meter. `level` is 0..1. */
export function LevelMeter({ level, color, label }: { level: number; color: string; label: string }) {
  const bars = 5;
  const lit = Math.round(level * bars);
  return (
    <span className="flex items-end gap-[2px]" title={label} aria-label={`${label} level`}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full transition-[height,opacity] duration-75"
          style={{
            height: 4 + i * 2.5,
            background: color,
            opacity: i < lit ? 1 : 0.18,
          }}
        />
      ))}
    </span>
  );
}
