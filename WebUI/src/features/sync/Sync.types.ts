
// ============================================================================
// Types matching Rust backend (camelCase for JSON serialization)
// ============================================================================

// Novels Reader Settings for sync
export interface NovelsReaderSettings {
    novelsFontSize: number;
    novelsLineHeight: number;
    novelsFontFamily: string;
    novelsTheme: 'light' | 'sepia' | 'dark' | 'black';
    novelsReadingDirection: 'horizontal' | 'vertical-rtl' | 'vertical-ltr';
    novelsPaginationMode: 'scroll' | 'paginated' | 'single-page';
    novelsPageWidth: number;
    novelsPageMargin: number;
    novelsEnableFurigana: boolean;
    novelsTextAlign: 'left' | 'center' | 'justify';
    novelsLetterSpacing: number;
    novelsParagraphSpacing: number;
    novelsTextBrightness: number;
    novelsFontWeight: number;
    novelsSecondaryFontFamily: string;
    novelsAutoBookmark: boolean;
    novelsBookmarkDelay: number;
    novelsLockProgressBar: boolean;
    novelsHideNavButtons: boolean;
    novelsEnableSwipe: boolean;
    novelsDragThreshold: number;
    novelsEnableClickZones: boolean;
    novelsClickZoneSize: number;
    novelsClickZonePlacement: 'vertical' | 'horizontal';
    novelsClickZonePosition: 'full' | 'start' | 'center' | 'end';
    novelsClickZoneCoverage: number;
    novelsDisableAnimations: boolean;
    novelsShowCharProgress: boolean;
    enableYomitan: boolean;
    interactionMode: 'hover' | 'click';
}

export interface NovelsProgress {
    chapterIndex: number;
    pageNumber?: number;
    chapterCharOffset: number;
    totalCharsRead: number;
    sentenceText: string;
    chapterProgress: number;
    totalProgress: number;
    blockId?: string;
    blockLocalOffset?: number;
    contextSnippet?: string;
    lastRead?: number;
    lastModified?: number;
    syncVersion?: number;
    deviceId?: string;
    highlights?: NovelsHighlight[];
}

export interface NovelsHighlight {
    id: string;
    chapterIndex: number;
    blockId: string;
    text: string;
    startOffset: number;
    endOffset: number;
    createdAt: number;
}

export interface BlockIndexMap {
    blockId: string;
    startOffset: number;
    endOffset: number;
}

export interface BookStats {
    chapterLengths: number[];
    totalLength: number;
    blockMaps?: BlockIndexMap[];
}

export interface TocItem {
    label: string;
    href: string;
    chapterIndex: number;
}

export interface NovelsMetadata {
    id: string;
    title: string;
    author: string;
    cover?: string;
    addedAt: number;
    isProcessing?: boolean;
    isError?: boolean;
    errorMsg?: string;
    stats: BookStats;
    chapterCount: number;
    toc: TocItem[];
    hasProgress?: boolean;
    lastModified?: number;
    syncVersion?: number;
    language?: string;
    categoryIds: string[];
    // Settings synced per language
    languageSettings?: Record<string, NovelsReaderSettings>;
}

export interface NovelsCategory {
    id: string;
    name: string;
    order: number;
    createdAt: number;
    lastModified: number;
}

export interface NovelsCategoryMetadata {
    sortBy: string;
    sortDesc: boolean;
}

export interface NovelsParsedBook {
    chapters: string[];
    imageBlobs: Record<string, string>;
    chapterFilenames: string[];
}

export interface FileReference {
    bookId: string;
    fileType: 'epub' | 'content';
    fileHash: string;
    fileSize: number;
    lastModified: number;
    driveFileId?: string;
}

export interface SyncPayload {
    schemaVersion: number;
    deviceId: string;
    lastModified: number;
    novelsProgress: Record<string, NovelsProgress>;
    novelsMetadata: Record<string, NovelsMetadata>;
    novelsContent?: Record<string, NovelsParsedBook>;
    novelsFiles?: Record<string, string>;
    novelsCategories?: Record<string, NovelsCategory>;
    novelsCategoryMetadata?: Record<string, NovelsCategoryMetadata>;
    deletedBookIds?: string[];
    deletedFileRefs?: FileReference[];
}

export type SyncBackendType = 'none' | 'googledrive' | 'webdav' | 'syncyomi';

export type GoogleDriveFolderType = 'public' | 'appData';

export type DeletionBehavior = 'keepEverywhere' | 'deleteEverywhere' | 'askEachTime';

export interface SyncConfig {
    novels_progress: boolean;
    novels_metadata: boolean;
    novels_content: boolean;
    novels_files: boolean;
    syncOnChapterRead: boolean;
    syncOnChapterOpen: boolean;
    syncOnAppStart: boolean;
    syncOnAppResume: boolean;
    backend: SyncBackendType;
    google_drive_folder: string;
    google_drive_folder_type: GoogleDriveFolderType;
    deletion_behavior: DeletionBehavior;
}

export interface AuthStatus {
    connected: boolean;
    backend: string;
    email?: string;
    last_sync?: number;
    device_id: string;
}

export interface AuthFlow {
    authUrl: string;
    state: string;
}

export interface MergeRequest {
    payload: SyncPayload;
    config?: SyncConfig;
}

export interface ConflictInfo {
    book_id: string;
    field: string;
    local_value: string;
    remote_value: string;
    resolution: string;
}

export interface MergeResponse {
    payload: SyncPayload;
    sync_timestamp: number;
    files_to_upload: string[];
    files_to_download: string[];
    conflicts: ConflictInfo[];
}

export interface PushResponse {
    success: boolean;
    etag: string;
    sync_timestamp: number;
}

// Frontend-only types
export interface SyncState {
    status: AuthStatus | null;
    config: SyncConfig | null;
    is_syncing: boolean;
    last_sync_time: Date | null;
    error: string | null;
    sync_progress: SyncProgress | null;
}

export interface SyncProgress {
    phase: 'collecting' | 'uploading' | 'merging' | 'applying';
    message: string;
    percent?: number;
}
