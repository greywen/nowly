// Bridge between stored Markdown and Quill's native Delta format.
//
// Load and save go through Delta rather than HTML on purpose. Quill's clipboard
// (`dangerouslyPasteHTML`) runs matcher heuristics that silently dropped the
// contents of `<pre>` blocks, and `getSemanticHTML()` collapses a soft break
// into a separate paragraph. Delta is the format Quill actually stores, so
// round-tripping through it avoids both.
//
// Shapes below were verified against Quill 2.0.3 rather than assumed:
//   - block formats live on the newline that *ends* the line
//   - code blocks use `'code-block': 'plain'` and need one newline op per line
//     (a single newline after multi-line text does not split into lines)
//   - images are `{ insert: { image: url } }` with alt in `attributes.alt`
//   - Quill always keeps a trailing newline, yielding a final empty line
//
// `mapUrl` exists so the caller can swap `attachment:<id>` for a displayable
// `blob:` URL on the way in and back again on the way out. Keeping it a
// parameter leaves this module pure and synchronous.

import {
  escapeLeadingHash,
  escapeMarkdownText,
  fenceCodeBlock,
  encodeUrlForMarkdown,
  parseMarkdown,
  safeUrl,
  type InlineToken
} from './markdown';

type Attributes = Record<string, unknown>;

export type DeltaOp = {
  insert: string | { image: string };
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

// Adjacent runs sharing a format would serialise as `**a****b**`, which parses
// back correctly but reads badly, so merge them first.
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
        // Quill has no soft break in this configuration, so a break becomes a
        // block boundary. This is why `一行\n二行` normalises to two paragraphs
        // once the content passes through the editor.
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

/** Build the Delta ops for stored Markdown, ready for `quill.setContents`. */
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

type Run =
  | { kind: 'text'; text: string; attributes: Attributes }
  | { kind: 'image'; url: string; alt: string };

type Line = { runs: Run[]; code: boolean; heading: 1 | 2 | null };

// Emphasis markers must not sit against whitespace, so shift any leading or
// trailing spaces outside them. Keeps output closer to standard Markdown.
function wrapEmphasis(marker: string, closing: string, inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match || !match[2]) return inner;
  return `${match[1]}${marker}${match[2]}${closing}${match[3]}`;
}

// Fixed order gives canonical output: link outermost, then bold, italic and
// underline innermost. Equivalent inputs nested differently normalise to this.
const formatPriority = ['link', 'bold', 'italic', 'underline'] as const;

function imageToMarkdown(run: Extract<Run, { kind: 'image' }>): string {
  return `![${run.alt.replace(/([\\[\]])/g, '\\$1')}](${encodeUrlForMarkdown(run.url)})`;
}

/**
 * Serialise a line's runs, factoring each shared format out around the longest
 * group of runs that carries it. Serialising runs independently would turn
 * `**粗 *斜* 粗**` into `**粗 ****斜***** 粗**`, so grouping is required for
 * correctness, not just tidiness.
 */
function serialiseRuns(runs: Run[], applied: ReadonlySet<string>, mapUrl: (url: string) => string): string {
  let out = '';
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    const attributes = run.kind === 'text' ? run.attributes : {};
    const key = formatPriority.find((name) => !applied.has(name) && attributes[name] !== undefined);

    if (!key) {
      out += run.kind === 'image' ? imageToMarkdown(run) : escapeMarkdownText(run.text);
      index += 1;
      continue;
    }

    const value = attributes[key];
    let end = index + 1;
    while (end < runs.length) {
      const next = runs[end];
      if (next.kind !== 'text' || next.attributes[key] !== value) break;
      end += 1;
    }
    const inner = serialiseRuns(runs.slice(index, end), new Set([...applied, key]), mapUrl);
    if (key === 'link') {
      const url = typeof value === 'string' ? safeUrl(mapUrl(value)) : '';
      out += url ? `[${inner}](${encodeUrlForMarkdown(url)})` : inner;
    } else if (key === 'bold') out += wrapEmphasis('**', '**', inner);
    else if (key === 'italic') out += wrapEmphasis('*', '*', inner);
    else out += wrapEmphasis('<u>', '</u>', inner);
    index = end;
  }
  return out;
}

/** Convert Quill's Delta ops back into stored Markdown. */
export function deltaToMarkdown(ops: readonly DeltaOp[], mapUrl: (url: string) => string = (url) => url): string {
  const lines: Line[] = [];
  let current: Line = { runs: [], code: false, heading: null };

  const closeLine = (attributes: Attributes | undefined) => {
    if (attributes?.['code-block']) current.code = true;
    const header = attributes?.header;
    if (header === 1 || header === 2) current.heading = header;
    lines.push(current);
    current = { runs: [], code: false, heading: null };
  };

  for (const op of ops) {
    if (typeof op.insert !== 'string') {
      const url = safeUrl(mapUrl(op.insert.image));
      // A rejected URL would render as a broken image, so drop the embed and
      // keep only its alt text.
      const alt = typeof op.attributes?.alt === 'string' ? op.attributes.alt : '';
      if (url) current.runs.push({ kind: 'image', url, alt });
      else if (alt) current.runs.push({ kind: 'text', text: alt, attributes: {} });
      continue;
    }
    const segments = op.insert.split('\n');
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment) current.runs.push({ kind: 'text', text: segment, attributes: op.attributes ?? {} });
      // Every separator between segments is a real newline, so close the line.
      if (index < segments.length - 1) closeLine(op.attributes);
    }
  }
  if (current.runs.length) lines.push(current);

  // Quill keeps a trailing newline, so drop trailing blank non-code lines.
  while (lines.length) {
    const last = lines[lines.length - 1];
    if (last.code || last.runs.length) break;
    lines.pop();
  }

  const blocks: string[] = [];
  let codeRun: string[] | null = null;
  const flushCode = () => {
    if (!codeRun) return;
    while (codeRun.length && !codeRun[codeRun.length - 1].trim()) codeRun.pop();
    if (codeRun.length) blocks.push(fenceCodeBlock(codeRun.join('\n')));
    codeRun = null;
  };

  for (const line of lines) {
    if (line.code) {
      // Code is stored verbatim, so use raw run text with no escaping.
      codeRun ??= [];
      codeRun.push(line.runs.map((run) => (run.kind === 'text' ? run.text : run.alt)).join(''));
      continue;
    }
    flushCode();
    const markdown = serialiseRuns(line.runs, new Set(), mapUrl);
    if (!markdown.trim()) continue;
    if (line.heading) blocks.push(`${line.heading === 1 ? '#' : '##'} ${markdown.trim()}`);
    else blocks.push(escapeLeadingHash(markdown));
  }
  flushCode();

  return blocks.join('\n\n');
}
