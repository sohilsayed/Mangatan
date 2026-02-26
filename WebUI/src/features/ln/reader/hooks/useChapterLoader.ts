/**
 * Lazy chapter loading hook
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { requestManager } from '@/lib/requests/RequestManager';

interface UseChapterLoaderProps {
    bookId: string;
    chapterCount: number;
    preloadCount?: number;
}

interface UseChapterLoaderReturn {
    loadedChapters: Map<number, string>;
    isChapterLoaded: (index: number) => boolean;
    loadChapter: (index: number) => void;
    loadChaptersAround: (centerIndex: number) => void;
    getChapterHtml: (index: number) => string | null;
    loadingState: Map<number, boolean>;
}

export function useChapterLoader({
    bookId,
    chapterCount,
    preloadCount = 2,
}: UseChapterLoaderProps): UseChapterLoaderReturn {
    const [loadedChapters, setLoadedChapters] = useState<Map<number, string>>(new Map());
    const [loadingState, setLoadingState] = useState<Map<number, boolean>>(new Map());
    const loadedRef = useRef<Set<number>>(new Set());

    const loadChapter = useCallback(async (index: number, immediate = false) => {
        if (index < 0 || index >= chapterCount) return;
        if (loadedRef.current.has(index)) return;

        loadedRef.current.add(index);

        setLoadingState(prev => {
            const next = new Map(prev);
            next.set(index, true);
            return next;
        });

        try {
            let html = await requestManager.getLnChapterContent(bookId, index);

            // Process image URLs
            html = html.replace(/data-epub-src="([^"]+)"/g, (match, path) => {
                const url = requestManager.getLnImageUrl(bookId, path);
                return `src="${url}" href="${url}" xlink:href="${url}" data-epub-src="${path}"`;
            });

            setLoadedChapters(prev => {
                const next = new Map(prev);
                next.set(index, html);
                return next;
            });
        } catch (e) {
            console.error(`Failed to load chapter ${index}:`, e);
            loadedRef.current.delete(index); // Allow retry
        } finally {
            setLoadingState(prev => {
                const next = new Map(prev);
                next.set(index, false);
                return next;
            });
        }
    }, [bookId, chapterCount]);

        // If immediate, execute NOW (for target chapter restoration)
        // Otherwise defer using requestIdleCallback
        if (immediate) {
            load();
        } else if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(load, { timeout: 100 });
        } else {
            setTimeout(load, 0);
        }
    }, [chapters]);

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

    // Load initial chapters
    useEffect(() => {
        loadChaptersAround(0);
    }, [loadChaptersAround]);

    return {
        loadedChapters,
        isChapterLoaded,
        loadChapter,
        loadChaptersAround,
        getChapterHtml,
        loadingState,
    };
}