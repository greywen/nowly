//! The SenseVoice model is too large to ship in the installer, so it is
//! downloaded on first use into the app data directory and verified against
//! pinned SHA-256 digests. Either mirror may serve it; the digest decides.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub const MODEL_FILE: &str = "model.int8.onnx";
pub const TOKENS_FILE: &str = "tokens.txt";
const DIR: &str = "sensevoice-int8";
const MARKER: &str = ".verified";

struct Asset {
    name: &'static str,
    size: u64,
    sha256: &'static str,
}

/// sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.
const ASSETS: [Asset; 2] = [
    Asset {
        name: MODEL_FILE,
        size: 239_233_841,
        sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    },
    Asset {
        name: TOKENS_FILE,
        size: 315_894,
        sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    },
];

/// ModelScope first: it is reachable from mainland China without a proxy.
const SOURCES: [&str; 2] = [
    "https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/",
    "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/",
];

/// Hosts a download may be redirected to (Hugging Face serves files from its
/// CDN on `*.hf.co`).
const ALLOWED_HOSTS: [&str; 3] = ["modelscope.cn", "huggingface.co", "hf.co"];

pub fn total_bytes() -> u64 {
    ASSETS.iter().map(|a| a.size).sum()
}

pub fn dir(app_dir: &Path) -> PathBuf {
    app_dir.join("models").join(DIR)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub installed: bool,
    pub total_bytes: u64,
}

/// Installed means a previous download finished verification and the files
/// still have their expected sizes. Hashing 230 MB on every launch would be
/// wasteful, so the full check only happens at download time.
pub fn status(app_dir: &Path) -> ModelStatus {
    let dir = dir(app_dir);
    let installed = dir.join(MARKER).is_file()
        && ASSETS.iter().all(|asset| {
            fs::metadata(dir.join(asset.name)).map(|m| m.len() == asset.size).unwrap_or(false)
        });
    ModelStatus { installed, total_bytes: total_bytes() }
}

pub fn delete(app_dir: &Path) -> Result<(), String> {
    let dir = dir(app_dir);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除语音模型：{error}")),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
    Cancelled,
    Failed(String),
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "下载已取消。"),
            Self::Failed(reason) => write!(f, "{reason}"),
        }
    }
}

/// Downloads every missing or damaged file. `progress(done, total)` is called
/// at most once per MiB. Partial files are removed on any failure.
pub fn download(
    app_dir: &Path,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DownloadError> {
    let dir = dir(app_dir);
    fs::create_dir_all(&dir).map_err(|e| DownloadError::Failed(format!("无法创建模型目录：{e}")))?;
    let _ = fs::remove_file(dir.join(MARKER));
    let client = client().map_err(DownloadError::Failed)?;
    let total = total_bytes();
    let mut done = 0;
    for asset in &ASSETS {
        let path = dir.join(asset.name);
        if verify_file(&path, asset) {
            done += asset.size;
            progress(done, total);
            continue;
        }
        let _ = fs::remove_file(&path);
        let mut last_error = String::new();
        let mut fetched = false;
        for source in SOURCES {
            let url = format!("{source}{}", asset.name);
            match fetch(&client, &url, &path, asset, cancelled, &mut |n| progress(done + n, total)) {
                Ok(()) => {
                    fetched = true;
                    break;
                }
                Err(DownloadError::Cancelled) => return Err(DownloadError::Cancelled),
                Err(DownloadError::Failed(error)) => last_error = error,
            }
        }
        if !fetched {
            return Err(DownloadError::Failed(format!("语音模型下载失败：{last_error}")));
        }
        done += asset.size;
    }
    fs::write(dir.join(MARKER), b"")
        .map_err(|e| DownloadError::Failed(format!("无法写入模型目录：{e}")))?;
    progress(total, total);
    Ok(())
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent("Nowly/1")
        .build()
        .map_err(|e| e.to_string())
}

fn allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            ALLOWED_HOSTS
                .iter()
                .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
        })
}

