import { BlockIndexMap } from '@/features/novels/reader/types/block';

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

    // Processing state
    isProcessing?: boolean;
    isError?: boolean;
    errorMsg?: string;

    // Pre-calculated on import
    stats: BookStats;
    chapterCount: number;
    toc: TocItem[];

    // For library display
    hasProgress?: boolean;

    // Language and categories
    language?: string;
    categoryIds: string[];

    // Settings per language (synced)
    languageSettings?: Record<string, NovelsReaderSettings>;
}

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
    // Current reading position (the bookmark)
    chapterIndex: number;
    pageNumber?: number;
    chapterCharOffset: number;
    totalCharsRead: number;
    sentenceText: string;
    chapterProgress: number;
    totalProgress: number;

    // Block tracking
    blockId?: string;
    blockLocalOffset?: number;
    contextSnippet?: string;

    // Sync metadata
    lastRead?: number;
    lastModified?: number;
    syncVersion?: number;
    deviceId?: string; // Track which device saved this

    // Highlights
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

export interface NovelsParsedBook {
    chapters: string[];
    imageBlobs: Record<string, Blob | string>;
    chapterFilenames: string[];
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
