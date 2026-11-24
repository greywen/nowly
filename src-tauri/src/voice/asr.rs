//! Speech to text. The session only sees `Transcriber`, so a cloud engine can
//! be added later without touching capture or the Bar.
use super::capture::SAMPLE_RATE;
use std::path::Path;

pub trait Transcriber: Send + Sync {
    /// `samples` is 16 kHz mono f32 in -1..1.
    fn transcribe(&self, samples: &[f32]) -> Result<String, String>;
}

/// Recognition language. SenseVoice detects zh/en itself under `Auto`; a fixed
/// language only helps when one speaker always uses it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    #[default]
    Auto,
    Zh,
    En,
}

impl Language {
    fn code(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Zh => "zh",
            Self::En => "en",
        }
    }
}

pub struct SenseVoice {
    recognizer: sherpa_onnx::OfflineRecognizer,
}

impl SenseVoice {
    /// Loads the model from a directory holding `model.int8.onnx` and
    /// `tokens.txt`. This takes about a second and a few hundred MB, so the
    /// session keeps one instance and drops it when idle.
    pub fn load(dir: &Path, language: Language) -> Result<Self, String> {
        let model = dir.join(super::model::MODEL_FILE);
        let tokens = dir.join(super::model::TOKENS_FILE);
        if !model.is_file() || !tokens.is_file() {
            return Err("语音模型尚未下载。".into());
        }
        let mut config = sherpa_onnx::OfflineRecognizerConfig::default();
        config.model_config.sense_voice = sherpa_onnx::OfflineSenseVoiceModelConfig {
            model: Some(model.to_string_lossy().into_owned()),
            language: Some(language.code().into()),
            use_itn: true,
        };
        config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
        config.model_config.num_threads = threads();
        config.model_config.provider = Some("cpu".into());
        sherpa_onnx::OfflineRecognizer::create(&config)
            .map(|recognizer| Self { recognizer })
            .ok_or_else(|| "语音模型加载失败，请在设置中重新下载。".into())
    }
}

fn threads() -> i32 {
    // Leave cores for the app the user is typing in; decoding a few seconds of
    // speech is fast either way.
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(1, 4) as i32)
        .unwrap_or(2)
}

impl Transcriber for SenseVoice {
    fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        if samples.is_empty() {
            return Ok(String::new());
        }
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, samples);
        self.recognizer.decode(&stream);
        let result = stream.get_result().ok_or("语音识别没有返回结果。")?;
        Ok(clean(&result.text))
    }
}

/// SenseVoice can leave `<|..|>` tags and stray spacing around CJK text.
pub(crate) fn clean(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<|") {
        out.push_str(&rest[..start]);
        match rest[start..].find("|>") {
            Some(end) => rest = &rest[start + end + 2..],
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_strips_tags_and_spacing() {
        assert_eq!(clean("<|zh|><|NEUTRAL|><|Speech|><|withitn|>今天下午三点开会。"), "今天下午三点开会。");
        assert_eq!(clean("  hello   world <|en|"), "hello world");
        assert_eq!(clean(""), "");
    }

    /// Run manually after downloading the model:
    /// `NOWLY_SENSEVOICE_DIR=<dir> NOWLY_SENSEVOICE_WAV=<16k mono wav> cargo test -- --ignored sensevoice`
    #[test]
    #[ignore]
    fn sensevoice_transcribes_a_wav() {
        let dir = std::env::var("NOWLY_SENSEVOICE_DIR").expect("NOWLY_SENSEVOICE_DIR");
        let wav = std::env::var("NOWLY_SENSEVOICE_WAV").expect("NOWLY_SENSEVOICE_WAV");
        let wave = sherpa_onnx::Wave::read(&wav).expect("read wav");
        assert_eq!(wave.sample_rate(), SAMPLE_RATE as i32);
        let engine = SenseVoice::load(Path::new(&dir), Language::Auto).unwrap();
        let text = engine.transcribe(wave.samples()).unwrap();
        println!("{text}");
        assert!(!text.is_empty());
    }
}
