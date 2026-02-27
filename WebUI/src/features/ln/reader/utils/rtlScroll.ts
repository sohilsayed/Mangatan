
/**
 * Browser-agnostic RTL scroll helper.
 *
 * Some browsers (Chrome/FF) use negative scrollLeft values for RTL.
 * Others (older Safari) use positive values that increase from right to left.
 */
export function scrollToPageRTL(
    container: HTMLElement,
    pageIndex: number,
    viewportWidth: number,
    behavior: 'smooth' | 'instant' = 'smooth'
) {
    const scrollAmount = pageIndex * viewportWidth;

    // Test for RTL scroll behavior (detect negative support)
    container.scrollLeft = -1;
    const supportsNegative = container.scrollLeft < 0;

    if (supportsNegative) {
        container.scrollTo({ left: -scrollAmount, behavior });
    } else {
        // Fallback for browsers that use positive reversed coordinates
        // We need to calculate the target relative to the max scroll width
        const maxScroll = container.scrollWidth - container.clientWidth;
        container.scrollTo({ left: maxScroll - scrollAmount, behavior });
    }
}

/**
 * Get the current page index in an RTL container.
 */
export function getRTLPageIndex(container: HTMLElement, viewportWidth: number): number {
    const { scrollLeft, scrollWidth, clientWidth } = container;

    if (scrollLeft <= 0) {
        // Negative coordinate system (Chrome/FF)
        return Math.round(Math.abs(scrollLeft) / viewportWidth);
    } else {
        // Positive coordinate system (Safari)
        const maxScroll = scrollWidth - clientWidth;
        return Math.round((maxScroll - scrollLeft) / viewportWidth);
    }
}
