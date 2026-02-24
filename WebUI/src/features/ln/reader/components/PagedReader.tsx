
import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    useMemo,
} from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Settings } from '@/Manatan/types';
import { BookStats } from '@/lib/storage/AppStorage';
import { ReaderNavigationUI } from './ReaderNavigationUI';
import { ClickZones, getClickZone } from './ClickZones';
import { SelectionHandles } from './SelectionHandles';
import { buildTypographyStyles } from '../utils/styles';
import { handleKeyNavigation, NavigationCallbacks } from '../utils/navigation';
import { PagedReaderProps } from '../types/reader';
import { detectVisibleBlockPaged } from '../utils/pagedPosition';
import { extractContextSnippet } from '../utils/blockPosition';
import { getReaderTheme } from '../utils/themes';
import { useTextLookup } from '../hooks/useTextLookup';
import {
    SaveablePosition,
    calculateProgress,
    createSaveScheduler
} from '../utils/readerSave';
import { createChapterBlockLookup, getPositionFromCharOffset } from '../utils/blockMap';
import { PagedChapter } from './PagedChapter';
import './PagedReader.css';

// ============================================================================
// Helpers

function adjustBrightness(hexColor: string, brightness: number): string {
    // Handle rgba format
    if (hexColor.startsWith('rgba')) {
        const match = hexColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const [, r, g, b] = match;
            const factor = brightness / 100;
            return `rgba(${Math.round(Number(r) * factor)}, ${Math.round(Number(g) * factor)}, ${Math.round(Number(b) * factor)})`;
        }
        return hexColor;
    }
    
    // Handle hex format
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    const factor = brightness / 100;
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

// ============================================================================
// Constants
// ============================================================================

const DRAG_THRESHOLD = 10;
const SAVE_DEBOUNCE_MS = 3000;
const POSITION_DETECT_DELAY_MS = 150;
const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_TIME = 500;

// ============================================================================
// Component
// ============================================================================

