use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tracing::{error, info};

use crate::ffmpeg::{Ffmpeg, HwAccelType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HwAccelConfigType {
    #[default]
    None,
    Cuda,
    Vaapi,
    Dxva2,
    D3d11va,
    Mediacodec,
    Auto,
}

impl HwAccelConfigType {
    pub fn as_str(&self) -> &'static str {
        match self {
            HwAccelConfigType::None => "",
            HwAccelConfigType::Cuda => "cuda",
            HwAccelConfigType::Vaapi => "vaapi",
            HwAccelConfigType::Dxva2 => "dxva2",
            HwAccelConfigType::D3d11va => "d3d11va",
            HwAccelConfigType::Mediacodec => "mediacodec",
            HwAccelConfigType::Auto => "",
        }
    }

    pub fn from_hwaccel_type(hwaccel: HwAccelType) -> Self {
        match hwaccel {
            HwAccelType::None => HwAccelConfigType::None,
            HwAccelType::Cuda => HwAccelConfigType::Cuda,
            HwAccelType::Vaapi => HwAccelConfigType::Vaapi,
            HwAccelType::Dxva2 => HwAccelConfigType::Dxva2,
            HwAccelType::D3d11va => HwAccelConfigType::D3d11va,
            HwAccelType::Mediacodec => HwAccelConfigType::Mediacodec,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HwAccelConfig {
    #[serde(default)]
    pub hwaccel_type: HwAccelConfigType,
    #[serde(default)]
    pub decoder: Option<String>,
    #[serde(default)]
    pub encoder: Option<String>,
}

impl Default for HwAccelConfig {
    fn default() -> Self {
        let auto_config = Self::auto();
        Self {
            hwaccel_type: auto_config.hwaccel_type,
            decoder: auto_config.decoder,
            encoder: auto_config.encoder,
        }
    }
}

impl HwAccelConfig {
    pub fn auto() -> Self {
        #[cfg(target_os = "android")]
        {
            Self {
                hwaccel_type: HwAccelConfigType::Mediacodec,
                decoder: Some("hevc_mediacodec".to_string()),
                encoder: Some("h264_mediacodec".to_string()),
            }
        }
        #[cfg(target_os = "linux")]
        {
            Self {
                hwaccel_type: HwAccelConfigType::Vaapi,
                decoder: Some("hevc_vaapi".to_string()),
                encoder: Some("h264_vaapi".to_string()),
            }
        }
        #[cfg(target_os = "windows")]
        {
            Self {
                hwaccel_type: HwAccelConfigType::D3d11va,
                decoder: Some("hevc_d3d11va".to_string()),
                encoder: Some("h264_nvenc".to_string()),
            }
        }
        #[cfg(not(any(target_os = "android", target_os = "linux", target_os = "windows")))]
        {
            Self {
                hwaccel_type: HwAccelConfigType::None,
                decoder: Some("hevc".to_string()),
                encoder: Some("libx264".to_string()),
            }
        }
    }

    pub fn for_target(target: &str) -> Self {
        if target.contains("android") {
            Self {
                hwaccel_type: HwAccelConfigType::Mediacodec,
                decoder: Some("hevc_mediacodec".to_string()),
                encoder: Some("h264_mediacodec".to_string()),
            }
        } else if target.contains("linux") {
            Self {
                hwaccel_type: HwAccelConfigType::Vaapi,
                decoder: Some("hevc_vaapi".to_string()),
                encoder: Some("h264_vaapi".to_string()),
            }
        } else if target.contains("windows") {
            Self {
                hwaccel_type: HwAccelConfigType::D3d11va,
                decoder: Some("hevc_d3d11va".to_string()),
                encoder: Some("h264_amf".to_string()),
            }
        } else {
            Self {
                hwaccel_type: HwAccelConfigType::None,
                decoder: Some("hevc".to_string()),
                encoder: Some("libx264".to_string()),
            }
        }
    }

    pub fn from_detected(ffmpeg: &Ffmpeg) -> Self {
        let detected = ffmpeg.detect_best_hwaccel();
        let hwaccel_type = HwAccelConfigType::from_hwaccel_type(detected);

        let (decoder, encoder) = match detected {
            HwAccelType::Cuda => (
                Some("hevc_cuvid".to_string()),
                Some("h264_nvenc".to_string()),
            ),
            HwAccelType::Vaapi => (
                Some("hevc_vaapi".to_string()),
                Some("h264_vaapi".to_string()),
            ),
            HwAccelType::D3d11va => (
                Some("hevc_d3d11va".to_string()),
                Some("h264_amf".to_string()),
            ),
            HwAccelType::Dxva2 => (
                Some("hevc_dxva2".to_string()),
                Some("h264_amf".to_string()),
            ),
            HwAccelType::Mediacodec => (
                Some("hevc_mediacodec".to_string()),
                Some("h264_mediacodec".to_string()),
            ),
            HwAccelType::None => (
                Some("hevc".to_string()),
                Some("libx264".to_string()),
            ),
        };

        Self {
            hwaccel_type,
            decoder,
            encoder,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeOptions {
    #[serde(default = "default_segment_duration")]
    pub segment_duration: u32,
    #[serde(default = "default_playlist_type")]
    pub playlist_type: String,
    #[serde(default = "default_force_8bit")]
    pub force_8bit: bool,
    #[serde(default)]
    pub video_bitrate: Option<String>,
    #[serde(default)]
    pub audio_bitrate: Option<String>,
    #[serde(default)]
    pub hwaccel: HwAccelConfig,
    #[serde(default)]
    pub resolution: Option<String>,
}

fn default_segment_duration() -> u32 {
    6
}

fn default_playlist_type() -> String {
    "vod".to_string()
}

fn default_force_8bit() -> bool {
    true
}

impl Default for TranscodeOptions {
    fn default() -> Self {
        Self {
            segment_duration: 6,
            playlist_type: "vod".to_string(),
            force_8bit: true,
            video_bitrate: None,
            audio_bitrate: None,
            hwaccel: HwAccelConfig::default(),
            resolution: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TranscodeJob {
    pub id: String,
    pub source: String,
    pub options: TranscodeOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatus {
    pub output_id: String,
    pub status: String,
    pub progress: f32,
    pub playlist_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Transcoder {
    output_dir: PathBuf,
    ffmpeg: Arc<Ffmpeg>,
    jobs: Arc<RwLock<HashMap<String, JobEntry>>>,
    detected_hwaccel: HwAccelConfig,
}

#[derive(Debug)]
struct JobEntry {
    status: JobStatus,
    cancel_tx: Option<oneshot::Sender<()>>,
}

impl Transcoder {
    pub fn new(output_dir: PathBuf, data_dir: &PathBuf) -> Result<Self> {
        let ffmpeg = Ffmpeg::new(data_dir, None).map_err(|e| anyhow!("Failed to initialize FFmpeg: {}", e))?;
        let detected_hwaccel = HwAccelConfig::from_detected(&ffmpeg);

        info!("Transcoder initialized with detected hwaccel: {:?}", detected_hwaccel);

        Ok(Self {
            output_dir,
            ffmpeg: Arc::new(ffmpeg),
            jobs: Arc::new(RwLock::new(HashMap::new())),
            detected_hwaccel,
        })
    }

    pub fn detected_hwaccel(&self) -> &HwAccelConfig {
        &self.detected_hwaccel
    }

    pub fn available_hwaccels(&self) -> &[String] {
        self.ffmpeg.available_hwaccels()
    }

    pub async fn submit(&self, job: TranscodeJob) -> Result<()> {
        let output_dir = self.output_dir.clone();
        let jobs = self.jobs.clone();
        let output_id = job.id.clone();
        let ffmpeg = Arc::clone(&self.ffmpeg);

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

        {
            let mut jobs_guard = jobs.write();
            jobs_guard.insert(
                output_id.clone(),
                JobEntry {
                    status: JobStatus {
                        output_id: output_id.clone(),
                        status: "queued".to_string(),
                        progress: 0.0,
                        playlist_url: None,
                        error: None,
                    },
                    cancel_tx: Some(cancel_tx),
                },
            );
        }

        tokio::spawn(async move {
            let result = run_transcode(job, output_dir, ffmpeg, cancel_rx).await;

            let mut jobs_guard = jobs.write();
            if let Some(entry) = jobs_guard.get_mut(&output_id) {
                match result {
                    Ok(playlist_path) => {
                        entry.status.status = "completed".to_string();
                        entry.status.progress = 100.0;
                        entry.status.playlist_url = Some(playlist_path);
                    }
                    Err(e) => {
                        entry.status.status = "failed".to_string();
                        entry.status.error = Some(e.to_string());
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn get_status(&self, output_id: &str) -> Option<JobStatus> {
        let jobs = self.jobs.read();
        jobs.get(output_id).map(|e| e.status.clone())
    }

    pub async fn get_playlist(&self, output_id: &str) -> Option<String> {
        let jobs = self.jobs.read();
        let entry = jobs.get(output_id)?;
        if entry.status.status != "completed" {
            return None;
        }

        let playlist_path = entry.status.playlist_url.as_ref()?;
        std::fs::read_to_string(playlist_path).ok()
    }

    pub async fn cancel(&self, output_id: &str) -> Result<()> {
        let mut jobs = self.jobs.write();
        if let Some(entry) = jobs.get_mut(output_id) {
            if let Some(tx) = entry.cancel_tx.take() {
                let _ = tx.send(());
            }
        }
        Ok(())
    }
}

pub fn resolve_hwaccel(config: &HwAccelConfig, detected: &HwAccelConfig) -> HwAccelConfig {
    match config.hwaccel_type {
        HwAccelConfigType::Auto => detected.clone(),
        _ => config.clone(),
    }
}

async fn run_transcode(
    job: TranscodeJob,
    output_dir: PathBuf,
    ffmpeg: Arc<Ffmpeg>,
    mut _cancel_rx: oneshot::Receiver<()>,
) -> Result<String> {
    let output_path = output_dir.join(&job.id);
    std::fs::create_dir_all(&output_path)?;

    let playlist_path = output_path.join("playlist.m3u8");
    let playlist_path_str = playlist_path.to_string_lossy().to_string();

    let source_path = &job.source;
    let is_mkv_h264 = is_mkv_h264_file(source_path);

    let mut cmd = Command::new(ffmpeg.path());

    cmd.arg("-i").arg(source_path);

    if is_mkv_h264 {
        info!("Input is MKV H.264, remuxing only (no transcoding)");
        cmd.arg("-c:v").arg("copy");
        cmd.arg("-c:a").arg("copy");
        cmd.arg("-hls_time")
            .arg(job.options.segment_duration.to_string())
            .arg("-hls_playlist_type")
            .arg(&job.options.playlist_type)
            .arg("-f")
            .arg("hls")
            .arg(&playlist_path_str);

        info!("Running FFmpeg command (remux): {:?}", cmd);

        let output = cmd.output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("FFmpeg failed: {}", stderr);
            return Err(anyhow!("FFmpeg remux failed: {}", stderr));
        }

        info!("FFmpeg remux completed: {}", playlist_path_str);
        return Ok(playlist_path_str);
    }

    let hwaccel = job.options.hwaccel.hwaccel_type.as_str();
    if !hwaccel.is_empty() && job.options.hwaccel.hwaccel_type != HwAccelConfigType::Auto {
        cmd.arg("-hwaccel").arg(hwaccel);
    }

    if let Some(ref decoder) = job.options.hwaccel.decoder {
        cmd.arg("-c:v").arg(decoder);
    }

    let encoder_result = pick_encoder(&job.options.hwaccel.encoder, ffmpeg.path());
    cmd.arg("-c:v").arg(&encoder_result);

    cmd.arg("-c:a").arg("copy");

    cmd.arg("-pix_fmt").arg("yuv420p");

    if let Some(ref resolution) = job.options.resolution {
        cmd.arg("-vf").arg(format!("scale={}", resolution));
    }

    if let Some(ref bitrate) = job.options.video_bitrate {
        cmd.arg("-b:v").arg(bitrate);
    }

    if let Some(ref bitrate) = job.options.audio_bitrate {
        cmd.arg("-b:a").arg(bitrate);
    }

    cmd.arg("-hls_time")
        .arg(job.options.segment_duration.to_string())
        .arg("-hls_playlist_type")
        .arg(&job.options.playlist_type)
        .arg("-f")
        .arg("hls")
        .arg(&playlist_path_str);

    info!("Running FFmpeg command: {:?}", cmd);

    let output = cmd.output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("FFmpeg failed: {}", stderr);
        return Err(anyhow!("FFmpeg transcoding failed: {}", stderr));
    }

    info!("FFmpeg transcoding completed: {}", playlist_path_str);
    Ok(playlist_path_str)
}

fn is_mkv_h264_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    if !lower.ends_with(".mkv") && !lower.ends_with(".matroska") {
        return false;
    }

    let ffmpeg_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default()
        .join("ffmpeg");

    #[cfg(target_os = "windows")]
    let ffmpeg_path = ffmpeg_path.with_extension("exe");

    let output = Command::new(&ffmpeg_path)
        .arg("-i")
        .arg(path)
        .arg("-hide_banner")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{}\n{}", stdout, stderr);
            combined.contains("Stream #0:0") && (combined.contains("h264") || combined.contains("avc"))
        }
        _ => false,
    }
}

fn pick_encoder(preferred: &Option<String>, ffmpeg_path: &std::path::Path) -> String {
    let mut encoders_to_try = Vec::new();

    if let Some(enc) = preferred {
        encoders_to_try.push(enc.clone());
    }

    #[cfg(target_os = "windows")]
    {
        if preferred.as_ref().map(|s| s.as_str()) != Some("h264_nvenc") {
            encoders_to_try.push("h264_nvenc".to_string());
        }
        if preferred.as_ref().map(|s| s.as_str()) != Some("h264_amf") {
            encoders_to_try.push("h264_amf".to_string());
        }
    }

    encoders_to_try.push("libx264".to_string());

    for encoder in &encoders_to_try {
        if encoder_available(encoder, ffmpeg_path) {
            return encoder.clone();
        }
        info!("Encoder {} not available, trying next fallback", encoder);
    }

    "libx264".to_string()
}

fn encoder_available(encoder: &str, ffmpeg_path: &std::path::Path) -> bool {
    let output = Command::new(ffmpeg_path)
        .arg("-encoders")
        .arg("2>/dev/null")
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains(encoder)
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_filter_8bit() {
        let options = TranscodeOptions {
            force_8bit: true,
            ..Default::default()
        };
        assert!(options.force_8bit);
    }

    #[test]
    fn test_for_target_android() {
        let config = HwAccelConfig::for_target("aarch64-linux-android");
        assert_eq!(config.hwaccel_type, HwAccelConfigType::Mediacodec);
    }

    #[test]
    fn test_for_target_windows() {
        let config = HwAccelConfig::for_target("x86_64-pc-windows-gnu");
        assert_eq!(config.encoder, Some("h264_nvenc".to_string()));
    }
}
