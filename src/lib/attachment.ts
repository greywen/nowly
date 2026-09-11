// Attachments are files stored on disk by the backend under
// `<app-data>/attachments/`, recorded in the `attachments` table, and referred
// to from stored Markdown as `attachment:<id>`.
//
// Keeping the reference inside the Markdown (rather than in a join table) means
// content stays portable and self-describing: moving a note's text moves its
// attachment references with it. The database row remains the authority on where
// the bytes actually live and what the file was originally called.

/** Per-file ceiling; mirrors `MAX_ATTACHMENT_BYTES` on the Rust side. */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;

/**
 * File types an attachment may be uploaded as: everyday office documents and
 * images.
 *
 * Mirrors `ALLOWED_EXTENSIONS` in src-tauri/src/attachments.rs, which is the
 * authoritative gate. This copy exists to filter the file picker and to reject a
 * drop before its bytes are read, so the user is told immediately instead of
 * waiting on a round trip that was always going to fail.
 *
 * A test asserts the two lists match. Drift in the widening direction is the
 * one that hurts: a picker offering files the backend then refuses.
 *
 * `svg` is deliberately absent — it is an image that can carry script, which is
 * also why `safeUrl` excludes it from its data-URL allowance.
 */
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'txt', 'md', 'csv',
  // OpenDocument equivalents
  'odt', 'ods', 'odp'
] as const;

/**
 * Value for the file input's `accept`, which filters the OS picker.
 *
 * Extensions rather than MIME types: the OS maps an extension to whatever type it
 * likes, and Windows reports `.md` and `.csv` inconsistently, so filtering by
 * type hides files that are in fact allowed.
 */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/** Lowercase extension of a file name, or null when it has none. */
export function attachmentExtensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // A leading dot is not a separator: `.gitignore` is a name, not an extension.
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Whether a file may be uploaded, by name.
 *
 * By name, not by `File.type`: the browser leaves `type` empty for plenty of
 * ordinary files, and the backend decides on the extension regardless.
 */
export function isAllowedAttachmentName(fileName: string): boolean {
  const extension = attachmentExtensionOf(fileName);
  return extension !== null
    && (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export type Attachment = {
  /** `<32 hex>[.<ext>]`, used verbatim in Markdown as `attachment:<id>`. */
  id: string;
  /** Original name chosen by the user, for display. */
  fileName: string;
  /** Location on disk, relative to the app data directory. */
  relPath: string;
  byteSize: number;
  mime: string;
  createdAt: string;
};

const ATTACHMENT_SCHEME = 'attachment:';

/** Same acceptance rule as the Rust side, so both agree on what an id is. */
export function isAttachmentId(id: string): boolean {
  const [stem, extension, ...rest] = id.split('.');
  if (rest.length) return false;
  if (!/^[0-9a-fA-F]{32}$/.test(stem)) return false;
  if (extension === undefined) return true;
  return /^[a-z0-9]{1,16}$/.test(extension);
}

/** Build the URL form written into Markdown. */
export function attachmentUrl(id: string): string {
  return `${ATTACHMENT_SCHEME}${id}`;
}

/** Read the id back out of an `attachment:` URL, or null if it is not one. */
export function attachmentIdFromUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_SCHEME)) return null;
  const id = url.slice(ATTACHMENT_SCHEME.length);
  return isAttachmentId(id) ? id : null;
}

/** Every attachment id referenced by a piece of Markdown, in order, deduped. */
export function attachmentIdsIn(markdown: string): string[] {
  const ids: string[] = [];
  const pattern = /attachment:([0-9a-fA-F]{32}(?:\.[a-z0-9]{1,16})?)/g;
  for (const match of markdown.matchAll(pattern)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

/**
 * Drop every `![alt](attachment:id)` and `[label](attachment:id)` reference to
 * one attachment, then tidy the whitespace the removal leaves behind.
 *
 * Removing an attachment is deliberately just a text edit: content is the only
 * record of which attachments are in use, and the backend reclaims unreferenced
 * files later. Nothing is deleted from disk here.
 */
export function removeAttachmentReference(markdown: string, id: string): string {
  if (!isAttachmentId(id)) return markdown;
  // Label may contain escaped `\]`, so match escape pairs rather than stopping
  // at the first bracket.
  const label = String.raw`\[(?:[^\]\\]|\\[\s\S])*\]`;
  const pattern = new RegExp(`!?${label}\\(attachment:${id.replace(/\./g, '\\.')}\\)`, 'g');
  return markdown
    .replace(pattern, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/** True when the stored mime type is one the editor can show inline. */
export function isDisplayableImage(mime: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(mime);
}

/**
 * Human-readable size. Uses binary units and drops the decimal for whole
 * numbers and for bytes, so the attachment strip reads cleanly.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
