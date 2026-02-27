
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Settings } from '@/Manatan/types';
import { PagedReaderProps } from '../types/reader';
import { usePagination } from '../utils/usePagination';
import { getReaderTheme } from '../utils/themes';
import { buildTypographyStyles } from '../utils/styles';
import { ReaderNavigationUI } from './ReaderNavigationUI';
import { ClickZones, getClickZone } from './ClickZones';
import { SelectionHandles } from './SelectionHandles';
import { useTextLookup } from '../hooks/useTextLookup';
import { createSaveScheduler } from '../utils/readerSave';
import { detectVisibleBlockPaged } from '../utils/pagedPosition';
import { extractContextSnippet, calculateBlockLocalOffset, calculateChapterCharOffset } from '../utils/blockPosition';
import { calculateProgress } from '../utils/readerSave';
import './VirtualizedPagedReader.css';

export const VirtualizedPagedReader: React.FC<PagedReaderProps> = ({
    bookId,
    chapters,
    stats,
    settings,
    isVertical,
    isRTL,
    initialChapter = 0,
    initialPage = 0,
    initialProgress,
    onToggleUI,
    showNavigation = false,
    safeAreaTopInset,
    onPositionUpdate,
    onRegisterSave,
    onUpdateSettings,
    onAddHighlight,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [currentChapterIndex, setCurrentChapterIndex] = useState(initialChapter);
    const [currentPageIndex, setCurrentPageIndex] = useState(initialPage);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const hasInitialRestored = useRef(false);
    const [currentProgress, setCurrentProgress] = useState(initialProgress?.totalProgress || 0);

    const theme = useMemo(() => getReaderTheme(settings.lnTheme), [settings.lnTheme]);
    const { tryLookup } = useTextLookup();

    const { fragments, isMeasuring, measureContainerRef } = usePagination({
        html: chapters[currentChapterIndex],
        settings,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        isVertical
    });

    useEffect(() => {
        if (!isMeasuring && fragments.length > 0 && !hasInitialRestored.current && initialProgress?.blockId) {
            const index = fragments.findIndex(f =>
                f.blocks.some(b => b.includes(`data-block-id="${initialProgress.blockId}"`))
            );
            if (index !== -1) {
                setCurrentPageIndex(index);
                if (containerRef.current) {
                    const scrollOptions: ScrollToOptions = isVertical
                        ? { top: index * viewportSize.height }
                        : { left: index * viewportSize.width };
                    containerRef.current.scrollTo(scrollOptions);
                }
            }
            hasInitialRestored.current = true;
        }
    }, [isMeasuring, fragments, initialProgress, isVertical, viewportSize]);

    // Save scheduler
    const [isSaved, setIsSaved] = useState(true);
    const saveSchedulerRef = useRef(
        createSaveScheduler({
            bookId,
            debounceMs: 3000,
            autoSaveEnabled: settings.lnAutoBookmark ?? true,
            saveDelay: settings.lnBookmarkDelay ?? 0,
            onSaveStatusChange: setIsSaved,
        })
    );

    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const { width, height } = containerRef.current.getBoundingClientRect();
                setViewportSize({ width, height });
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    const goToPage = useCallback((page: number) => {
        if (!containerRef.current || fragments.length === 0) return;
        const clamped = Math.max(0, Math.min(page, fragments.length - 1));

        const scrollOptions: ScrollToOptions = isVertical
            ? { top: clamped * viewportSize.height, behavior: 'smooth' }
            : { left: clamped * viewportSize.width, behavior: 'smooth' };

        containerRef.current.scrollTo(scrollOptions);
        setCurrentPageIndex(clamped);
    }, [fragments.length, isVertical, viewportSize]);

    const handleScroll = useCallback(() => {
        if (!containerRef.current || isMeasuring) return;
        const { scrollLeft, scrollTop, clientWidth, clientHeight } = containerRef.current;

        const newIndex = isVertical
            ? Math.round(scrollTop / clientHeight)
            : Math.round(scrollLeft / clientWidth);

        if (newIndex !== currentPageIndex && newIndex >= 0 && newIndex < fragments.length) {
            setCurrentPageIndex(newIndex);
        }
    }, [currentPageIndex, fragments.length, isVertical, isMeasuring]);

    const detectAndReportPosition = useCallback(() => {
        if (isMeasuring || fragments.length === 0 || !containerRef.current || !stats) return;

        // In fragmented mode, the "visible block" is always the first block of the current fragment
        const currentFragment = fragments[currentPageIndex];
        if (!currentFragment) return;

        // Since we split by top-level blocks, the first block in the fragment is our anchor
        // We'll look for the first element with data-block-id in the current page
        const pageElement = containerRef.current.children[currentPageIndex] as HTMLElement;
        const blockElement = pageElement.querySelector('[data-block-id]');
        if (!blockElement) return;

        const blockId = blockElement.getAttribute('data-block-id')!;
        const blockLocalOffset = 0; // Anchored to start of page for now
        const contextSnippet = extractContextSnippet(blockElement, blockLocalOffset, 20);

        const chapterCharOffset = calculateChapterCharOffset(
            pageElement,
            blockId,
            blockLocalOffset,
            currentChapterIndex
        );

        const progressCalc = calculateProgress(currentChapterIndex, chapterCharOffset, stats);

        setCurrentProgress(progressCalc.totalProgress);

        onPositionUpdate?.({
            chapterIndex: currentChapterIndex,
            pageIndex: currentPageIndex,
            chapterCharOffset,
            sentenceText: contextSnippet,
            totalProgress: progressCalc.totalProgress,
            blockId,
        });

        saveSchedulerRef.current.scheduleSave({
            blockId,
            blockLocalOffset,
            contextSnippet,
            chapterIndex: currentChapterIndex,
            pageIndex: currentPageIndex,
            chapterCharOffset,
            totalCharsRead: progressCalc.totalCharsRead,
            chapterProgress: progressCalc.chapterProgress,
            totalProgress: progressCalc.totalProgress,
            sentenceText: contextSnippet,
        });
    }, [isMeasuring, fragments, currentPageIndex, currentChapterIndex, stats, onPositionUpdate]);

    useEffect(() => {
        if (!isMeasuring) {
            detectAndReportPosition();
        }
    }, [isMeasuring, currentPageIndex, currentChapterIndex, detectAndReportPosition]);

    const handleContentClick = useCallback(async (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, .nav-btn, .reader-progress-bar, .dict-popup')) return;

        const lookupSuccess = await tryLookup(e);
        if (lookupSuccess) return;

        if (settings.lnEnableClickZones && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const zone = getClickZone(e.clientX, e.clientY, rect, isVertical, settings.lnClickZonePlacement || 'vertical', settings.lnClickZoneSize || 10, settings.lnClickZonePosition || 'full', settings.lnClickZoneCoverage || 60);

            if (zone === 'prev') {
                if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                else if (currentChapterIndex > 0) {
                    setCurrentChapterIndex(currentChapterIndex - 1);
                    setCurrentPageIndex(999); // Will be clamped after pagination
                }
                return;
            }
            if (zone === 'next') {
                if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                else if (currentChapterIndex < chapters.length - 1) {
                    setCurrentChapterIndex(currentChapterIndex + 1);
                    setCurrentPageIndex(0);
                }
                return;
            }
        }

        onToggleUI?.();
    }, [tryLookup, settings, currentPageIndex, currentChapterIndex, fragments.length, chapters.length, isVertical, goToPage, onToggleUI]);

    const typographyStyles = useMemo(() => buildTypographyStyles(settings, isVertical), [settings, isVertical]);

    return (
        <div
            className="virtualized-paged-reader"
            style={{ backgroundColor: theme.bg, color: theme.fg }}
        >
            <div
                ref={containerRef}
                className={`pages-container ${isVertical ? 'vertical' : 'horizontal'}`}
                onScroll={handleScroll}
                onClick={handleContentClick}
            >
                {fragments.map((fragment, i) => (
                    <div key={i} className="reader-page">
                        <div
                            className={`page-content ${isVertical ? 'vertical-text' : ''}`}
                            style={{
                                padding: `${settings.lnPageMargin || 20}px`,
                                ...typographyStyles
                            }}
                        >
                            {fragment.blocks.map((blockHtml, bi) => (
                                <div key={bi} dangerouslySetInnerHTML={{ __html: blockHtml }} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {isMeasuring && (
                <div className="virtual-loading" style={{ backgroundColor: theme.bg }}>
                    <div className="loading-spinner" />
                    <span>Fragmenting chapter...</span>
                </div>
            )}

            <div ref={measureContainerRef} style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }} />

            <ReaderNavigationUI
                visible={showNavigation}
                onNext={() => goToPage(currentPageIndex + 1)}
                onPrev={() => goToPage(currentPageIndex - 1)}
                canGoNext={currentPageIndex < fragments.length - 1 || currentChapterIndex < chapters.length - 1}
                canGoPrev={currentPageIndex > 0 || currentChapterIndex > 0}
                currentPage={currentPageIndex}
                totalPages={fragments.length}
                currentChapter={currentChapterIndex}
                totalChapters={chapters.length}
                progress={currentProgress}
                theme={theme}
                isVertical={isVertical}
                mode="paged"
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                isSaved={isSaved}
            />

            <SelectionHandles
                containerRef={containerRef}
                enabled={!isMeasuring}
                theme={(settings.lnTheme as 'light' | 'sepia' | 'dark' | 'black') || 'dark'}
                onSelectionComplete={(text, startOffset, endOffset, blockId) => {
                    if (onAddHighlight && currentChapterIndex && blockId) {
                        onAddHighlight(currentChapterIndex, blockId, text, startOffset, endOffset);
                    }
                }}
            />
        </div>
    );
};
