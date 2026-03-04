
import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    useMemo,
    useLayoutEffect
} from 'react';
import { Settings } from '@/Manatan/types';
import { BookStats } from '@/lib/storage/AppStorage';
import { ReaderNavigationUI } from './ReaderNavigationUI';
import { ClickZones, getClickZone } from './ClickZones';
import { ReaderContextMenu } from './ReaderContextMenu';
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
import { calculatePagination } from '../utils/jsPaginator';
import { SaveablePosition as ReaderSaveablePosition } from '../utils/readerSave';
import './PagedReader.css';

type SaveablePosition = ReaderSaveablePosition;

// ============================================================================
// Helpers

function adjustBrightness(hexColor: string, brightness: number): string {
    if (hexColor.startsWith('rgba')) {
        const match = hexColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const [, r, g, b] = match;
            const factor = brightness / 100;
            return `rgba(${Math.round(Number(r) * factor)}, ${Math.round(Number(g) * factor)}, ${Math.round(Number(b) * factor)})`;
        }
        return hexColor;
    }
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

const SAVE_DEBOUNCE_MS = 3000;
const POSITION_DETECT_DELAY_MS = 150;
const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_TIME = 500;
const VIEWPORT_BUFFER = 1; // current +- 1

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
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const wheelTimeoutRef = useRef<number | null>(null);
    const navigationIntentRef = useRef<{ goToLastPage: boolean } | null>(null);
    const positionDetectTimerRef = useRef<number | null>(null);

    // Restore state refs
    const restoreAnchorRef = useRef<{ blockId?: string; chapterIndex: number; chapterCharOffset?: number } | null>(null);
    const lastRestoreKeyRef = useRef<string>('');
    const restorePendingRef = useRef(false);
    
    // Save lock to prevent saving immediately after restoration
    const saveLockUntilRef = useRef<number>(0);
    const SAVE_LOCK_DURATION_MS = 3000;

    // Drag/touch detection
    const isDraggingRef = useRef(false);
    const startPosRef = useRef({ x: 0, y: 0 });
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

    // Callback refs
    const onPositionUpdateRef = useRef(onPositionUpdate);
    const onRegisterSaveRef = useRef(onRegisterSave);
    const onToggleUIRef = useRef(onToggleUI);

    // Save scheduler
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
    // State
    // ========================================================================

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [currentSection, setCurrentSection] = useState(initialChapter);
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [totalPages, setTotalPages] = useState(1);
    const [measuredPageSize, setMeasuredPageSize] = useState(0);
    const [contentReady, setContentReady] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [currentProgress, setCurrentProgress] = useState(initialProgress?.totalProgress || 0);
    const [currentPosition, setCurrentPosition] = useState<SaveablePosition | null>(null);

    // ========================================================================
    // Update Refs
    // ========================================================================

    useEffect(() => {
        onPositionUpdateRef.current = onPositionUpdate;
        onRegisterSaveRef.current = onRegisterSave;
        onToggleUIRef.current = onToggleUI;
    }, [onPositionUpdate, onRegisterSave, onToggleUI]);

    useEffect(() => {
        if (!restoreAnchorRef.current) {
            restoreAnchorRef.current = {
                blockId: initialProgress?.blockId,
                chapterIndex: initialProgress?.chapterIndex ?? initialChapter,
                chapterCharOffset: initialProgress?.chapterCharOffset,
            };
        }
    }, [initialChapter, initialProgress]);

    useEffect(() => {
        if (initialProgress?.blockId) {
            saveSchedulerRef.current.setInitialSavedPosition(initialProgress.blockId);
        }
    }, [initialProgress]);

    useEffect(() => {
        saveSchedulerRef.current.updateOptions({
            bookId,
            autoSaveEnabled: settings.lnAutoBookmark ?? true,
            saveDelay: settings.lnBookmarkDelay ?? 0,
        });
    }, [bookId, settings.lnAutoBookmark, settings.lnBookmarkDelay]);

    // ========================================================================
    // Layout Key
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
            marginTop: settings.lnMarginTop,
            marginBottom: settings.lnMarginBottom,
            marginLeft: settings.lnMarginLeft,
            marginRight: settings.lnMarginRight,
            width: dimensions.width,
            height: dimensions.height,
        });
    }, [
        isVertical, isRTL,
        settings.lnFontSize, settings.lnLineHeight, settings.lnLetterSpacing,
        settings.lnFontFamily, settings.lnTextAlign, settings.lnEnableFurigana,
        settings.lnMarginTop, settings.lnMarginBottom,
        settings.lnMarginLeft, settings.lnMarginRight,
        dimensions.width, dimensions.height
    ]);

    const theme = useMemo(() => getReaderTheme(settings.lnTheme), [settings.lnTheme]);
    const typographyStyles = useMemo(() => buildTypographyStyles(settings, isVertical), [settings, isVertical]);
    const { tryLookup } = useTextLookup();

    const currentHtml = useMemo(() => chapters[currentSection] || '', [chapters, currentSection]);

    // ========================================================================
    // Resize Observer
    // ========================================================================

    useEffect(() => {
        const updateDimensions = () => {
            if (wrapperRef.current) {
                const rect = wrapperRef.current.getBoundingClientRect();
                setDimensions({
                    width: Math.floor(rect.width),
                    height: Math.floor(rect.height),
                });
            }
        };

        updateDimensions();
        const observer = new ResizeObserver(updateDimensions);
        if (wrapperRef.current) observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, []);

    // ========================================================================
    // JS Pagination Calculation
    // ========================================================================

    useLayoutEffect(() => {
        if (dimensions.width === 0 || dimensions.height === 0 || !contentRef.current) return;

        let cancelled = false;

        const doPagination = async () => {
            setContentReady(false);
            setIsTransitioning(true);

            const content = contentRef.current;
            if (!content) return;

            // Wait for fonts and images
            if (document.fonts) await document.fonts.ready;

            const images = content.querySelectorAll('img');
            await Promise.all(Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise<void>(resolve => {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                    setTimeout(resolve, 500);
                });
            }));

            if (cancelled) return;

            // Measure in-place
            const availableW = dimensions.width - (settings.lnMarginLeft ?? 24) - (settings.lnMarginRight ?? 24);
            const availableH = dimensions.height - (settings.lnMarginTop ?? 24) - (settings.lnMarginBottom ?? 24);

            // Force content to flow naturally for measurement
            content.style.transform = 'none';
            content.style.width = isVertical ? 'auto' : `${availableW}px`;
            content.style.height = isVertical ? `${availableH}px` : 'auto';
            content.style.contain = 'none';

            // Wait for layout
            await new Promise(resolve => requestAnimationFrame(resolve));

            const scrollSize = isVertical ? content.scrollWidth : content.scrollHeight;
            const pageSize = isVertical ? availableW : availableH;
            const calculatedPages = Math.max(1, Math.ceil((scrollSize - 1) / pageSize));

            if (cancelled) return;

            setTotalPages(calculatedPages);
            setMeasuredPageSize(pageSize);

            const intent = navigationIntentRef.current;
            navigationIntentRef.current = null;

            if (intent?.goToLastPage) {
                setCurrentPage(calculatedPages - 1);
            } else {
                setCurrentPage(p => Math.min(p, calculatedPages - 1));
            }

            setContentReady(true);
            setIsTransitioning(false);
        };

        doPagination();

        return () => { cancelled = true; };
    }, [currentHtml, layoutKey, isVertical, typographyStyles, dimensions]);

    // ========================================================================
    // Navigation
    // ========================================================================

    const goToPage = useCallback((page: number) => {
        const clamped = Math.max(0, Math.min(page, totalPages - 1));
        if (clamped !== currentPage) {
            setCurrentPage(clamped);
        }
    }, [totalPages, currentPage]);

    const goToSection = useCallback((section: number, goToLastPage = false) => {
        const clamped = Math.max(0, Math.min(section, chapters.length - 1));
        if (clamped === currentSection) return;

        saveSchedulerRef.current.saveNow();
        setIsTransitioning(true);
        setContentReady(false);
        lastRestoreKeyRef.current = '';
        navigationIntentRef.current = { goToLastPage };
        setCurrentSection(clamped);
        setCurrentPage(0);
    }, [chapters.length, currentSection]);

    const goNext = useCallback(() => {
        if (!contentReady || isTransitioning) return;
        if (currentPage < totalPages - 1) goToPage(currentPage + 1);
        else if (currentSection < chapters.length - 1) goToSection(currentSection + 1, false);
    }, [contentReady, isTransitioning, currentPage, totalPages, currentSection, chapters.length, goToPage, goToSection]);

    const goPrev = useCallback(() => {
        if (!contentReady || isTransitioning) return;
        if (currentPage > 0) goToPage(currentPage - 1);
        else if (currentSection > 0) goToSection(currentSection - 1, true);
    }, [contentReady, isTransitioning, currentPage, currentSection, goToPage, goToSection]);

    // ========================================================================
    // Position Detection & Restoration
    // ========================================================================

    const detectAndReportPosition = useCallback(() => {
        if (restorePendingRef.current || Date.now() < saveLockUntilRef.current) return;
        if (!contentReady || !viewportRef.current || !stats || measuredPageSize <= 0) return;

        // Detection using the contentRef
        if (!contentRef.current) return;

        // Temporarily reset transform for measurement if needed,
        // but detectVisibleBlockPaged is designed to handle offsets.
        const detected = detectVisibleBlockPaged(
            contentRef.current,
            currentPage,
            measuredPageSize,
            isVertical,
            currentSection,
            stats?.blockMaps
        );

        if (!detected) return;

        restoreAnchorRef.current = {
            blockId: detected.blockId,
            chapterIndex: currentSection,
            chapterCharOffset: detected.chapterCharOffset,
        };

        const contextSnippet = extractContextSnippet(detected.element as Element, detected.blockLocalOffset, 20);
        const progressCalc = calculateProgress(currentSection, detected.chapterCharOffset, stats);

        const position: SaveablePosition = {
            blockId: detected.blockId,
            blockLocalOffset: detected.blockLocalOffset,
            contextSnippet,
            chapterIndex: currentSection,
            pageIndex: currentPage,
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
            chapterIndex: currentSection,
            pageIndex: currentPage,
            chapterCharOffset: detected.chapterCharOffset,
            sentenceText: contextSnippet,
            totalProgress: progressCalc.totalProgress,
            blockId: detected.blockId,
        });

    }, [contentReady, stats, measuredPageSize, currentPage, currentSection, isVertical]);

    useEffect(() => {
        if (contentReady && !isTransitioning) {
            if (positionDetectTimerRef.current) clearTimeout(positionDetectTimerRef.current);
            positionDetectTimerRef.current = window.setTimeout(detectAndReportPosition, POSITION_DETECT_DELAY_MS);
        }
    }, [contentReady, isTransitioning, currentPage, currentSection, detectAndReportPosition]);

    // Restoration
    useEffect(() => {
        if (!contentReady || measuredPageSize <= 0) return;

        const restoreKey = `${currentSection}|${layoutKey}|${measuredPageSize}|${totalPages}`;
        if (restoreKey === lastRestoreKeyRef.current) return;

        const anchor = restoreAnchorRef.current;
        if (!anchor || anchor.chapterIndex !== currentSection || !anchor.blockId) {
            lastRestoreKeyRef.current = restoreKey;
            return;
        }

        const tryRestore = async () => {
            await new Promise(resolve => requestAnimationFrame(resolve));
            restorePendingRef.current = true;

            const blockEl = contentRef.current?.querySelector(`[data-block-id="${anchor.blockId}"]`) as HTMLElement;
            if (blockEl) {
                const rect = blockEl.getBoundingClientRect();
                const contentRect = contentRef.current!.getBoundingClientRect();
                
                // Content coordinates are currently shifted by transform.
                // We need the "natural" position relative to the content start.
                const currentOffset = currentPage * measuredPageSize;

                let naturalPosition;
                if (isVertical) {
                    // Vertical-rl: content flows right-to-left.
                    // Both contentRect and rect are shifted by the same transform,
                    // so their relative distance is the natural offset from the start.
                    naturalPosition = contentRect.right - rect.right;
                } else {
                    // Horizontal: flows top-to-bottom.
                    naturalPosition = rect.top - contentRect.top;
                }

                const targetPage = Math.floor(Math.abs(naturalPosition) / measuredPageSize);
                const clamped = Math.max(0, Math.min(targetPage, totalPages - 1));

                console.log('[PagedReader] Restoring to page:', clamped, 'naturalPos:', naturalPosition);

                lastRestoreKeyRef.current = restoreKey;
                setCurrentPage(clamped);
                saveLockUntilRef.current = Date.now() + SAVE_LOCK_DURATION_MS;
            } else {
                lastRestoreKeyRef.current = restoreKey;
            }

            restorePendingRef.current = false;
        };

        tryRestore();
    }, [contentReady, measuredPageSize, totalPages, currentSection, isVertical, layoutKey]);

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
            if (dx > threshold || dy > threshold) isDraggingRef.current = true;
        }
    }, [settings.lnDragThreshold]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
        }
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current || !contentReady || isTransitioning || !(settings.lnEnableSwipe ?? true)) return;
        const touch = touchStartRef.current;
        touchStartRef.current = null;

        const target = e.target as HTMLElement;
        if (target.closest('.reader-progress-bar, .nav-btn, .dict-popup, .click-zone')) return;

        const deltaX = e.changedTouches[0].clientX - touch.x;
        const deltaY = e.changedTouches[0].clientY - touch.y;
        const deltaTime = Date.now() - touch.time;
        if (deltaTime > SWIPE_MAX_TIME) return;

        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > SWIPE_MIN_DISTANCE) {
            if (deltaY > 0) goPrev(); else goNext();
        } else if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_MIN_DISTANCE) {
            if (isVertical) { if (deltaX > 0) goNext(); else goPrev(); }
            else { if (deltaX > 0) goPrev(); else goNext(); }
        }
    }, [contentReady, isTransitioning, isVertical, goNext, goPrev, settings.lnEnableSwipe]);

    const handleContentClick = useCallback(async (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, img, ruby rt, .nav-btn, .reader-progress-bar, .dict-popup')) return;

        const lookupSuccess = await tryLookup(e);
        if (lookupSuccess) return;

        if (settings.lnEnableClickZones && wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            const zone = getClickZone(e.clientX, e.clientY, rect, isVertical, settings.lnClickZonePlacement ?? 'vertical', settings.lnClickZoneSize ?? 10, settings.lnClickZonePosition ?? 'full', settings.lnClickZoneCoverage ?? 60);
            if (zone === 'prev') { goPrev(); return; }
            if (zone === 'next') { goNext(); return; }
        }
        onToggleUIRef.current?.();
    }, [tryLookup, settings.lnEnableClickZones, settings.lnClickZonePlacement, settings.lnClickZoneSize, settings.lnClickZonePosition, settings.lnClickZoneCoverage, isVertical, goPrev, goNext]);

    // ========================================================================
    // Keyboard Navigation
    // ========================================================================

    const navCallbacks: NavigationCallbacks = useMemo(() => ({
        goNext,
        goPrev,
        goToStart: () => goToPage(0),
        goToEnd: () => goToPage(totalPages - 1),
    }), [goNext, goPrev, goToPage, totalPages]);

    const navOptions = useMemo(() => ({ isVertical, isRTL, isPaged: true }), [isVertical, isRTL]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            if (!contentReady || isTransitioning) return;
            if (handleKeyNavigation(e, navOptions, navCallbacks)) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navOptions, navCallbacks, contentReady, isTransitioning]);

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

            let chapterIndex = chapterFilenames.indexOf(filename);
            if (chapterIndex === -1) {
                chapterIndex = chapterFilenames.findIndex(fn => fn.endsWith(filename) || fn.endsWith('/' + filename));
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
                    setTimeout(() => {
                        const element = measureRef.current?.querySelector(`#${CSS.escape(anchor)}`);
                        if (element && measuredPageSize > 0) {
                            const rect = element.getBoundingClientRect();
                            const measureRect = measureRef.current!.getBoundingClientRect();
                            const offset = isVertical ? (rect.left - measureRect.left) : (rect.top - measureRect.top);
                            const targetPage = Math.floor(Math.abs(offset) / measuredPageSize);
                            goToPage(Math.max(0, Math.min(targetPage, totalPages - 1)));
                        }
                    }, 100);
                } else {
                    goToSection(chapterIndex, false);
                    if (anchor) {
                        setTimeout(() => {
                            const element = measureRef.current?.querySelector(`#${CSS.escape(anchor)}`);
                            if (element && measuredPageSize > 0) {
                                const rect = element.getBoundingClientRect();
                                const measureRect = measureRef.current!.getBoundingClientRect();
                                const offset = isVertical ? (rect.left - measureRect.left) : (rect.top - measureRect.top);
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
            if (isTransitioning || !contentReady) return;

            const now = Date.now();
            if (now - lastWheelTime < wheelDebounce) return;

            const delta = e.deltaY;
            if (Math.abs(delta) > 20) {
                lastWheelTime = now;
                if (delta > 0) goNext(); else goPrev();
            }
        };

        wrapper.addEventListener('wheel', handleWheel, { passive: false });
        return () => wrapper.removeEventListener('wheel', handleWheel);
    }, [goNext, goPrev, isTransitioning, contentReady]);

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
            if (positionDetectTimerRef.current) clearTimeout(positionDetectTimerRef.current);
            if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
            saveSchedulerRef.current.saveNow();
        };
    }, []);

    // ========================================================================
    // Virtualized Page Viewports
    // ========================================================================

    const getPageStyle = useCallback(() => {
        const availableW = dimensions.width - (settings.lnMarginLeft ?? 24) - (settings.lnMarginRight ?? 24);
        const availableH = dimensions.height - (settings.lnMarginTop ?? 24) - (settings.lnMarginBottom ?? 24);

        return {
            position: 'absolute' as const,
            top: settings.lnMarginTop ?? 24,
            left: settings.lnMarginLeft ?? 24,
            width: `${availableW}px`,
            height: `${availableH}px`,
            overflow: 'hidden',
        };
    }, [dimensions, settings.lnMarginLeft, settings.lnMarginRight, settings.lnMarginTop, settings.lnMarginBottom]);

    const getPageContentStyle = useCallback(() => {
        const offset = currentPage * measuredPageSize;
        // In vertical-rl, content flows right-to-left.
        // Page 0 is at offset 0. Page 1 is shifted right by measuredPageSize (to reveal content to the left).
        const transform = isVertical ? `translateX(${offset}px)` : `translateY(-${offset}px)`;

        const brightness = settings.lnTextBrightness ?? 100;
        const textColor = brightness === 100 ? theme.fg : adjustBrightness(theme.fg, brightness);

        const availableW = dimensions.width - (settings.lnMarginLeft ?? 24) - (settings.lnMarginRight ?? 24);
        const availableH = dimensions.height - (settings.lnMarginTop ?? 24) - (settings.lnMarginBottom ?? 24);

        return {
            ...typographyStyles,
            color: textColor,
            transform,
            transition: settings.lnDisableAnimations ? 'none' : 'transform 0.3s ease-out',
            willChange: 'transform',
            width: isVertical ? 'auto' : `${availableW}px`,
            height: isVertical ? `${availableH}px` : 'auto',
            writingMode: isVertical ? 'vertical-rl' : 'horizontal-tb' as const,
            // Optimization: preserve layout during transforms
            contain: (contentReady && !isTransitioning) ? 'strict' : 'none',
        };
    }, [currentPage, measuredPageSize, isVertical, settings.lnTextBrightness, settings.lnDisableAnimations, theme.fg, typographyStyles]);

    const handleSaveNow = useCallback(async () => await saveSchedulerRef.current.saveNow(), []);

    // ========================================================================
    // Render
    // ========================================================================

    const wrapperStyle = { backgroundColor: theme.bg, color: theme.fg };

    return (
        <div
            ref={wrapperRef}
            className="paged-reader-wrapper"
            style={wrapperStyle}
            data-dark-mode={settings.lnTheme === 'dark' || settings.lnTheme === 'black'}
        >
            <div
                ref={viewportRef}
                className="paged-viewport"
                onClick={handleContentClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <div
                    className="page-viewport"
                    style={{
                        ...getPageStyle(),
                        visibility: contentReady ? 'visible' : 'hidden'
                    }}
                >
                    <div
                        ref={contentRef}
                        className={`paged-content ${!settings.lnEnableFurigana ? 'furigana-hidden' : ''}`}
                        style={getPageContentStyle()}
                        dangerouslySetInnerHTML={{ __html: currentHtml }}
                    />
                </div>
            </div>

            {(!contentReady || isTransitioning) && (
                <div className="paged-loading" style={{ backgroundColor: theme.bg, color: theme.fg }}>
                    <div className="loading-spinner" />
                </div>
            )}

            {contentReady && (
                <SelectionHandles
                    containerRef={viewportRef}
                    enabled={contentReady && !isTransitioning}
                    theme={(settings.lnTheme as 'light' | 'sepia' | 'dark' | 'black') || 'dark'}
                    onSelectionComplete={(text, startOffset, endOffset, blockId) => {
                        if (onAddHighlight && currentSection && blockId) {
                            onAddHighlight(currentSection, blockId, text, startOffset, endOffset);
                        }
                    }}
                />
            )}

            {contentReady && (
                <ReaderContextMenu
                    containerRef={wrapperRef}
                    theme={(settings.lnTheme as 'light' | 'sepia' | 'dark' | 'black') || 'dark'}
                />
            )}

            {contentReady && (
                <ReaderNavigationUI
                    visible={showNavigation}
                    onNext={goNext}
                    onPrev={goPrev}
                    canGoNext={currentPage < totalPages - 1 || currentSection < chapters.length - 1}
                    canGoPrev={currentPage > 0 || currentSection > 0}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    currentChapter={currentSection}
                    totalChapters={chapters.length}
                    progress={totalPages > 0 ? ((currentPage + 1) / totalPages) * 100 : 0}
                    totalBookProgress={currentProgress}
                    showSlider={totalPages > 1}
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
