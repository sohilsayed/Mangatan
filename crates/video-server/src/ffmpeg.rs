use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use tracing::info;

static FFMPEG_BYTES: &[u8] = get_embedded_ffmpeg();

const fn get_embedded_ffmpeg() -> &'static [u8] {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        include_bytes!("../bin/linux-x86_64/ffmpeg")
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        include_bytes!("../bin/windows-x86_64/ffmpeg.exe")
    }

    #[cfg(all(target_os = "android", target_arch = "aarch64"))]
    {
        include_bytes!("../bin/android-arm64/ffmpeg")
    }

    #[cfg(all(target_os = "android", target_arch = "arm"))]
    {
        include_bytes!("../bin/android-armeabi-v7a/ffmpeg")
    }

    #[cfg(not(any(
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "android", target_arch = "aarch64"),
        all(target_os = "android", target_arch = "arm")
    )))]
    {
        include_bytes!("../bin/linux-x86_64/ffmpeg")
    }
}

#[derive(Debug)]
pub struct Ffmpeg {
    path: PathBuf,
    available_hwaccels: Vec<String>,
}

impl Ffmpeg {
    pub fn new(data_dir: &Path, extraction_dir: Option<&Path>) -> std::io::Result<Self> {
        let extraction_path = extraction_dir.unwrap_or_else(|| data_dir);
        let path = Self::extract(extraction_path)?;

        let mut ffmpeg = Self {
            path,
            available_hwaccels: Vec::new(),
        };

        if let Ok(hwaccels) = ffmpeg.detect_hwaccels() {
            info!("Detected hardware accelerators: {:?}", hwaccels);
            ffmpeg.available_hwaccels = hwaccels;
        } else {
            info!("No hardware accelerators detected or FFmpeg failed to query");
        }

        if let Ok(version) = ffmpeg.version() {
            info!("FFmpeg version: {}", version);
        }

        Ok(ffmpeg)
    }

    fn extract(extract_dir: &Path) -> std::io::Result<PathBuf> {
        let bin_dir = extract_dir.join("bin");
        fs::create_dir_all(&bin_dir)?;

        let binary_name = if cfg!(target_os = "windows") {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        let path = bin_dir.join(binary_name);

        if !path.exists() {
            info!("Extracting FFmpeg binary to {}", path.display());
            let mut file = File::create(&path)?;
            file.write_all(FFMPEG_BYTES)?;
            info!("FFmpeg extraction complete ({} bytes)", FFMPEG_BYTES.len());
        } else {
            info!("FFmpeg binary already exists at {}", path.display());
        }

        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms)?;
            info!("Set executable permissions on {}", path.display());
        }

        info!(
            "Verifying binary exists: {} -> {}",
            path.display(),
            path.exists()
        );
        info!("Binary file size: {} bytes", fs::metadata(&path)?.len());

        Ok(path)
    }

    fn detect_hwaccels(&self) -> std::io::Result<Vec<String>> {
        let output = Command::new(&self.path).arg("-hwaccels").output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            info!("FFmpeg -hwaccels stderr: {}", stderr);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        info!("FFmpeg -hwaccels stdout: {}", stdout);

        let hwaccels: Vec<String> = stdout
            .lines()
            .skip(1)
            .filter(|line| !line.is_empty())
            .map(|s| s.trim().to_string())
            .collect();

        Ok(hwaccels)
    }

    pub fn available_hwaccels(&self) -> &[String] {
        &self.available_hwaccels
    }

    pub fn has_hwaccel(&self, name: &str) -> bool {
        self.available_hwaccels.iter().any(|h| h == name)
    }

    pub fn detect_best_hwaccel(&self) -> HwAccelType {
        if self.has_hwaccel("cuda") {
            HwAccelType::Cuda
        } else if self.has_hwaccel("vaapi") {
            HwAccelType::Vaapi
        } else if self.has_hwaccel("d3d11va") {
            HwAccelType::D3d11va
        } else if self.has_hwaccel("dxva2") {
            HwAccelType::Dxva2
        } else if self.has_hwaccel("mediacodec") {
            HwAccelType::Mediacodec
        } else {
            HwAccelType::None
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn version(&self) -> std::io::Result<String> {
        let output = Command::new(&self.path).arg("-version").output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            info!("FFmpeg -version stderr: {}", stderr);
            return Ok(format!("error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        info!("FFmpeg -version stdout: {}", stdout);

        Ok(stdout.lines().next().unwrap_or("unknown").to_string())
    }

    pub fn run(&self, args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new(&self.path).args(args).output()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HwAccelType {
    #[default]
    None,
    Cuda,
    Vaapi,
    Dxva2,
    D3d11va,
    Mediacodec,
}

impl HwAccelType {
    pub fn as_str(&self) -> &'static str {
        match self {
            HwAccelType::None => "",
            HwAccelType::Cuda => "cuda",
            HwAccelType::Vaapi => "vaapi",
            HwAccelType::Dxva2 => "dxva2",
            HwAccelType::D3d11va => "d3d11va",
            HwAccelType::Mediacodec => "mediacodec",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn get_test_data_dir(name: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("manatan-video-test-{}-{}", name, id))
    }

    #[test]
    fn test_ffmpeg_extraction() {
        let data_dir = get_test_data_dir("extraction");
        let _ = fs::remove_dir_all(&data_dir);
        fs::create_dir_all(&data_dir).expect("Failed to create test dir");

        let ffmpeg = Ffmpeg::new(&data_dir, None).expect("Failed to create Ffmpeg");

        assert!(ffmpeg.path().exists());
    }

    #[test]
    fn test_version() {
        let data_dir = get_test_data_dir("version");
        let _ = fs::remove_dir_all(&data_dir);
        fs::create_dir_all(&data_dir).expect("Failed to create test dir");

        let ffmpeg = Ffmpeg::new(&data_dir, None).expect("Failed to create Ffmpeg");

        let version = ffmpeg.version().expect("Failed to get version");
        assert!(version.to_lowercase().contains("ffmpeg"));
    }
}
