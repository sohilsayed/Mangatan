import { DictionaryResult, DictionaryDefinition } from '../types';

/**
 * Unified utility for exporting dictionary glossaries to Anki
 */

const VOID_TAGS = ['br', 'img', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'];

function generatePlaintextNode(node: any): string {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(generatePlaintextNode).join('');
    if (node.type === 'structured-content') return generatePlaintextNode(node.content);
    if (node?.data?.content === 'attribution') return '';

    const { tag, content } = node;
    if (tag === 'br') return '\n';
    return generatePlaintextNode(content);
}

function generateHTMLNode(node: any, dictionaryName?: string): string {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(n => generateHTMLNode(n, dictionaryName)).join('');
    if (node.type === 'structured-content') return generateHTMLNode(node.content, dictionaryName);
    if (node?.data?.content === 'attribution') return '';

    const { tag, content, href, data, style } = node;

    // Use attributes for styling instead of inline styles where possible to allow dictionary CSS to take over
    const classNames = [`gloss-sc-${tag}`];
    if (data?.class) classNames.push(data.class);
    const classAttr = ` class="${classNames.join(' ')}"`;

    const dataAttrs = data && typeof data === 'object'
        ? Object.entries(data).map(([k, v]) => {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                return ` data-sc-${k}="${String(v).replace(/"/g, '&quot;')}"`;
            }
            return '';
        }).join('')
        : '';

    // Convert style object to string if present
    let styleAttr = '';
    if (style && typeof style === 'object') {
        const styleString = Object.entries(style).map(([k, v]) => {
            const key = k.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${key}:${v}`;
        }).join(';');
        if (styleString) styleAttr = ` style="${styleString}"`;
    }

    if (VOID_TAGS.includes(tag)) {
        if (tag === 'img') {
            const rawPath = node.path || node.src || '';
            const src = rawPath && dictionaryName
                ? `/api/yomitan/dict-media/${encodeURIComponent(dictionaryName)}/${rawPath}`
                : rawPath;
            const alt = node.alt || '';
            return `<img src="${src}" alt="${alt}"${classAttr}${dataAttrs}${styleAttr} />`;
        }
        if (tag === 'br') return '<br />';
        return `<${tag}${classAttr}${dataAttrs}${styleAttr} />`;
    }

    const innerHTML = generateHTMLNode(content, dictionaryName);

    if (tag === 'a') {
        return `<a href="${href || '#'}" target="_blank" rel="noreferrer"${classAttr}${dataAttrs}${styleAttr}>${innerHTML}</a>`;
    }

    return `<${tag}${classAttr}${dataAttrs}${styleAttr}>${innerHTML}</${tag}>`;
}

export function buildGlossaryExport(
    entry: DictionaryResult,
    format: 'styled' | 'plaintext',
    targetDictionary?: string
): string {
    const glossaryEntries = targetDictionary
        ? entry.glossary.filter(def => def.dictionaryName === targetDictionary)
        : entry.glossary;

    if (glossaryEntries.length === 0) return '';

    if (format === 'plaintext') {
        return glossaryEntries.map((def) => {
            const header = `(${def.dictionaryName})`;
            const tags = def.tags.length > 0 ? ` [${def.tags.join(', ')}]` : '';
            const content = def.content.map(c => {
                const trimmed = c.trim();
                if (!trimmed) return '';
                try {
                    return generatePlaintextNode(JSON.parse(trimmed));
                } catch {
                    return trimmed.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
                }
            }).filter(Boolean).join('\n');
            return `${header}${tags}\n${content}`;
        }).join('\n\n').trim();
    }

    // Styled HTML format (Yomitan-style)
    const listItems = glossaryEntries.map((def) => {
        const tagsHTML = def.tags.map(t => `<span class="tag">${t}</span>`).join(' ');
        const headerHTML = `<i>(${def.dictionaryName})</i>${tagsHTML ? ' ' + tagsHTML : ''}`;

        const contentHTML = def.content.map(c => {
            const trimmed = c.trim();
            if (!trimmed) return '';
            try {
                return generateHTMLNode(JSON.parse(trimmed), def.dictionaryName);
            } catch {
                return trimmed;
            }
        }).join('');

        return `<li data-dictionary="${def.dictionaryName.replace(/"/g, '&quot;')}">${headerHTML} ${contentHTML}</li>`;
    }).join('');

    let styleBlock = '';
    if (entry.styles) {
        const cssParts = Object.entries(entry.styles).map(([dictName, css]) => {
            if (!css) return '';
            const escapedName = dictName.replace(/"/g, '\\"');
            const selector = `.yomitan-glossary [data-dictionary="${escapedName}"]`;
            // Wrap in nesting selector if browser supports it, or use simple prefixing
            return `${selector} { ${css} }`;
        }).join('');
        if (cssParts.trim()) {
            styleBlock = `<style>${cssParts}</style>`;
        }
    }

    return `<div style="text-align: left;" class="yomitan-glossary"><ol>${listItems}</ol></div>${styleBlock}`;
}
