
/**
 * Browser-agnostic RTL scroll helper.
 *
 * Some browsers (Chrome/FF) use negative scrollLeft values for RTL.
 * Others (older Safari) use positive values that increase from right to left.
 */
let cachedRTLType: 'negative' | 'reversed' | 'default' | null = null;

function getRTLScrollType(container: HTMLElement): 'negative' | 'reversed' | 'default' {
    if (cachedRTLType) return cachedRTLType;

    const originalScrollLeft = container.scrollLeft;
    container.scrollLeft = -1;
    if (container.scrollLeft < 0) {
        cachedRTLType = 'negative'; // Chrome/Firefox
    } else {
        container.scrollLeft = 1;
        if (container.scrollLeft > 0) {
            cachedRTLType = 'default'; // Unusual but possible
        } else {
            cachedRTLType = 'reversed'; // Safari
        }
    }
    container.scrollLeft = originalScrollLeft;
    return cachedRTLType;
}

export function scrollToPageRTL(
    container: HTMLElement,
    pageIndex: number,
    viewportWidth: number,
    behavior: 'smooth' | 'instant' = 'smooth'
) {
    const scrollAmount = pageIndex * viewportWidth;
    const type = getRTLScrollType(container);

    if (type === 'negative') {
        container.scrollTo({ left: -scrollAmount, behavior });
    } else if (type === 'reversed') {
        const maxScroll = container.scrollWidth - container.clientWidth;
        container.scrollTo({ left: maxScroll - scrollAmount, behavior });
    } else {
        container.scrollTo({ left: scrollAmount, behavior });
    }
}

/**
 * Get the current page index in an RTL container.
 */
export function getRTLPageIndex(container: HTMLElement, viewportWidth: number): number {
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const type = getRTLScrollType(container);

    if (type === 'negative') {
        return Math.round(Math.abs(scrollLeft) / viewportWidth);
    } else if (type === 'reversed') {
        const maxScroll = scrollWidth - clientWidth;
        return Math.round((maxScroll - scrollLeft) / viewportWidth);
    } else {
        return Math.round(scrollLeft / viewportWidth);
    }
}
