// Turns raw errors from the Rust core into one clear sentence plus where to fix it.

export type FixTarget = "setup" | "audio" | null;

export interface Friendly {
  message: string;
  fix: FixTarget;
  /** The original text, for a tooltip. */
  raw: string;
}

/** "Deepgram (speech-to-text)" → "Deepgram", "Ollama (local)" → "Ollama". */
const shortName = (label: string) => label.replace(/\s*\(.*\)\s*$/, "").trim();

export function friendlyError(raw: string): Friendly {
  const r = raw.trim();
  const make = (message: string, fix: FixTarget = null): Friendly => ({ message, fix, raw: r });

  const missing = r.match(/no API key saved for provider '([^']+)'/i);
  if (missing) return make("Add an API key to continue.", "setup");

  const http = r.match(/^(.+?) returned HTTP (\d{3}): ([\s\S]*)$/);
  if (http) {
    const who = shortName(http[1]);
    const status = Number(http[2]);
    const detail = http[3];
    if (/credit|balance|quota|billing|insufficient|payment/i.test(detail) || status === 402)
      return make(`${who} says the account is out of credit. Top it up or switch provider.`, "setup");
    if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|invalid.*key|permission/i.test(detail))
      return make(`${who} didn't accept the API key. Paste a fresh one.`, "setup");
    if (status === 429) return make(`${who} is rate-limiting requests. Give it a few seconds.`);
    if (status === 404 || /model.*(not found|does not exist|not supported)/i.test(detail))
      return make(`${who} doesn't offer that model. Pick another one.`, "setup");
    if (status >= 500 || /overloaded/i.test(detail)) return make(`${who} is having trouble right now. Try again shortly.`);
    return make(`${who}: ${detail}`);
  }

  if (/^network error/i.test(r)) {
    if (/localhost|127\.0\.0\.1/i.test(r)) return make("The local server isn't running. Start it and try again.", "setup");
    return make("Couldn't reach the provider. Check your internet connection.");
  }
  if (/no microphone found/i.test(r)) return make("No microphone found. Plug one in or choose another.", "audio");
  if (/no audio output device/i.test(r)) return make("No speakers or headphones found for system audio.", "audio");
  if (/^audio error/i.test(r)) return make(r.replace(/^audio error:\s*/i, "Audio problem: "), "audio");
  if (/^keychain error/i.test(r)) return make("Windows Credential Manager couldn't store the key.", "setup");
  if (/^screen capture error/i.test(r)) return make("Couldn't capture the screen.");
  return make(r);
}
