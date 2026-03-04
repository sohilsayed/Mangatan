
/**
 * JS Paginator utility for calculating paged layout without CSS columns.
 */

export interface PaginationResult {
    totalPages: number;
    pageSize: number;
    scrollSize: number;
}

/**
 * Calculates pagination details by performing an in-place measurement.
 *
 * @param content - The content element to measure
 * @param options - Layout options
 */
export async function calculatePagination(
    content: HTMLElement,
    options: {
        width: number;
        height: number;
        isVertical: boolean;
        marginTop: number;
        marginBottom: number;
        marginLeft: number;
        marginRight: number;
    }
): Promise<PaginationResult> {
    const { width, height, isVertical, marginTop, marginBottom, marginLeft, marginRight } = options;

    // Available space for text
    const availableW = width - marginLeft - marginRight;
    const availableH = height - marginTop - marginBottom;

    // Setup content for measurement
    content.style.transform = 'none';
    content.style.transition = 'none';
    content.style.contain = 'none';

    if (isVertical) {
        content.style.writingMode = 'vertical-rl';
        content.style.width = 'max-content';
        content.style.height = `${availableH}px`;
    } else {
        content.style.writingMode = 'horizontal-tb';
        content.style.width = `${availableW}px`;
        content.style.height = 'max-content';
    }

    // Wait for fonts
    if (document.fonts) await document.fonts.ready;

    // Wait for images
    const images = content.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>(resolve => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(resolve, 500);
        });
    }));

    // Allow browser to layout
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    const rect = content.getBoundingClientRect();
    const scrollSize = isVertical ? rect.width : rect.height;
    const pageSize = isVertical ? availableW : availableH;

    const totalPages = Math.max(1, Math.ceil((scrollSize - 1) / pageSize));

    return { totalPages, pageSize, scrollSize };
}
