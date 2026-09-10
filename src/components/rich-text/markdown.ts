// Markdown is the storage format for every rich text field (event notes, task
// descriptions, note bodies). This module owns the single parser for that
// format; renderers consume its tokens.
//
// The supported subset is deliberately closed:
//
//   # h1 / ## h2 / paragraphs / **bold** / *italic* / <u>underline</u>
//   ``` fenced code / ![alt](src) images / [text](href) links
//
// `<u>` is the one inline HTML form accepted, because Markdown has no underline
// syntax but the editor toolbar offers underline, so it must survive a round
// trip.
//
// Security note: `markdownToHtml` builds output from parsed tokens rather than
// passing source through, so the only markup it can emit is the tag set above
// and the result needs no separate sanitiser. URLs are the sole place
// attacker-controlled text reaches an attribute, so they go through `safeUrl`.
//
// Token text is *semantic* (already unescaped). Each serialiser re-escapes for
// its own target, which is why `escapeMarkdownText` is exported.

/** Tags `markdownToHtml` can produce. Exported so tests can pin the closed set. */
export const richTextTags = ['p', 'h1', 'h2', 'pre', 'strong', 'em', 'u', 'a', 'img', 'br'] as const;

const escapedMarkdownChars = '\\*[]`<>#';

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'break' }
  | { kind: 'image'; alt: string; url: string }
  | { kind: 'link'; url: string; children: InlineToken[] }
  | { kind: 'strong'; children: InlineToken[] }
  | { kind: 'em'; children: InlineToken[] }
  | { kind: 'underline'; children: InlineToken[] };

export type Block =
  | { kind: 'heading'; level: 1 | 2; inline: InlineToken[] }
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'code'; code: string };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/**
 * Reject any URL scheme not explicitly allowed. Relative paths and fragments
 * carry no scheme and pass through untouched; `javascript:`, `vbscript:` and
 * `file:` collapse to an empty string. `data:image/svg+xml` is excluded on
 * purpose because SVG can carry script.
 */
export function safeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(value);
  if (!scheme) return value;
  const protocol = scheme[1].toLowerCase();
  if (['http', 'https', 'mailto', 'attachment', 'blob'].includes(protocol)) return value;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,/i.test(value)) return value;
  return '';
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/** Wrap code in a fence wide enough to survive backticks inside the code. */
export function fenceCodeBlock(code: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
  return `${fence}\n${code}\n${fence}`;
}

