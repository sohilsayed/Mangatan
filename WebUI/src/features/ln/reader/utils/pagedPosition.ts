
import { BlockIndexMap } from '../types/block';
import {
    getCleanTextContent,
    getCleanCharCount,
    extractContextSnippet
} from './blockPosition';
import { createChapterBlockLookup, calculateCharOffsetFromBlock } from './blockMap';

// ============================================================================
// Types
// ============================================================================

export interface DetectedBlock {
    blockId: string;
    element: Element;
    blockLocalOffset: number;
    chapterCharOffset: number;
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Find the block that's currently at the reading position for paged mode
 * 
 * @param container - The viewport container element
 * @param pageIndex - Current page index (0-based)
 * @param pageSize - Size of each page in pixels
 * @param isVertical - Whether reading direction is vertical
 * @param chapterIndex - Current chapter index (for block ID prefix)
 * @param blockMaps - Optional blockMaps for precise character offset calculation
 */
export function detectVisibleBlockPaged(
    container: HTMLElement,
    pageIndex: number,
    pageSize: number,
    isVertical: boolean,
    chapterIndex: number,
    blockMaps?: BlockIndexMap[]
): DetectedBlock | null {
    // Get all blocks
    const allBlocks = container.querySelectorAll('[data-block-id]');

    if (allBlocks.length === 0) {
        console.warn('[pagedPosition] No blocks found in container');
        return null;
    }

    const containerRect = container.getBoundingClientRect();
    // scrollOffset is the virtual position in the untransformed chapter layout
    const scrollOffset = pageIndex * pageSize;

    let bestBlock: Element | null = null;
    let bestDistance = Infinity;

    // Find block closest to the reading edge (top for horizontal, right for vertical)
    for (const block of allBlocks) {
        const rect = block.getBoundingClientRect();

        // Check if block is physically visible in this viewport
        const isVisible = isVertical
            ? (rect.right > containerRect.left - 1 && rect.left < containerRect.right + 1)
            : (rect.bottom > containerRect.top - 1 && rect.top < containerRect.bottom + 1);

        if (isVisible) {
            // Distance from the "start" edge of the viewport
            const distance = isVertical
                ? Math.abs(containerRect.right - rect.right)
                : Math.abs(rect.top - containerRect.top);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestBlock = block;
            }
        }
    }

    // Fallback to first block if none found
    if (!bestBlock) {
        bestBlock = allBlocks[0];
    }

    const blockId = bestBlock.getAttribute('data-block-id');
    if (!blockId) {
        console.warn('[pagedPosition] Best block has no data-block-id');
        return null;
    }

    // Calculate block local offset (how far into the block we've read)
    const blockRect = bestBlock.getBoundingClientRect();
    const blockText = getCleanTextContent(bestBlock);
    const blockChars = blockText.length;

    let blockLocalOffset = 0;
    if (blockChars > 0) {
        let readRatio: number;

        if (isVertical) {
            // Vertical text (vertical-rl): reading progress is horizontal, right to left.
            const scrollRight = pageIndex * pageSize;
            const blockRight = containerRect.right - blockRect.right + scrollRight;
            const readAmount = scrollRight - blockRight;
            readRatio = Math.max(0, Math.min(1, readAmount / blockRect.width));
        } else {
            // Horizontal text uses vertical offset for reading progress
            const scrollTop = pageIndex * pageSize;
            const blockTop = blockRect.top - containerRect.top + scrollTop;
            const readAmount = scrollTop - blockTop;
            readRatio = Math.max(0, Math.min(1, readAmount / blockRect.height));
        }

        blockLocalOffset = Math.floor(blockChars * readRatio);
    }

    // Calculate chapter character offset using blockMaps (precise!) or fallback to DOM counting
    let chapterCharOffset: number;
    
    if (blockMaps && blockMaps.length > 0) {
        const chapterLookup = createChapterBlockLookup(blockMaps, chapterIndex);
        chapterCharOffset = calculateCharOffsetFromBlock(chapterLookup, blockId, blockLocalOffset);
    } else {
        // Fallback: count from DOM
        chapterCharOffset = 0;
        for (const block of allBlocks) {
            if (block === bestBlock) {
                chapterCharOffset += blockLocalOffset;
                break;
            }
            const text = getCleanTextContent(block);
            chapterCharOffset += getCleanCharCount(text);
        }
    }

    return {
        blockId,
        element: bestBlock,
        blockLocalOffset,
        chapterCharOffset,
    };
}

/**
 * Find which page contains a specific block.
 * Should be called on the untransformed measurement container.
 */
export function findPageForBlock(
    container: HTMLElement,
    blockId: string,
    pageSize: number,
    isVertical: boolean
): number {
    const block = container.querySelector(`[data-block-id="${blockId}"]`);
    if (!block) return 0;

    const containerRect = container.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();

    let offsetFromStart: number;

    if (isVertical) {
        // Japanese: distance from right edge.
        // We use Math.abs because RTL coordinates can sometimes be tricky depending on browser.
        offsetFromStart = Math.abs(containerRect.right - blockRect.right) + (container.scrollLeft || 0);
    } else {
        // English: distance from top edge
        offsetFromStart = Math.abs(blockRect.top - containerRect.top) + (container.scrollTop || 0);
    }

    // Use a small epsilon (1px) to avoid float rounding issues
    return Math.floor((offsetFromStart + 1) / pageSize);
}

/**
 * Restore position to a specific block on a page
 */
export function restoreToBlockPaged(
    container: HTMLElement,
    blockId: string,
    blockLocalOffset: number,
    pageSize: number,
    isVertical: boolean
): { pageIndex: number; success: boolean } {
    const block = container.querySelector(`[data-block-id="${blockId}"]`);

    if (!block) {
        console.warn('[pagedPosition] Block not found for restoration:', blockId);
        return { pageIndex: 0, success: false };
    }

    const pageIndex = findPageForBlock(container, blockId, pageSize, isVertical);

    console.log('[pagedPosition] Restored to block:', {
        blockId,
        pageIndex,
        blockLocalOffset,
    });

    return { pageIndex, success: true };
}