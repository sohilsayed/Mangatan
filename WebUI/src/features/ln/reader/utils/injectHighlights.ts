import { LNHighlight } from '@/lib/storage/AppStorage';

/**
 * Applies highlights to a chapter's HTML content using DOM manipulation.
 * This ensures precise placement and prevents corruption of HTML structure.
 */
export function injectHighlightsIntoHtml(
    html: string,
    chapterHighlights: LNHighlight[],
    chapterIndex?: number
): string {
    if (!chapterHighlights || chapterHighlights.length === 0 || !html) return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Filter by chapter if provided, then sort highlights by startOffset descending
    // so we apply from end to start to prevent offset shifting.
    const sortedHighlights = [...chapterHighlights]
        .filter(h => chapterIndex === undefined || h.chapterIndex === chapterIndex)
        .sort((a, b) => {
            if (a.blockId !== b.blockId) {
                return a.blockId.localeCompare(b.blockId);
            }
            return b.startOffset - a.startOffset;
        });

    for (const highlight of sortedHighlights) {
        const block = doc.querySelector(`[data-block-id="${highlight.blockId}"]`);
        if (!block) continue;

        try {
            applyHighlightToBlock(block, highlight.startOffset, highlight.endOffset, highlight.id);
        } catch (err) {
            console.warn('[Highlights] Failed to apply highlight:', highlight.id, err);
        }
    }

    return doc.body.innerHTML;
}

function applyHighlightToBlock(
    block: Element,
    startOffset: number,
    endOffset: number,
    highlightId: string
): void {
    const walker = document.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT,
        null
    );

    let currentOffset = 0;
    const textNodes: { node: Text; start: number; end: number }[] = [];

    // Collect all text nodes with their offsets
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const nodeLength = node.textContent?.length || 0;

        textNodes.push({
            node,
            start: currentOffset,
            end: currentOffset + nodeLength,
        });

        currentOffset += nodeLength;
    }

    // Find nodes that overlap with the highlight range
    const overlappingNodes = textNodes.filter(
        tn => tn.end > startOffset && tn.start < endOffset
    );

    // Apply highlight to each overlapping node (in reverse order to preserve offsets)
    for (let i = overlappingNodes.length - 1; i >= 0; i--) {
        const { node, start } = overlappingNodes[i];

        const highlightStart = Math.max(0, startOffset - start);
        const highlightEnd = Math.min(node.textContent?.length || 0, endOffset - start);

        if (highlightStart >= highlightEnd) continue;

        const text = node.textContent || '';
        const before = text.substring(0, highlightStart);
        const highlighted = text.substring(highlightStart, highlightEnd);
        const after = text.substring(highlightEnd);

        const fragment = document.createDocumentFragment();

        if (before) {
            fragment.appendChild(document.createTextNode(before));
        }

        const mark = document.createElement('mark');
        mark.className = 'highlight';
        mark.dataset.highlightId = highlightId;
        mark.textContent = highlighted;
        fragment.appendChild(mark);

        if (after) {
            fragment.appendChild(document.createTextNode(after));
        }

        node.parentNode?.replaceChild(fragment, node);
    }
}