export const PagedReader: React.FC<PagedReaderProps> = ({
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
    safeAreaTopOffsetPx = 0,
    onPositionUpdate,
    onRegisterSave,
    onUpdateSettings,
    chapterFilenames = [],
    highlights = [],
    onAddHighlight,
}) => {
    // ========================================================================
    // Refs
    // ========================================================================

    const wrapperRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const wheelTimeoutRef = useRef<number | null>(null);
    const positionDetectTimerRef = useRef<number | null>(null);

    // Restore state refs
    const restoreAnchorRef = useRef<{ blockId?: string; chapterIndex: number; chapterCharOffset?: number } | null>(null);
    const hasRestoredRef = useRef(false);
    const restorePendingRef = useRef(false);

    // Save lock to prevent saving immediately after restoration (3 seconds)
    const saveLockUntilRef = useRef<number>(0);
    const SAVE_LOCK_DURATION_MS = 3000;

    // Drag/touch detection
    const isDraggingRef = useRef(false);
    const startPosRef = useRef({ x: 0, y: 0 });
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

    // Callback refs (prevent re-render loops)
    const onPositionUpdateRef = useRef(onPositionUpdate);
    const onRegisterSaveRef = useRef(onRegisterSave);
    const onToggleUIRef = useRef(onToggleUI);

    // Save scheduler ref
    const [isSaved, setIsSaved] = useState(true);
    const saveSchedulerRef = useRef(
        createSaveScheduler({
            bookId,
            debounceMs: SAVE_DEBOUNCE_MS,
            autoSaveEnabled: settings.lnAutoBookmark ?? true,
            saveDelay: settings.lnBookmarkDelay ?? 0,
            onSaveStatusChange: setIsSaved,
        })
    );

    // ========================================================================
    // Initialization
    // ========================================================================

    // Initialize anchor from props once
    useEffect(() => {
        if (!restoreAnchorRef.current) {
            restoreAnchorRef.current = {
                blockId: initialProgress?.blockId,
                chapterIndex: initialProgress?.chapterIndex ?? initialChapter,
                chapterCharOffset: initialProgress?.chapterCharOffset,
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (initialProgress?.blockId) {
            saveSchedulerRef.current.setInitialSavedPosition(initialProgress.blockId);
        }
    }, []);

    // Reset restoration when initialProgress changes (for search/highlight navigation)
    const lastInitialProgressRef = useRef(initialProgress);
    useEffect(() => {
        const lastProgress = lastInitialProgressRef.current;
        const progressChanged = 
            (lastProgress?.blockId !== initialProgress?.blockId) ||
            (lastProgress?.chapterIndex !== initialProgress?.chapterIndex);
        
        if (progressChanged && initialProgress?.blockId) {
            console.log('[PagedReader] InitialProgress changed, resetting restoration');
            restoreAnchorRef.current = {
                blockId: initialProgress.blockId,
                chapterIndex: initialProgress.chapterIndex ?? initialChapter,
                chapterCharOffset: initialProgress.chapterCharOffset,
            };
            lastRestoreKeyRef.current = '';
            restorePendingRef.current = false;
        }
        
        lastInitialProgressRef.current = initialProgress;
    }, [initialProgress?.blockId, initialProgress?.chapterIndex, initialProgress?.chapterCharOffset, initialChapter]);

    // ========================================================================
    // Update Callback Refs
    // ========================================================================

    useEffect(() => {
        onPositionUpdateRef.current = onPositionUpdate;
    }, [onPositionUpdate]);

    useEffect(() => {
        onRegisterSaveRef.current = onRegisterSave;
    }, [onRegisterSave]);

    useEffect(() => {
        onToggleUIRef.current = onToggleUI;
    }, [onToggleUI]);

    // Update save scheduler when bookId changes
    useEffect(() => {
        saveSchedulerRef.current.updateOptions({
            bookId,
            autoSaveEnabled: settings.lnAutoBookmark ?? true,
            saveDelay: settings.lnBookmarkDelay ?? 0,
        });
    }, [bookId, settings.lnAutoBookmark, settings.lnBookmarkDelay]);

    // ========================================================================
    // State
    // ========================================================================

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [currentSection, setCurrentSection] = useState(initialChapter);
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [totalPagesInChapter, setTotalPagesInChapter] = useState(1);
    const [contentReady, setContentReady] = useState(false);
    const [measuredPageSize, setMeasuredPageSize] = useState<number>(0);
    const [chapterPageCounts, setChapterPageCounts] = useState<number[]>(new Array(chapters.length).fill(1));
    const chapterStartPages = useMemo(() => {
        const starts = new Array(chapters.length).fill(0);
        for (let i = 1; i < chapters.length; i++) {
            starts[i] = starts[i - 1] + (chapterPageCounts[i - 1] || 1);
        }
        return starts;
    }, [chapterPageCounts, chapters.length]);

    const [currentProgress, setCurrentProgress] = useState(initialProgress?.totalProgress || 0);
    const [currentPosition, setCurrentPosition] = useState<SaveablePosition | null>(null);

    // ========================================================================
    // Simple Derived Values
    // ========================================================================

    const theme = useMemo(
        () => getReaderTheme(settings.lnTheme),
        [settings.lnTheme]
    );

    const navOptions = useMemo(
        () => ({ isVertical, isRTL, isPaged: true }),
        [isVertical, isRTL]
    );

    const { tryLookup } = useTextLookup();

    // ========================================================================
    // Layout Key (Detects when layout changes require restore)
    // ========================================================================

    const layoutKey = useMemo(() => {
        return JSON.stringify({
            isVertical,
            isRTL,
            fontSize: settings.lnFontSize,
            lineHeight: settings.lnLineHeight,
            letterSpacing: settings.lnLetterSpacing,
            fontFamily: settings.lnFontFamily,
            textAlign: settings.lnTextAlign,
            furigana: settings.lnEnableFurigana,
            pageMargin: settings.lnPageMargin,
            marginTop: settings.lnMarginTop,
            marginBottom: settings.lnMarginBottom,
            marginLeft: settings.lnMarginLeft,
            marginRight: settings.lnMarginRight,
        });
    }, [
        isVertical, isRTL,
        settings.lnFontSize, settings.lnLineHeight, settings.lnLetterSpacing,
        settings.lnFontFamily, settings.lnTextAlign, settings.lnEnableFurigana,
        settings.lnPageMargin, settings.lnMarginTop, settings.lnMarginBottom,
        settings.lnMarginLeft, settings.lnMarginRight,
    ]);

    // ========================================================================
    // Layout Calculation
    // ========================================================================

    const layout = useMemo(() => {
        if (dimensions.width === 0 || dimensions.height === 0) return null;

        const gap =160;
        const padding = settings.lnPageMargin || 24;

        const contentW = dimensions.width - (padding * 2);
        const contentH = dimensions.height - (padding * 2) - safeAreaTopOffsetPx;

        const columnWidth = isVertical ? contentH : contentW;

        return {
            gap,
            padding,
            width: dimensions.width,
            height: dimensions.height,
            contentW,
            contentH,
            columnWidth,
        };
    }, [dimensions, settings.lnPageMargin, isVertical, safeAreaTopOffsetPx]);

    const currentHtml = useMemo(
        () => chapters[currentSection] || '',
        [chapters, currentSection]
    );

    const isKorean = useMemo(() => {
        if (stats?.language === 'ko') return true;

        const koreanFonts = ['KR', 'Malgun', 'Nanum', 'Gothic', 'Noto Sans CJK KR'];
        if (koreanFonts.some(f => settings.lnFontFamily?.includes(f))) return true;

        const sample = currentHtml.slice(0, 2000);
        return /[\uAC00-\uD7A3]/.test(sample);
    }, [stats?.language, settings.lnFontFamily, currentHtml]);

    const typographyStyles = useMemo(
        () => buildTypographyStyles(settings, isVertical),
        [settings, isVertical]
    );

    // Memoized transform - only recalculate when page actually changes
    const getTransformForPage = useCallback((page: number) => {
        const effectivePageSize = measuredPageSize > 0
            ? measuredPageSize
            : (layout?.columnWidth || 0) + (layout?.gap || 80);
        const pageOffset = Math.round(page * effectivePageSize);
        return isVertical
            ? `translateY(-${pageOffset}px)`
            : `translateX(-${pageOffset}px)`;
    }, [measuredPageSize, layout?.columnWidth, layout?.gap, isVertical]);

    const getContentStyle = useCallback(() => {
        if (!layout) return {};

        const brightness = settings.lnTextBrightness ?? 100;
        const textColor = brightness === 100
            ? theme.fg
            : adjustBrightness(theme.fg, brightness);

        return {
            ...typographyStyles,
            color: textColor,
            columnWidth: `${layout.columnWidth}px`,
            columnGap: `${layout.gap}px`,
            columnFill: 'auto',
            boxSizing: 'border-box',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            ...(isVertical
                ? {
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    width: `${layout.contentW}px`,
                    height: 'auto',
                    minHeight: `${layout.contentH}px`,
                }
                : {
                    height: `${layout.contentH}px`,
                    width: 'auto',
                    minWidth: `${layout.contentW}px`,
                }
            ),
        };
    }, [
        typographyStyles,
        layout,
        settings.lnTextBrightness,
        theme.fg,
        isVertical
    ]);

    // ========================================================================
    // Register Save Function with Parent
    // ========================================================================

    useEffect(() => {
        const saveNow = saveSchedulerRef.current.saveNow;
        onRegisterSaveRef.current?.(saveNow);
    }, []);

    // ========================================================================
    // Resize Observer
    // ========================================================================

    useEffect(() => {
        const updateDimensions = () => {
            if (wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                // iOS Safari fix
                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                const height = isSafari ? window.innerHeight : rect.height;

                setDimensions({
                    width: Math.floor(rect.width),
                    height: Math.floor(height),
                });
            }
        };

        updateDimensions();

        const resizeObserver = new ResizeObserver(updateDimensions);
        if (wrapperRef.current) {
            resizeObserver.observe(wrapperRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    // Update dimensions on direction change
    useEffect(() => {
        if (wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            setDimensions({
                width: Math.floor(rect.width),
                height: Math.floor(rect.height),
            });
        }
    }, [isVertical]);


    // ========================================================================
    // Position Detection
    // ========================================================================

    const detectAndReportPosition = useCallback((chapterIndex: number, pageIndex: number, element: HTMLElement) => {
        if (restorePendingRef.current) return;
        if (Date.now() < saveLockUntilRef.current) return;
        if (!stats) return;

        const pageSize = measuredPageSize > 0
            ? measuredPageSize
            : (layout?.columnWidth || 0) + (layout?.gap || 80);

        if (pageSize <= 0) return;

        const detected = detectVisibleBlockPaged(
            element,
            pageIndex,
            pageSize,
            isVertical,
            chapterIndex,
            stats?.blockMaps
        );

        if (!detected) return;

        restoreAnchorRef.current = {
            blockId: detected.blockId,
            chapterIndex: chapterIndex,
            chapterCharOffset: detected.chapterCharOffset,
        };

        const contextSnippet = extractContextSnippet(
            detected.element as Element,
            detected.blockLocalOffset,
            20
        );

        const progressCalc = calculateProgress(chapterIndex, detected.chapterCharOffset, stats);

        const position: SaveablePosition = {
            blockId: detected.blockId,
            blockLocalOffset: detected.blockLocalOffset,
            contextSnippet,
            chapterIndex: chapterIndex,
            pageIndex: pageIndex,
            chapterCharOffset: detected.chapterCharOffset,
            totalCharsRead: progressCalc.totalCharsRead,
            chapterProgress: progressCalc.chapterProgress,
            totalProgress: progressCalc.totalProgress,
            sentenceText: contextSnippet,
        };

        setCurrentProgress(progressCalc.totalProgress);
        setCurrentPosition(position);
        saveSchedulerRef.current.scheduleSave(position);

        onPositionUpdateRef.current?.({
            chapterIndex,
            pageIndex,
            chapterCharOffset: detected.chapterCharOffset,
            sentenceText: contextSnippet,
            totalProgress: progressCalc.totalProgress,
            blockId: detected.blockId,
        });

    }, [stats, measuredPageSize, layout, isVertical]);

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;

        const handleScroll = () => {
            if (restorePendingRef.current) return;

            const pageSize = measuredPageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);
            if (pageSize <= 0) return;

            const scrollPos = Math.abs(isVertical ? scroller.scrollTop : scroller.scrollLeft);
            const globalPage = Math.round(scrollPos / pageSize);

            // Find current chapter based on global page
            let chapterIndex = 0;
            for (let i = chapters.length - 1; i >= 0; i--) {
                if (chapterStartPages[i] <= globalPage) {
                    chapterIndex = i;
                    break;
                }
            }

            const localPage = globalPage - chapterStartPages[chapterIndex];

            if (chapterIndex !== currentSection || localPage !== currentPage) {
                setCurrentPage(localPage);
                if (chapterIndex !== currentSection) {
                    setCurrentSection(chapterIndex);
                    setTotalPagesInChapter(chapterPageCounts[chapterIndex] || 1);
                }

                const chapterEl = scroller.querySelector(`[data-chapter="${chapterIndex}"]`) as HTMLElement;
                if (chapterEl) {
                    detectAndReportPosition(chapterIndex, localPage, chapterEl);
                }
            }
        };

        scroller.addEventListener('scroll', handleScroll, { passive: true });
        return () => scroller.removeEventListener('scroll', handleScroll);
    }, [measuredPageSize, layout, isVertical, chapters.length, chapterStartPages, currentSection, currentPage, chapterPageCounts, detectAndReportPosition]);

    useEffect(() => {
        if (!initialProgress || hasRestoredRef.current || !virtuosoRef.current) return;

        const tryRestore = async () => {
            const targetChapter = initialProgress.chapterIndex ?? 0;
            const targetBlockId = initialProgress.blockId;

            virtuosoRef.current?.scrollToIndex({
                index: targetChapter,
                align: 'start',
                behavior: 'auto'
            });

            hasRestoredRef.current = true;
            setCurrentSection(targetChapter);

            // Further precise restoration will happen in Chapter component
        };

        tryRestore();
    }, [initialProgress]);

    // ========================================================================
    // Touch/Click Handlers
    // ========================================================================

    // ========================================================================
    // Navigation
    // ========================================================================

    const goToPage = useCallback((page: number) => {
        if (!scrollerRef.current) return;
        const pageSize = measuredPageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);
        const chapterOffsetInPages = chapterStartPages[currentSection];
        const globalPage = chapterOffsetInPages + page;
        const targetPos = globalPage * pageSize;

        scrollerRef.current.scrollTo({
            [isVertical ? 'top' : 'left']: isRTL && !isVertical ? -targetPos : targetPos,
            behavior: 'smooth'
        });
    }, [measuredPageSize, layout, isVertical, isRTL, chapterStartPages, currentSection]);

    const goNext = useCallback(() => {
        if (!scrollerRef.current) return;
        const pageSize = measuredPageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);
        scrollerRef.current.scrollBy({
            [isVertical ? 'top' : 'left']: pageSize,
            behavior: settings.lnDisableAnimations ? 'auto' : 'smooth'
        });
    }, [measuredPageSize, layout, isVertical, settings.lnDisableAnimations]);

    const goPrev = useCallback(() => {
        if (!scrollerRef.current) return;
        const pageSize = measuredPageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);
        scrollerRef.current.scrollBy({
            [isVertical ? 'top' : 'left']: -pageSize,
            behavior: settings.lnDisableAnimations ? 'auto' : 'smooth'
        });
    }, [measuredPageSize, layout, isVertical, settings.lnDisableAnimations]);

    // ========================================================================
    // Touch/Click Handlers
    // ========================================================================

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        isDraggingRef.current = false;
        startPosRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        const threshold = settings.lnDragThreshold ?? 10;
        if (!isDraggingRef.current) {
            const dx = Math.abs(e.clientX - startPosRef.current.x);
            const dy = Math.abs(e.clientY - startPosRef.current.y);
            if (dx > threshold || dy > threshold) {
                isDraggingRef.current = true;
            }
        }
    }, [settings.lnDragThreshold]);

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
        if (!touchStartRef.current) return;
        if (!contentReady) return;
        if (!(settings.lnEnableSwipe ?? true)) return;

        const touch = touchStartRef.current;
        
        // Ignore swipes starting from bottom edge (system gesture area)
        const BOTTOM_EDGE_THRESHOLD = 100;
        if (touch.y > window.innerHeight - BOTTOM_EDGE_THRESHOLD) {
            touchStartRef.current = null;
            return;
        }
        
        touchStartRef.current = null;

        // Don't handle swipe if touching UI elements
        const target = e.target as HTMLElement;
        if (target.closest('.reader-progress-bar, .nav-btn, .dict-popup, .click-zone')) {
            return;
        }

        const deltaX = e.changedTouches[0].clientX - touch.x;
        const deltaY = e.changedTouches[0].clientY - touch.y;
        const deltaTime = Date.now() - touch.time;

        if (deltaTime > SWIPE_MAX_TIME) return;

        // VERTICAL SWIPE: Works in BOTH modes
        // Swipe UP = next, Swipe DOWN = prev
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > SWIPE_MIN_DISTANCE) {
            if (deltaY > 0) {
                goPrev(); // Swipe down = back
            } else {
                goNext(); // Swipe up = forward
            }
            return;
        }

        // HORIZONTAL SWIPE: Works in BOTH modes with inverted logic
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_MIN_DISTANCE) {
            if (isVertical) {
                // Vertical text mode: swipe right = next, swipe left = prev 
                if (deltaX > 0) {
                    goNext(); // Swipe right = forward
                } else {
                    goPrev(); // Swipe left = back
                }
            } else {
                // Horizontal text mode: swipe left = next, swipe right = prev 
                if (deltaX > 0) {
                    goPrev(); // Swipe right = back
                } else {
                    goNext(); // Swipe left = forward
                }
            }
        }
    }, [contentReady, isVertical, isRTL, goNext, goPrev, settings.lnEnableSwipe]);

    const handleContentClick = useCallback(async (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;

        const target = e.target as HTMLElement;

        // Handle links
        const link = target.closest('a');
        if (link) {
            const href = link.getAttribute('href');

            if (href?.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else if (href?.startsWith('http')) {
                e.preventDefault();
                window.open(href, '_blank', 'noopener,noreferrer');
            } else if (href?.includes('.html') || href?.includes('.xhtml')) {
                e.preventDefault();
                const linkEvent = new CustomEvent('epub-link-clicked', {
                    detail: { href },
                    bubbles: true
                });
                e.currentTarget.dispatchEvent(linkEvent);
            }
            return;
        }

        // Ignore UI elements
        if (target.closest('button, img, ruby rt, .nav-btn, .reader-progress-bar, .dict-popup')) {
            return;
        }

        // Try text lookup first (highest priority)
        const lookupSuccess = await tryLookup(e);
        if (lookupSuccess) return;

        // Check if click zones are enabled and detect zone click
        if (settings.lnEnableClickZones && wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            const zone = getClickZone(
                e.clientX,
                e.clientY,
                rect,
                isVertical,
                settings.lnClickZonePlacement ?? 'vertical',
                settings.lnClickZoneSize ?? 10,
                settings.lnClickZonePosition ?? 'full',
                settings.lnClickZoneCoverage ?? 60
            );
            
            if (zone === 'prev') {
                goPrev();
                return;
            }
            if (zone === 'next') {
                goNext();
                return;
            }
        }

        // Otherwise toggle UI
        onToggleUIRef.current?.();
    }, [tryLookup, settings.lnEnableClickZones, settings.lnClickZonePlacement, settings.lnClickZoneSize, settings.lnClickZonePosition, settings.lnClickZoneCoverage, isVertical, goPrev, goNext]);

    const navCallbacks: NavigationCallbacks = useMemo(() => ({
        goNext,
        goPrev,
        goToStart: () => goToPage(0),
        goToEnd: () => goToPage(totalPages - 1),
    }), [goNext, goPrev, goToPage, totalPages]);

    const handleSaveNow = useCallback(async (): Promise<boolean> => {
        return await saveSchedulerRef.current.saveNow();
    }, []);

    // ========================================================================
    // Keyboard Navigation
    // ========================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            if (!contentReady) return;
            if (handleKeyNavigation(e, navOptions, navCallbacks)) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navOptions, navCallbacks, contentReady]);

    // ========================================================================
    // EPUB Link Handler
    // ========================================================================

    useEffect(() => {
        const container = wrapperRef.current;
        if (!container) return;

        const handleEpubLink = (event: Event) => {
            const customEvent = event as CustomEvent<{ href: string }>;
            const href = customEvent.detail.href;
            const [filename, anchor] = href.split('#');

            // Find chapter by filename
            let chapterIndex = chapterFilenames.indexOf(filename);

            if (chapterIndex === -1) {
                chapterIndex = chapterFilenames.findIndex(fn =>
                    fn.endsWith(filename) || fn.endsWith('/' + filename)
                );
            }

            if (chapterIndex === -1) {
                const targetBasename = filename.split('/').pop() || filename;
                chapterIndex = chapterFilenames.findIndex(fn => {
                    const storedBasename = fn.split('/').pop() || fn;
                    return storedBasename === targetBasename;
                });
            }

            if (chapterIndex !== -1 && chapterIndex < chapters.length) {
                if (chapterIndex === currentSection && anchor) {
                    // Same chapter, scroll to anchor
                    setTimeout(() => {
                        const element = document.getElementById(anchor);
                        if (element && contentRef.current && measuredPageSize > 0) {
                            const rect = element.getBoundingClientRect();
                            const contentRect = contentRef.current.getBoundingClientRect();
                            const offset = isVertical
                                ? rect.top - contentRect.top
                                : rect.left - contentRect.left;
                            const targetPage = Math.floor(Math.abs(offset) / measuredPageSize);
                            goToPage(Math.max(0, Math.min(targetPage, totalPages - 1)));
                        }
                    }, 100);
                } else {
                    // Different chapter
                    goToSection(chapterIndex, false);

                    if (anchor) {
                        setTimeout(() => {
                            const element = document.getElementById(anchor);
                            if (element && contentRef.current && measuredPageSize > 0) {
                                const rect = element.getBoundingClientRect();
                                const contentRect = contentRef.current.getBoundingClientRect();
                                const offset = isVertical
                                    ? rect.top - contentRect.top
                                    : rect.left - contentRect.left;
                                const targetPage = Math.floor(Math.abs(offset) / measuredPageSize);
                                goToPage(Math.max(0, Math.min(targetPage, totalPages - 1)));
                            }
                        }, 500);
                    }
                }
            }
        };

        container.addEventListener('epub-link-clicked', handleEpubLink);
        return () => container.removeEventListener('epub-link-clicked', handleEpubLink);
    }, [chapters.length, goToSection, chapterFilenames, currentSection, goToPage, isVertical, measuredPageSize, totalPages]);

    // ========================================================================
    // Wheel Handler
    // ========================================================================

    
useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let lastWheelTime = 0;
    const wheelDebounce = 300;

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        
        if (!contentReady) return;

        const now = Date.now();
        if (now - lastWheelTime < wheelDebounce) return;

        const delta = e.deltaY;
        
        if (Math.abs(delta) > 20) {
            lastWheelTime = now;
            
            
            if (delta > 0) {
                goNext();
            } else {
                goPrev();
            }
        }
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
        wrapper.removeEventListener('wheel', handleWheel);
    };
}, [goNext, goPrev, contentReady]);

    // ========================================================================
    // Visibility Change Handler (Save on Hide)
    // ========================================================================

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                saveSchedulerRef.current.saveNow();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // ========================================================================
    // Cleanup
    // ========================================================================

    useEffect(() => {
        return () => {
            // Cancel pending timers
            if (positionDetectTimerRef.current) {
                clearTimeout(positionDetectTimerRef.current);
            }
            if (wheelTimeoutRef.current) {
                clearTimeout(wheelTimeoutRef.current);
            }

            // Force save on unmount
            saveSchedulerRef.current.saveNow();
        };
    }, []);

    // ========================================================================
    // Early Return
    // ========================================================================

    if (!layout) {
        return (
            <div
                ref={wrapperRef}
                className="paged-reader-wrapper"
                style={{ backgroundColor: theme.bg }}
            />
        );
    }

    // ========================================================================
    // Render
    // ========================================================================

    // Calculate derived values for rendering
    const effectivePageSize = measuredPageSize > 0
        ? measuredPageSize
        : (layout?.columnWidth || 0) + (layout?.gap || 80);

    const pageProgressPercent = totalPages > 0
        ? ((currentPage + 1) / totalPages) * 100
        : 0;

    const handleUpdateSettings = onUpdateSettings ?? (() => {});

    const wrapperStyle = {
        backgroundColor: theme.bg,
        color: theme.fg,
    };

    return (
        <div
            ref={wrapperRef}
            className="paged-reader-wrapper"
            style={wrapperStyle}
            data-dark-mode={settings.lnTheme === 'dark' || settings.lnTheme === 'black'}
        >
            <style>{`
                .paged-content img {
                    max-width: 100vw !important;
                    max-height: ${layout ? layout.contentH : 1000}px;
                    width: auto;
                    height: auto;
                    display: block;
                    object-fit: contain;
                }
            `}</style>

            <Virtuoso
                ref={virtuosoRef}
                scrollerRef={(ref) => (scrollerRef.current = ref as HTMLDivElement)}
                data={chapters}
                useWindowScroll={false}
                horizontalDirection={!isVertical}
                className="paged-virtuoso"
                style={{
                    width: '100%',
                    height: '100%',
                    scrollSnapType: isVertical ? 'y mandatory' : 'x mandatory',
                }}
                itemContent={(index, html) => (
                    <div
                        onClick={handleContentClick}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <PagedChapter
                            html={html}
                            index={index}
                            isActive={index === currentSection}
                            currentPage={currentPage}
                            layout={layout}
                            isVertical={isVertical}
                            isKorean={isKorean}
                            settings={settings}
                            measuredPageSize={measuredPageSize}
                            setMeasuredPageSize={setMeasuredPageSize}
                            onPagesCalculated={(pages) => {
                                setChapterPageCounts(prev => {
                                    if (prev[index] === pages) return prev;
                                    const next = [...prev];
                                    next[index] = pages;
                                    return next;
                                });
                                if (index === currentSection) {
                                    setTotalPagesInChapter(pages);
                                    setContentReady(true);
                                }
                            }}
                            onPositionUpdate={(page, element) => {
                                if (index === currentSection) {
                                    setCurrentPage(page);
                                    detectAndReportPosition(index, page, element);
                                }
                            }}
                            initialPage={index === initialChapter ? initialPage : 0}
                            initialProgress={index === initialChapter ? initialProgress : undefined}
                            getContentStyle={getContentStyle}
                            stats={stats}
                            saveLockUntilRef={saveLockUntilRef}
                            restorePendingRef={restorePendingRef}
                            onToggleUI={onToggleUI}
                            onAddHighlight={onAddHighlight}
                        />
                    </div>
                )}
            />

            {contentReady && (
                <ReaderNavigationUI
                    visible={showNavigation}
                    onNext={goNext}
                    onPrev={goPrev}
                    canGoNext={currentPage < totalPagesInChapter - 1 || currentSection < chapters.length - 1}
                    canGoPrev={currentPage > 0 || currentSection > 0}
                    currentPage={currentPage}
                    totalPages={totalPagesInChapter}
                    currentChapter={currentSection}
                    totalChapters={chapters.length}
                    progress={pageProgressPercent}
                    totalBookProgress={currentProgress}
                    showSlider={totalPagesInChapter > 1}
                    onPageChange={goToPage}
                    theme={theme}
                    isVertical={isVertical}
                    mode="paged"
                    currentPosition={currentPosition ?? undefined}
                    bookStats={stats ?? undefined}
                    settings={settings}
                    onUpdateSettings={onUpdateSettings}
                    isSaved={isSaved}
                    onSaveNow={handleSaveNow}
                />
            )}
        </div>
    );
};
