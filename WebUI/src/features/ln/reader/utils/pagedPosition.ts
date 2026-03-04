
import { BlockIndexMap } from '../types/block';
import {
    getCleanTextContent,
    getCleanCharCount,
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
 * Find the block that's currently at the reading position for paged mode.
 * Optimized for JS pagination where a single container is shifted.
 */
export function detectVisibleBlockPaged(
    container: HTMLElement,
    pageIndex: number,
    pageSize: number,
    isVertical: boolean,
    chapterIndex: number,
    blockMaps?: BlockIndexMap[]
): DetectedBlock | null {
    const allBlocks = container.querySelectorAll('[data-block-id]');
    if (allBlocks.length === 0) return null;

    const containerRect = container.getBoundingClientRect();
    const currentOffset = pageIndex * pageSize;

    let bestBlock: Element | null = null;
    let bestDistance = Infinity;

    for (const block of allBlocks) {
        const rect = block.getBoundingClientRect();
        let blockNaturalStart: number;

        if (isVertical) {
            // Both containerRect and rect are affected by the shift.
            // Their relative distance is invariant.
            blockNaturalStart = containerRect.right - rect.right;
        } else {
            blockNaturalStart = rect.top - containerRect.top;
        }

        const blockSize = isVertical ? rect.width : rect.height;
        const blockEnd = blockNaturalStart + blockSize;
        const viewportStart = 0;
        const viewportEnd = pageSize;

        const isVisible = blockEnd > viewportStart && blockNaturalStart < viewportEnd;

        if (isVisible) {
            const distance = Math.abs(blockNaturalStart - viewportStart);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestBlock = block;
            }
        }
    }

    if (!bestBlock) bestBlock = allBlocks[0];

    const blockId = bestBlock.getAttribute('data-block-id');
    if (!blockId) return null;

    const blockRect = bestBlock.getBoundingClientRect();
    const blockChars = getCleanTextContent(bestBlock).length;
    let blockLocalOffset = 0;

    if (blockChars > 0) {
        const viewportNaturalStart = pageIndex * pageSize;
        const blockNaturalStart = isVertical
            ? containerRect.right - blockRect.right
            : blockRect.top - containerRect.top;

        const readAmount = viewportNaturalStart - blockNaturalStart;
        const blockSize = isVertical ? blockRect.width : blockRect.height;
        const ratio = Math.max(0, Math.min(1, readAmount / (blockSize || 1)));
        blockLocalOffset = Math.floor(blockChars * ratio);
    }

    let chapterCharOffset: number;
    if (blockMaps && blockMaps.length > 0) {
        const chapterLookup = createChapterBlockLookup(blockMaps, chapterIndex);
        chapterCharOffset = calculateCharOffsetFromBlock(chapterLookup, blockId, blockLocalOffset);
    } else {
        chapterCharOffset = 0;
        for (const block of allBlocks) {
            if (block === bestBlock) {
                chapterCharOffset += blockLocalOffset;
                break;
            }
            chapterCharOffset += getCleanCharCount(getCleanTextContent(block));
        }
    }

    return { blockId, element: bestBlock, blockLocalOffset, chapterCharOffset };
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

    let blockPosition: number;
    if (isVertical) {
        // Since both are shifted by same transform, the difference is the natural offset
        blockPosition = containerRect.right - blockRect.right;
    } else {
        blockPosition = blockRect.top - containerRect.top;
    }

    return Math.floor(Math.abs(blockPosition) / pageSize);
}
