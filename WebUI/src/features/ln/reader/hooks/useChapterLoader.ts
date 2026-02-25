/**
 * Lazy chapter loading hook
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AppStorage, LNHighlight } from '@/lib/storage/AppStorage';
import { injectHighlightsIntoHtml } from '../utils/injectHighlights';

interface UseChapterLoaderProps {
    bookId: string;
    chapterCount: number;
    highlights: LNHighlight[];
    preloadCount?: number;
}

interface UseChapterLoaderReturn {
    loadedChapters: Map<number, string>;
    isChapterLoaded: (index: number) => boolean;
    loadChapter: (index: number, immediate?: boolean) => Promise<void>;
    loadChaptersAround: (centerIndex: number) => void;
    getChapterHtml: (index: number) => string | null;
    loadingState: Map<number, boolean>;
}

const MAX_LOADED_CHAPTERS = 10;

export function useChapterLoader({
    bookId,
    chapterCount,
    highlights,
    preloadCount = 2,
}: UseChapterLoaderProps): UseChapterLoaderReturn {
    const [loadedChapters, setLoadedChapters] = useState<Map<number, string>>(new Map());
    const [loadingState, setLoadingState] = useState<Map<number, boolean>>(new Map());

    // Track Object URLs for revocation
    const objectUrlsRef = useRef<Map<number, string[]>>(new Map());
    const loadedOrderRef = useRef<number[]>([]);

    // Clear cache when book changes or highlights change significantly
    useEffect(() => {
        setLoadedChapters(new Map());
        setLoadingState(new Map());
        loadedOrderRef.current = [];
        objectUrlsRef.current.forEach(urls => {
            urls.forEach(url => URL.revokeObjectURL(url));
        });
        objectUrlsRef.current.clear();
    }, [bookId, highlights]);

    const resolveImages = async (html: string): Promise<{ processedHtml: string; urls: string[] }> => {
        const urls: string[] = [];
        const container = document.createElement('div');
        container.innerHTML = html;

        const images = container.querySelectorAll('[data-epub-src]');
        for (const img of Array.from(images)) {
            const path = img.getAttribute('data-epub-src');
            if (path) {
                const blob = await AppStorage.getImage(bookId, path);
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    img.setAttribute('src', url);
                    // Also update svg image xlink:href if needed
                    if (img.tagName.toLowerCase() === 'image') {
                        img.setAttribute('xlink:href', url);
                    }
                    urls.push(url);
                }
            }
        }

        return { processedHtml: container.innerHTML, urls };
    };

    const loadChapter = useCallback(async (index: number, immediate = false) => {
        if (index < 0 || index >= chapterCount) return;
        if (loadedOrderRef.current.includes(index)) {
            // Move to end of LRU
            loadedOrderRef.current = loadedOrderRef.current.filter(i => i !== index);
            loadedOrderRef.current.push(index);
            return;
        }

        setLoadingState(prev => {
            const next = new Map(prev);
            next.set(index, true);
            return next;
        });

        const performLoad = async () => {
            try {
                // 1. Fetch HTML from storage
                let html = await AppStorage.getChapter(bookId, index);

                // Fallback to legacy storage if not found in granular
                if (html === null) {
                    console.log(`[useChapterLoader] Chapter ${index} not found in granular storage, trying legacy...`);
                    const legacyContent = await AppStorage.getLnContent(bookId);
                    if (legacyContent && legacyContent.chapters[index]) {
                        html = legacyContent.chapters[index];
                    }
                }

                if (!html) {
                    throw new Error(`Chapter ${index} not found`);
                }

                // 2. Inject Highlights
                const chapterHighlights = highlights.filter(h => h.chapterIndex === index);
                const htmlWithHighlights = injectHighlightsIntoHtml(html, chapterHighlights);

                // 3. Resolve Images
                const { processedHtml, urls } = await resolveImages(htmlWithHighlights);

                // 4. Update State
                setLoadedChapters(prev => {
                    const next = new Map(prev);

                    // Manage sliding window / LRU
                    if (loadedOrderRef.current.length >= MAX_LOADED_CHAPTERS) {
                        const oldestIndex = loadedOrderRef.current.shift();
                        if (oldestIndex !== undefined) {
                            next.delete(oldestIndex);
                            // Revoke URLs
                            const urlsToRevoke = objectUrlsRef.current.get(oldestIndex) || [];
                            urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
                            objectUrlsRef.current.delete(oldestIndex);
                        }
                    }

                    next.set(index, processedHtml);
                    loadedOrderRef.current.push(index);
                    objectUrlsRef.current.set(index, urls);
                    return next;
                });
            } catch (err) {
                console.error(`[useChapterLoader] Failed to load chapter ${index}:`, err);
            } finally {
                setLoadingState(prev => {
                    const next = new Map(prev);
                    next.set(index, false);
                    return next;
                });
            }
        };

        if (immediate) {
            await performLoad();
        } else if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(() => performLoad(), { timeout: 2000 });
        } else {
            setTimeout(performLoad, 100);
        }
    }, [bookId, chapterCount, highlights]);

    const loadChaptersAround = useCallback((centerIndex: number) => {
        // FIRST: Immediately load the target chapter (highest priority for restoration)
        void loadChapter(centerIndex, true);
        
        // THEN: Load surrounding chapters with deferred priority
        const start = Math.max(0, centerIndex - preloadCount);
        const end = Math.min(chapterCount - 1, centerIndex + preloadCount);

        for (let i = start; i <= end; i++) {
            if (i !== centerIndex) {
                void loadChapter(i, false);
            }
        }
    }, [chapterCount, preloadCount, loadChapter]);

    const isChapterLoaded = useCallback((index: number): boolean => {
        return loadedChapters.has(index);
    }, [loadedChapters]);

    const getChapterHtml = useCallback((index: number): string | null => {
        return loadedChapters.get(index) || null;
    }, [loadedChapters]);

    // Cleanup Object URLs on unmount
    useEffect(() => {
        return () => {
            objectUrlsRef.current.forEach(urls => {
                urls.forEach(url => URL.revokeObjectURL(url));
            });
        };
    }, []);

    return {
        loadedChapters,
        isChapterLoaded,
        loadChapter,
        loadChaptersAround,
        getChapterHtml,
        loadingState,
    };
}