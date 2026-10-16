import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import clsx from "clsx";

export function SectionHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[17px] font-semibold tracking-tight text-ink-100">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-400">{description}</p>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-xl border border-white/7 bg-ink-900 p-4", className)}>{children}</div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-ink-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-ink-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/8 bg-ink-850 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 outline-none transition focus:border-lime-400/50 focus:bg-ink-800 disabled:opacity-50";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputCls, "resize-y leading-relaxed", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, "appearance-auto pr-8", props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg py-2 text-left"
    >
      <span
        className={clsx(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition",
          checked ? "bg-lime-400" : "bg-ink-700",
        )}
      >
        <span
          className={clsx(
            "h-4 w-4 rounded-full bg-white shadow transition",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-ink-100">{label}</span>
        {description && <span className="block text-[12px] leading-snug text-ink-400">{description}</span>}
      </span>
    </button>
  );
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-lime-400 text-ink-950 hover:bg-lime-500",
        variant === "secondary" && "bg-white/7 text-ink-100 hover:bg-white/11",
        variant === "danger" && "bg-rose-400/12 text-rose-400 hover:bg-rose-400/20",
        variant === "ghost" && "text-ink-300 hover:bg-white/7 hover:text-ink-100",
        className,
      )}
    />
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "ok" && "bg-lime-400/12 text-lime-400",
        tone === "warn" && "bg-amber-300/12 text-amber-300",
        tone === "muted" && "bg-white/6 text-ink-300",
      )}
    >
      {children}
    </span>
  );
}
