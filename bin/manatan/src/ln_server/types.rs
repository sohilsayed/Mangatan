use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNMetadata {
    pub id: String,
    pub title: String,
    pub author: String,
    pub cover: Option<String>,
    pub added_at: i64,
    pub stats: BookStats,
    pub chapter_count: usize,
    pub toc: Vec<TocItem>,
    pub language: String,
    pub category_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookStats {
    pub chapter_lengths: Vec<usize>,
    pub total_length: usize,
    pub block_maps: Option<Vec<BlockIndexMap>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockIndexMap {
    pub block_id: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocItem {
    pub label: String,
    pub href: String,
    pub chapter_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNProgress {
    pub chapter_index: i32,
    pub page_number: Option<i32>,
    pub chapter_char_offset: i32,
    pub total_chars_read: i32,
    pub sentence_text: String,
    pub chapter_progress: f64,
    pub total_progress: f64,
    pub block_id: Option<String>,
    pub block_local_offset: Option<i32>,
    pub context_snippet: Option<String>,
    pub last_read: Option<i64>,
    pub last_modified: Option<i64>,
    pub sync_version: Option<i32>,
    pub device_id: Option<String>,
    #[serde(default)]
    pub highlights: Vec<LNHighlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNHighlight {
    pub id: String,
    pub chapter_index: i32,
    pub block_id: String,
    pub text: String,
    pub start_offset: i32,
    pub end_offset: i32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNHighlights {
    pub highlights: Vec<LNHighlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNCategory {
    pub id: String,
    pub name: String,
    pub order: i32,
    pub created_at: i64,
    pub last_modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LNCategoryMetadata {
    pub sort_by: String,
    pub sort_desc: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub chapter_index: usize,
    pub text: String,
    pub position: usize,
}