/** Escape text so it survives being written back as Markdown inline content. */
export function escapeMarkdownText(value: string): string {
  // Quill emits U+00A0 for runs of spaces; normalise so stored text stays
  // greppable and diffable.
  return value.replace(/\u00a0/g, ' ').replace(/([\\*[\]`<>])/g, '\\$1');
}

/** Prevent a block that happens to start with `#` from re-parsing as a heading. */
export function escapeLeadingHash(value: string): string {
  return value.replace(/^(\s*)(#+)/, '$1\\$2');
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\*[\]`<>#])/g, '$1');
}

function hasBalancedParens(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Percent-encode only URLs that could not be written back between parentheses.
 * Balanced parens stay readable, because links such as
 * `https://en.wikipedia.org/wiki/Foo_(bar)` are common and round-trip fine.
 */
export function encodeUrlForMarkdown(url: string): string {
  if (hasBalancedParens(url) && !/\s/.test(url)) return url;
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

type InlineLink = { label: string; url: string; length: number };

// Read `[label](url)` or `![label](url)`, allowing balanced parentheses inside
// the URL the way CommonMark does. Returns null on incomplete syntax, letting
// the caller fall through and treat the text literally.
function matchLink(source: string, image: boolean): InlineLink | null {
  const prefix = image ? '![' : '[';
  if (!source.startsWith(prefix)) return null;
  let index = prefix.length;
  let label = '';
  while (index < source.length && source[index] !== ']') {
    // Keep `\x` pairs intact so an escaped `\]` inside the label does not end
    // it early.
    if (source[index] === '\\' && index + 1 < source.length) {
      label += source[index] + source[index + 1];
      index += 2;
      continue;
    }
    label += source[index];
    index += 1;
  }
  if (source[index] !== ']' || source[index + 1] !== '(') return null;
  index += 2;

  let url = '';
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) return null;
    if (char === ')' && depth === 0) break;
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    url += char;
    index += 1;
  }
  if (source[index] !== ')') return null;
  return { label, url, length: index + 1 };
}

/** Tokenise inline Markdown. Token text is unescaped, semantic content. */
export function tokenizeInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      tokens.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);

    if (rest[0] === '\\' && rest.length > 1 && escapedMarkdownChars.includes(rest[1])) {
      buffer += rest[1];
      index += 2;
      continue;
    }

    const image = matchLink(rest, true);
    if (image) {
      flush();
      const url = safeUrl(image.url);
      const alt = unescapeMarkdown(image.label);
      // A rejected URL would leave a broken image, so degrade to the alt text.
      if (url) tokens.push({ kind: 'image', alt, url });
      else if (alt) tokens.push({ kind: 'text', text: alt });
      index += image.length;
      continue;
    }

    const link = matchLink(rest, false);
    if (link) {
      flush();
      const url = safeUrl(link.url);
      const children = tokenizeInline(link.label);
      if (url) tokens.push({ kind: 'link', url, children });
      else tokens.push(...children);
      index += link.length;
      continue;
    }

    const underline = /^<u>([\s\S]*?)<\/u>/.exec(rest);
    if (underline) {
      flush();
      tokens.push({ kind: 'underline', children: tokenizeInline(underline[1]) });
      index += underline[0].length;
      continue;
    }

    const bold = /^\*\*([\s\S]+?)\*\*/.exec(rest);
    if (bold) {
      flush();
      tokens.push({ kind: 'strong', children: tokenizeInline(bold[1]) });
      index += bold[0].length;
      continue;
    }

    const italic = /^\*([^*\n]+?)\*/.exec(rest);
    if (italic) {
      flush();
      tokens.push({ kind: 'em', children: tokenizeInline(italic[1]) });
      index += italic[0].length;
      continue;
    }

    if (rest[0] === '\n') {
      flush();
      tokens.push({ kind: 'break' });
      index += 1;
      continue;
    }

    buffer += rest[0];
    index += 1;
  }
  flush();
  return tokens;
}

/**
 * Split Markdown into blocks. Headings deeper than h2 clamp to h2 so pasted or
 * hand-edited content degrades predictably instead of leaking `###` as text.
 */
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join('\n');
    if (text.trim()) blocks.push({ kind: 'paragraph', inline: tokenizeInline(text) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = /^ {0,3}(`{3,})(.*)$/.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const closing = new RegExp(`^ {0,3}\`{${marker.length},}\\s*$`);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', code: body.join('\n') });
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length === 1 ? 1 : 2,
        inline: tokenizeInline(heading[2].trim())
      });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function renderInlineHtml(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case 'text':
          return escapeHtml(token.text);
        case 'break':
          return '<br>';
        case 'image':
          return `<img src="${escapeAttribute(token.url)}" alt="${escapeAttribute(token.alt)}">`;
        case 'link':
          return `<a href="${escapeAttribute(token.url)}">${renderInlineHtml(token.children)}</a>`;
        case 'strong':
          return `<strong>${renderInlineHtml(token.children)}</strong>`;
        case 'em':
          return `<em>${renderInlineHtml(token.children)}</em>`;
        case 'underline':
          return `<u>${renderInlineHtml(token.children)}</u>`;
      }
    })
    .join('');
}

function renderInlinePlain(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case 'text':
          return token.text;
        case 'break':
          return '\n';
        case 'image':
          return token.alt;
        default:
          return renderInlinePlain(token.children);
      }
    })
    .join('');
}

/**
 * Render stored Markdown as HTML restricted to `richTextTags`. Safe to inject:
 * every tag is constructed here and every URL passed through `safeUrl`.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  return parseMarkdown(markdown)
    .map((block) => {
      if (block.kind === 'code') return `<pre>${escapeHtml(block.code)}</pre>`;
      if (block.kind === 'heading') {
        return `<h${block.level}>${renderInlineHtml(block.inline)}</h${block.level}>`;
      }
      return `<p>${renderInlineHtml(block.inline)}</p>`;
    })
    .join('');
}

/** Flatten Markdown for list previews and search. */
export function markdownToPlainText(markdown: string): string {
  if (!markdown.trim()) return '';
  return parseMarkdown(markdown)
    .map((block) => (block.kind === 'code' ? block.code : renderInlinePlain(block.inline)))
    .join('\n')
    .trim();
}
