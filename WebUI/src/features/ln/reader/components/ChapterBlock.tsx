

import React from 'react';
import { Settings } from '@/Manatan/types';

interface ChapterBlockProps {
    html: string | null;
    index: number;
    isLoading: boolean;
    isVertical: boolean;
    settings: Settings;
    activeBlockId?: string | null;
}

export const ChapterBlock: React.FC<ChapterBlockProps> = React.memo(
    ({ html, index, isLoading, isVertical, settings, activeBlockId }) => {
        if (isLoading || !html) {
            return (
                <div
                    className={`chapter-loading ${isVertical ? 'vertical' : 'horizontal'}`}
                    data-chapter={index}
                >
                    <div className="loading-spinner" />
                    <span>Loading chapter {index + 1}...</span>
                </div>
            );
        }

        // Build font family with secondary font
        let fontFamily = settings.lnFontFamily || "'Noto Serif JP', serif";
        if (settings.lnSecondaryFontFamily) {
            fontFamily = `${fontFamily}, ${settings.lnSecondaryFontFamily}`;
        }

        // Inject active class if needed
        const processedHtml = useMemo(() => {
            if (!activeBlockId || !html) return html;

            // This is a bit expensive but necessary for highlighting in dangerouslySetInnerHTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const activeEl = doc.querySelector(`[data-block-id="${activeBlockId}"]`);
            if (activeEl) {
                activeEl.classList.add('active-sync-block');
                return doc.body.innerHTML;
            }
            return html;
        }, [html, activeBlockId]);

        return (
            <section
                className={`chapter-block ${isVertical ? 'vertical' : 'horizontal'} ${!settings.lnEnableFurigana ? 'furigana-hidden' : ''
                    }`}
                data-chapter={index}
                style={{
                    padding: '0px',
                    maxWidth: !isVertical ? `${settings.lnPageWidth || 1000}px` : undefined,
                    textAlign: (settings.lnTextAlign as any) || 'justify',
                    fontFamily,
                    fontWeight: settings.lnFontWeight || 400,
                }}
            >
                <div
                    className="chapter-content"
                    dangerouslySetInnerHTML={{ __html: processedHtml || '' }}
                />
            </section>
        );
    }
);

ChapterBlock.displayName = 'ChapterBlock';