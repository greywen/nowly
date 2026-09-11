// Stored content format for every rich text field: event notes, task
// descriptions and note bodies.
//
// Content is stored as a Delta JSON envelope, `{"v":1,"ops":[…]}`.
//
// Why Delta and not Markdown: the editor exposes all of Quill's formats, and
// Markdown has no syntax for ten of them (align, background, color, direction,
// font, formula, indent, script, size, video). Serialising through Markdown
// would silently drop whatever it could not express. Delta is Quill's own
// document model, so the round trip is lossless by construction rather than by
// maintenance.
//
// Three invariants the rest of the app depends on:
//
//   1. An empty document serialises to '' — never to an envelope holding a lone
//      newline. Drafts start at `content:''` / `description:''`, and dirty checks
//      compare whole forms with JSON.stringify (UnifiedTaskDialog, note-draft,
//      task-draft, event-draft), so an envelope would make every dialog open
//      already dirty.
//   2. Anything that is not a valid envelope is read as legacy Markdown / plain
//      text and converted on load, so no migration is needed and content
//      written by the earlier Markdown version keeps working.
//   3. Attachment references stay literal `attachment:<id>` substrings inside
//      the JSON, so the backend's regex scan for live references works on the
//      envelope unchanged.

import { attachmentUrl, isAttachmentId, removeAttachmentReference } from '../../lib/attachment';
import { markdownToDelta, type DeltaOp } from './delta';
import { markdownToPlainText } from './markdown';

/** Envelope version. Bumped only if the op shape itself has to change. */
const CONTENT_VERSION = 1;

type Envelope = { v: number; ops: DeltaOp[] };

/** URL-bearing keys on an embed insert, for attachment remapping. */
const EMBED_URL_KEYS = ['image', 'video'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDeltaOp(value: unknown): value is DeltaOp {
  if (!isRecord(value)) return false;
  const { insert, attributes } = value;
  if (typeof insert !== 'string' && !isRecord(insert)) return false;
  if (attributes !== undefined && !isRecord(attributes)) return false;
  return true;
}

/**
 * Read the envelope out of stored content, or null when it is not one.
 *
 * A legacy note would have to consist of valid JSON with an `ops` array to be
 * misread here, which cannot happen for text a user typed into the old plain
 * textarea.
 */
function parseEnvelope(content: string): Envelope | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.ops)) return null;
  const ops = parsed.ops.filter(isDeltaOp);
  // A malformed envelope with no usable ops is indistinguishable from empty;
  // treating it as legacy text would render raw JSON to the user.
  return { v: typeof parsed.v === 'number' ? parsed.v : CONTENT_VERSION, ops };
}

/** Apply a URL mapping to every embed and link in a set of ops, without mutating. */
function mapOpUrls(ops: readonly DeltaOp[], mapUrl: (url: string) => string): DeltaOp[] {
  return ops.map((op) => {
    const next: DeltaOp = { insert: op.insert };
    if (isRecord(op.insert)) {
      const insert = { ...op.insert };
      for (const key of EMBED_URL_KEYS) {
        if (typeof insert[key] === 'string') insert[key] = mapUrl(insert[key]);
      }
      next.insert = insert;
    }
    if (op.attributes) {
      const attributes = { ...op.attributes };
      if (typeof attributes.link === 'string') attributes.link = mapUrl(attributes.link);
      next.attributes = attributes;
    }
    return next;
  });
}

/** True when a document holds no text and no embeds, ignoring block formats. */
export function deltaOpsAreEmpty(ops: readonly DeltaOp[]): boolean {
  for (const op of ops) {
    if (typeof op.insert !== 'string') return false;
    if (op.insert.trim()) return false;
  }
  return true;
}

/**
 * Turn stored content into Delta ops for `quill.setContents`.
 *
 * `mapUrl` swaps `attachment:<id>` for a displayable `blob:` URL on the way in;
 * keeping it a parameter leaves this module pure and synchronous.
 */
