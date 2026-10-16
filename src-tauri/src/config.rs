//! User settings: providers, model choices, profiles, behaviour and hotkeys.
//! Persisted as JSON in the app config dir. API keys are NOT stored here (see `secrets`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    /// Any `/chat/completions` + `/models` (+ optional `/audio/transcriptions`) API:
    /// OpenAI, Groq, OpenRouter, DeepSeek, xAI, Mistral, Ollama, LM Studio, vLLM, ...
    OpenaiCompat,
    Anthropic,
    Gemini,
    /// Speech-to-text only (streaming websocket).
    Deepgram,
}

impl ProviderKind {
    pub fn supports_stt(self) -> bool {
        matches!(self, ProviderKind::Deepgram | ProviderKind::OpenaiCompat)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderConfig {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub base_url: String,
    /// Local servers (Ollama, LM Studio) work without a key.
    pub needs_key: bool,
    /// Built-in preset (can be edited, not deleted).
    pub preset: bool,
    /// Extra HTTP headers sent with every request (e.g. OpenRouter's HTTP-Referer).
    pub extra_headers: BTreeMap<String, String>,
    /// JSON object merged into every chat request body (e.g. {"reasoning_effort":"low"}).
    pub extra_body: Option<serde_json::Value>,
    /// Suggested models shown before the live list is fetched.
    pub suggested_models: Vec<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            kind: ProviderKind::OpenaiCompat,
            base_url: String::new(),
            needs_key: true,
            preset: false,
            extra_headers: BTreeMap::new(),
            extra_body: None,
            suggested_models: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ModelRef {
    pub provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SttSettings {
    pub provider_id: String,
    pub model: String,
    /// BCP-47 code ("en", "hi", ...) or "multi" for automatic detection.
    pub language: String,
}

impl Default for SttSettings {
    fn default() -> Self {
        Self {
            provider_id: "deepgram".into(),
            model: "nova-3".into(),
            language: "en".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// How the assistant should behave in this situation.
    pub instructions: String,
    /// Background the assistant can draw on: resume, product notes, pricing, FAQs...
    /// Attached files are stored separately (see `context.rs`).
    pub context: String,
    /// Summarize finished meetings and feed recent summaries back in.
    pub memory_enabled: bool,
    /// How many past meeting summaries to include.
    pub memory_count: u32,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            instructions: String::new(),
            context: String::new(),
            memory_enabled: true,
            memory_count: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Behavior {
    /// Answer automatically when the other side asks a question.
    pub auto_answer: bool,
    /// Attach a screenshot when asking via the hotkey / Ask button.
    pub screen_on_ask: bool,
    /// Exclude Fluke's windows from screen sharing and recordings.
    pub hide_from_capture: bool,
    pub capture_mic: bool,
    pub capture_system: bool,
    /// Device names; None = system default.
    pub mic_device: Option<String>,
    pub output_device: Option<String>,
    /// How much of the transcript goes into each request.
    pub transcript_window_secs: u32,
    /// Anthropic `output_config.effort` ("low" | "medium" | "high" | ...). None = model default.
    pub anthropic_effort: Option<String>,
    pub max_output_tokens: u32,
    /// Overlay background opacity, 0.3–1.0.
    pub opacity: f32,
}

impl Default for Behavior {
    fn default() -> Self {
        Self {
            auto_answer: true,
            screen_on_ask: true,
            hide_from_capture: true,
            capture_mic: true,
            capture_system: true,
            mic_device: None,
            output_device: None,
            transcript_window_secs: 600,
            anthropic_effort: Some("low".into()),
            max_output_tokens: 16000,
            opacity: 0.88,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Hotkeys {
    pub toggle_overlay: String,
    pub ask: String,
    pub toggle_listen: String,
    pub focus_input: String,
    pub click_through: String,
    pub move_up: String,
    pub move_down: String,
    pub move_left: String,
    pub move_right: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            toggle_overlay: "CommandOrControl+Shift+Space".into(),
            ask: "CommandOrControl+Shift+Enter".into(),
            toggle_listen: "CommandOrControl+Shift+L".into(),
            focus_input: "CommandOrControl+Shift+K".into(),
            click_through: "CommandOrControl+Shift+X".into(),
            move_up: "CommandOrControl+Shift+Up".into(),
            move_down: "CommandOrControl+Shift+Down".into(),
            move_left: "CommandOrControl+Shift+Left".into(),
            move_right: "CommandOrControl+Shift+Right".into(),
        }
    }
}

impl Hotkeys {
    pub fn entries(&self) -> Vec<(&'static str, &str)> {
        vec![
            ("toggle_overlay", self.toggle_overlay.as_str()),
            ("ask", self.ask.as_str()),
            ("toggle_listen", self.toggle_listen.as_str()),
            ("focus_input", self.focus_input.as_str()),
            ("click_through", self.click_through.as_str()),
            ("move_up", self.move_up.as_str()),
            ("move_down", self.move_down.as_str()),
            ("move_left", self.move_left.as_str()),
            ("move_right", self.move_right.as_str()),
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub onboarded: bool,
    pub providers: Vec<ProviderConfig>,
    pub llm: ModelRef,
    pub stt: SttSettings,
    pub profiles: Vec<Profile>,
    pub active_profile: String,
    pub behavior: Behavior,
    pub hotkeys: Hotkeys,
}

impl Default for Settings {
    fn default() -> Self {
        let profiles = default_profiles();
        Self {
            version: SETTINGS_VERSION,
            onboarded: false,
            providers: preset_providers(),
            llm: ModelRef {
                provider_id: "anthropic".into(),
                model: "claude-opus-5-5".into(),
            },
            stt: SttSettings::default(),
            active_profile: profiles[0].id.clone(),
            profiles,
            behavior: Behavior::default(),
            hotkeys: Hotkeys::default(),
        }
    }
}

impl Settings {
    pub fn provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.id == id)
    }

    pub fn active_profile(&self) -> Option<&Profile> {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile)
            .or_else(|| self.profiles.first())
    }

    /// Bring settings saved by an older build up to date: add new presets, fix invalid values.
    fn normalize(&mut self) {
        for preset in preset_providers() {
            match self.providers.iter_mut().find(|p| p.id == preset.id) {
                Some(existing) => existing.preset = true,
                None => self.providers.push(preset),
            }
        }
        if self.profiles.is_empty() {
            self.profiles = default_profiles();
        }
        if self
            .active_profile()
            .is_some_and(|p| p.id != self.active_profile)
        {
            self.active_profile = self.profiles[0].id.clone();
        }
        for p in &mut self.profiles {
            p.memory_count = p.memory_count.clamp(1, 50);
        }
        self.behavior.opacity = self.behavior.opacity.clamp(0.3, 1.0);
        self.behavior.transcript_window_secs = self.behavior.transcript_window_secs.clamp(30, 7200);
        self.behavior.max_output_tokens = self.behavior.max_output_tokens.clamp(256, 128_000);
        self.version = SETTINGS_VERSION;
    }

    pub fn load(path: &Path) -> Self {
        let mut settings = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| match serde_json::from_str::<Settings>(&s) {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!("settings file unreadable, using defaults: {e}");
                    None
                }
            })
            .unwrap_or_default();
        settings.normalize();
        settings
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write-then-rename so a crash mid-write never corrupts the file.
        let tmp: PathBuf = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn sanitized(mut self) -> Self {
        self.normalize();
        self
    }
}

fn preset(
    id: &str,
    label: &str,
    kind: ProviderKind,
    base_url: &str,
    needs_key: bool,
    models: &[&str],
) -> ProviderConfig {
    ProviderConfig {
        id: id.into(),
        label: label.into(),
        kind,
        base_url: base_url.into(),
        needs_key,
        preset: true,
        suggested_models: models.iter().map(|m| (*m).to_owned()).collect(),
        ..Default::default()
    }
}

pub fn preset_providers() -> Vec<ProviderConfig> {
    use ProviderKind::*;
    vec![
        preset(
            "anthropic",
            "Anthropic",
            Anthropic,
            "https://api.anthropic.com",
            true,
            &["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        ),
        preset(
            "openai",
            "OpenAI",
            OpenaiCompat,
            "https://api.openai.com/v1",
            true,
            &[],
        ),
        preset(
            "gemini",
            "Google Gemini",
            Gemini,
            "https://generativelanguage.googleapis.com",
            true,
            &[],
        ),
        preset(
            "groq",
            "Groq",
            OpenaiCompat,
            "https://api.groq.com/openai/v1",
            true,
            &["whisper-large-v3-turbo"],
        ),
        preset(
            "openrouter",
            "OpenRouter",
            OpenaiCompat,
            "https://openrouter.ai/api/v1",
            true,
            &[],
        ),
        preset(
            "deepseek",
            "DeepSeek",
            OpenaiCompat,
            "https://api.deepseek.com/v1",
            true,
            &[],
        ),
        preset("xai", "xAI", OpenaiCompat, "https://api.x.ai/v1", true, &[]),
        preset(
            "mistral",
            "Mistral",
            OpenaiCompat,
            "https://api.mistral.ai/v1",
            true,
            &[],
        ),
        preset(
            "ollama",
            "Ollama (local)",
            OpenaiCompat,
            "http://localhost:11434/v1",
            false,
            &[],
        ),
        preset(
            "lmstudio",
            "LM Studio (local)",
            OpenaiCompat,
            "http://localhost:1234/v1",
            false,
            &[],
        ),
        // Any OpenAI-compatible Whisper server works; speaches (faster-whisper) listens on 8000.
        preset(
            "whisper_local",
            "Local Whisper (speech-to-text)",
            OpenaiCompat,
            "http://localhost:8000/v1",
            false,
            &[
                "Systran/faster-whisper-small",
                "Systran/faster-distil-whisper-large-v3",
            ],
        ),
        preset(
            "deepgram",
            "Deepgram (speech-to-text)",
            Deepgram,
            "https://api.deepgram.com",
            true,
            &["nova-3", "nova-2"],
        ),
    ]
}

fn default_profiles() -> Vec<Profile> {
    vec![
        Profile {
            id: "general".into(),
            name: "General".into(),
            ..Default::default()
        },
        Profile {
            id: "sales".into(),
            name: "Sales call".into(),
            instructions: "I'm on a sales call. Help me answer objections with specifics, \
                           suggest the next discovery question, and keep me moving toward a next step."
                .into(),
            ..Default::default()
        },
        Profile {
            id: "meeting".into(),
            name: "Meeting".into(),
            instructions: "I'm in a work meeting. When asked something, give me a crisp answer \
                           I can say. Flag decisions and action items when you see them."
                .into(),
            ..Default::default()
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_ids_are_unique() {
        let presets = preset_providers();
        let mut ids: Vec<_> = presets.iter().map(|p| p.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), presets.len());
    }

    #[test]
    fn old_settings_gain_new_presets() {
        let mut s = Settings::default();
        s.providers.retain(|p| p.id != "whisper_local");
        s.behavior.opacity = 5.0;
        s.normalize();
        let local = s.provider("whisper_local").expect("preset added back");
        assert!(!local.needs_key);
        assert_eq!(s.behavior.opacity, 1.0);
    }
}
