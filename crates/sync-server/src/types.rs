use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ============================================================================
// Light Novel Progress
// ============================================================================

/// Reading progress for a light novel - matches TypeScript NovelsProgress
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelsProgress {
    /// Current chapter index
    #[serde(alias = "chapterIndex")]
    pub chapter_index: i32,

    /// Current page number (optional, for paginated view)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "pageNumber")]
    pub page_number: Option<i32>,

    /// Character offset within the chapter
    #[serde(alias = "chapterCharOffset")]
    pub chapter_char_offset: i32,

    /// Total characters read across all chapters
    #[serde(alias = "totalCharsRead")]
    pub total_chars_read: i32,

    /// The sentence currently being read
    #[serde(alias = "sentenceText")]
    pub sentence_text: String,

    /// Progress within current chapter (0.0 - 1.0)
    #[serde(alias = "chapterProgress")]
    pub chapter_progress: f64,

    /// Overall book progress (0.0 - 1.0)
    #[serde(alias = "totalProgress")]
    pub total_progress: f64,

    // Block tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "blockId")]
    pub block_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "blockLocalOffset")]
    pub block_local_offset: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "contextSnippet")]
    pub context_snippet: Option<String>,

    // Sync metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "lastRead")]
    pub last_read: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "lastModified")]
    pub last_modified: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "syncVersion")]
    pub sync_version: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,

    // Highlights
    #[serde(default)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub highlights: Vec<NovelsHighlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelsHighlight {
    pub id: String,
    pub chapter_index: i32,
    pub block_id: String,
    pub text: String,
    pub start_offset: i32,
    pub end_offset: i32,
    pub created_at: i64,
}

impl NovelsProgress {
    /// Check if this progress is further along than another
    pub fn is_further_than(&self, other: &NovelsProgress) -> bool {
        self.total_progress > other.total_progress
    }

    /// Check if this progress is newer than another
    pub fn is_newer_than(&self, other: &NovelsProgress) -> bool {
        match (self.last_modified, other.last_modified) {
            (Some(a), Some(b)) => a > b,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => false,
        }
    }

    /// Check if this has a higher sync version
    pub fn has_higher_version(&self, other: &NovelsProgress) -> bool {
        match (self.sync_version, other.sync_version) {
            (Some(a), Some(b)) => a > b,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => false,
        }
    }
}

// ============================================================================
// Novels Reader Settings (for sync)
// ============================================================================

/// Novels Reader settings - matches TypeScript NovelsReaderSettings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelsReaderSettings {
    // Basic display
    pub novels_font_size: f64,
    pub novels_line_height: f64,
    pub novels_font_family: String,
    pub novels_theme: String,
    pub novels_reading_direction: String,
    pub novels_pagination_mode: String,
    pub novels_page_width: f64,
    pub novels_page_margin: f64,
    pub novels_enable_furigana: bool,
    pub novels_text_align: String,
    pub novels_letter_spacing: f64,
    pub novels_paragraph_spacing: f64,

    // Additional display settings
    pub novels_text_brightness: f64,
    pub novels_font_weight: f64,
    pub novels_secondary_font_family: String,

    // Bookmark settings
    pub novels_auto_bookmark: bool,
    pub novels_bookmark_delay: f64,
    pub novels_lock_progress_bar: bool,

    // Navigation settings
    pub novels_hide_nav_buttons: bool,
    pub novels_enable_swipe: bool,
    pub novels_drag_threshold: f64,

    // Click zones (paged mode)
    pub novels_enable_click_zones: bool,
    pub novels_click_zone_size: f64,
    pub novels_click_zone_placement: String,
    pub novels_click_zone_position: String,
    pub novels_click_zone_coverage: f64,

    // Animations & extras
    pub novels_disable_animations: bool,
    pub novels_show_char_progress: bool,

    // Yomitan integration
    pub enable_yomitan: bool,
    pub interaction_mode: String,
}

