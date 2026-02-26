/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { BlockIndexMap } from '@/features/ln/reader/types/block';
import { jsonSaveParse } from '@/lib/HelperFunctions.ts';
import localforage from 'localforage';
import { requestManager } from '@/lib/requests/RequestManager';

type StorageBackend = typeof window.localStorage | null;

export class Storage {
    private readonly memory = new Map<string, string>();

    constructor(private readonly storage: StorageBackend) {}

    parseValue<T>(value: string | null, defaultValue: T): T {
        if (value === null) {
            return defaultValue;
        }

        const parsedValue = jsonSaveParse(value);

        if (value === 'null' || value === 'undefined') {
            return parsedValue;
        }

        return parsedValue ?? (value as T);
    }

    getItem(key: string): string | null {
        if (!this.storage) {
            return this.memory.get(key) ?? null;
        }

        try {
            return this.storage.getItem(key);
        } catch {
            return this.memory.get(key) ?? null;
        }
    }

    getItemParsed<T>(key: string, defaultValue: T): T {
        return this.parseValue(this.getItem(key), defaultValue);
    }

    setItem(key: string, value: unknown, emitEvent: boolean = true): void {
        const currentValue = this.getItem(key);

        const fireEvent = (valueToStore: string | undefined) => {
            if (!emitEvent) {
                return;
            }

            window.dispatchEvent(
                new StorageEvent('storage', {
                    key,
                    oldValue: currentValue,
                    newValue: valueToStore,
                }),
            );
        };

        if (value === undefined) {
            if (this.storage) {
                try {
                    this.storage.removeItem(key);
                } catch {
                    this.memory.delete(key);
                }
            } else {
                this.memory.delete(key);
            }
            fireEvent(undefined);
            return;
        }

        const stringify = typeof value !== 'string';
        const valueToStore = stringify ? JSON.stringify(value) : value;

        if (this.storage) {
            try {
                this.storage.setItem(key, valueToStore);
            } catch {
                this.memory.set(key, valueToStore);
            }
        } else {
            this.memory.set(key, valueToStore);
        }
        fireEvent(valueToStore as string);
    }

    setItemIfMissing(key: string, value: unknown, emitEvent?: boolean): void {
        if (this.getItem(key) === null) {
            this.setItem(key, value, emitEvent);
        }
    }
}

// ============================================================================
// Types
// ============================================================================

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

export interface LNMetadata {
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
    languageSettings?: Record<string, LNReaderSettings>;
}

export interface LNReaderSettings {
    lnFontSize: number;
    lnLineHeight: number;
    lnFontFamily: string;
    lnTheme: 'light' | 'sepia' | 'dark' | 'black';
    lnReadingDirection: 'horizontal' | 'vertical-rtl' | 'vertical-ltr';
    lnPaginationMode: 'scroll' | 'paginated' | 'single-page';
    lnPageWidth: number;
    lnPageMargin: number;
    lnEnableFurigana: boolean;
    lnTextAlign: 'left' | 'center' | 'justify';
    lnLetterSpacing: number;
    lnParagraphSpacing: number;
    lnTextBrightness: number;
    lnFontWeight: number;
    lnSecondaryFontFamily: string;
    lnAutoBookmark: boolean;
    lnBookmarkDelay: number;
    lnLockProgressBar: boolean;
    lnHideNavButtons: boolean;
    lnEnableSwipe: boolean;
    lnDragThreshold: number;
    lnEnableClickZones: boolean;
    lnClickZoneSize: number;
    lnClickZonePlacement: 'vertical' | 'horizontal';
    lnClickZonePosition: 'full' | 'start' | 'center' | 'end';
    lnClickZoneCoverage: number;
    lnDisableAnimations: boolean;
    lnShowCharProgress: boolean;
    enableYomitan: boolean;
    interactionMode: 'hover' | 'click';
}

export interface LNProgress {
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
    highlights?: LNHighlight[];
}

