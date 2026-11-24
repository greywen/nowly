//! Microphone capture. Audio lives only in memory, converted to the 16 kHz
//! mono f32 the recogniser expects, and is dropped with the recording.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::JoinHandle;

pub const SAMPLE_RATE: u32 = 16_000;
/// Recording stops growing after this many seconds; the session then ends it.
pub const MAX_SECONDS: u32 = 60;
const MAX_SAMPLES: usize = (SAMPLE_RATE * MAX_SECONDS) as usize;
/// One level frame is 50 ms of output audio.
const LEVEL_FRAME: usize = (SAMPLE_RATE / 20) as usize;
const LEVEL_DECAY: f32 = 0.85;
/// The level meter maps -60..-10 dBFS onto 0..1.
const FLOOR_DB: f32 = -60.0;
const RANGE_DB: f32 = 50.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    NoDevice,
    /// The OS refused access (microphone privacy setting).
    Denied,
    Unavailable(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoDevice => write!(f, "没有可用的麦克风。"),
            Self::Denied => write!(f, "系统拒绝了麦克风访问。"),
            Self::Unavailable(reason) => write!(f, "无法打开麦克风：{reason}"),
        }
    }
}

/// Converts interleaved device frames to 16 kHz mono with linear
/// interpolation. Speech recognition at 16 kHz does not need a better filter;
/// the band above 8 kHz carries little speech energy.
pub(crate) struct Resampler {
    channels: usize,
    step: f64,
    position: f64,
    previous: f32,
}

impl Resampler {
    pub(crate) fn new(input_rate: u32, channels: u16) -> Self {
        Self {
            channels: channels.max(1) as usize,
            step: input_rate as f64 / SAMPLE_RATE as f64,
            position: 0.0,
            previous: 0.0,
        }
    }

    pub(crate) fn push(&mut self, interleaved: &[f32], out: &mut Vec<f32>) {
        for frame in interleaved.chunks(self.channels) {
            let current = frame.iter().sum::<f32>() / frame.len() as f32;
            // `position` is where the next output sample falls, measured in
            // input frames from `previous` (0.0) to `current` (1.0).
            while self.position <= 1.0 {
                let t = self.position as f32;
                out.push(self.previous + (current - self.previous) * t);
                self.position += self.step;
            }
            self.position -= 1.0;
            self.previous = current;
        }
    }
}

/// RMS envelope with instant attack and a fixed per-frame decay, so the bars
/// jump with the voice and settle smoothly in pauses.
pub(crate) struct LevelMeter {
    sum: f32,
    count: usize,
    level: f32,
}

impl LevelMeter {
    pub(crate) fn new() -> Self {
        Self { sum: 0.0, count: 0, level: 0.0 }
    }

    /// Returns the new level each time a full frame completes.
    pub(crate) fn push(&mut self, samples: &[f32]) -> Option<f32> {
        let mut latest = None;
        for sample in samples {
            self.sum += sample * sample;
            self.count += 1;
            if self.count == LEVEL_FRAME {
                let rms = (self.sum / LEVEL_FRAME as f32).sqrt();
                self.level = normalized(rms).max(self.level * LEVEL_DECAY);
                self.sum = 0.0;
                self.count = 0;
                latest = Some(self.level);
            }
        }
        latest
    }
}

fn normalized(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() - FLOOR_DB) / RANGE_DB).clamp(0.0, 1.0)
}

struct Shared {
    samples: Mutex<Vec<f32>>,
    level: AtomicU32,
    full: AtomicBool,
    failed: Mutex<Option<String>>,
}

impl Shared {
    fn append(&self, resampler: &mut Resampler, meter: &mut LevelMeter, data: &[f32]) {
        let mut chunk = Vec::with_capacity(data.len());
        resampler.push(data, &mut chunk);
        if let Some(level) = meter.push(&chunk) {
            self.level.store(level.to_bits(), Ordering::Relaxed);
        }
        let Ok(mut samples) = self.samples.lock() else { return };
        let room = MAX_SAMPLES.saturating_sub(samples.len());
        samples.extend_from_slice(&chunk[..chunk.len().min(room)]);
        if samples.len() >= MAX_SAMPLES {
            self.full.store(true, Ordering::Relaxed);
        }
    }
}

