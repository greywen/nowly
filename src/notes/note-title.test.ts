import { describe, expect, it } from 'vitest';
import { noteTitle } from './note-title';

const delta = (ops: unknown[]) => JSON.stringify({ v: 1, ops });
describe('noteTitle', () => {
  it('uses the first non-empty logical line, not a separate title', () => {
    expect(noteTitle('\n \n第一行\n第二行')).toBe('第一行');
    expect(noteTitle(delta([{ insert: '\n' }, { insert: '第一', attributes: { bold: true } }, { insert: '行\n第二行\n' }]))).toBe('第一行');
  });
  it('reads legacy Markdown and preserves long titles without changing content', () => {
    expect(noteTitle('# 标题\n正文')).toBe('标题');
    const content = '字'.repeat(500) + '\n正文';
    expect(noteTitle(content)).toBe('字'.repeat(500));
    expect(content.endsWith('\n正文')).toBe(true);
  });
  it('falls back for empty and image-only notes, and retains formula text', () => {
    expect(noteTitle('')).toBe('无标题便笺');
    expect(noteTitle(delta([{ insert: { image: 'attachment:image-id' } }, { insert: '\n' }]))).toBe('无标题便笺');
    expect(noteTitle(delta([{ insert: { formula: 'x^2' } }, { insert: '\n' }]))).toBe('x^2');
  });
});
