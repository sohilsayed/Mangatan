
import React, { useLayoutEffect, useRef } from 'react';

interface LNReaderPageProps {
    html: string;
    theme?: string;
    style?: React.CSSProperties;
    contentStyle?: React.CSSProperties;
    className?: string;
    lang?: string;
    onReady?: (contentRef: HTMLElement) => void;
}

export const LNReaderPage: React.FC<LNReaderPageProps> = ({
    html,
    theme,
    style,
    contentStyle,
    className,
    lang,
    onReady,
}) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (!hostRef.current) return;

        let shadow = hostRef.current.shadowRoot;
        if (!shadow) {
            shadow = hostRef.current.attachShadow({ mode: 'open' });
        }

        // Clean up or create content element
        let content = shadow.querySelector('.ln-content') as HTMLDivElement;
        if (!content) {
            content = document.createElement('div');
            content.className = 'ln-content';
            shadow.appendChild(content);
        }

        // Apply theme info to host for CSS selection
        const isDark = theme === 'dark' || theme === 'black';
        hostRef.current.setAttribute('data-dark-mode', isDark.toString());

        // Apply styles to content element
        if (contentStyle) {
            Object.assign(content.style, contentStyle);
        }

        // Inject HTML
        content.innerHTML = html;
        contentRef.current = content;

        // Add base styles to isolate and fix common book CSS issues
        let styleEl = shadow.querySelector('style#ln-base-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'ln-base-styles';
            shadow.appendChild(styleEl);
        }

        styleEl.textContent = `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                overflow: visible !important;
            }
            .ln-content {
                margin: 0 !important;
                padding: 0 !important;
                width: 100%;
                height: 100%;
                box-sizing: border-box;
                overflow: visible !important;
                column-fill: auto;

                /* Prevent breaking inside paragraphs */
                orphans: 2;
                widows: 2;
            }

            /* Universal Reset for book CSS */
            .ln-content * {
                box-sizing: border-box;
                max-width: none !important;
            }

            /* Typography */
            .ln-content p {
                margin: 0 0 1em 0;
                break-inside: avoid;
            }

            .ln-content h1, .ln-content h2, .ln-content h3,
            .ln-content h4, .ln-content h5, .ln-content h6 {
                font-weight: bold;
                margin: 1.2em 0 0.5em 0;
                break-after: avoid;
            }

            .ln-content blockquote {
                margin: 1em 0;
                padding-left: 1em;
                border-left: 2px solid currentColor;
                opacity: 0.85;
                break-inside: avoid;
            }

            /* Images */
            .ln-content img, .ln-content svg, .ln-content figure {
                max-width: 100% !important;
                max-height: 100% !important;
                height: auto !important;
                width: auto !important;
                display: block;
                margin: 0.5em auto;
                object-fit: contain;
                break-inside: avoid;
                image-rendering: -webkit-optimize-contrast;
            }

            .ln-content a {
                color: #4890ff;
                text-decoration: underline;
                cursor: pointer;
            }

            .ln-content ruby {
                ruby-align: center;
            }

            .ln-content rt {
                font-size: 0.5em;
            }

            /* Highlights */
            .ln-content mark.highlight {
                background-color: rgba(255, 235, 59, 0.45);
                border-radius: 2px;
                padding: 0 1px;
                color: inherit;
            }

            /* Dark mode highlights */
            :host([data-dark-mode="true"]) .ln-content mark.highlight {
                background-color: rgba(0, 200, 200, 0.5);
            }

            /* Inline Images / Gaiji */
            .ln-content img.gaiji, .ln-content img.inline-img,
            .ln-content img[width="1"], .ln-content img[height="1"] {
                display: inline-block !important;
                vertical-align: baseline !important;
                max-width: 1.5em !important;
                max-height: 1.5em !important;
                width: auto !important;
                height: auto !important;
                margin: 0 0.1em !important;
            }

            /* Furigana visibility */
            :host(.furigana-hidden) rt {
                visibility: hidden !important;
                font-size: 0 !important;
            }

            /* Korean stability */
            :host([lang="ko"]) .ln-content {
                word-break: keep-all !important;
                line-break: strict !important;
            }

            /* Universal Classes */
            .gfont, .gothic { font-family: sans-serif !important; }
            .mfont, .mincho { font-family: serif !important; }
            .bold, .strong { font-weight: bold !important; }
            .italic, .em { font-style: italic !important; }
        `;

        if (onReady) {
            onReady(content);
        }
    }, [html, theme, contentStyle, onReady]);

    return (
        <div
            ref={hostRef}
            className={className}
            style={style}
            lang={lang}
        />
    );
};
