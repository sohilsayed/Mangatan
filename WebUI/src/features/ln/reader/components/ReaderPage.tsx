
import React, { useLayoutEffect, useRef, useEffect } from 'react';
import { Settings } from '@/Manatan/types';

interface ReaderPageProps {
    html: string;
    css?: string;
    pageIndex: number;
    pageSize: number;
    isVertical: boolean;
    isKorean: boolean;
    settings: Settings;
    contentStyle: React.CSSProperties;
    className?: string;
    onMount?: (shadowRoot: ShadowRoot) => void;
}

/**
 * ReaderPage renders a single page of content within a Shadow Root.
 * This ensures that the EPUB's CSS is isolated from the rest of the application UI.
 */
export const ReaderPage = React.forwardRef<HTMLDivElement, ReaderPageProps>((props, ref) => {
    const {
        html,
        css,
        pageIndex,
        pageSize,
        isVertical,
        isKorean,
        settings,
        contentStyle,
        className,
        onMount
    } = props;
    const internalRef = useRef<HTMLDivElement>(null);
    const hostRef = (ref as React.MutableRefObject<HTMLDivElement | null>) || internalRef;
    const shadowRootRef = useRef<ShadowRoot | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const styleTagRef = useRef<HTMLStyleElement | null>(null);

    // Initial setup of shadow root and HTML content
    useLayoutEffect(() => {
        if (!hostRef.current) return;

        if (!shadowRootRef.current) {
            shadowRootRef.current = hostRef.current.attachShadow({ mode: 'open' });

            const styleTag = document.createElement('style');
            shadowRootRef.current.appendChild(styleTag);
            styleTagRef.current = styleTag;

            const wrapper = document.createElement('div');
            wrapper.className = 'content-wrapper';

            const content = document.createElement('div');
            content.className = 'content';
            contentRef.current = content;

            wrapper.appendChild(content);
            shadowRootRef.current.appendChild(wrapper);

            if (onMount) {
                onMount(shadowRootRef.current);
            }
        }
    }, [onMount]);

    // Update HTML content only when it changes
    useLayoutEffect(() => {
        if (contentRef.current) {
            contentRef.current.innerHTML = html;
            if (isKorean) {
                contentRef.current.setAttribute('lang', 'ko');
            } else {
                contentRef.current.removeAttribute('lang');
            }
        }
    }, [html, isKorean]);

    // Update Styles efficiently
    useLayoutEffect(() => {
        if (!styleTagRef.current) return;

        const styleString = Object.entries(contentStyle)
            .map(([key, value]) => `${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}: ${value};`)
            .join('\n');

        const isDarkMode = settings.lnTheme === 'dark' || settings.lnTheme === 'black';

        const baseStyle = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                overflow: hidden;
                contain: strict;
            }
            .content-wrapper {
                width: 100%;
                height: 100%;
                overflow: hidden;
            }
            .content {
                ${styleString}
                transform: ${isVertical ? `translateY(-${pageIndex * pageSize}px)` : `translateX(-${pageIndex * pageSize}px)`};
                transition: ${settings.lnDisableAnimations ? 'none' : 'transform 0.3s ease-out'};
                will-change: transform;
                backface-visibility: hidden;
                -webkit-backface-visibility: hidden;
                orphans: 2;
                widows: 2;
            }

            /* Break avoidance */
            .content p, .content blockquote, .content figure, .content pre {
                break-inside: avoid;
            }
            .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
                break-after: avoid;
            }

            /* Typography */
            .content p { margin: 0 0 1em 0; }
            .content h1, .content h2, .content h3, .content h4 { font-weight: bold; margin: 1.2em 0 0.5em 0; }
            .content h1 { font-size: 1.4em; }
            .content h2 { font-size: 1.25em; }
            .content h3 { font-size: 1.15em; }
            .content a {
                color: #4890ff;
                text-decoration: underline;
                text-decoration-color: rgba(72, 144, 255, 0.5);
                cursor: pointer;
                transition: opacity 0.2s ease;
            }
            .content a:hover { opacity: 0.7; text-decoration-color: rgba(72, 144, 255, 0.8); }
            .content a:active { opacity: 0.5; }

            .content ruby { ruby-align: center; }
            .content rt { font-size: 0.5em; }
            .content blockquote { margin: 1em 0; padding-left: 1em; border-left: 2px solid currentColor; opacity: 0.85; }

            /* Images */
            .content img, .content svg, .content figure {
                max-width: 100% !important;
                max-height: calc(100vh - 120px);
                width: auto;
                height: auto;
                display: block;
                margin: 0.5em auto;
                object-fit: contain;
                break-inside: avoid;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
            }
            .content svg image { width: 100%; height: 100%; }

            /* Image-Only Chapters */
            .content .image-only-chapter {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100%;
                height: 100%;
                width: 100%;
                padding: 0;
                margin: 0;
            }
            .content .image-only-chapter img,
            .content .image-only-chapter svg,
            .content .image-only-chapter figure {
                max-width: 100% !important;
                max-height: calc(100vh - 120px);
                width: auto;
                height: auto;
                object-fit: contain;
                margin: 0;
            }
            .content .image-only-chapter p,
            .content .image-only-chapter div {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 100%;
                margin: 0;
                padding: 0;
            }

            /* Furigana */
            ${!settings.lnEnableFurigana ? '.content ruby rt, .content rt { visibility: hidden; font-size: 0; }' : ''}

            /* Highlights */
            .content mark.highlight {
                background-color: rgba(255, 235, 59, 0.45);
                border-radius: 2px;
                padding: 0 1px;
                color: inherit;
            }
            ${isDarkMode ? `
                .content mark.highlight {
                    background-color: ${settings.lnTheme === 'black' ? 'rgba(0, 255, 255, 0.5)' : 'rgba(0, 200, 200, 0.5)'};
                }
            ` : ''}

            ${isKorean ? `
                .content[lang="ko"] {
                    word-break: keep-all !important;
                    line-break: strict !important;
                    -webkit-line-break: strict !important;
                    orphans: 1 !important;
                    widows: 1 !important;
                }
                .content[lang="ko"] p, .content[lang="ko"] blockquote {
                    break-inside: avoid-column;
                }
            ` : ''}

            /* Inline Images / Gaiji */
            .content img.gaiji, .content img.gaiji-line, .content img.gaiji1, .content img.inline-img,
            .content img[width="1"], .content img[width="2"], .content img[height="1"], .content img[height="2"],
            .content img[style*="display: inline"], .content img[style*="display:inline"] {
                display: inline-block !important;
                vertical-align: baseline !important;
                max-width: 1.5em !important;
                max-height: 1.5em !important;
                width: auto !important;
                height: auto !important;
                margin: 0 0.1em !important;
                padding: 0 !important;
            }

            ${isDarkMode ? `
                .content img.gaiji, .content img.gaiji-line, .content img.gaiji1, .content img.inline-img,
                .content img[width="1"], .content img[width="2"], .content img[height="1"], .content img[height="2"],
                .content img[style*="display: inline"], .content img[style*="display:inline"] {
                    filter: invert(1);
                }
            ` : ''}

            /* Drop caps */
            .content .drop-cap, .content img.initial {
                display: inline-block;
                float: left;
                margin: 0 0.1em 0 0;
                max-height: 3em;
                width: auto;
                line-height: 1;
            }

            /* Universal EPUB CSS Classes */
            .content .gfont, .content .gothic { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "MS Gothic", "Noto Sans JP", sans-serif !important; }
            .content .mfont, .content .mincho { font-family: "Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", "Noto Serif JP", serif !important; }
            .content .bold, .content .b, .content .strong { font-weight: bold !important; }
            .content .italic, .content .i, .content .em { font-style: italic !important; }

            /* Injected EPUB CSS */
            ${css || ''}
        `;

        styleTagRef.current.textContent = baseStyle;
    }, [css, pageIndex, pageSize, isVertical, isKorean, settings, contentStyle]);

    return <div ref={hostRef} className={className} />;
});

ReaderPage.displayName = 'ReaderPage';
