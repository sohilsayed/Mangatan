
import { useState, useLayoutEffect, useRef, useCallback } from 'react';
import { parseChapterToBlocks, createPageFragments, PageFragment } from './fragmenter';
import { Settings } from '@/Manatan/types';
import { buildTypographyStyles } from './styles';

interface UsePaginationProps {
    html: string | null;
    settings: Settings;
    viewportWidth: number;
    viewportHeight: number;
    isVertical: boolean;
}

export function usePagination({
    html,
    settings,
    viewportWidth,
    viewportHeight,
    isVertical
}: UsePaginationProps) {
    const [fragments, setFragments] = useState<PageFragment[]>([]);
    const [isMeasuring, setIsMeasuring] = useState(false);
    const measureContainerRef = useRef<HTMLDivElement>(null);

    const paginate = useCallback(async () => {
        if (!html || !measureContainerRef.current || viewportWidth === 0 || viewportHeight === 0) {
            setFragments([]);
            return;
        }

        setIsMeasuring(true);
        setFragments([]);
        const blocks = parseChapterToBlocks(html);
        const container = measureContainerRef.current;

        // Reset container
        container.innerHTML = '';
        const sizes: number[] = [];

        // Wait for fonts
        if (document.fonts) {
            await document.fonts.ready;
        }

        // Batch creation of measuring elements to avoid serial append/measure/remove
        const measureElements: HTMLDivElement[] = [];
        const styles = buildTypographyStyles(settings, isVertical);

        for (const block of blocks) {
            const tempDiv = document.createElement('div');
            tempDiv.style.visibility = 'hidden';
            tempDiv.style.position = 'absolute';
            tempDiv.style.pointerEvents = 'none';
            tempDiv.style.overflow = 'hidden';

            if (isVertical) {
                tempDiv.style.height = `${viewportHeight - (settings.lnPageMargin * 2)}px`;
                tempDiv.style.width = 'auto';
            } else {
                tempDiv.style.width = `${viewportWidth - (settings.lnPageMargin * 2)}px`;
                tempDiv.style.height = 'auto';
            }

            Object.assign(tempDiv.style, styles);
            tempDiv.innerHTML = block.html;
            container.appendChild(tempDiv);
            measureElements.push(tempDiv);
        }

        // Wait for ALL images in ALL blocks in parallel
        const allImages = container.querySelectorAll('img');
        await Promise.all(Array.from(allImages).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                // Timeout after 1s to prevent hanging
                setTimeout(resolve, 1000);
            });
        }));

        // Now measure all elements in one go (avoids layout thrashing)
        // For very large chapters, we can split measurement into small batches to avoid long UI freezes
        const BATCH_SIZE = 100;
        for (let i = 0; i < measureElements.length; i += BATCH_SIZE) {
            const batch = measureElements.slice(i, i + BATCH_SIZE);
            for (const el of batch) {
                const rect = el.getBoundingClientRect();
                sizes.push(isVertical ? rect.width : rect.height);
            }
            // Yield to main thread briefly if it's a long measurement
            if (measureElements.length > BATCH_SIZE) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Clean up
        container.innerHTML = '';

        const options = {
            viewportWidth,
            viewportHeight,
            margin: settings.lnPageMargin || 20,
            isVertical
        };

        const newFragments = createPageFragments(blocks, sizes, options);
        setFragments(newFragments);
        setIsMeasuring(false);
    }, [html, settings, viewportWidth, viewportHeight, isVertical]);

    useLayoutEffect(() => {
        paginate();
    }, [paginate]);

    return { fragments, isMeasuring, measureContainerRef };
}
