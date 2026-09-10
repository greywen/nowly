// Quill configuration shared by the editor component and its tests.
//
// Quill's stock blots enforce their own URL whitelists and rewrite anything
// outside them:
//
//   Image: ['http','https','data']                    -> '//:0'
//   Link:  ['http','https','mailto','tel','sms']      -> 'about:blank'
//
// Attachments are addressed as `attachment:<id>` in storage and shown as
// `blob:` URLs while editing, so both schemes would be destroyed on load —
// silent loss of images and of file links. Widening both blots to exactly our
// own `safeUrl` policy is the fix. It stays a whitelist, so `javascript:` and
// friends are still rejected at the blot boundary.

import Quill from 'quill';
import { safeUrl } from './markdown';

/**
 * Toolbar groups, matching the reference compose editor: heading level, the
 * three inline marks, then image and code block.
 */
export const richTextToolbar = [
  [{ header: [1, 2, false] }],
  ['bold', 'italic', 'underline'],
  ['image', 'code-block']
];

/**
 * Formats the editor accepts; anything else is stripped on paste. Keeping this
 * tight is what stops a paste from Word or a web page introducing colours,
 * fonts and sizes that the design system does not define.
 *
 * `alt` is deliberately absent: it is an attribute of the image blot rather than
 * a registered format, so it survives regardless, and listing it makes Quill
 * warn that it cannot be registered.
 */
export const richTextFormats = ['header', 'bold', 'italic', 'underline', 'code-block', 'image', 'link'];

// Minimal structural view of a blot class: enough to subclass and override the
// one static we care about. The constructor is never called from our code
// (Quill instantiates blots itself), so its parameters stay opaque.
type BlotClass = {
  new (...args: unknown[]): object;
  blotName: string;
  tagName: string;
  sanitize(url: string): string;
};

let registered = false;

/**
 * Register the widened blots. Idempotent, so it is safe to call from React
 * effects that run twice under StrictMode.
 */
export function registerRichTextFormats(): void {
  if (registered) return;
  registered = true;

  const BaseImage = Quill.import('formats/image') as BlotClass;
  const BaseLink = Quill.import('formats/link') as BlotClass;

  class RichTextImage extends BaseImage {
    static blotName = 'image';
    static tagName = 'IMG';

    // '//:0' is Quill's own rejection sentinel; keep it so a hostile src renders
    // as a broken image rather than being followed.
    static sanitize(url: string): string {
      return safeUrl(url) || '//:0';
    }
  }

  class RichTextLink extends BaseLink {
    static blotName = 'link';
    static tagName = 'A';

    static sanitize(url: string): string {
      return safeUrl(url) || 'about:blank';
    }
  }

  Quill.register('formats/image', RichTextImage, true);
  Quill.register('formats/link', RichTextLink, true);
}