impl NovelsReaderSettings {
    pub fn default_settings() -> Self {
        Self {
            novels_font_size: 18.0,
            novels_line_height: 1.8,
            novels_font_family: "\"Noto Serif JP\", serif".to_string(),
            novels_theme: "dark".to_string(),
            novels_reading_direction: "vertical-rtl".to_string(),
            novels_pagination_mode: "paginated".to_string(),
            novels_page_width: 800.0,
            novels_page_margin: 20.0,
            novels_enable_furigana: true,
            novels_text_align: "justify".to_string(),
            novels_letter_spacing: 0.0,
            novels_paragraph_spacing: 0.0,
            novels_text_brightness: 100.0,
            novels_font_weight: 400.0,
            novels_secondary_font_family: String::new(),
            novels_auto_bookmark: true,
            novels_bookmark_delay: 5.0,
            novels_lock_progress_bar: false,
            novels_hide_nav_buttons: false,
            novels_enable_swipe: true,
            novels_drag_threshold: 10.0,
            novels_enable_click_zones: true,
            novels_click_zone_size: 10.0,
            novels_click_zone_placement: "vertical".to_string(),
            novels_click_zone_position: "full".to_string(),
            novels_click_zone_coverage: 60.0,
            novels_disable_animations: false,
            novels_show_char_progress: false,
            enable_yomitan: true,
            interaction_mode: "hover".to_string(),
        }
    }
}

// ============================================================================
// Light Novel Metadata
// ============================================================================

/// Block index mapping for navigation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockIndexMap {
    #[serde(alias = "blockId")]
    pub block_id: String,
    #[serde(alias = "startOffset")]
    pub start_offset: i32,
    #[serde(alias = "endOffset")]
    pub end_offset: i32,
}

/// Book statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookStats {
    pub chapter_lengths: Vec<i32>,
    pub total_length: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_maps: Option<Vec<BlockIndexMap>>,
}

/// Table of contents item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocItem {
    pub label: String,
    pub href: String,
    #[serde(alias = "chapterIndex")]
    pub chapter_index: i32,
}

/// Light novel metadata - matches TypeScript NovelsMetadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelsMetadata {
    pub id: String,
    pub title: String,
    pub author: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,

    #[serde(alias = "addedAt")]
    pub added_at: i64,

    // Processing state
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "isProcessing")]
    pub is_processing: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "isError")]
    pub is_error: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "errorMsg")]
    pub error_msg: Option<String>,

    // Pre-calculated on import
    pub stats: BookStats,
    #[serde(alias = "chapterCount")]
    pub chapter_count: i32,
    pub toc: Vec<TocItem>,

    // For library display
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "hasProgress")]
    pub has_progress: Option<bool>,

    // Sync metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "lastModified")]
    pub last_modified: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "syncVersion")]
    pub sync_version: Option<i32>,

    // Language and categories
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub category_ids: Vec<String>,

    // Settings per language (synced)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[serde(alias = "languageSettings")]
    pub language_settings: HashMap<String, NovelsReaderSettings>,
}

// ============================================================================
// Novels Categories
// ============================================================================

/// Category for organizing light novels
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelsCategory {
    pub id: String,
    pub name: String,
    pub order: i32,
    pub created_at: i64,
    pub last_modified: i64,
}

/// Category metadata (sort settings)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelsCategoryMetadata {
    #[serde(alias = "sortBy")]
    pub sort_by: String,
    #[serde(alias = "sortDesc")]
    pub sort_desc: bool,
}

// ============================================================================
// Light Novel Content
// ============================================================================

/// Parsed book content - matches TypeScript NovelsParsedBook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelsParsedBook {
    /// HTML content of each chapter
    pub chapters: Vec<String>,

    /// Images extracted from the EPUB (base64 encoded)
    #[serde(alias = "imageBlobs")]
    pub image_blobs: HashMap<String, String>,

    /// Original filenames of chapters
    #[serde(alias = "chapterFilenames")]
    pub chapter_filenames: Vec<String>,
}

/// Reference to a synced file (for file manifest)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReference {
    #[serde(alias = "bookId")]
    pub book_id: String,
    #[serde(alias = "fileType")]
    pub file_type: FileType,
    #[serde(alias = "fileHash")]
    pub file_hash: String,
    #[serde(alias = "fileSize")]
    pub file_size: u64,
    #[serde(alias = "lastModified")]
    pub last_modified: i64,
    #[serde(alias = "driveFileId")]
    pub drive_file_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    Epub,
    Content,
}

