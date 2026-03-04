
/**
 * JS Paginator utility for calculating paged layout without CSS columns.
 */

export interface PaginationResult {
    totalPages: number;
    pageSize: number;
    scrollSize: number;
}

/**
 * Calculates pagination details by rendering content in a hidden measurement div.
 *
 * @param contentHtml - The HTML content of the chapter
 * @param options - Layout options (width, height, styles, margins, etc.)
 */
export async function calculatePagination(
    contentHtml: string,
    options: {
        width: number;
        height: number;
        isVertical: boolean;
        styles: React.CSSProperties;
        marginTop: number;
        marginBottom: number;
        marginLeft: number;
        marginRight: number;
    }
): Promise<PaginationResult> {
    const { width, height, isVertical, styles, marginTop, marginBottom, marginLeft, marginRight } = options;

    // Create measurement container
    const measureContainer = document.createElement('div');
    measureContainer.className = 'measure-container';
    measureContainer.style.position = 'fixed';
    measureContainer.style.top = '-10000px';
    measureContainer.style.left = '-10000px';
    measureContainer.style.visibility = 'hidden';
    measureContainer.style.pointerEvents = 'none';

    // Set measurement area size (available space for text)
    const availableW = width - marginLeft - marginRight;
    const availableH = height - marginTop - marginBottom;

    // Measurement box
    const measureBox = document.createElement('div');
    measureBox.className = 'measure-box';

    // Apply typography and layout styles
    Object.assign(measureBox.style, styles);

    // Crucially, we use the writing mode but NOT column-count
    // We want to measure the natural flow size
    measureBox.style.writingMode = isVertical ? 'vertical-rl' : 'horizontal-tb';
    measureBox.style.width = isVertical ? 'auto' : `${availableW}px`;
    measureBox.style.height = isVertical ? `${availableH}px` : 'auto';
    measureBox.style.margin = '0';
    measureBox.style.padding = '0';
    measureBox.style.columnCount = 'auto'; // Ensure no columns
    measureBox.style.columnWidth = 'auto';
    measureBox.style.overflow = 'hidden';

    measureBox.innerHTML = contentHtml;
    measureContainer.appendChild(measureBox);
    document.body.appendChild(measureContainer);

    try {
        // Wait for images to load within the measurement div
        const images = measureBox.querySelectorAll('img');
        const imagePromises = Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise<void>(resolve => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
                // Safety timeout
                setTimeout(resolve, 500);
            });
        });
        await Promise.all(imagePromises);

        // Allow some time for layout to settle
        await new Promise(resolve => requestAnimationFrame(resolve));

        const scrollSize = isVertical ? measureBox.scrollWidth : measureBox.scrollHeight;
        const pageSize = isVertical ? availableW : availableH;

        // Calculate total pages
        // We add a tiny epsilon to avoid off-by-one errors from subpixel rendering
        const totalPages = Math.max(1, Math.ceil((scrollSize - 1) / pageSize));

        return {
            totalPages,
            pageSize,
            scrollSize
        };
    } finally {
        document.body.removeChild(measureContainer);
    }
}
