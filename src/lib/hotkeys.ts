const isMac = navigator.userAgent.includes("Mac");

const SYMBOLS: Record<string, string> = isMac
  ? {
      commandorcontrol: "⌘",
      cmdorctrl: "⌘",
      command: "⌘",
      cmd: "⌘",
      super: "⌘",
      control: "⌃",
      ctrl: "⌃",
      shift: "⇧",
      alt: "⌥",
      option: "⌥",
      enter: "↵",
      return: "↵",
      space: "Space",
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
    }
  : {
      commandorcontrol: "Ctrl",
      cmdorctrl: "Ctrl",
      control: "Ctrl",
      ctrl: "Ctrl",
      super: "Win",
      shift: "Shift",
      alt: "Alt",
      enter: "Enter",
      return: "Enter",
      space: "Space",
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
    };

/** "CommandOrControl+Shift+Enter" → ["Ctrl", "Shift", "Enter"] (or ⌘ ⇧ ↵ on macOS). */
export function keyParts(accelerator: string): string[] {
  return accelerator
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => SYMBOLS[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p));
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Build an accelerator string from a keydown event, or null if only modifiers are held. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null; // global hotkeys need a modifier

  let key = e.code;
  if (key.startsWith("Key")) key = key.slice(3);
  else if (key.startsWith("Digit")) key = key.slice(5);
  else if (key.startsWith("Arrow")) key = key.slice(5);
  else if (key === "Space") key = "Space";
  parts.push(key);
  return parts.join("+");
}
