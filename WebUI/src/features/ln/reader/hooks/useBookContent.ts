

import { useState, useEffect, useRef } from 'react';
import { AppStorage, LNMetadata, BookStats } from '@/lib/storage/AppStorage';

export interface BookContent {
    chapters: string[];
    stats: BookStats;
    metadata: LNMetadata;
    chapterFilenames: string[];
}

interface UseBookContentReturn {
    content: BookContent | null;
    isLoading: boolean;
    error: string | null;
}


export function useBookContent(bookId: string | undefined): UseBookContentReturn {
    const [content, setContent] = useState<BookContent | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!bookId) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // Ensure metadata is migrated (includes splitting monolithic storage)
                await AppStorage.migrateLnMetadata();

                if (cancelled) return;

                // Now only load metadata.
                // Chapters and images will be loaded lazily via useChapterLoader.
                const metadata = await AppStorage.getLnMetadata(bookId);

                if (cancelled) return;

                if (!metadata) {
                    setError('Book metadata not found. It may need to be re-imported.');
                    setIsLoading(false);
                    return;
                }

                // If granular storage is missing (old book), we can still load from lnContent as fallback
                let chapterFilenames = metadata.chapterFilenames || [];
                let initialChapters = new Array(metadata.chapterCount).fill('');

                setContent({
                    chapters: initialChapters,
                    stats: metadata.stats,
                    metadata,
                    chapterFilenames: chapterFilenames,
                });
                setIsLoading(false);

            } catch (err: any) {
                if (cancelled) return;
                console.error('[useBookContent] Load error:', err);
                setError(err.message || 'Failed to load book');
                setIsLoading(false);
            }
        };

        load();

        return () => {
            cancelled = true;
        };
    }, [bookId]);



    return { content, isLoading, error };
}


export function clearBookCache(bookId: string): void {
    // No-op for now, revocation is handled in useChapterLoader
}


export function clearAllBookCaches(): void {
    // No-op
}