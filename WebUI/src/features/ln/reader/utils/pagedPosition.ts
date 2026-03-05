
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
    // With Shadow DOM, the blocks are inside the shadow root of the ReaderPage
    // container here is the host element (ReaderPage)
    const shadow = container.shadowRoot;
    const content = shadow?.querySelector('.content') || container;

    // Get all blocks
    const allBlocks = content.querySelectorAll('[data-block-id]');

    if (allBlocks.length === 0) {
        console.warn('[pagedPosition] No blocks found in container');
        return null;
    }

    const containerRect = container.getBoundingClientRect();
    const scrollOffset = pageIndex * pageSize;

    let bestBlock: Element | null = null;
    let bestDistance = Infinity;

    // The container here is the active ReaderPage, which already has transform: none.
    // However, the content inside it is shifted by -pageIndex * pageSize.
    // We want to find the block that is visible within the physical bounds of the container.
    // Since the container itself is already positioned correctly in the viewport (part of paged-strip),
    // we just need to check if the block's current bounding rect overlaps with the container's bounding rect.

    // Find block closest to the reading edge
    for (const block of allBlocks) {
        const rect = block.getBoundingClientRect();

        // Check if block overlaps with container
        const isVisible = isVertical
            ? (rect.bottom > containerRect.top && rect.top < containerRect.bottom)
            : (rect.right > containerRect.left && rect.left < containerRect.right);

        if (isVisible) {
            const distance = isVertical
                ? Math.abs(rect.top - containerRect.top)
                : Math.abs(rect.left - containerRect.left);

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
            const readAmount = containerRect.top - blockRect.top;
            readRatio = Math.max(0, Math.min(1, readAmount / blockRect.height));
        } else {
            const readAmount = containerRect.left - blockRect.left;
            readRatio = Math.max(0, Math.min(1, readAmount / blockRect.width));
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
    const shadow = container.shadowRoot;
    const content = shadow?.querySelector('.content') as HTMLElement;
    if (!content) return 0;

    const block = content.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
    if (!block) return 0;

    // Reset transform to measure true position relative to content container
    const originalTransform = content.style.transform;
    content.style.transform = 'none';

    const blockRect = block.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    let blockPosition: number;
    if (isVertical) {
        blockPosition = blockRect.top - contentRect.top;
    } else {
        blockPosition = blockRect.left - contentRect.left;
    }

    // Restore transform
    content.style.transform = originalTransform;

    return Math.floor(Math.abs(blockPosition) / pageSize);
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
    const shadow = container.shadowRoot;
    const content = shadow?.querySelector('.content') || container;
    const block = content.querySelector(`[data-block-id="${blockId}"]`);

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