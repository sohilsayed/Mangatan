
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
    const scrollOffset = pageIndex * pageSize;

    let bestBlock: Element | null = null;
    let bestDistance = Infinity;

    // Find block closest to the reading edge
    for (const block of allBlocks) {
        const rect = block.getBoundingClientRect();

        let blockPosition: number;
        let viewportStart: number;
        let viewportEnd: number;

        if (isVertical) {
            // Natural position from right edge
            blockPosition = containerRect.right - rect.right;
            viewportStart = pageIndex * pageSize;
            viewportEnd = viewportStart + pageSize;
        } else {
            // Natural position from top edge
            blockPosition = rect.top - containerRect.top;
            viewportStart = pageIndex * pageSize;
            viewportEnd = viewportStart + pageSize;
        }

        const blockSize = isVertical ? rect.width : rect.height; // Logic fixed
        const blockEnd = blockPosition + blockSize;

        // Check if block is visible on current page
        const isVisible = blockEnd > viewportStart && blockPosition < viewportEnd;

        if (isVisible) {
            const distance = Math.abs(blockPosition - viewportStart);
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

        const currentOffset = pageIndex * pageSize;
        if (isVertical) {
            const blockNaturalStart = containerRect.right - blockRect.right;
            const readAmount = currentOffset - blockNaturalStart;
            // In vertical-rl, width is the "scrolling" dimension
            readRatio = Math.max(0, Math.min(1, readAmount / (blockRect.width || 1)));
        } else {
            const blockNaturalStart = blockRect.top - containerRect.top;
            const readAmount = currentOffset - blockNaturalStart;
            // In horizontal, height is the "scrolling" dimension
            readRatio = Math.max(0, Math.min(1, readAmount / (blockRect.height || 1)));
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
 * Find which page contains a specific block
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

    // Calculate block's position in the scrollable content
    let blockPosition: number;

    if (isVertical) {
        blockPosition = containerRect.right - blockRect.right;
    } else {
        blockPosition = blockRect.top - containerRect.top;
    }

    return Math.floor(blockPosition / pageSize);
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