/// A live recording. The cpal stream is not `Send` on every backend, so it is
/// owned by a dedicated thread that ends when the recording is stopped or
/// dropped.
pub struct Recording {
    shared: Arc<Shared>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Recording {
    /// Opens the named input device, or the system default when `device` is
    /// empty or no longer present.
    pub fn start(device: Option<&str>) -> Result<Self, CaptureError> {
        let shared = Arc::new(Shared {
            samples: Mutex::new(Vec::with_capacity(SAMPLE_RATE as usize * 8)),
            level: AtomicU32::new(0),
            full: AtomicBool::new(false),
            failed: Mutex::new(None),
        });
        let (ready_tx, ready_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let thread_shared = shared.clone();
        let device = device.map(str::to_owned);
        let thread = std::thread::Builder::new()
            .name("voice-capture".into())
            .spawn(move || {
                let stream = match open_stream(device.as_deref(), thread_shared) {
                    Ok(stream) => stream,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                // Blocks until stop() sends or the Recording is dropped.
                let _ = stop_rx.recv();
                drop(stream);
            })
            .map_err(|error| CaptureError::Unavailable(error.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { shared, stop: Some(stop_tx), thread: Some(thread) }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => Err(CaptureError::Unavailable("录音线程意外退出。".into())),
        }
    }

    pub fn level(&self) -> f32 {
        f32::from_bits(self.shared.level.load(Ordering::Relaxed))
    }

    pub fn is_full(&self) -> bool {
        self.shared.full.load(Ordering::Relaxed)
    }

    pub fn duration_ms(&self) -> u64 {
        let len = self.shared.samples.lock().map(|s| s.len()).unwrap_or(0);
        len as u64 * 1000 / SAMPLE_RATE as u64
    }

    /// A copy of everything recorded so far, for partial transcription.
    pub fn snapshot(&self) -> Vec<f32> {
        self.shared.samples.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// The device error that ended the stream early, if any.
    pub fn failure(&self) -> Option<String> {
        self.shared.failed.lock().ok().and_then(|f| f.clone())
    }

    /// Stops the device and hands back the whole recording.
    pub fn finish(mut self) -> Vec<f32> {
        self.close();
        std::mem::take(&mut *self.shared.samples.lock().unwrap_or_else(|e| e.into_inner()))
    }

    fn close(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        self.close();
    }
}

/// Input device names for the settings picker.
pub fn input_devices() -> Vec<String> {
    cpal::default_host()
        .input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

fn pick_device(host: &cpal::Host, name: Option<&str>) -> Option<cpal::Device> {
    if let Some(name) = name.filter(|n| !n.is_empty()) {
        if let Some(device) = host
            .input_devices()
            .ok()
            .and_then(|mut devices| devices.find(|d| d.name().ok().as_deref() == Some(name)))
        {
            return Some(device);
        }
    }
    host.default_input_device()
}

fn classify(message: String) -> CaptureError {
    // WASAPI reports the privacy toggle as E_ACCESSDENIED.
    let lower = message.to_ascii_lowercase();
    if lower.contains("0x80070005") || lower.contains("access is denied") || lower.contains("拒绝访问") {
        CaptureError::Denied
    } else {
        CaptureError::Unavailable(message)
    }
}

fn open_stream(name: Option<&str>, shared: Arc<Shared>) -> Result<cpal::Stream, CaptureError> {
    let host = cpal::default_host();
    let device = pick_device(&host, name).ok_or(CaptureError::NoDevice)?;
    let supported = device
        .default_input_config()
        .map_err(|e| classify(e.to_string()))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let mut resampler = Resampler::new(config.sample_rate.0, config.channels);
    let mut meter = LevelMeter::new();
    let error_shared = shared.clone();
    let on_error = move |error: cpal::StreamError| {
        if let Ok(mut failed) = error_shared.failed.lock() {
            failed.get_or_insert_with(|| error.to_string());
        }
    };
    let stream = match format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                shared.append(&mut resampler, &mut meter, data)
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let data: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                shared.append(&mut resampler, &mut meter, &data)
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let data: Vec<f32> =
                    data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect();
                shared.append(&mut resampler, &mut meter, &data)
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            &config,
            move |data: &[i32], _: &cpal::InputCallbackInfo| {
                let data: Vec<f32> = data.iter().map(|s| *s as f32 / 2_147_483_648.0).collect();
                shared.append(&mut resampler, &mut meter, &data)
            },
            on_error,
            None,
        ),
        other => {
            return Err(CaptureError::Unavailable(format!("不支持的采样格式 {other}")));
        }
    }
    .map_err(|e| classify(e.to_string()))?;
    stream.play().map_err(|e| classify(e.to_string()))?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_downmixes_and_converts_rate() {
        let mut resampler = Resampler::new(48_000, 2);
        let mut out = Vec::new();
        // One second of stereo where left=0.5, right=-0.1 → mono 0.2.
        let input: Vec<f32> = (0..48_000).flat_map(|_| [0.5, -0.1]).collect();
        resampler.push(&input, &mut out);
        assert!((out.len() as i64 - 16_000).abs() <= 1, "len {}", out.len());
        assert!(out[10..].iter().all(|s| (s - 0.2).abs() < 1e-5));
    }

    #[test]
    fn resampler_keeps_phase_across_chunks() {
        let mut whole = Resampler::new(44_100, 1);
        let mut split = Resampler::new(44_100, 1);
        let input: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.01).sin()).collect();
        let (mut a, mut b) = (Vec::new(), Vec::new());
        whole.push(&input, &mut a);
        split.push(&input[..1000], &mut b);
        split.push(&input[1000..], &mut b);
        assert_eq!(a, b);
    }

    #[test]
    fn level_attacks_instantly_and_decays_per_frame() {
        let mut meter = LevelMeter::new();
        let high = meter.push(&vec![0.3; LEVEL_FRAME]).unwrap();
        assert!(high > 0.8, "{high}");
        let after = meter.push(&vec![0.0; LEVEL_FRAME]).unwrap();
        assert!((after - high * LEVEL_DECAY).abs() < 1e-6);
        assert_eq!(meter.push(&vec![0.0; LEVEL_FRAME / 2]), None);
    }

    #[test]
    fn silence_reads_as_zero() {
        assert_eq!(normalized(0.0), 0.0);
        assert_eq!(normalized(1e-5), 0.0);
        assert_eq!(normalized(1.0), 1.0);
    }

    /// Needs a real microphone: `cargo test -- --ignored records_from_default`
    #[test]
    #[ignore]
    fn records_from_default_microphone() {
        let recording = Recording::start(None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1000));
        assert!(recording.failure().is_none());
        let samples = recording.finish();
        assert!(samples.len() > SAMPLE_RATE as usize * 8 / 10, "{}", samples.len());
    }

    #[test]
    fn access_denied_maps_to_privacy_error() {
        assert_eq!(classify("HRESULT 0x80070005".into()), CaptureError::Denied);
        assert!(matches!(classify("device busy".into()), CaptureError::Unavailable(_)));
    }
}