export interface LNHighlight {
    id: string;
    chapterIndex: number;
    blockId: string;
    text: string;
    startOffset: number;
    endOffset: number;
    createdAt: number;
}

export interface LNParsedBook {
    chapters: string[];
    imageBlobs: Record<string, Blob>;
    chapterFilenames: string[];
}

export interface LnCategory {
    id: string;
    name: string;
    order: number;
    createdAt: number;
    lastModified: number;
}

export interface LnCategoryMetadata {
    sortBy: string;
    sortDesc: boolean;
}

// ============================================================================
// Device ID Helper
// ============================================================================

function getDeviceId(): string {
    const key = 'manatan_device_id';
    let deviceId = localStorage.getItem(key);
    
    if (!deviceId) {
        deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem(key, deviceId);
    }
    
    return deviceId;
}

// ============================================================================
// AppStorage Class
// ============================================================================

export class AppStorage {
    static readonly local = new Storage(AppStorage.getSafeStorage(() => window.localStorage));
    static readonly session = new Storage(AppStorage.getSafeStorage(() => window.sessionStorage));

    // Raw EPUB files
    static readonly files = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_files',
        description: 'EPUB source files',
    });

    // Book metadata with stats
    static readonly lnMetadata = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_metadata',
        description: 'Light Novel metadata',
    });

    // Pre-parsed book content
    static readonly lnContent = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_content',
        description: 'Pre-parsed book chapters and images',
    });

    // Reading progress (the bookmark)
    static readonly lnProgress = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_progress',
        description: 'Reading progress',
    });

    // LN Categories
    static readonly lnCategories = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_categories',
        description: 'Light Novel categories',
    });

    // LN Category metadata (sort settings per category)
    static readonly lnCategoryMetadata = localforage.createInstance({
        name: 'Manatan',
        storeName: 'ln_category_metadata',
        description: 'Light Novel category metadata',
    });

    // Custom imported fonts
    static readonly customFonts = localforage.createInstance({
        name: 'Manatan',
        storeName: 'custom_fonts',
        description: 'User-imported font files',
    });

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private static getSafeStorage(getter: () => StorageBackend): StorageBackend {
        try {
            return getter();
        } catch {
            return null;
        }
    }

    // ========================================================================
    // Progress Methods
    // ========================================================================

    static async saveLnProgress(
        bookId: string,
        progress: Partial<LNProgress>
    ): Promise<void> {
        const existing = await this.getLnProgress(bookId);
        const now = Date.now();

        const fullProgress = {
            ...progress,
            lastRead: progress.lastRead || now,
            lastModified: progress.lastModified || now,
            syncVersion: progress.syncVersion || (existing?.syncVersion || 0) + 1,
            deviceId: progress.deviceId || getDeviceId(),
        } as LNProgress;

        try {
            await requestManager.saveLnProgress(bookId, fullProgress).response;
        } catch (e) {
            console.error('[AppStorage] Failed to save progress to server:', e);
        }

        await this.lnProgress.setItem(bookId, fullProgress);
    }

    static async getLnProgress(bookId: string): Promise<LNProgress | null> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/${bookId}/progress`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch progress for ${bookId}:`, e);
        }

        try {
            return await this.lnProgress.getItem<LNProgress>(bookId);
        } catch {
            return null;
        }
    }

    static async hasProgress(bookId: string): Promise<boolean> {
        const progress = await this.getLnProgress(bookId);
        return progress !== null && progress.totalProgress > 0;
    }

    // ========================================================================
    // Metadata Methods
    // ========================================================================

    static async getLnMetadata(bookId: string): Promise<LNMetadata | null> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/${bookId}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch metadata for ${bookId}:`, e);
        }

        try {
            return await this.lnMetadata.getItem<LNMetadata>(bookId);
        } catch {
            return null;
        }
    }

    static async saveLnMetadata(metadata: LNMetadata): Promise<void> {
        // Metadata is usually saved during import on server,
        // but for updates (categories, etc.) we might need a PUT endpoint.
        // For now, we still save to local IndexedDB as well.
        await this.lnMetadata.setItem(metadata.id, metadata);
    }

    static async updateLnMetadata(bookId: string, updates: Partial<LNMetadata>): Promise<void> {
        const existing = await this.getLnMetadata(bookId);
        if (!existing) return;

        await this.lnMetadata.setItem(bookId, {
            ...existing,
            ...updates,
        });
    }

    static async getAllLnMetadata(): Promise<LNMetadata[]> {
        try {
            const books = await requestManager.getClient().fetcher('/api/v1/ln');
            const data = await books.json();
            if (data && Array.isArray(data)) {
                return data;
            }
        } catch (e) {
            console.error('[AppStorage] Failed to fetch LN library from server:', e);
        }

        return this.getLocalOnlyLnMetadata();
    }

    static async getLocalOnlyLnMetadata(): Promise<LNMetadata[]> {
        const keys = await this.lnMetadata.keys();
        const allMetadata: LNMetadata[] = [];

        for (const key of keys) {
            try {
                const metadata = await this.lnMetadata.getItem<LNMetadata>(key as string);
                if (metadata) {
                    allMetadata.push(metadata);
                }
            } catch {
                // Ignore
            }
        }

        return allMetadata.sort((a, b) => b.addedAt - a.addedAt);
    }

    // ========================================================================
    // Content Methods
    // ========================================================================

    static async getLnContent(bookId: string): Promise<LNParsedBook | null> {
        try {
            return await this.lnContent.getItem<LNParsedBook>(bookId);
        } catch {
            return null;
        }
    }

    static async saveLnContent(bookId: string, content: LNParsedBook): Promise<void> {
        await this.lnContent.setItem(bookId, content);
    }

    static async getLnFile(bookId: string): Promise<Blob | null> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/${bookId}/file`);
            if (response.ok) {
                return await response.blob();
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch file for ${bookId}:`, e);
        }
        return await this.files.getItem<Blob>(bookId);
    }

    static async getLnContentFromServer(bookId: string): Promise<LNParsedBook | null> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/${bookId}/content`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch content for ${bookId}:`, e);
        }
        return await this.getLnContent(bookId);
    }

    // ========================================================================
    // Delete Methods
    // ========================================================================

    static async deleteLnData(bookId: string): Promise<void> {
        await Promise.all([
            this.files.removeItem(bookId),
            this.lnMetadata.removeItem(bookId),
            this.lnContent.removeItem(bookId),
            this.lnProgress.removeItem(bookId),
        ]);
        console.log('[AppStorage] All data deleted for:', bookId);
    }

    static async deleteLnProgress(bookId: string): Promise<void> {
        await this.lnProgress.removeItem(bookId);
    }

    // ========================================================================
    // Highlight Methods
    // ========================================================================

    static async getLnHighlights(bookId: string): Promise<LNHighlight[]> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/${bookId}/highlights`);
            if (response.ok) {
                const data = await response.json();
                return data.highlights || [];
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch highlights for ${bookId}:`, e);
        }

        const progress = await this.getLnProgress(bookId);
        return progress?.highlights || [];
    }

    static async addLnHighlight(bookId: string, highlight: LNHighlight): Promise<void> {
        try {
            await requestManager.addLnHighlight(bookId, highlight).response;
        } catch (e) {
            console.error(`[AppStorage] Failed to add highlight for ${bookId}:`, e);
        }

        const progress = await this.getLnProgress(bookId);
        if (progress) {
            const highlights = [...(progress.highlights || []), highlight];
            await this.saveLnProgress(bookId, { ...progress, highlights });
        }
    }

    static async deleteLnHighlight(bookId: string, highlightId: string): Promise<void> {
        try {
            await requestManager.deleteLnHighlight(bookId, highlightId).response;
        } catch (e) {
            console.error(`[AppStorage] Failed to delete highlight for ${bookId}:`, e);
        }

        const progress = await this.getLnProgress(bookId);
        if (progress) {
            const highlights = (progress.highlights || []).filter(h => h.id !== highlightId);
            await this.saveLnProgress(bookId, { ...progress, highlights });
        }
    }

    // ========================================================================
    // Sync Methods
    // ========================================================================

    static async getAllProgressForSync(): Promise<Array<{ bookId: string; progress: LNProgress }>> {
        const keys = await this.lnProgress.keys();
        const allProgress: Array<{ bookId: string; progress: LNProgress }> = [];

        for (const bookId of keys) {
            const progress = await this.getLnProgress(bookId as string);
            if (progress) {
                allProgress.push({ bookId: bookId as string, progress });
            }
        }

        return allProgress;
    }

    static async getProgressModifiedSince(timestamp: number): Promise<Array<{ bookId: string; progress: LNProgress }>> {
        const all = await this.getAllProgressForSync();
        return all.filter(({ progress }) => (progress.lastModified || 0) > timestamp);
    }

    static async mergeRemoteProgress(
        bookId: string, 
        remoteProgress: LNProgress
    ): Promise<{ result: 'local' | 'remote' | 'conflict'; merged?: LNProgress }> {
        const localProgress = await this.getLnProgress(bookId);

        // No local progress, use remote
        if (!localProgress) {
            await this.lnProgress.setItem(bookId, remoteProgress);
            return { result: 'remote' };
        }

        // No timestamps, use whichever has more progress
        if (!localProgress.lastModified || !remoteProgress.lastModified) {
            if (remoteProgress.totalProgress > localProgress.totalProgress) {
                await this.lnProgress.setItem(bookId, remoteProgress);
                return { result: 'remote' };
            }
            return { result: 'local' };
        }

        // Same device, use latest
        if (localProgress.deviceId === remoteProgress.deviceId) {
            if (remoteProgress.lastModified > localProgress.lastModified) {
                await this.lnProgress.setItem(bookId, remoteProgress);
                return { result: 'remote' };
            }
            return { result: 'local' };
        }

        // Different devices - conflict resolution
        // Strategy: Use whichever is further ahead, or more recent if same progress
        if (remoteProgress.totalProgress > localProgress.totalProgress) {
            await this.lnProgress.setItem(bookId, remoteProgress);
            return { result: 'remote' };
        } else if (localProgress.totalProgress > remoteProgress.totalProgress) {
            return { result: 'local' };
        } else {
            // Same progress, use most recent
            if (remoteProgress.lastModified > localProgress.lastModified) {
                await this.lnProgress.setItem(bookId, remoteProgress);
                return { result: 'remote' };
            }
            return { result: 'local' };
        }
    }

    static async exportProgressData(): Promise<string> {
        const allProgress = await this.getAllProgressForSync();
        return JSON.stringify({
            version: 1,
            exportedAt: Date.now(),
            deviceId: getDeviceId(),
            data: allProgress,
        });
    }

    static async importProgressData(jsonData: string): Promise<{ imported: number; conflicts: number }> {
        const parsed = JSON.parse(jsonData);
        if (parsed.version !== 1) {
            throw new Error('Unsupported export version');
        }

        let imported = 0;
        let conflicts = 0;

        for (const { bookId, progress } of parsed.data) {
            const result = await this.mergeRemoteProgress(bookId, progress);
            if (result.result === 'remote') {
                imported++;
            } else if (result.result === 'conflict') {
                conflicts++;
            }
        }

        return { imported, conflicts };
    }

    // ========================================================================
    // Block Check Methods
    // ========================================================================

    static async hasBookBlocks(bookId: string): Promise<boolean> {
        const metadata = await this.getLnMetadata(bookId);
        if (!metadata) return false;

        return metadata.stats.blockMaps && metadata.stats.blockMaps.length > 0;
    }

    // ========================================================================
    // Migration Methods
    // ========================================================================

    static async migrateLnMetadata(): Promise<void> {
        const keys = await this.lnMetadata.keys();
        
        for (const key of keys) {
            const metadata = await this.lnMetadata.getItem<any>(key as string);
            if (!metadata) continue;

            let needsUpdate = false;
            const migrated = { ...metadata };

            // Migrate language field
            if (migrated.language === undefined) {
                migrated.language = 'unknown';
                needsUpdate = true;
            }

            // Migrate categoryIds field
            if (!migrated.categoryIds) {
                migrated.categoryIds = migrated.category_ids || [];
                needsUpdate = true;
            }

            // Migrate snake_case to camelCase for stats
            if (migrated.stats?.chapter_lengths !== undefined) {
                migrated.stats = {
                    chapterLengths: migrated.stats.chapter_lengths || migrated.stats.chapterLengths || [],
                    totalLength: migrated.stats.total_length || migrated.stats.totalLength || 0,
                    blockMaps: migrated.stats.block_maps || migrated.stats.blockMaps || [],
                };
                needsUpdate = true;
            }

            // Migrate old reader-format blockMaps (nested blocks array) to flat format
            const blockMaps = migrated.stats?.blockMaps || [];
            if (blockMaps.length > 0 && blockMaps[0]?.blocks !== undefined) {
                console.log(`[Migration] Converting reader-format blockMaps for ${key}`);
                migrated.stats.blockMaps = blockMaps.flatMap((chapter: any) => {
                    if (!chapter.blocks || !Array.isArray(chapter.blocks)) return [];
                    return chapter.blocks.map((block: any) => ({
                        blockId: block.id || `ch${chapter.chapterIndex}-b${block.order || 0}`,
                        startOffset: block.cleanCharStart || 0,
                        endOffset: (block.cleanCharStart || 0) + (block.cleanCharCount || 0),
                    }));
                });
                needsUpdate = true;
            }

            if (blockMaps.length > 1 && typeof blockMaps[0]?.startOffset === 'number') {
                const firstBlock = blockMaps[0];
                const secondBlock = blockMaps[1];
                
                // If startOffset looks like it's using order (0, 1, 2...) instead of character offsets
                if (firstBlock.startOffset === 0 && secondBlock.startOffset === (blockMaps[0]?.endOffset || 0)) {
                    // This looks correct - endOffset of first = startOffset of second
                } else if (firstBlock.startOffset === 0 && secondBlock.startOffset < 100 && blockMaps[0]?.endOffset > 100) {
                    // Suspicious: startOffset is small but endOffset is large
                    console.warn(`[Migration] BlockMaps for ${key} may have incorrect offsets. Consider re-importing the book.`);
                }
            }

            if (needsUpdate) {
                await this.lnMetadata.setItem(key as string, migrated);
            }
        }
    }

    // ========================================================================
    // Category Methods
    // ========================================================================

    static async getLnCategories(): Promise<LnCategory[]> {
        try {
            const response = await requestManager.getClient().fetcher('/api/v1/ln/categories');
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error('[AppStorage] Failed to fetch LN categories from server:', e);
        }

        return this.getLocalOnlyLnCategories();
    }

    static async getLocalOnlyLnCategories(): Promise<LnCategory[]> {
        const keys = await this.lnCategories.keys();
        const categories: LnCategory[] = [];

        for (const key of keys) {
            try {
                const category = await this.lnCategories.getItem<LnCategory>(key as string);
                if (category) {
                    categories.push(category);
                }
            } catch {
                // Ignore
            }
        }

        return categories.sort((a, b) => a.order - b.order);
    }

    static async getLnCategory(categoryId: string): Promise<LnCategory | null> {
        const all = await this.getLnCategories();
        return all.find(c => c.id === categoryId) || null;
    }

    static async saveLnCategory(category: LnCategory): Promise<void> {
        try {
            await requestManager.updateLnCategory(category.id, category).response;
        } catch (e) {
            console.error('[AppStorage] Failed to save LN category to server:', e);
        }
        await this.lnCategories.setItem(category.id, category);
    }

    static async createLnCategory(name: string): Promise<LnCategory> {
        const categories = await this.getLnCategories();
        const maxOrder = categories.reduce((max, c) => Math.max(max, c.order), -1);
        
        const newCategory: LnCategory = {
            id: `lncat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            order: maxOrder + 1,
            createdAt: Date.now(),
            lastModified: Date.now(),
        };

        try {
            await requestManager.createLnCategory(newCategory).response;
        } catch (e) {
            console.error('[AppStorage] Failed to create LN category on server:', e);
        }

        await this.lnCategories.setItem(newCategory.id, newCategory);
        return newCategory;
    }

    static async updateLnCategory(categoryId: string, updates: Partial<LnCategory>): Promise<void> {
        const existing = await this.getLnCategory(categoryId);
        if (!existing) return;

        const updated = {
            ...existing,
            ...updates,
            lastModified: Date.now(),
        };

        try {
            await requestManager.updateLnCategory(categoryId, updated).response;
        } catch (e) {
            console.error('[AppStorage] Failed to update LN category on server:', e);
        }

        await this.lnCategories.setItem(categoryId, updated);
    }

    static async deleteLnCategory(categoryId: string): Promise<void> {
        try {
            await requestManager.deleteLnCategory(categoryId).response;
        } catch (e) {
            console.error('[AppStorage] Failed to delete LN category on server:', e);
        }

        await this.lnCategories.removeItem(categoryId);
        await this.lnCategoryMetadata.removeItem(categoryId);

        const keys = await this.lnMetadata.keys();
        for (const key of keys) {
            const metadata = await this.lnMetadata.getItem<LNMetadata>(key as string);
            if (metadata && metadata.categoryIds?.includes(categoryId)) {
                metadata.categoryIds = metadata.categoryIds.filter(id => id !== categoryId);
                await this.lnMetadata.setItem(key as string, metadata);
            }
        }
    }

    static async getLnCategoryMetadata(categoryId: string): Promise<LnCategoryMetadata | null> {
        try {
            const response = await requestManager.getClient().fetcher(`/api/v1/ln/categories/${categoryId}/metadata`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error(`[AppStorage] Failed to fetch metadata for category ${categoryId}:`, e);
        }

        try {
            return await this.lnCategoryMetadata.getItem<LnCategoryMetadata>(categoryId);
        } catch {
            return null;
        }
    }

    static async setLnCategoryMetadata(categoryId: string, metadata: LnCategoryMetadata): Promise<void> {
        try {
            await requestManager.saveLnCategoryMetadata(categoryId, metadata).response;
        } catch (e) {
            console.error(`[AppStorage] Failed to save metadata for category ${categoryId}:`, e);
        }
        await this.lnCategoryMetadata.setItem(categoryId, metadata);
    }

    static async getAllLnCategoryMetadata(): Promise<Record<string, LnCategoryMetadata>> {
        try {
            const data = await requestManager.listAllLnCategoryMetadata();
            if (data) {
                return data;
            }
        } catch (e) {
            console.error('[AppStorage] Failed to fetch all LN category metadata from server:', e);
        }

        return this.getLocalOnlyLnCategoryMetadata();
    }

    static async getLocalOnlyLnCategoryMetadata(): Promise<Record<string, LnCategoryMetadata>> {
        const keys = await this.lnCategoryMetadata.keys();
        const metadata: Record<string, LnCategoryMetadata> = {};

        for (const key of keys) {
            try {
                const catMeta = await this.lnCategoryMetadata.getItem<LnCategoryMetadata>(key as string);
                if (catMeta) {
                    metadata[key as string] = catMeta;
                }
            } catch {
                // Ignore
            }
        }

        return metadata;
    }
}