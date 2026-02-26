import { useState, useCallback, useEffect } from 'react';
import { AppStorage, LNHighlight } from '@/lib/storage/AppStorage';

function generateId(): string {
    return `hl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function useHighlights(bookId: string) {
    const [highlights, setHighlights] = useState<LNHighlight[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await AppStorage.getLnHighlights(bookId);
            setHighlights(data);
        } catch (e) {
            console.warn('[useHighlights] Failed to load:', e);
            setHighlights([]);
        } finally {
            setLoading(false);
        }
    }, [bookId]);

    useEffect(() => {
        load();
    }, [load]);

    const addHighlight = useCallback(async (
        chapterIndex: number,
        blockId: string,
        text: string,
        startOffset: number,
        endOffset: number
    ) => {
        // Check for duplicate or overlapping highlight in the same block
        const hasOverlap = highlights.some(h => 
            h.chapterIndex === chapterIndex &&
            h.blockId === blockId &&
            !(endOffset <= h.startOffset || startOffset >= h.endOffset)
        );
        
        if (hasOverlap) {
            console.warn('[useHighlights] Overlapping highlight ignored');
            return null;
        }

        const newHighlight: LNHighlight = {
            id: generateId(),
            chapterIndex,
            blockId,
            text,
            startOffset,
            endOffset,
            createdAt: Date.now(),
        };

        setHighlights(prev => [...prev, newHighlight]);
        await AppStorage.addLnHighlight(bookId, newHighlight);
        return newHighlight;
    }, [bookId, highlights]);

    const removeHighlight = useCallback(async (highlightId: string) => {
        setHighlights(prev => prev.filter(h => h.id !== highlightId));
        await AppStorage.deleteLnHighlight(bookId, highlightId);
    }, [bookId]);

    const getHighlightsForChapter = useCallback((chapterIndex: number): LNHighlight[] => {
        return highlights.filter(h => h.chapterIndex === chapterIndex);
    }, [highlights]);

    const exportToTxt = useCallback((chapterTitles: string[]): string => {
        const lines: string[] = [];
        
        const byChapter = new Map<number, LNHighlight[]>();
        for (const h of highlights) {
            const list = byChapter.get(h.chapterIndex) ?? [];
            list.push(h);
            byChapter.set(h.chapterIndex, list);
        }

        const sortedChapters = Array.from(byChapter.keys()).sort((a, b) => a - b);

        for (const chIdx of sortedChapters) {
            const chHighlights = byChapter.get(chIdx) ?? [];
            const title = chapterTitles[chIdx] ?? `Chapter ${chIdx + 1}`;
            
            lines.push(`【${title}】`);
            lines.push('');

            const sorted = [...chHighlights].sort((a, b) => a.createdAt - b.createdAt);
            for (const h of sorted) {
                const date = new Date(h.createdAt).toLocaleDateString();
                lines.push(`${h.text} (${date})`);
                lines.push('');
            }
            lines.push('');
        }

        return lines.join('\n');
    }, [highlights]);

    const exportToJson = useCallback((): string => {
        return JSON.stringify(highlights, null, 2);
    }, [highlights]);

    const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
        const manatanNative = (window as any).ManatanNative;
        if (manatanNative?.saveFile) {
            manatanNative.saveFile(filename, mimeType, content);
            return;
        }
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, []);

    return {
        highlights,
        loading,
        addHighlight,
        removeHighlight,
        getHighlightsForChapter,
        exportToTxt,
        exportToJson,
        downloadFile,
        refresh: load,
    };
}
