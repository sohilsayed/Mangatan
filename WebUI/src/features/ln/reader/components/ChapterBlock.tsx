import React from 'react';
import { Settings } from '@/Manatan/types';
import { LNHighlight } from '@/lib/storage/AppStorage';
import { injectHighlightsIntoHtml } from '@/features/ln/reader/utils/injectHighlights';

interface ChapterBlockProps {
    html: string | null;
    index: number;
    isLoading: boolean;
    isVertical: boolean;
    settings: Settings;
    highlights?: LNHighlight[];
}

export const ChapterBlock: React.FC<ChapterBlockProps> = React.memo(
    ({ html, index, isLoading, isVertical, settings, highlights = [] }) => {
        if (isLoading || !html) {
            return (
                <div className={`chapter-loading ${isVertical ? 'vertical' : 'horizontal'}`} data-chapter={index}>
                    <div className="loading-spinner" />
                    <span>Loading chapter {index + 1}...</span>
                </div>
            );
        }

        // Apply highlights to the HTML
        const highlightedHtml = React.useMemo(() => {
            if (!highlights || highlights.length === 0 || !html) return html;

            const chapterHighlights = highlights.filter((h) => h.chapterIndex === index);
            if (chapterHighlights.length === 0) return html;

            return injectHighlightsIntoHtml(html, chapterHighlights, index);
        }, [html, highlights, index]);

        // Build font family with secondary font
        let fontFamily = settings.lnFontFamily || "'Noto Serif JP', serif";
        if (settings.lnSecondaryFontFamily) {
            fontFamily = `${fontFamily}, ${settings.lnSecondaryFontFamily}`;
        }

        return (
            <section
                className={`chapter-block ${isVertical ? 'vertical' : 'horizontal'} ${
                    !settings.lnEnableFurigana ? 'furigana-hidden' : ''
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
                <div className="chapter-content" dangerouslySetInnerHTML={{ __html: highlightedHtml || '' }} />
            </section>
        );
    },
);

ChapterBlock.displayName = 'ChapterBlock';
