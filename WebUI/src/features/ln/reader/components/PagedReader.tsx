
import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    useMemo,
    useLayoutEffect
} from 'react';
import { Settings } from '@/Manatan/types';
import { BookStats, AppStorage } from '@/lib/storage/AppStorage';
import { ReaderNavigationUI } from './ReaderNavigationUI';
import { ClickZones, getClickZone } from './ClickZones';
import { ReaderContextMenu } from './ReaderContextMenu';
import { SelectionHandles } from './SelectionHandles';
import { buildTypographyStyles } from '../utils/styles';
import { handleKeyNavigation, NavigationCallbacks } from '../utils/navigation';
import { PagedReaderProps } from '../types/reader';
import { detectVisibleBlockPaged, restoreToBlockPaged } from '../utils/pagedPosition';
import { extractContextSnippet } from '../utils/blockPosition';
import { getReaderTheme } from '../utils/themes';
import { useTextLookup } from '../hooks/useTextLookup';
import {
    SaveablePosition,
    calculateProgress,
    createSaveScheduler
} from '../utils/readerSave';
import { createChapterBlockLookup, getPositionFromCharOffset } from '../utils/blockMap';
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
const PAGE_GAP_PX = 40;

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
    onRemoveHighlight,
}) => {
    // ========================================================================
    // Refs
    // ========================================================================

    const wrapperRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const wheelTimeoutRef = useRef<number | null>(null);
    const navigationIntentRef = useRef<{ goToLastPage: boolean } | null>(null);
    const positionDetectTimerRef = useRef<number | null>(null);

    // Restore state refs
    const restoreAnchorRef = useRef<{ blockId?: string; chapterIndex: number; chapterCharOffset?: number } | null>(null);
    const lastRestoreKeyRef = useRef<string>('');
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

    // Computed pages and visibility range
    const [computedPages, setComputedPages] = useState<{
        totalPages: number;
        pageSize: number;
    }>({ totalPages: 1, pageSize: 0 });

    const [visiblePageRange, setVisiblePageRange] = useState({ start: 0, end: 0 });

    // Update visible range when page changes
    useEffect(() => {
        const halfWindow = 2;
        setVisiblePageRange({
            start: Math.max(0, currentPage - halfWindow),
            end: Math.min(computedPages.totalPages - 1, currentPage + halfWindow)
        });
    }, [currentPage, computedPages.totalPages]);

    const [contentReady, setContentReady] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
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

        // Gap between columns in CSS multi-column
        const gap = 160;
        const padding = settings.lnPageMargin || 24;

        const contentW = dimensions.width - (padding * 2);
        const contentH = dimensions.height - (padding * 2) - safeAreaTopOffsetPx;

        // For vertical text (vertical-rl), column-width property sets the column HEIGHT.
        // For horizontal text, it sets the column WIDTH.
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
    // Page Calculation (After Render)
    // ========================================================================

    useLayoutEffect(() => {
        if (!measureRef.current || !layout) return;

        let cancelled = false;

        const calculatePages = async () => {
            setContentReady(false);

            const content = measureRef.current;
            if (!content || cancelled) return;

            // Wait for fonts
            if (document.fonts) {
                try {
                    await document.fonts.ready;
                } catch (error) {
                    console.warn('[PagedReader] Font loading check failed:', error);
                }
            }

            if (cancelled) return;

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

            // Wait for layout to settle
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => requestAnimationFrame(resolve));

            if (cancelled) return;

            const currentContent = measureRef.current;
            if (!currentContent) return;

            // Force reflow
            void currentContent.offsetHeight;
            void currentContent.scrollWidth;

            // Get actual values from browser
            const computedStyle = window.getComputedStyle(currentContent);
            const actualGap = parseFloat(computedStyle.columnGap) || layout.gap;

            // For vertical text (vertical-rl), pages are laid out horizontally.
            // Paging distance is the width of the viewport + gap.
            // For horizontal text with vertical paging, distance is height + gap.
            const pageSize = isVertical
                ? (layout.contentW + actualGap)
                : (layout.contentH + actualGap);

            // Calculate total pages
            const scrollSize = isVertical
                ? currentContent.scrollWidth
                : currentContent.scrollHeight;

            const totalPages = Math.max(1, Math.ceil((scrollSize - 1) / pageSize));

            setComputedPages({ totalPages, pageSize });

            // Handle navigation intent
            const intent = navigationIntentRef.current;
            navigationIntentRef.current = null;

            if (intent?.goToLastPage) {
                setCurrentPage(totalPages - 1);
            } else {
                setCurrentPage(p => Math.min(p, totalPages - 1));
            }

            requestAnimationFrame(() => {
                if (cancelled) return;
                setIsTransitioning(false);
                setContentReady(true);
            });
        };

        calculatePages();

        return () => {
            cancelled = true;
        };
    }, [currentHtml, layout, isVertical, typographyStyles]);

    // ========================================================================
    // Position Detection
    // ========================================================================

    const detectAndReportPosition = useCallback(() => {
        // GUARD: Don't save position if a restore is pending
        if (restorePendingRef.current) return;

        // GUARD: Don't save if save is locked (after restoration)
        if (Date.now() < saveLockUntilRef.current) {
            console.log('[PagedReader] Save locked, skipping detection');
            return;
        }

        if (!contentReady || !viewportRef.current || !stats) return;

        const pageSize = computedPages.pageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);

        if (pageSize <= 0) return;

        const detected = detectVisibleBlockPaged(
            viewportRef.current,
            currentPage,
            pageSize,
            isVertical,
            currentSection,
            stats?.blockMaps
        );

        if (!detected) {
            console.warn('[PagedReader] No block detected on page', currentPage);
            return;
        }

        // Update the anchor for future restores
        restoreAnchorRef.current = {
            blockId: detected.blockId,
            chapterIndex: currentSection,
            chapterCharOffset: detected.chapterCharOffset,
        };

        // Extract context for restoration
        const contextSnippet = extractContextSnippet(
            detected.element as Element,
            detected.blockLocalOffset,
            20
        );

        // Calculate progress
        const progressCalc = calculateProgress(
            currentSection,
            detected.chapterCharOffset,
            stats
        );

        // Build position object
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

        // Update local state
        setCurrentProgress(progressCalc.totalProgress);
        setCurrentPosition(position);

        // Schedule save
        saveSchedulerRef.current.scheduleSave(position);

        // Notify parent (via ref to prevent loops)
        onPositionUpdateRef.current?.({
            chapterIndex: currentSection,
            pageIndex: currentPage,
            chapterCharOffset: detected.chapterCharOffset,
            sentenceText: contextSnippet,
            totalProgress: progressCalc.totalProgress,
            blockId: detected.blockId,
        });

    }, [contentReady, stats, computedPages.pageSize, layout, currentPage, currentSection, isVertical]);

    // Detect position after page/chapter changes
    useEffect(() => {
        if (contentReady && !isTransitioning) {
            // Clear previous timer
            if (positionDetectTimerRef.current) {
                clearTimeout(positionDetectTimerRef.current);
            }

            // Delay to ensure transform has been applied
            positionDetectTimerRef.current = window.setTimeout(() => {
                detectAndReportPosition();
            }, POSITION_DETECT_DELAY_MS);

            return () => {
                if (positionDetectTimerRef.current) {
                    clearTimeout(positionDetectTimerRef.current);
                }
            };
        }
    }, [contentReady, isTransitioning, currentPage, currentSection, detectAndReportPosition]);

    // ========================================================================
    // Position Restoration (Clean "Once per Layout" Logic)
    // ========================================================================

    useEffect(() => {
        if (!contentReady) return;
        if (!contentRef.current) return;
        if (computedPages.pageSize <= 0) return;

        // Create a unique key for this layout state
        // Restores happen exactly once when this key changes
        const restoreKey = `${currentSection}|${layoutKey}|${computedPages.pageSize}|${computedPages.totalPages}`;

        if (restoreKey === lastRestoreKeyRef.current) return;

        const anchor = restoreAnchorRef.current;
        const anchorBlockId = anchor?.blockId;
        const anchorChapter = anchor?.chapterIndex ?? 0;

        // Fast restoration: no polling, just verify and restore
        const tryRestore = async () => {
            // Wait for next frame to ensure DOM is ready
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Verify blocks exist for the anchor chapter
            const blocks = contentRef.current.querySelectorAll(`[data-block-id^="ch${anchorChapter}-b"]`);
            
            if (blocks.length === 0) {
                console.log('[PagedReader] No blocks found for chapter', anchorChapter, '- skipping restoration');
                lastRestoreKeyRef.current = restoreKey;
                return;
            }

            // Block detection until we finish
            restorePendingRef.current = true;

            // If no anchor or wrong chapter, just mark done and allow detection
            if (!anchorBlockId || anchorChapter !== currentSection) {
                lastRestoreKeyRef.current = restoreKey;
                restorePendingRef.current = false;
                return;
            }

            let blockEl = contentRef.current.querySelector(
                `[data-block-id="${anchorBlockId}"]`
            ) as HTMLElement | null;

            if (!blockEl && stats?.blockMaps && anchor?.chapterCharOffset) {
                const chapterLookup = createChapterBlockLookup(stats.blockMaps, anchorChapter);
                const pos = getPositionFromCharOffset(chapterLookup, anchor.chapterCharOffset);
                
                if (pos) {
                    blockEl = contentRef.current.querySelector(
                        `[data-block-id="${pos.blockId}"]`
                    ) as HTMLElement | null;
                    
                    if (blockEl) {
                        console.log('[PagedReader] Restored using blockMaps:', {
                            originalBlockId: anchorBlockId,
                            foundBlockId: pos.blockId,
                            charOffset: anchor.chapterCharOffset,
                        });
                    }
                }
            }

            if (!blockEl) {
                console.log('[PagedReader] Block element not found - skipping restoration');
                lastRestoreKeyRef.current = restoreKey;
                restorePendingRef.current = false;
                return;
            }

            const blockRect = blockEl.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();

            // Match your existing logic (vertical uses translateY, horizontal uses translateX)
            const offset = isVertical
                ? (blockRect.top - contentRect.top)
                : (blockRect.left - contentRect.left);

            // Calculate which page the block is on based on its offset from content start
            // Note: blockRect and contentRect are from the measurement div which has no transform.
            const offset = isVertical
                ? (contentRect.right - blockRect.right) // horizontal offset for vertical-rl
                : (blockRect.top - contentRect.top);    // vertical offset for horizontal text

            const targetPage = Math.floor(Math.abs(offset) / computedPages.pageSize);
            const clamped = Math.max(0, Math.min(targetPage, computedPages.totalPages - 1));

            // Mark as restored for this layout
            lastRestoreKeyRef.current = restoreKey;

            setCurrentPage(prev => {
                if (prev === clamped) {
                    // If page didn't change, release the guard immediately
                    restorePendingRef.current = false;
                    // Set save lock for 3 seconds
                    saveLockUntilRef.current = Date.now() + SAVE_LOCK_DURATION_MS;
                    return prev;
                }
                return clamped;
            });

            // Release guard and set save lock after state updates
            requestAnimationFrame(() => {
                restorePendingRef.current = false;
                // Set save lock for 3 seconds to prevent overwriting restored position
                saveLockUntilRef.current = Date.now() + SAVE_LOCK_DURATION_MS;
            });
        };

        tryRestore();
    }, [contentReady, computedPages.pageSize, computedPages.totalPages, currentSection, isVertical, layoutKey, stats?.blockMaps]);

    // ========================================================================
    // Touch/Click Handlers
    // ========================================================================

    // ========================================================================
    // Navigation
    // ========================================================================

    const goToPage = useCallback((page: number) => {
        const clamped = Math.max(0, Math.min(page, computedPages.totalPages - 1));
        if (clamped !== currentPage) {
            setCurrentPage(clamped);
        }
    }, [computedPages.totalPages, currentPage]);

    const goToSection = useCallback((section: number, goToLastPage = false) => {
        const clamped = Math.max(0, Math.min(section, chapters.length - 1));
        if (clamped === currentSection) return;

        // Save current position before switching
        saveSchedulerRef.current.saveNow();

        setIsTransitioning(true);
        setContentReady(false);
        // Clear restore key so we restore again in new chapter if needed
        lastRestoreKeyRef.current = '';
        navigationIntentRef.current = { goToLastPage };
        setCurrentSection(clamped);
        setCurrentPage(0);
    }, [chapters.length, currentSection]);

    const goNext = useCallback(() => {
        if (!contentReady || isTransitioning) return;

        if (currentPage < computedPages.totalPages - 1) {
            goToPage(currentPage + 1);
        } else if (currentSection < chapters.length - 1) {
            goToSection(currentSection + 1, false);
        }
    }, [currentPage, computedPages.totalPages, currentSection, chapters.length, goToPage, goToSection, contentReady, isTransitioning]);

    const goPrev = useCallback(() => {
        if (!contentReady || isTransitioning) return;

        if (currentPage > 0) {
            goToPage(currentPage - 1);
        } else if (currentSection > 0) {
            goToSection(currentSection - 1, true);
        }
    }, [currentPage, currentSection, goToPage, goToSection, contentReady, isTransitioning]);

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
        if (!contentReady || isTransitioning) return;
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
    }, [contentReady, isTransitioning, isVertical, isRTL, goNext, goPrev, settings.lnEnableSwipe]);

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
        goToEnd: () => goToPage(computedPages.totalPages - 1),
    }), [goNext, goPrev, goToPage, computedPages.totalPages]);

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
                        if (element && contentRef.current && computedPages.pageSize > 0) {
                            const rect = element.getBoundingClientRect();
                            const contentRect = contentRef.current.getBoundingClientRect();
                            const offset = isVertical
                                ? rect.top - contentRect.top
                                : rect.left - contentRect.left;
                            const targetPage = Math.floor(Math.abs(offset) / computedPages.pageSize);
                            goToPage(Math.max(0, Math.min(targetPage, computedPages.totalPages - 1)));
                        }
                    }, 100);
                } else {
                    // Different chapter
                    goToSection(chapterIndex, false);

                    if (anchor) {
                        setTimeout(() => {
                            const element = document.getElementById(anchor);
                        if (element && contentRef.current && computedPages.pageSize > 0) {
                                const rect = element.getBoundingClientRect();
                                const contentRect = contentRef.current.getBoundingClientRect();
                                const offset = isVertical
                                    ? rect.top - contentRect.top
                                    : rect.left - contentRect.left;
                            const targetPage = Math.floor(Math.abs(offset) / computedPages.pageSize);
                            goToPage(Math.max(0, Math.min(targetPage, computedPages.totalPages - 1)));
                            }
                        }, 500);
                    }
                }
            }
        };

        container.addEventListener('epub-link-clicked', handleEpubLink);
        return () => container.removeEventListener('epub-link-clicked', handleEpubLink);
}, [chapters.length, goToSection, chapterFilenames, currentSection, goToPage, isVertical, computedPages.pageSize, computedPages.totalPages]);

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
    const pageSize = computedPages.pageSize || (layout?.columnWidth || 0) + (layout?.gap || 80);

    const pageProgressPercent = computedPages.totalPages > 0
        ? ((currentPage + 1) / computedPages.totalPages) * 100
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
            {/* Measurement div (Hidden) */}
            <div
                ref={measureRef}
                className={`paged-content ${!settings.lnEnableFurigana ? 'furigana-hidden' : ''}`}
                style={{
                    ...typographyStyles,
                    color: theme.fg,
                    columnWidth: `${layout.columnWidth}px`,
                    columnGap: `${layout.gap}px`,
                    columnFill: 'auto',
                    boxSizing: 'border-box',
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                    position: 'absolute',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    zIndex: -1,
                    transform: 'none',
                    transition: 'none',
                    ...(isVertical
                        ? {
                            writingMode: 'vertical-rl',
                            textOrientation: 'mixed',
                            width: 'auto',
                            minWidth: `${layout.contentW}px`,
                            height: `${layout.contentH}px`,
                        }
                        : {
                            width: `${layout.contentW}px`,
                            height: 'auto',
                            minHeight: `${layout.contentH}px`,
                        }
                    ),
                }}
                dangerouslySetInnerHTML={{ __html: currentHtml }}
            />

            {/* Dynamic image sizing */}
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

            {/* Multi-Viewport Reader */}
            {Array.from({ length: visiblePageRange.end - visiblePageRange.start + 1 }).map((_, i) => {
                const pageIndex = visiblePageRange.start + i;
                const isCurrentPage = pageIndex === currentPage;
                const offset = pageIndex * computedPages.pageSize;

                // Paging direction based on text orientation
                // For vertical-rl, we shift content RIGHT to bring left columns into view
                const contentTransform = isVertical
                    ? `translateX(${offset}px)`
                    : `translateY(${-offset}px)`;

                // Slide factor for horizontal viewport movement
                // LTR: Page 1 (0%), Page 2 (100%) -> Next is Right
                // RTL: Page 1 (0%), Page 2 (-100%) -> Next is Left
                const slideFactor = isVertical ? (currentPage - pageIndex) : (pageIndex - currentPage);

                return (
                    <div
                        key={pageIndex}
                        ref={isCurrentPage ? viewportRef : undefined}
                        className="page-viewport"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            paddingTop: `calc(${layout.padding}px + ${safeAreaTopInset ?? '0px'})`,
                            paddingRight: `${layout.padding}px`,
                            paddingBottom: `${layout.padding}px`,
                            paddingLeft: `${layout.padding}px`,
                            overflow: 'hidden',
                            clipPath: 'inset(0px)',
                            transform: `translateX(calc(${slideFactor * 100}% + ${slideFactor * PAGE_GAP_PX}px))`,
                            transition: settings.lnDisableAnimations ? 'none' : 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                            zIndex: isCurrentPage ? 1 : 0,
                            // Performance optimizations
                            contain: 'strict',
                            contentVisibility: isCurrentPage ? 'visible' : 'auto',
                            pointerEvents: isCurrentPage ? 'auto' : 'none',
                            // Ensure vertical text starts on the right
                            display: isVertical ? 'flex' : 'block',
                            justifyContent: isVertical ? 'flex-end' : 'flex-start',
                        }}
                        onClick={isCurrentPage ? handleContentClick : undefined}
                        onPointerDown={isCurrentPage ? handlePointerDown : undefined}
                        onPointerMove={isCurrentPage ? handlePointerMove : undefined}
                        onTouchStart={isCurrentPage ? handleTouchStart : undefined}
                        onTouchEnd={isCurrentPage ? handleTouchEnd : undefined}
                    >
                        <div
                            ref={isCurrentPage ? contentRef : undefined}
                            className={`paged-content ${!settings.lnEnableFurigana ? 'furigana-hidden' : ''}`}
                            lang={isKorean ? "ko" : undefined}
                            style={{
                                ...typographyStyles,
                                color: (settings.lnTextBrightness ?? 100) === 100
                                    ? theme.fg
                                    : adjustBrightness(theme.fg, settings.lnTextBrightness ?? 100),
                                columnWidth: `${layout.columnWidth}px`,
                                columnGap: `${layout.gap}px`,
                                columnFill: 'auto',
                                boxSizing: 'border-box',
                                overflowWrap: 'break-word',
                                wordBreak: 'break-word',
                                transform: contentTransform,
                                willChange: 'transform',
                                ...(isVertical
                                    ? {
                                        writingMode: 'vertical-rl',
                                        textOrientation: 'mixed',
                                        width: 'auto', // Changed to auto for horizontal paging
                                        minWidth: `${layout.contentW}px`,
                                        height: `${layout.contentH}px`,
                                    }
                                    : {
                                        width: `${layout.contentW}px`,
                                        height: 'auto', // Changed to auto for vertical paging
                                        minHeight: `${layout.contentH}px`,
                                    }
                                ),
                            }}
                            dangerouslySetInnerHTML={{ __html: currentHtml }}
                        />
                    </div>
                );
            })}

            {/* Loading Overlay */}
            {(!contentReady || isTransitioning) && (
                <div
                    className="paged-loading"
                    style={{ backgroundColor: theme.bg, color: theme.fg }}
                >
                    <div className="loading-spinner" />
                </div>
            )}

            <SelectionHandles 
                containerRef={contentRef}
                enabled={contentReady && !isTransitioning}
                theme={(settings.lnTheme as 'light' | 'sepia' | 'dark' | 'black') || 'dark'}
                onSelectionComplete={(text, startOffset, endOffset, blockId) => {
                    if (onAddHighlight && currentSection && blockId) {
                        onAddHighlight(currentSection, blockId, text, startOffset, endOffset);
                    }
                }}
            />

            {/* Click Zones - Visual Debug Only */}
            {contentReady && (
                <ClickZones
                    isVertical={isVertical}
                    canGoNext={currentPage < computedPages.totalPages - 1 || currentSection < chapters.length - 1}
                    canGoPrev={currentPage > 0 || currentSection > 0}
                    zoneSize={settings.lnClickZoneSize ?? 10}
                    zonePosition={settings.lnClickZonePosition ?? 'full'}
                    zoneCoverage={settings.lnClickZoneCoverage ?? 60}
                    zonePlacement={settings.lnClickZonePlacement ?? 'vertical'}
                    visible={showNavigation}
                    debugMode={settings.debugMode}
                />
            )}

            {contentReady && (
                <ReaderNavigationUI
                    visible={showNavigation}
                    onNext={goNext}
                    onPrev={goPrev}
                    canGoNext={currentPage < computedPages.totalPages - 1 || currentSection < chapters.length - 1}
                    canGoPrev={currentPage > 0 || currentSection > 0}
                    currentPage={currentPage}
                    totalPages={computedPages.totalPages}
                    currentChapter={currentSection}
                    totalChapters={chapters.length}
                    progress={pageProgressPercent}
                    totalBookProgress={currentProgress}
                    showSlider={computedPages.totalPages > 1}
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