fn fetch(
    client: &reqwest::blocking::Client,
    url: &str,
    path: &Path,
    asset: &Asset,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<(), DownloadError> {
    let part = path.with_extension("part");
    let result = fetch_to(client, url, &part, asset, cancelled, progress)
        .and_then(|()| fs::rename(&part, path).map_err(|e| DownloadError::Failed(e.to_string())));
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

fn fetch_to(
    client: &reqwest::blocking::Client,
    url: &str,
    part: &Path,
    asset: &Asset,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<(), DownloadError> {
    let failed = |e: &dyn std::fmt::Display| DownloadError::Failed(e.to_string());
    let mut response = client.get(url).send().map_err(|e| failed(&e))?;
    if !response.status().is_success() {
        return Err(DownloadError::Failed(format!("HTTP {}", response.status())));
    }
    let mut file = fs::File::create(part).map_err(|e| failed(&e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];
    let mut received = 0u64;
    let mut reported = 0u64;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(DownloadError::Cancelled);
        }
        let n = response.read(&mut buffer).map_err(|e| failed(&e))?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > asset.size {
            return Err(DownloadError::Failed("文件大小与预期不符。".into()));
        }
        hasher.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|e| failed(&e))?;
        if received - reported >= 1 << 20 {
            reported = received;
            progress(received);
        }
    }
    file.flush().map_err(|e| failed(&e))?;
    drop(file);
    if received != asset.size || hex(&hasher.finalize()) != asset.sha256 {
        return Err(DownloadError::Failed("文件校验失败。".into()));
    }
    progress(received);
    Ok(())
}

fn verify_file(path: &Path, asset: &Asset) -> bool {
    if fs::metadata(path).map(|m| m.len() != asset.size).unwrap_or(true) {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else { return false };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    hex(&hasher.finalize()) == asset.sha256
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nowly-voice-model-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn redirects_stay_on_known_https_hosts() {
        let ok = |u: &str| allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://modelscope.cn/x"));
        assert!(ok("https://cas-bridge.xethub.hf.co/x"));
        assert!(ok("https://cdn-lfs.huggingface.co/x"));
        assert!(!ok("http://huggingface.co/x"));
        assert!(!ok("https://evilhf.co/x"));
        assert!(!ok("https://huggingface.co.evil.com/x"));
    }

    #[test]
    fn status_requires_marker_and_sizes() {
        let app = temp_dir();
        assert!(!status(&app).installed);
        let dir = dir(&app);
        fs::create_dir_all(&dir).unwrap();
        for asset in &ASSETS {
            fs::File::create(dir.join(asset.name)).unwrap().set_len(asset.size).unwrap();
        }
        assert!(!status(&app).installed, "no marker yet");
        fs::write(dir.join(MARKER), b"").unwrap();
        assert!(status(&app).installed);
        delete(&app).unwrap();
        assert!(!status(&app).installed);
        delete(&app).unwrap();
        fs::remove_dir_all(app).unwrap();
    }

    #[test]
    fn verify_rejects_wrong_content() {
        let app = temp_dir();
        let path = app.join("tokens.txt");
        fs::File::create(&path).unwrap().set_len(ASSETS[1].size).unwrap();
        assert!(!verify_file(&path, &ASSETS[1]));
        fs::remove_dir_all(app).unwrap();
    }

    /// Downloads the real model (~230 MB):
    /// `NOWLY_VOICE_APP_DIR=<dir> cargo test -- --ignored downloads_and_verifies`
    #[test]
    #[ignore]
    fn downloads_and_verifies() {
        let app = PathBuf::from(std::env::var("NOWLY_VOICE_APP_DIR").expect("NOWLY_VOICE_APP_DIR"));
        let mut last = 0;
        download(&app, &AtomicBool::new(false), &mut |done, total| {
            assert!(done >= last && done <= total);
            last = done;
        })
        .unwrap();
        assert_eq!(last, total_bytes());
        assert!(status(&app).installed);
    }

    #[test]
    fn hex_matches_known_digest() {
        assert_eq!(
            hex(&Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