// ============================================================================
// Sync Payload
// ============================================================================

/// The complete sync payload exchanged between frontend, backend, and cloud
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    /// Schema version for future migrations
    pub schema_version: u32,

    /// Device ID that created this payload
    pub device_id: String,

    /// When this payload was created
    pub last_modified: i64,

    /// Reading progress for each book (bookId → progress)
    #[serde(default)]
    pub novels_progress: HashMap<String, NovelsProgress>,

    /// Metadata for each book (bookId → metadata)
    #[serde(default)]
    pub novels_metadata: HashMap<String, NovelsMetadata>,

    /// Parsed content for each book (bookId → content)
    /// Only included if sync_config.novels_content is true
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub novels_content: HashMap<String, NovelsParsedBook>,

    /// EPUB files as base64 (bookId → base64 data)
    /// Only included if sync_config.novels_files is true
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub novels_files: HashMap<String, String>,

    /// File manifest for resumable sync
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub file_manifest: HashMap<String, FileReference>,

    /// Novels Categories
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[serde(alias = "novelsCategories")]
    pub novels_categories: HashMap<String, NovelsCategory>,

    /// Novels Category metadata (sort settings)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[serde(alias = "novelsCategoryMetadata")]
    pub novels_category_metadata: HashMap<String, NovelsCategoryMetadata>,
}

impl SyncPayload {
    pub const CURRENT_SCHEMA_VERSION: u32 = 1;

    pub fn new(device_id: String) -> Self {
        Self {
            schema_version: Self::CURRENT_SCHEMA_VERSION,
            device_id,
            last_modified: chrono::Utc::now().timestamp_millis(),
            ..Default::default()
        }
    }
}

/// Request body for merge endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    /// Local payload from frontend
    pub payload: SyncPayload,

    /// What to sync (optional, uses stored config if not provided)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<SyncConfig>,
}

/// Response from merge endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResponse {
    /// The merged payload to apply locally
    pub payload: SyncPayload,

    /// Timestamp of this sync
    pub sync_timestamp: i64,

    /// Files that need to be uploaded (for resumable sync)
    #[serde(default)]
    pub files_to_upload: Vec<String>,

    /// Files that can be downloaded
    #[serde(default)]
    pub files_to_download: Vec<String>,

    /// Any conflicts that occurred (informational)
    #[serde(default)]
    pub conflicts: Vec<ConflictInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub book_id: String,
    pub field: String,
    pub local_value: String,
    pub remote_value: String,
    pub resolution: String,
}

// ============================================================================
// Sync Configuration
// ============================================================================

/// What data to sync - user configurable
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    // What to sync
    pub novels_progress: bool,
    pub novels_metadata: bool,
    pub novels_content: bool,
    pub novels_files: bool,

    // Sync triggers (matching Tachiyomi)
    pub sync_on_chapter_read: bool,
    pub sync_on_chapter_open: bool,
    pub sync_on_app_start: bool,
    pub sync_on_app_resume: bool,

    // Backend selection
    pub backend: SyncBackendType,

    // Google Drive settings
    pub google_drive_folder: String,
    pub google_drive_folder_type: GoogleDriveFolderType,

    // Deletion behavior
    pub deletion_behavior: DeletionBehavior,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            novels_progress: true,
            novels_metadata: true,
            novels_content: true,
            novels_files: false,
            sync_on_chapter_read: false,
            sync_on_chapter_open: false,
            sync_on_app_start: false,
            sync_on_app_resume: false,
            backend: SyncBackendType::None,
            google_drive_folder: "Manatan".to_string(),
            google_drive_folder_type: GoogleDriveFolderType::Public,
            deletion_behavior: DeletionBehavior::KeepEverywhere,
        }
    }
}

/// Google Drive folder type selection
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GoogleDriveFolderType {
    #[default]
    Public,
    AppData,
}

/// Deletion behavior when syncing
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DeletionBehavior {
    #[default]
    KeepEverywhere,
    DeleteEverywhere,
    AskEachTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SyncBackendType {
    #[default]
    None,
    GoogleDrive,
    WebDav,
    SyncYomi,
}
