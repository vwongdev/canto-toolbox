// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createContextList, createContextSentence, CLOZE_BLANK } from '../context-sentence.js';

describe('createContextSentence', () => {
  it('renders the sentence with the word marked', () => {
    const el = createContextSentence('謝謝', '真的很謝謝你');

    expect(el.querySelector('.context-word')?.textContent).toBe('謝謝');
    expect(el.querySelector('.context-sentence')?.textContent).toBe('真的很謝謝你');
  });

  it('labels the snippet', () => {
    const el = createContextSentence('謝謝', '真的很謝謝你');
    expect(el.querySelector('.context-label')?.textContent).toBe('Seen in');
  });

  it('marks every occurrence of the word', () => {
    const el = createContextSentence('好', '好好好');
    expect(el.querySelectorAll('.context-word')).toHaveLength(3);
  });

  it('hides the word behind a gap when blanked', () => {
    const el = createContextSentence('謝謝', '真的很謝謝你', { blank: true });

    expect(el.textContent).not.toContain('謝謝');
    expect(el.querySelector('.context-blank')?.textContent).toBe(CLOZE_BLANK.repeat(2));
  });

  it('sizes the gap to the hidden word', () => {
    const el = createContextSentence('中國人', '我是中國人', { blank: true });
    expect(el.querySelector('.context-blank')?.textContent).toHaveLength(3);
  });

  it('takes a caller-supplied label', () => {
    const el = createContextSentence('好', '你好', { label: 'Fill the gap' });
    expect(el.querySelector('.context-label')?.textContent).toBe('Fill the gap');
  });

  it('renders the sentence unchanged when the word does not occur in it', () => {
    const el = createContextSentence('謝謝', '你好嗎');

    expect(el.querySelector('.context-sentence')?.textContent).toBe('你好嗎');
    expect(el.querySelector('.context-word')).toBeNull();
  });
});

describe('createContextList', () => {
  it('renders every sentence under one label', () => {
    const el = createContextList('好', [{ text: '你好' }, { text: '好嘢' }]);

    expect(el.querySelectorAll('.context-label')).toHaveLength(1);
    expect(Array.from(el.querySelectorAll('.context-sentence'), s => s.textContent)).toEqual(['你好', '好嘢']);
  });

  it('links a sentence to its page in a new tab', () => {
    const el = createContextList('好', [
      { text: '你好', source: { url: 'https://example.com/story', title: '新聞' } },
    ]);
    const link = el.querySelector<HTMLAnchorElement>('a.context-source')!;

    expect(link.textContent).toBe('新聞');
    expect(link.getAttribute('href')).toBe('https://example.com/story');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
  });

  it('names an untitled page by its host', () => {
    const el = createContextList('好', [{ text: '你好', source: { url: 'https://example.com/story' } }]);
    expect(el.querySelector('.context-source')?.textContent).toBe('example.com');
  });

  it('draws no link for an address that is not a web page', () => {
    const el = createContextList('好', [{ text: '你好', source: { url: 'javascript:alert(1)' } }]);
    expect(el.querySelector('.context-source')).toBeNull();
  });
});
