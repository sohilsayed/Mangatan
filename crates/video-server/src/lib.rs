use std::path::PathBuf;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod ffmpeg;
pub mod state;
pub mod transcoder;

pub use state::VideoServerState;
pub use transcoder::{HwAccelConfig, TranscodeJob, TranscodeOptions, Transcoder};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscodeRequest {
    pub source: String,
    pub output_id: Option<String>,
    pub options: Option<TranscodeOptions>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscodeResponse {
    pub output_id: String,
    pub playlist_url: String,
    pub status: String,
}

pub fn create_router(data_dir: PathBuf) -> Router {
    let state = VideoServerState::new(data_dir);

    Router::new()
        .route("/health", get(health_handler))
        .route("/transcode", post(transcode_handler))
        .route("/transcode/test", post(test_transcode_handler))
        .route("/status/{output_id}", get(status_handler))
        .route("/playlist/{output_id}", get(playlist_handler))
        .route("/segment/{output_id}/{filename}", get(segment_handler))
        .route("/info", get(info_handler))
        .with_state(state)
}

async fn transcode_handler(
    State(state): State<VideoServerState>,
    Json(req): Json<TranscodeRequest>,
) -> Result<Json<TranscodeResponse>, StatusCode> {
    let output_id = req.output_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let job = TranscodeJob {
        id: output_id.clone(),
        source: req.source,
        options: req.options.unwrap_or_default(),
    };

    state.transcoder.submit(job).await.map_err(|e| {
        tracing::error!("Failed to submit transcode job: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let playlist_url = format!("/api/video/playlist/{}", output_id);

    Ok(Json(TranscodeResponse {
        output_id,
        playlist_url,
        status: "started".to_string(),
    }))
}

async fn status_handler(
    State(state): State<VideoServerState>,
    Path(output_id): Path<String>,
) -> Result<Json<transcoder::JobStatus>, StatusCode> {
    let status = state.transcoder.get_status(&output_id).await.ok_or_else(|| {
        tracing::warn!("Job not found: {}", output_id);
        StatusCode::NOT_FOUND
    })?;

    Ok(Json(status))
}

async fn playlist_handler(
    State(state): State<VideoServerState>,
    Path(output_id): Path<String>,
) -> Result<Response, StatusCode> {
    let playlist = state.transcoder.get_playlist(&output_id).await.ok_or_else(|| {
        tracing::warn!("Playlist not found: {}", output_id);
        StatusCode::NOT_FOUND
    })?;

    let base_url = format!("/api/video/segment/{}", output_id);
    let modified_playlist = playlist
        .lines()
        .map(|line| {
            if line.starts_with("data:") || line.starts_with('#') || line.is_empty() {
                line.to_string()
            } else {
                format!("{}/{}", base_url, line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    Ok((StatusCode::OK, modified_playlist).into_response())
}

async fn segment_handler(
    State(state): State<VideoServerState>,
    Path((output_id, filename)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    let segment_path = state.output_dir.join(&output_id).join(&filename);

    if !segment_path.exists() {
        tracing::warn!("Segment not found: {}", segment_path.display());
        return Err(StatusCode::NOT_FOUND);
    }

    let bytes = tokio::fs::read(&segment_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mime = if filename.ends_with(".ts") {
        "video/mp2t"
    } else if filename.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else {
        "application/octet-stream"
    };

    Ok((
        [(axum::http::header::CONTENT_TYPE, mime)],
        bytes,
    ).into_response())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerInfo {
    pub version: String,
    pub detected_hwaccel: HwAccelConfig,
    pub available_hwaccels: Vec<String>,
}

async fn info_handler(State(state): State<VideoServerState>) -> Json<ServerInfo> {
    Json(ServerInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        detected_hwaccel: state.transcoder.detected_hwaccel().clone(),
        available_hwaccels: state.transcoder.available_hwaccels().to_vec(),
    })
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
    }))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestTranscodeRequest {
    pub source: String,
    pub output_id: Option<String>,
    pub options: Option<TranscodeOptions>,
    pub wait: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestTranscodeResponse {
    pub output_id: String,
    pub status: String,
    pub playlist_url: Option<String>,
    pub error: Option<String>,
    pub hwaccel_used: HwAccelConfig,
}

async fn test_transcode_handler(
    State(state): State<VideoServerState>,
    Json(req): Json<TestTranscodeRequest>,
) -> Result<Json<TestTranscodeResponse>, StatusCode> {
    let output_id = req.output_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let options = req.options.unwrap_or_default();
    let wait = req.wait.unwrap_or(false);
    let hwaccel = transcoder::resolve_hwaccel(
        &options.hwaccel,
        state.transcoder.detected_hwaccel(),
    );

    let job = TranscodeJob {
        id: output_id.clone(),
        source: req.source,
        options: options.clone(),
    };

    state.transcoder.submit(job).await.map_err(|e| {
        tracing::error!("Failed to submit transcode job: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if wait {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let status = state.transcoder.get_status(&output_id).await;

            if let Some(s) = status {
                if s.status == "completed" || s.status == "failed" {
                    return Ok(Json(TestTranscodeResponse {
                        output_id,
                        status: s.status,
                        playlist_url: s.playlist_url,
                        error: s.error,
                        hwaccel_used: hwaccel,
                    }));
                }
            }
        }
    }

    let playlist_url = format!("/api/video/playlist/{}", output_id);

    Ok(Json(TestTranscodeResponse {
        output_id,
        status: "started".to_string(),
        playlist_url: Some(playlist_url),
        error: None,
        hwaccel_used: hwaccel,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_router() {
        let _router = create_router(std::env::temp_dir().join("manatan-video-test"));
    }
}
