pub use manatan_sync_server::types::{
    BlockIndexMap, BookStats, LNHighlight, LNMetadata, LNParsedBook, LNProgress, LnCategory,
    LnCategoryMetadata, TocItem,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadataRequest {
    pub metadata: LNMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressRequest {
    pub progress: LNProgress,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryRequest {
    pub category: LnCategory,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEpub {
    pub id: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WhisperSyncTrack {
    pub id: String,
    pub audio_filename: String,
    pub subtitle_filename: Option<String>,
    pub label: String,
    pub order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WhisperSyncMatch {
    pub track_id: String,
    pub subtitle_index: i32,
    pub block_id: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WhisperSyncData {
    pub book_id: String,
    pub tracks: Vec<WhisperSyncTrack>,
    pub matches: Vec<WhisperSyncMatch>,
    pub last_modified: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWhisperSyncRequest {
    pub data: WhisperSyncData,
}
