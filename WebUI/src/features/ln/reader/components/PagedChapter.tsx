
import React, { useRef, useEffect, useState, useLayoutEffect, useMemo } from 'react';
import { Settings } from '@/Manatan/types';
import { BookStats } from '@/lib/storage/AppStorage';
import { SelectionHandles } from './SelectionHandles';
import { createChapterBlockLookup, getPositionFromCharOffset } from '../utils/blockMap';

interface PagedChapterProps {
    html: string;
    index: number;
    isActive: boolean;
    currentPage: number;
    layout: any;
    isVertical: boolean;
    isKorean: boolean;
    settings: Settings;
    measuredPageSize: number;
    setMeasuredPageSize: (size: number) => void;
    onPagesCalculated: (pages: number) => void;
    onPositionUpdate: (page: number, element: HTMLElement) => void;
    initialPage: number;
    initialProgress?: any;
    getContentStyle: () => React.CSSProperties;
    stats: BookStats | null;
    saveLockUntilRef: React.MutableRefObject<number>;
    restorePendingRef: React.MutableRefObject<boolean>;
    onToggleUI: () => void;
    onAddHighlight?: (chapterIndex: number, blockId: string, text: string, startOffset: number, endOffset: number) => void;
}

export const PagedChapter: React.FC<PagedChapterProps> = ({
    html,
    index,
    isActive,
    currentPage,
    layout,
    isVertical,
    isKorean,
    settings,
    measuredPageSize,
    setMeasuredPageSize,
    onPagesCalculated,
    onPositionUpdate,
    initialPage,
    initialProgress,
    getContentStyle,
    stats,
    saveLockUntilRef,
    restorePendingRef,
    onToggleUI,
    onAddHighlight,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [localPages, setLocalPages] = useState(1);
    const [ready, setReady] = useState(false);
    const lastRestoreKeyRef = useRef('');

    useLayoutEffect(() => {
        if (!contentRef.current || !layout) return;

        let cancelled = false;

        const calculatePages = async () => {
            const content = contentRef.current;
            if (!content || cancelled) return;

            // Wait for images
            const images = content.querySelectorAll('img');
            const imagePromises = Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise<void>(resolve => {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                    setTimeout(resolve, 100);
                });
            });

            await Promise.all(imagePromises);

            if (cancelled) return;

            // Force reflow
            void content.offsetHeight;
            void content.scrollWidth;

            const computedStyle = window.getComputedStyle(content);
            const actualColumnWidth = parseFloat(computedStyle.columnWidth) || layout.columnWidth;
            const actualGap = parseFloat(computedStyle.columnGap) || layout.gap;
            const actualPageSize = actualColumnWidth + actualGap;

            if (isActive) {
                setMeasuredPageSize(actualPageSize);
            }

            const scrollSize = isVertical ? content.scrollHeight : content.scrollWidth;
            let calculatedPages = 1;
            if (scrollSize > actualColumnWidth) {
                calculatedPages = Math.max(1, Math.ceil((scrollSize - 1) / actualPageSize));
            }

            setLocalPages(calculatedPages);
            onPagesCalculated(calculatedPages);
            setReady(true);
        };

        calculatePages();
        return () => { cancelled = true; };
    }, [html, layout, isVertical, isActive]);

    // Precise Restoration
    useEffect(() => {
        if (!ready || !isActive || !contentRef.current || measuredPageSize <= 0) return;

        const restoreKey = `${index}|${measuredPageSize}|${localPages}|${initialProgress?.blockId}`;
        if (restoreKey === lastRestoreKeyRef.current) return;

        const tryRestore = async () => {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const content = contentRef.current;
            if (!content) return;

            const anchorBlockId = initialProgress?.blockId;
            if (!anchorBlockId) {
                lastRestoreKeyRef.current = restoreKey;
                return;
            }

            let blockEl = content.querySelector(`[data-block-id="${anchorBlockId}"]`) as HTMLElement | null;

            if (!blockEl && stats?.blockMaps && initialProgress?.chapterCharOffset) {
                const chapterLookup = createChapterBlockLookup(stats.blockMaps, index);
                const pos = getPositionFromCharOffset(chapterLookup, initialProgress.chapterCharOffset);
                if (pos) {
                    blockEl = content.querySelector(`[data-block-id="${pos.blockId}"]`) as HTMLElement | null;
                }
            }

            if (!blockEl) {
                lastRestoreKeyRef.current = restoreKey;
                return;
            }

            const blockRect = blockEl.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const offset = isVertical ? (blockRect.top - contentRect.top) : (blockRect.left - contentRect.left);
            const targetPage = Math.floor(Math.abs(offset) / measuredPageSize);
            const clamped = Math.max(0, Math.min(targetPage, localPages - 1));

            lastRestoreKeyRef.current = restoreKey;
            restorePendingRef.current = true;
            onPositionUpdate(clamped, content);

            requestAnimationFrame(() => {
                restorePendingRef.current = false;
                saveLockUntilRef.current = Date.now() + 3000;
            });
        };

        tryRestore();
    }, [ready, isActive, measuredPageSize, localPages, initialProgress, index, isVertical, stats]);

    const itemStyle = useMemo(() => {
        const size = localPages * (measuredPageSize || (layout.columnWidth + layout.gap));
        return {
            width: isVertical ? layout.width : size,
            height: isVertical ? size : layout.height,
            flexShrink: 0,
            position: 'relative' as const,
        };
    }, [localPages, measuredPageSize, layout, isVertical]);

    return (
        <div className="paged-chapter-item" style={itemStyle} data-chapter={index}>
            {/* Snap Points */}
            <div className="paged-snap-container" style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: isVertical ? 'column' : 'row',
                pointerEvents: 'none',
            }}>
                {Array.from({ length: localPages }).map((_, i) => (
                    <div key={i} style={{
                        flexShrink: 0,
                        width: isVertical ? '100%' : measuredPageSize || layout.columnWidth + layout.gap,
                        height: isVertical ? measuredPageSize || layout.columnWidth + layout.gap : '100%',
                        scrollSnapAlign: 'start',
                    }} />
                ))}
            </div>

            <div
                ref={contentRef}
                className={`paged-content ${!settings.lnEnableFurigana ? 'furigana-hidden' : ''}`}
                lang={isKorean ? "ko" : undefined}
                style={getContentStyle()}
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {isActive && (
                <SelectionHandles
                    containerRef={contentRef}
                    enabled={ready}
                    theme={(settings.lnTheme as any) || 'dark'}
                    onSelectionComplete={(text, startOffset, endOffset, blockId) => {
                        if (onAddHighlight && blockId) {
                            onAddHighlight(index, blockId, text, startOffset, endOffset);
                        }
                    }}
                />
            )}
        </div>
    );
};
