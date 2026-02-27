
import { Settings } from '@/Manatan/types';
import { getCleanTextContent, getCleanCharCount } from './blockPosition';

export interface FragmentBlock {
    html: string;
    charCount: number;
    charOffset: number; // Offset from start of chapter
    blockId: string | null;
    visualOffset?: number; // Y offset (horizontal) or X offset (vertical) for tall blocks
    clippingHeight?: number; // Viewport height for tall blocks
}

export interface PageFragment {
    blocks: FragmentBlock[];
    startIndex: number;
    endIndex: number;
    charOffset: number; // Offset of the first block in the page
}

const BLOCK_ELEMENTS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGURE', 'LI', 'SECTION', 'ARTICLE']);

/**
 * Recursively find block-level elements that should be treated as fragmentation units.
 */
function findBlocks(element: Element, blocks: FragmentBlock[], state: { currentOffset: number }) {
    // If it's a leaf block (contains data-block-id directly or is a simple paragraph)
    if (element.hasAttribute('data-block-id') || (BLOCK_ELEMENTS.has(element.tagName) && !Array.from(element.children).some(c => BLOCK_ELEMENTS.has(c.tagName)))) {
        const text = getCleanTextContent(element);
        const charCount = getCleanCharCount(text);

        blocks.push({
            html: element.outerHTML,
            charCount,
            charOffset: state.currentOffset,
            blockId: element.getAttribute('data-block-id')
        });

        state.currentOffset += charCount;
        return;
    }

    if (element.children.length === 0) {
        if (element.outerHTML.trim()) {
            const text = getCleanTextContent(element);
            const charCount = getCleanCharCount(text);

            blocks.push({
                html: element.outerHTML,
                charCount,
                charOffset: state.currentOffset,
                blockId: null
            });
            state.currentOffset += charCount;
        }
        return;
    }

    // Otherwise, recurse into children
    Array.from(element.children).forEach(child => findBlocks(child, blocks, state));
}

/**
 * Parses raw HTML chapter content into a list of fragmentation blocks.
 */
export function parseChapterToBlocks(html: string): FragmentBlock[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    const blocks: FragmentBlock[] = [];
    const state = { currentOffset: 0 };
    findBlocks(body, blocks, state);
    return blocks;
}

/**
 * Options for the fragmenting process
 */
export interface FragmentOptions {
    viewportWidth: number;
    viewportHeight: number;
    margin: number;
    isVertical: boolean;
    gap?: number;
}

/**
 * Since we can't easily measure without a DOM, this utility provides the logic
 * to be used within a React Hook that has access to a measurement container.
 */
export function createPageFragments(
    blocks: FragmentBlock[],
    measuredSizes: number[], // Height for horizontal, Width for vertical
    options: FragmentOptions
): PageFragment[] {
    const { viewportWidth, viewportHeight, margin, isVertical } = options;

    // The available space per page
    const availableSpace = isVertical
        ? viewportWidth - (margin * 2)
        : viewportHeight - (margin * 2);

    const fragments: PageFragment[] = [];
    let currentBlocks: FragmentBlock[] = [];
    let currentSize = 0;
    let startIndexInFullList = 0;

    for (let i = 0; i < blocks.length; i++) {
        const blockSize = measuredSizes[i] || 0;

        // If a single block is larger than the available space, we need to fragment it
        if (blockSize > availableSpace) {
            // Finish existing page if any
            if (currentBlocks.length > 0) {
                fragments.push({
                    blocks: currentBlocks,
                    startIndex: startIndexInFullList,
                    endIndex: i - 1,
                    charOffset: currentBlocks[0].charOffset
                });
                currentBlocks = [];
                currentSize = 0;
            }

            // Split the tall block into multiple virtual fragments
            let remainingHeight = blockSize;
            let offset = 0;
            const totalCharsInBlock = blocks[i].charCount;

            // Safety break to prevent infinite loops
            let iterations = 0;
            const fragmentSize = Math.max(100, availableSpace); // Ensure we always advance

            while (remainingHeight > 0 && iterations < 500) {
                iterations++;
                const progressRatio = offset / blockSize;
                fragments.push({
                    blocks: [{
                        ...blocks[i],
                        visualOffset: offset,
                        clippingHeight: availableSpace
                    }],
                    startIndex: i,
                    endIndex: i,
                    charOffset: blocks[i].charOffset + Math.floor(totalCharsInBlock * progressRatio)
                });
                remainingHeight -= fragmentSize;
                offset += fragmentSize;
            }
            startIndexInFullList = i + 1;
            continue;
        }

        if (currentSize + blockSize > availableSpace && currentBlocks.length > 0) {
            // Finish current page
            fragments.push({
                blocks: currentBlocks,
                startIndex: startIndexInFullList,
                endIndex: i - 1,
                charOffset: currentBlocks[0].charOffset
            });

            // Start new page
            currentBlocks = [blocks[i]];
            currentSize = blockSize;
            startIndexInFullList = i;
        } else {
            currentBlocks.push(blocks[i]);
            currentSize += blockSize;
        }
    }

    // Add the last page
    if (currentBlocks.length > 0) {
        fragments.push({
            blocks: currentBlocks,
            startIndex: startIndexInFullList,
            endIndex: blocks.length - 1,
            charOffset: currentBlocks[0].charOffset
        });
    }

    return fragments;
}
