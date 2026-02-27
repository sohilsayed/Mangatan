
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
import { scrollToPageRTL, getRTLPageIndex } from '../utils/rtlScroll';
import { handleKeyNavigation, NavigationCallbacks, NavigationOptions } from '../utils/navigation';
import { FragmentBlock } from '../utils/fragmenter';
import './VirtualizedPagedReader.css';

const BlockRenderer: React.FC<{ block: FragmentBlock, isVertical: boolean }> = ({ block, isVertical }) => {
    const isTall = block.visualOffset !== undefined;

    if (isTall) {
        return (
            <div
                style={{
                    position: 'relative',
                    width: isVertical ? `${block.clippingHeight}px` : '100%',
                    height: isVertical ? '100%' : `${block.clippingHeight}px`,
                    overflow: 'hidden',
                }}
                data-block-id={block.blockId || undefined}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: isVertical ? 0 : -block.visualOffset!,
                        right: isVertical ? -block.visualOffset! : 0,
                        width: isVertical ? 'auto' : '100%',
                        height: isVertical ? '100%' : 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: block.html }}
                />
            </div>
        );
    }

    return (
        <div
            style={{ display: isVertical ? 'inline-block' : 'block' }}
            data-block-id={block.blockId || undefined}
            dangerouslySetInnerHTML={{ __html: block.html }}
        />
    );
};

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
    const isProgrammaticScroll = useRef(false);
    const lastSeenCharOffset = useRef<number>(initialProgress?.chapterCharOffset || 0);
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
        if (currentChapterIndex !== initialChapter) {
            setCurrentChapterIndex(initialChapter);
            hasInitialRestored.current = false;
            lastSeenCharOffset.current = 0;
            if (containerRef.current) {
                containerRef.current.scrollLeft = isRTL ? 999999 : 0;
            }
        }
    }, [initialChapter, isRTL]);

    useEffect(() => {
        // Reset restoration when blockId changes (from search/highlights)
        if (initialProgress?.blockId) {
            hasInitialRestored.current = false;
            lastSeenCharOffset.current = 0;
        }
    }, [initialProgress?.blockId]);

    useEffect(() => {
        if (!isMeasuring && fragments.length > 0 && !hasInitialRestored.current) {
            let targetPage = 0;

            // Restoration prioritized by: charOffset > blockId > initialPage
            // Use lastSeenCharOffset for resize or chapter switch restoration if valid
            const charOffsetToRestore = lastSeenCharOffset.current > 0
                ? lastSeenCharOffset.current
                : (initialProgress?.chapterCharOffset ?? 0);

            if (charOffsetToRestore > 0) {
                const index = fragments.findIndex((f, i) => {
                    const nextF = fragments[i + 1];
                    return charOffsetToRestore >= f.charOffset &&
                           (!nextF || charOffsetToRestore < nextF.charOffset);
                });
                if (index !== -1) targetPage = index;
            } else if (initialProgress?.blockId) {
                const index = fragments.findIndex(f =>
                    f.blocks.some(b => b.blockId === initialProgress.blockId)
                );
                if (index !== -1) targetPage = index;
            } else if (initialPage > 0) {
                targetPage = initialPage;
            }

            setCurrentPageIndex(targetPage);

            if (containerRef.current) {
                const width = containerRef.current.clientWidth;
                if (isRTL) {
                    scrollToPageRTL(containerRef.current, targetPage, width, 'instant' as any);
                } else {
                    containerRef.current.scrollTo({
                        left: targetPage * width,
                        behavior: 'instant' as any
                    });
                }
            }

            hasInitialRestored.current = true;
        }
    }, [isMeasuring, fragments, initialProgress, isRTL, initialPage]);

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
        onRegisterSave?.(saveSchedulerRef.current.saveNow);
    }, [onRegisterSave]);

    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const { width, height } = containerRef.current.getBoundingClientRect();
                setViewportSize(prev => {
                    if (prev.width !== width || prev.height !== height) {
                        hasInitialRestored.current = false; // Trigger re-scroll on size change
                        return { width, height };
                    }
                    return prev;
                });
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    const goToPage = useCallback((page: number, behavior: 'smooth' | 'instant' = 'smooth') => {
        if (!containerRef.current || fragments.length === 0) return;
        const clamped = Math.max(0, Math.min(page, fragments.length - 1));

        isProgrammaticScroll.current = true;
        const width = containerRef.current.clientWidth;
        if (isRTL) {
            scrollToPageRTL(containerRef.current, clamped, width, behavior as any);
        } else {
            containerRef.current.scrollTo({
                left: clamped * width,
                behavior
            });
        }
        setCurrentPageIndex(clamped);
        setTimeout(() => { isProgrammaticScroll.current = false; }, 500);
    }, [fragments.length, isRTL]);

    const goToSection = useCallback((sectionIndex: number, goToLastPage = false) => {
        const clamped = Math.max(0, Math.min(sectionIndex, chapters.length - 1));
        if (clamped === currentChapterIndex) return;

        saveSchedulerRef.current.saveNow();

        hasInitialRestored.current = false;
        lastSeenCharOffset.current = goToLastPage ? 999999999 : 0;
        setCurrentChapterIndex(clamped);
        setCurrentPageIndex(0);
    }, [chapters.length, currentChapterIndex]);

    const handleScroll = useCallback(() => {
        if (!containerRef.current || isMeasuring || isProgrammaticScroll.current) return;

        const width = containerRef.current.clientWidth;
        if (width <= 0) return;

        let newIndex: number;
        if (isRTL) {
            newIndex = getRTLPageIndex(containerRef.current, width);
        } else {
            const { scrollLeft } = containerRef.current;
            newIndex = Math.round(scrollLeft / width);
        }

        if (newIndex !== currentPageIndex && newIndex >= 0 && newIndex < fragments.length) {
            setCurrentPageIndex(newIndex);
        }
    }, [currentPageIndex, fragments.length, isMeasuring, isRTL]);

    const detectAndReportPosition = useCallback(() => {
        if (isMeasuring || fragments.length === 0 || !containerRef.current || !stats) return;

        // In fragmented mode, the "visible block" is always the first block of the current fragment
        const currentFragment = fragments[currentPageIndex];
        if (!currentFragment) return;

        // Find the first block in this fragment that has a blockId
        const anchorBlock = currentFragment.blocks.find(b => b.blockId) || currentFragment.blocks[0];
        if (!anchorBlock) return;

        const blockId = anchorBlock.blockId || `ch${currentChapterIndex}-b${currentFragment.startIndex}`;
        const blockLocalOffset = 0; // Anchored to start of fragment

        // We need to get the element to extract context, but we can't rely on it for offset
        const pageElement = containerRef.current.querySelector(`.reader-page:nth-child(${currentPageIndex + 1})`) as HTMLElement;
        const blockElement = pageElement?.querySelector(`[data-block-id="${blockId}"]`) || pageElement?.firstElementChild;
        if (!blockElement) return;

        const contextSnippet = extractContextSnippet(blockElement, blockLocalOffset, 20);
        const chapterCharOffset = anchorBlock.charOffset;

        const progressCalc = calculateProgress(currentChapterIndex, chapterCharOffset, stats);

        setCurrentProgress(progressCalc.totalProgress);

        lastSeenCharOffset.current = chapterCharOffset;

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
        if (!isMeasuring && hasInitialRestored.current) {
            detectAndReportPosition();
        }
    }, [isMeasuring, currentPageIndex, currentChapterIndex, detectAndReportPosition]);

    // Keyboard navigation
    useEffect(() => {
        const navOptions: NavigationOptions = { isVertical, isRTL, isPaged: true };
        const callbacks: NavigationCallbacks = {
            goNext: () => {
                if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                else if (currentChapterIndex < chapters.length - 1) goToSection(currentChapterIndex + 1, false);
            },
            goPrev: () => {
                if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                else if (currentChapterIndex > 0) goToSection(currentChapterIndex - 1, true);
            },
            goToStart: () => goToPage(0),
            goToEnd: () => goToPage(fragments.length - 1),
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (handleKeyNavigation(e, navOptions, callbacks)) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isVertical, isRTL, currentPageIndex, fragments.length, currentChapterIndex, chapters.length, goToPage, goToSection]);

    // Wheel navigation
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let lastWheelTime = 0;
        const wheelDebounce = 300;

        const handleWheel = (e: WheelEvent) => {
            if (isMeasuring) return;
            const now = Date.now();
            if (now - lastWheelTime < wheelDebounce) return;

            if (Math.abs(e.deltaY) > 20) {
                lastWheelTime = now;
                if (e.deltaY > 0) {
                    if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                    else if (currentChapterIndex < chapters.length - 1) goToSection(currentChapterIndex + 1, false);
                } else {
                    if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                    else if (currentChapterIndex > 0) goToSection(currentChapterIndex - 1, true);
                }
                e.preventDefault();
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [isMeasuring, currentPageIndex, fragments.length, currentChapterIndex, chapters.length, goToPage, goToSection]);

    // Swipe navigation
    const touchStartRef = useRef<{ x: number, y: number, time: number } | null>(null);
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            touchStartRef.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: Date.now(),
            };
        }
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current || isMeasuring) return;
        const touch = touchStartRef.current;
        touchStartRef.current = null;

        const deltaX = e.changedTouches[0].clientX - touch.x;
        const deltaY = e.changedTouches[0].clientY - touch.y;
        const deltaTime = Date.now() - touch.time;

        if (deltaTime > 500) return;

        const minDistance = 50;

        // Horizontal swipe (paging)
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minDistance) {
            const isForward = isRTL ? deltaX > 0 : deltaX < 0;
            if (isForward) {
                if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                else if (currentChapterIndex < chapters.length - 1) goToSection(currentChapterIndex + 1, false);
            } else {
                if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                else if (currentChapterIndex > 0) goToSection(currentChapterIndex - 1, true);
            }
        }
    }, [isMeasuring, isRTL, currentPageIndex, fragments.length, currentChapterIndex, chapters.length, goToPage, goToSection]);

    const handleContentClick = useCallback(async (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, .nav-btn, .reader-progress-bar, .dict-popup, .selection-handle, .selection-toolbar')) return;

        // Try lookup first, if successful it will consume the event
        const lookupSuccess = await tryLookup(e);
        if (lookupSuccess) {
            e.stopPropagation();
            return;
        }

        if (settings.lnEnableClickZones && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const zone = getClickZone(e.clientX, e.clientY, rect, isVertical, settings.lnClickZonePlacement || 'vertical', settings.lnClickZoneSize || 10, settings.lnClickZonePosition || 'full', settings.lnClickZoneCoverage || 60);

            if (zone === 'prev') {
                if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                else if (currentChapterIndex > 0) goToSection(currentChapterIndex - 1, true);
                return;
            }
            if (zone === 'next') {
                if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                else if (currentChapterIndex < chapters.length - 1) goToSection(currentChapterIndex + 1, false);
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
                className={`pages-container ${isRTL ? 'rtl' : 'ltr'}`}
                onScroll={handleScroll}
                onClick={handleContentClick}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
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
                            {fragment.blocks.map((block, bi) => (
                                <BlockRenderer
                                    key={bi}
                                    block={block}
                                    isVertical={isVertical}
                                />
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
                onNext={() => {
                    if (currentPageIndex < fragments.length - 1) goToPage(currentPageIndex + 1);
                    else if (currentChapterIndex < chapters.length - 1) goToSection(currentChapterIndex + 1, false);
                }}
                onPrev={() => {
                    if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
                    else if (currentChapterIndex > 0) goToSection(currentChapterIndex - 1, true);
                }}
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
                onSaveNow={() => saveSchedulerRef.current.saveNow()}
            />

            <SelectionHandles
                containerRef={containerRef}
                enabled={!isMeasuring}
                theme={(settings.lnTheme as 'light' | 'sepia' | 'dark' | 'black') || 'dark'}
                onSelectionComplete={(text, startOffset, endOffset, blockId) => {
                    if (onAddHighlight && blockId) {
                        onAddHighlight(currentChapterIndex, blockId, text, startOffset, endOffset);
                    }
                }}
            />
        </div>
    );
};
