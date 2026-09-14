// Legacy load path: Markdown and plain text into Quill's Delta format.
//
// Content is stored as Delta JSON now (see content.ts), so this direction is all
// that remains. It exists so notes written before that change — and any content
// that is simply plain text, which every note was originally — still open
// correctly with no migration step. The reverse converter was removed with the
// Markdown storage format: serialising through Markdown would have silently
// dropped the ten formats Markdown has no syntax for.
//
// Shapes below were verified against Quill 2.0.3 rather than assumed:
//   - block formats live on the newline that *ends* the line
//   - code blocks use `'code-block': 'plain'` and need one newline op per line
//     (a single newline after multi-line text does not split into lines)
//   - images are `{ insert: { image: url } }` with alt in `attributes.alt`
//   - Quill always keeps a trailing newline, yielding a final empty line
//
// `mapUrl` lets the caller swap `attachment:<id>` for a displayable `blob:` URL
// on the way in. Keeping it a parameter leaves this module pure and synchronous.

import { parseMarkdown, type InlineToken } from './markdown';

type Attributes = Record<string, unknown>;

/**
 * One Delta operation.
 *
 * `insert` is a string for text or a single-key record for an embed. It is typed
 * loosely because the editor now enables every Quill format, so the embed set
 * covers `image`, `video` and `formula`, and attributes carry the full format
 * vocabulary rather than the four inline marks this started with.
 */
export type DeltaOp = {
  insert: string | Record<string, unknown>;
  attributes?: Attributes;
};

type InlineFormat = {
  bold?: true;
  italic?: true;
  underline?: true;
  link?: string;
};

function sameFormat(a: Attributes | undefined, b: Attributes | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

// Adjacent runs sharing a format would produce needlessly fragmented ops, so
// merge them before handing the result to Quill.
function mergeRuns(ops: DeltaOp[]): DeltaOp[] {
  const merged: DeltaOp[] = [];
  for (const op of ops) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      typeof previous.insert === 'string' &&
      typeof op.insert === 'string' &&
      !previous.insert.includes('\n') &&
      !op.insert.includes('\n') &&
      sameFormat(previous.attributes, op.attributes)
    ) {
      previous.insert += op.insert;
      continue;
    }
    merged.push(op);
  }
  return merged;
}

function pushInline(ops: DeltaOp[], tokens: InlineToken[], format: InlineFormat, mapUrl: (url: string) => string) {
  for (const token of tokens) {
    switch (token.kind) {
      case 'text': {
        if (!token.text) break;
        ops.push(
          Object.keys(format).length ? { insert: token.text, attributes: { ...format } } : { insert: token.text }
        );
        break;
      }
      case 'break':
        // Quill has no soft break, so a break becomes a block boundary. This is
        // why `一行\n二行` normalises to two paragraphs on first open.
        ops.push({ insert: '\n' });
        break;
      case 'image': {
        const op: DeltaOp = { insert: { image: mapUrl(token.url) } };
        if (token.alt) op.attributes = { alt: token.alt };
        ops.push(op);
        break;
      }
      case 'link':
        pushInline(ops, token.children, { ...format, link: mapUrl(token.url) }, mapUrl);
        break;
      case 'strong':
        pushInline(ops, token.children, { ...format, bold: true }, mapUrl);
        break;
      case 'em':
        pushInline(ops, token.children, { ...format, italic: true }, mapUrl);
        break;
      case 'underline':
        pushInline(ops, token.children, { ...format, underline: true }, mapUrl);
        break;
    }
  }
}

/** Build Delta ops for legacy Markdown or plain text, ready for `setContents`. */
export function markdownToDelta(markdown: string, mapUrl: (url: string) => string = (url) => url): DeltaOp[] {
  const ops: DeltaOp[] = [];
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === 'code') {
      // One newline op per line: a single trailing newline does not split
      // multi-line text into separate code lines.
      for (const line of block.code.split('\n')) {
        if (line) ops.push({ insert: line });
        ops.push({ insert: '\n', attributes: { 'code-block': 'plain' } });
      }
      continue;
    }
    pushInline(ops, block.inline, {}, mapUrl);
    ops.push(block.kind === 'heading' ? { insert: '\n', attributes: { header: block.level } } : { insert: '\n' });
  }
  if (!ops.length) ops.push({ insert: '\n' });
  return mergeRuns(ops);
}