export function parseContent(content: string, mapUrl: (url: string) => string = (url) => url): DeltaOp[] {
  const envelope = parseEnvelope(content);
  if (envelope) {
    const ops = mapOpUrls(envelope.ops, mapUrl);
    // Quill requires a trailing newline; an envelope that lost it would throw.
    return ops.length ? ops : [{ insert: '\n' }];
  }
  // Legacy plain text or Markdown from before the Delta format.
  return markdownToDelta(content, mapUrl);
}

/**
 * Serialise Quill's ops for storage, mapping display URLs back to durable
 * `attachment:` references. Returns '' for an empty document — see invariant 1.
 */
export function serializeContent(
  ops: readonly DeltaOp[],
  mapUrl: (url: string) => string = (url) => url
): string {
  if (deltaOpsAreEmpty(ops)) return '';
  const envelope: Envelope = { v: CONTENT_VERSION, ops: mapOpUrls(ops, mapUrl) };
  return JSON.stringify(envelope);
}

/** True when stored content would render as nothing. */
export function isContentEmpty(content: string): boolean {
  if (!content.trim()) return true;
  const envelope = parseEnvelope(content);
  return envelope ? deltaOpsAreEmpty(envelope.ops) : false;
}

/**
 * Flatten stored content to plain text for previews and list rows.
 *
 * Previews are line-clamped to a few lines, where rendered rich text reads
 * badly, and flattening also keeps `dangerouslySetInnerHTML` out of the app
 * entirely. Images contribute their alt text and formulas their source, which
 * keeps both greppable.
 */
export function contentToPlainText(content: string): string {
  const envelope = parseEnvelope(content);
  if (!envelope) return markdownToPlainText(content);

  let out = '';
  for (const op of envelope.ops) {
    if (typeof op.insert === 'string') {
      out += op.insert;
      continue;
    }
    if (typeof op.insert.formula === 'string') {
      out += op.insert.formula;
      continue;
    }
    // Images and videos cannot be shown in a text preview; an image's alt text
    // is the closest readable stand-in.
    const alt = op.attributes?.alt;
    if (typeof alt === 'string' && alt) out += alt;
  }
  return out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Drop every reference to one attachment from stored content.
 *
 * Removing an attachment is deliberately just a content edit: content is the
 * only record of which attachments are in use, and the backend reclaims
 * unreferenced files on the next launch. Nothing is deleted from disk here.
 *
 * Embeds are removed outright; a link merely loses its href, because the label
 * is text the user wrote and deleting it would lose their words.
 */
export function removeAttachmentFromContent(content: string, id: string): string {
  if (!isAttachmentId(id)) return content;
  const envelope = parseEnvelope(content);
  // Legacy Markdown still needs the Markdown-shaped removal.
  if (!envelope) return removeAttachmentReference(content, id);

  const url = attachmentUrl(id);
  const ops: DeltaOp[] = [];
  for (const op of envelope.ops) {
    const insert = op.insert;
    if (isRecord(insert) && EMBED_URL_KEYS.some((key) => insert[key] === url)) continue;
    if (op.attributes && op.attributes.link === url) {
      const { link: _removed, ...rest } = op.attributes;
      ops.push(Object.keys(rest).length ? { insert: op.insert, attributes: rest } : { insert: op.insert });
      continue;
    }
    ops.push(op);
  }
  return serializeContent(ops);
}

/**
 * Replace formula embeds with their LaTeX source.
 *
 * Quill's formula blot throws unless KaTeX is present, which would take the
 * whole dialog down if the lazy chunk failed to load. Degrading to the source
 * text keeps the content readable and editable instead.
 */
export function stripFormulas(ops: readonly DeltaOp[]): DeltaOp[] {
  return ops.map((op) => {
    if (!isRecord(op.insert) || typeof op.insert.formula !== 'string') return op;
    return op.attributes ? { insert: op.insert.formula, attributes: op.attributes } : { insert: op.insert.formula };
  });
}
