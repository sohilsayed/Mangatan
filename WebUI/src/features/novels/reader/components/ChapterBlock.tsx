

import React from 'react';
import { Settings } from '@/Manatan/types';

interface ChapterBlockProps {
    html: string | null;
    index: number;
    isLoading: boolean;
    isVertical: boolean;
    settings: Settings;
}

export const ChapterBlock: React.FC<ChapterBlockProps> = React.memo(
    ({ html, index, isLoading, isVertical, settings }) => {
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
        let fontFamily = settings.novelsFontFamily || "'Noto Serif JP', serif";
        if (settings.novelsSecondaryFontFamily) {
            fontFamily = `${fontFamily}, ${settings.novelsSecondaryFontFamily}`;
        }

        return (
            <section
                className={`chapter-block ${isVertical ? 'vertical' : 'horizontal'} ${!settings.novelsEnableFurigana ? 'furigana-hidden' : ''
                    }`}
                data-chapter={index}
                style={{
                    padding: `${settings.novelsPageMargin || 20}px`,
                    maxWidth: !isVertical ? `${settings.novelsPageWidth || 800}px` : undefined,
                    textAlign: (settings.novelsTextAlign as any) || 'justify',
                    fontFamily,
                    fontWeight: settings.novelsFontWeight || 400,
                }}
            >
                <div
                    className="chapter-content"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </section>
        );
    }
);

ChapterBlock.displayName = 'ChapterBlock';