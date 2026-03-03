use serde::{Deserialize, Serialize};
pub use manatan_sync_server::types::{
    NovelsMetadata, NovelsProgress, NovelsHighlight, NovelsParsedBook, NovelsCategory, NovelsCategoryMetadata,
    BookStats, TocItem, BlockIndexMap
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadataRequest {
    pub metadata: NovelsMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressRequest {
    pub progress: NovelsProgress,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryRequest {
    pub category: NovelsCategory,
}
