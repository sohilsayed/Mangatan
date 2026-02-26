

import { useState, useEffect, useRef } from 'react';
import { AppStorage, LNMetadata, BookStats } from '@/lib/storage/AppStorage';

export interface BookContent {
    chapters: string[]; // Still keep for compatibility, but might be empty if lazy loading
    stats: BookStats;
    metadata: LNMetadata;
    chapterFilenames: string[];
}

interface UseBookContentReturn {
    content: BookContent | null;
    isLoading: boolean;
    error: string | null;
}


const blobUrlCache = new Map<string, Map<string, string>>();

export function useBookContent(bookId: string | undefined): UseBookContentReturn {
    const [content, setContent] = useState<BookContent | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const objectUrlsRef = useRef<string[]>([]);

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
                const metadata = await AppStorage.getLnMetadata(bookId);
                if (cancelled) return;

                if (!metadata) {
                    setError('Book not found. It may need to be re-imported.');
                    setIsLoading(false);
                    return;
                }

                setContent({
                    chapters: [], // We don't load all at once anymore
                    stats: metadata.stats,
                    metadata,
                    chapterFilenames: [],
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
    const cache = blobUrlCache.get(bookId);
    if (cache) {
        cache.forEach((url) => URL.revokeObjectURL(url));
        blobUrlCache.delete(bookId);
    }
}


export function clearAllBookCaches(): void {
    blobUrlCache.forEach((cache) => {
        cache.forEach((url) => URL.revokeObjectURL(url));
    });
    blobUrlCache.clear();
}