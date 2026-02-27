
import { Settings } from '@/Manatan/types';

export interface PageFragment {
    blocks: string[];
    startIndex: number;
    endIndex: number;
}

/**
 * Parses raw HTML chapter content into a list of top-level blocks.
 */
export function parseChapterToBlocks(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    // We want to keep top-level elements as individual blocks
    return Array.from(body.children).map(child => child.outerHTML);
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
    blocks: string[],
    measuredSizes: number[], // Height for horizontal, Width for vertical
    options: FragmentOptions
): PageFragment[] {
    const { viewportWidth, viewportHeight, margin, isVertical } = options;

    // The available space per page
    const availableSpace = isVertical
        ? viewportWidth - (margin * 2)
        : viewportHeight - (margin * 2);

    const fragments: PageFragment[] = [];
    let currentBlocks: string[] = [];
    let currentSize = 0;
    let startIndex = 0;

    for (let i = 0; i < blocks.length; i++) {
        const blockSize = measuredSizes[i] || 0;

        // If a single block is larger than the available space, it gets its own page
        // (This might happen with large images).
        if (blockSize > availableSpace && currentBlocks.length === 0) {
            fragments.push({
                blocks: [blocks[i]],
                startIndex: i,
                endIndex: i
            });
            startIndex = i + 1;
            continue;
        }

        if (currentSize + blockSize > availableSpace && currentBlocks.length > 0) {
            // Finish current page
            fragments.push({
                blocks: currentBlocks,
                startIndex: startIndex,
                endIndex: i - 1
            });

            // Start new page
            currentBlocks = [blocks[i]];
            currentSize = blockSize;
            startIndex = i;
        } else {
            currentBlocks.push(blocks[i]);
            currentSize += blockSize;
        }
    }

    // Add the last page
    if (currentBlocks.length > 0) {
        fragments.push({
            blocks: currentBlocks,
            startIndex: startIndex,
            endIndex: blocks.length - 1
        });
    }

    return fragments;
}
