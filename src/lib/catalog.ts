// What the setup flow shows for each built-in provider, and how Fluke picks a model
// automatically so nobody has to know model ids.

export type Role = "llm" | "stt";

export interface CatalogEntry {
  id: string;
  name: string;
  /** One short line under the name. */
  tagline: string;
  /** Where to get a key (or the app, for local providers). */
  url?: string;
  urlLabel?: string;
}

export const LLM_FEATURED: CatalogEntry[] = [
  { id: "gemini", name: "Gemini", tagline: "Google · free tier", url: "https://aistudio.google.com/apikey" },
  { id: "anthropic", name: "Claude", tagline: "Anthropic · sharpest answers", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "GPT", tagline: "OpenAI · pay as you go", url: "https://platform.openai.com/api-keys" },
];

export const LLM_MORE: CatalogEntry[] = [
  { id: "groq", name: "Groq", tagline: "Free tier · very fast", url: "https://console.groq.com/keys" },
  { id: "openrouter", name: "OpenRouter", tagline: "Hundreds of models, one key", url: "https://openrouter.ai/keys" },
  { id: "deepseek", name: "DeepSeek", tagline: "Low cost", url: "https://platform.deepseek.com/api_keys" },
  { id: "xai", name: "Grok", tagline: "xAI", url: "https://console.x.ai" },
  { id: "mistral", name: "Mistral", tagline: "Mistral AI", url: "https://console.mistral.ai/api-keys" },
  { id: "ollama", name: "Ollama", tagline: "Runs on this PC", url: "https://ollama.com/download", urlLabel: "Get Ollama" },
  { id: "lmstudio", name: "LM Studio", tagline: "Runs on this PC", url: "https://lmstudio.ai", urlLabel: "Get LM Studio" },
];

export const STT_FEATURED: CatalogEntry[] = [
  { id: "deepgram", name: "Deepgram", tagline: "Live, word by word · free credit", url: "https://console.deepgram.com/signup" },
  { id: "groq", name: "Groq Whisper", tagline: "Free tier · per sentence", url: "https://console.groq.com/keys" },
  { id: "openai", name: "OpenAI", tagline: "Per sentence · pay as you go", url: "https://platform.openai.com/api-keys" },
];

export const STT_MORE: CatalogEntry[] = [
  {
    id: "whisper_local",
    name: "Whisper on this PC",
    tagline: "Offline · needs a local Whisper server",
    url: "https://github.com/speaches-ai/speaches",
    urlLabel: "Set up speaches",
  },
];

export const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["multi", "Auto-detect"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["ru", "Russian"],
];

export function catalogEntry(role: Role, id: string): CatalogEntry | undefined {
  const all = role === "llm" ? [...LLM_FEATURED, ...LLM_MORE] : [...STT_FEATURED, ...STT_MORE];
  return all.find((e) => e.id === id);
}

/** Model ids that can't hold a conversation (speech, images, embeddings, moderation...). */
const NOT_CHAT =
  /(embed|whisper|transcri|tts|speech|audio|realtime|image|dall-e|imagen|veo|lyria|moderation|guard|search|computer-use|instruct|davinci|babbage|aqa|learnlm|gemma|native|live|robotics|tool-use|-vision)/i;

const version = (m: string) => {
  const v = m.match(/(\d+(?:\.\d+)?)/);
  return v ? parseFloat(v[1]) : 0;
};

const best = <T,>(items: T[], score: (t: T) => number): T | undefined =>
  items.reduce<T | undefined>((top, x) => (top === undefined || score(x) > score(top) ? x : top), undefined);

/** Pick a fast, capable answering model from what the provider offers. */
export function pickLlmModel(providerId: string, models: string[], suggested: string[]): string {
  const chat = models.filter((m) => !NOT_CHAT.test(m));
  const fromSuggested = suggested.find((s) => !/whisper|transcri/i.test(s) && (models.length === 0 || models.includes(s)));
  switch (providerId) {
    case "anthropic":
      return fromSuggested ?? best(chat.filter((m) => /sonnet|opus/.test(m)), version) ?? chat[0] ?? "";
    case "gemini": {
      if (chat.includes("gemini-flash-latest")) return "gemini-flash-latest";
      const flash = chat.filter((m) => /^gemini-[\d.]+-flash/.test(m) && !/lite|8b|exp|thinking/.test(m));
      const stable = flash.filter((m) => !/preview/.test(m));
      return best(stable.length ? stable : flash, version) ?? chat.find((m) => m.startsWith("gemini")) ?? "";
    }
    case "openai": {
      const gpt = chat.filter((m) => /^gpt-\d/.test(m) && !/nano|audio|codex|chat-latest|\d{4}-\d{2}-\d{2}/.test(m));
      const mini = gpt.filter((m) => /-mini$/.test(m));
      return best(mini.length ? mini : gpt, version) ?? chat[0] ?? "";
    }
    case "groq":
      return (
        ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"].find((m) => chat.includes(m)) ??
        chat[0] ??
        ""
      );
    default:
      return fromSuggested ?? chat[0] ?? "";
  }
}

/** Pick the transcription model for a speech-to-text provider. */
export function pickSttModel(providerId: string, models: string[], suggested: string[]): string {
  const prefer: Record<string, string[]> = {
    deepgram: ["nova-3", "nova-2"],
    groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
    openai: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  };
  const wanted = [...(prefer[providerId] ?? []), ...suggested];
  return (
    wanted.find((m) => models.length === 0 || models.includes(m)) ??
    models.find((m) => /whisper|transcri/i.test(m)) ??
    models[0] ??
    ""
  );
}
