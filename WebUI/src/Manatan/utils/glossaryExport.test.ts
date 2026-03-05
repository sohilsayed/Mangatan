import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGlossaryExport } from './glossaryExport';
import { DictionaryResult } from '../types';

const mockEntry: DictionaryResult = {
    headword: 'ろくな',
    reading: 'ろくな',
    glossary: [
        {
            dictionaryName: '新和英大辞典 第5版',
            tags: ['adj-pn'],
            content: [
                JSON.stringify({
                    tag: 'div',
                    content: [
                        { tag: 'span', content: '1' },
                        { tag: 'span', content: ' 〔満足できる〕 satisfactory' }
                    ]
                }),
                JSON.stringify({
                    tag: 'div',
                    content: [
                        { tag: 'span', content: '2' },
                        { tag: 'span', content: ' 〔いい〕 good' }
                    ]
                })
            ]
        }
    ],
    styles: {
        '新和英大辞典 第5版': '.gloss-sc-div { margin-bottom: 2px; }'
    }
};

test('buildGlossaryExport renders styled format correctly', () => {
    const html = buildGlossaryExport(mockEntry, 'styled');

    assert.ok(html.includes('class="yomitan-glossary"'));
    assert.ok(html.includes('<ol>'));
    assert.ok(html.includes('<li data-dictionary="新和英大辞典 第5版">'));
    assert.ok(html.includes('<i>(新和英大辞典 第5版)</i>'));
    assert.ok(html.includes('<span class="tag">adj-pn</span>'));
    assert.ok(html.includes('class="gloss-sc-div"'));
    assert.ok(html.includes('satisfactory'));
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('.yomitan-glossary [data-dictionary="新和英大辞典 第5版"] { .gloss-sc-div { margin-bottom: 2px; } }'));
});

test('buildGlossaryExport renders plaintext format correctly', () => {
    const text = buildGlossaryExport(mockEntry, 'plaintext');

    assert.ok(text.includes('(新和英大辞典 第5版) [adj-pn]'));
    assert.ok(text.includes('1 〔満足できる〕 satisfactory'));
    assert.ok(text.includes('2 〔いい〕 good'));
    assert.ok(!text.includes('<div'));
});

test('buildGlossaryExport handles targetDictionary filtering', () => {
    const html = buildGlossaryExport(mockEntry, 'styled', 'Non-existent Dict');
    assert.equal(html, '');
});

test('buildGlossaryExport handles whitespace and newlines in plaintext', () => {
    const entryWithWhitespace: DictionaryResult = {
        ...mockEntry,
        glossary: [{
            ...mockEntry.glossary[0],
            content: ['  Line 1  ', '  Line 2  \n  Line 3  ']
        }]
    };
    const text = buildGlossaryExport(entryWithWhitespace, 'plaintext');
    // Result should be: "(新和英大辞典 第5版) [adj-pn]\nLine 1\nLine 2\nLine 3"
    assert.ok(text.includes('Line 1\nLine 2\nLine 3'), `Text was actually: ${JSON.stringify(text)}`);
});

test('buildGlossaryExport handles newlines in styled HTML', () => {
    const entryWithNewlines: DictionaryResult = {
        ...mockEntry,
        glossary: [{
            ...mockEntry.glossary[0],
            content: ['Line 1\nLine 2']
        }]
    };
    const html = buildGlossaryExport(entryWithNewlines, 'styled');
    assert.ok(html.includes('Line 1<br />Line 2'), `HTML was actually: ${html}`);
});

test('buildGlossaryExport handles newlines inside structured content', () => {
    const entry: DictionaryResult = {
        ...mockEntry,
        glossary: [{
            ...mockEntry.glossary[0],
            content: [JSON.stringify({
                tag: 'span',
                content: 'Structured\nNewline'
            })]
        }]
    };
    const html = buildGlossaryExport(entry, 'styled');
    assert.ok(html.includes('Structured<br />Newline'), `HTML was actually: ${html}`);
});
