// Quill configuration: every format it ships, constrained to design.md values.
//
// Two independent problems are solved here.
//
// 1. URL whitelists. Quill's stock blots rewrite anything outside their own
//    lists, which would destroy our attachment URLs:
//
//      Image: ['http','https','data']               -> '//:0'
//      Link:  ['http','https','mailto','tel','sms'] -> 'about:blank'
//
//    Attachments are stored as `attachment:<id>` and shown as `blob:` while
//    editing, so both blots are widened to exactly our own `safeUrl` policy.
//    It stays a whitelist, so `javascript:` is still rejected at the boundary.
//
//    Video is the exception and is deliberately NARROWED instead. It renders an
//    IFRAME and inherits `Link.sanitize` by default, so widening Link would let
//    a `blob:` or `data:` document load in an iframe that inherits this page's
//    origin — script execution. Video only ever needs a remote embed, so it is
//    pinned to http/https.
//
// 2. Design system conformance. Quill's stock colour, size and font pickers
//    offer arbitrary values, which design.md §2 and §3.3 forbid. Rather than
//    dropping the controls, their option lists are replaced with design tokens,
//    so every reachable value is one the design system defines.

import Quill from 'quill';
import { t } from '../../i18n';
import { safeUrl } from './markdown';

/**
 * Text colours, from design.md's token block. Titles use the token name: it is
 * the design system's own vocabulary and needs no translation.
 *
 * Swatches carry a title because Quill renders picker options as unlabelled
 * spans, which would otherwise be announced as nothing at all.
 */
export const richTextColors: ReadonlyArray<{ value: string; token: string }> = [
  { value: '#211f1c', token: 'text-primary' },
  { value: '#403d38', token: 'text-strong' },
  { value: '#716d66', token: 'text-secondary' },
  { value: '#8e887a', token: 'text-tertiary' },
  { value: '#968e7e', token: 'text-muted' },
  { value: '#b5b0a1', token: 'text-disabled' },
  { value: '#4fc9da', token: 'primary' },
  { value: '#30a6b6', token: 'primary-active' },
  { value: '#b8d935', token: 'success' },
  { value: '#4f55da', token: 'info' },
  { value: '#e8c444', token: 'warning' },
  { value: '#f06445', token: 'danger' }
];

/**
 * Highlight colours. Each was measured against `--text-primary` (#211f1c),
 * which is the text that sits on top of a highlight:
 *
 *   the `-light` tints                     14.5-15.4:1
 *   primary / success / warning / danger   8.4 / 10.2 / 9.7 / 5.2:1
 *
 * `--color-info` (#4f55da) is the one palette entry excluded: it measures
 * 2.85:1, below the 4.5:1 body text needs. Its `-light` tint is offered instead.
 */
export const richTextBackgrounds: ReadonlyArray<{ value: string; token: string }> = [
  { value: '#ffffff', token: 'bg-surface' },
  { value: '#f8f6f2', token: 'bg-subtle' },
  { value: '#f6f1e9', token: 'bg-secondary' },
  { value: '#ddf8fc', token: 'primary-light' },
  { value: '#f4fbdb', token: 'success-light' },
  { value: '#eff0ff', token: 'info-light' },
  { value: '#fdf4d6', token: 'warning-light' },
  { value: '#fff0ed', token: 'danger-light' },
  { value: '#4fc9da', token: 'primary' },
  { value: '#b8d935', token: 'success' },
  { value: '#e8c444', token: 'warning' },
  { value: '#f06445', token: 'danger' }
];

/**
 * Inline sizes, taken from design.md §3.3's scale. `false` is the default (Body,
 * 1rem) and emits no attribute at all. Values are rem because §3.3 forbids
 * absolute px, so the whole scale still tracks the root font size.
 */
export const richTextSizes: ReadonlyArray<string | false> = [
  '0.85rem',
  '0.95rem',
  false,
  '1.075rem',
  '1.75rem'
];

/** The size values alone, for the attributor whitelist. */
const SIZE_WHITELIST = richTextSizes.filter((size): size is string => typeof size === 'string');

/**
 * Font families. design.md defines only `--font-sans`, so that is the default
 * (`false`, no attribute) and `mono` is the single alternative — needed for the
 * code formats and defined locally in rich-editor.css. No serif option exists
 * because inventing a third family would mean inventing a token.
 */
export const richTextFonts: ReadonlyArray<string | false> = [false, 'mono'];

/** The font values alone, for the attributor whitelist. */
const FONT_WHITELIST = richTextFonts.filter((font): font is string => typeof font === 'string');

/**
 * Heading levels. design.md §3.3 defines H1–H4 and no deeper, so 5 and 6 are
 * absent rather than styled by guesswork.
 */
export const richTextHeaders: ReadonlyArray<number | false> = [1, 2, 3, 4, false];

/** Toolbar groups, ordered from text properties out to embeds. */
export const richTextToolbar: unknown[] = [
  [{ font: [...richTextFonts] }, { size: [...richTextSizes] }, { header: [...richTextHeaders] }],
  ['bold', 'italic', 'underline', 'strike', 'code'],
  [{ color: richTextColors.map((entry) => entry.value) }, { background: richTextBackgrounds.map((entry) => entry.value) }],
  [{ script: 'sub' }, { script: 'super' }],
  [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
  [{ indent: '-1' }, { indent: '+1' }, { align: [] }, { direction: 'rtl' }],
  ['blockquote', 'code-block'],
  ['link', 'image', 'video', 'formula', 'table'],
  ['clean']
];

/**
 * Every format the editor accepts; anything else is stripped on paste.
 *
 * This is now the full set Quill ships, which is the point of the feature, but
 * it does mean a paste from Word or a web page can bring in that page's colours
 * and sizes. The pickers stay design-constrained; paste does not.
 *
 * `alt` is deliberately absent: it is an attribute of the image blot rather than
 * a registered format, so it survives regardless, and listing it makes Quill
 * throw.
 */
export const richTextFormats = [
  'header',
  'font',
  'size',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'script',
  'code',
  'link',
  'blockquote',
  'code-block',
  'list',
  'indent',
  'align',
  'direction',
  'image',
  'video',
  'formula',
  'table',
  // Applied by the syntax module to carry highlight.js token classes. Without it
  // whitelisted, Quill strips the blot the instant highlighting applies it and
  // code blocks never colour at all.
  'code-token'
];

// Minimal structural view of a blot class: enough to subclass and override the
// statics we care about. Constructors are never called from our code (Quill
// instantiates blots itself), so their parameters stay opaque.
type BlotClass = {
  new (...args: unknown[]): object;
  blotName: string;
  tagName: string;
  sanitize(url: string): string;
};

type AttributorClass = {
  new (name: string, keyName: string, options: { scope: unknown; whitelist: unknown[] }): unknown;
};

type ParchmentModule = {
  ClassAttributor: AttributorClass;
  StyleAttributor: AttributorClass;
  Scope: { INLINE: unknown };
};

let registered = false;

/**
 * Register the widened blots and the design-constrained attributors. Idempotent,
 * so it is safe to call from React effects that run twice under StrictMode.
 */
export function registerRichTextFormats(): void {
  if (registered) return;
  registered = true;

  // Imported through Quill's own registry rather than as direct imports: both
  // `parchment` and `quill-delta` are transitive dependencies here, so importing
  // them by name would break under a strict or pnpm-style node_modules layout.
  const { ClassAttributor, StyleAttributor, Scope } = Quill.import('parchment') as ParchmentModule;

  const BaseImage = Quill.import('formats/image') as BlotClass;
  const BaseLink = Quill.import('formats/link') as BlotClass;
  const BaseVideo = Quill.import('formats/video') as BlotClass;

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

  class RichTextVideo extends BaseVideo {
    static blotName = 'video';

    // Narrower than Link on purpose: this is an IFRAME src. A `blob:` or
    // `data:` document loaded here would run script against this page's origin.
    static sanitize(url: string): string {
      const safe = safeUrl(url);
      if (!safe) return 'about:blank';
      return /^https?:\/\//i.test(safe) ? safe : 'about:blank';
    }
  }

  Quill.register('formats/image', RichTextImage, true);
  Quill.register('formats/link', RichTextLink, true);
  Quill.register('formats/video', RichTextVideo, true);

  // Replace the stock size and font attributors so only design tokens are
  // reachable. Size stays a style attributor because the values are rem from
  // design.md §3.3; font is a class attributor so the family itself lives in CSS
  // next to the token it comes from.
  const SizeStyle = new StyleAttributor('size', 'font-size', {
    scope: Scope.INLINE,
    whitelist: [...SIZE_WHITELIST]
  });
  const FontClass = new ClassAttributor('font', 'ql-font', {
    scope: Scope.INLINE,
    whitelist: [...FONT_WHITELIST]
  });
  // Registered one at a time through the string-path overload: the record
  // overload does not accept an opaque attributor instance.
  Quill.register('formats/size', SizeStyle, true);
  Quill.register('formats/font', FontClass, true);

  // Picker option labels are not set here: snow.css hardcodes English ones per
  // value, and they are overridden per instance in `applyToolbarLabels`.
}

/**
 * Buttons whose accessible name is just their format, keyed by Quill's class.
 * Quill sets `aria-label` to the raw English format name ('bold', 'blockquote'),
 * which is the accessible name a screen reader announces, so a zh-CN user would
 * hear English for the entire toolbar without these.
 */
const BUTTON_LABELS: ReadonlyArray<[string, string]> = [
  ['.ql-bold', 'richEditor.bold'],
  ['.ql-italic', 'richEditor.italic'],
  ['.ql-underline', 'richEditor.underline'],
  ['.ql-strike', 'richEditor.strike'],
  ['.ql-code', 'richEditor.code'],
  ['.ql-blockquote', 'richEditor.blockquote'],
  ['.ql-code-block', 'richEditor.codeBlock'],
  ['.ql-link', 'richEditor.link'],
  ['.ql-image', 'richEditor.image'],
  ['.ql-video', 'richEditor.video'],
  ['.ql-formula', 'richEditor.formula'],
  ['.ql-clean', 'richEditor.clean'],
  ['.ql-table', 'richEditor.table'],
  ['.ql-direction', 'richEditor.direction']
];

/** Buttons distinguished by their value attribute rather than class alone. */
const VALUE_BUTTON_LABELS: ReadonlyArray<[string, string]> = [
  ['.ql-script[value="sub"]', 'richEditor.scriptSub'],
  ['.ql-script[value="super"]', 'richEditor.scriptSuper'],
  ['.ql-list[value="ordered"]', 'richEditor.listOrdered'],
  ['.ql-list[value="bullet"]', 'richEditor.listBullet'],
  ['.ql-list[value="check"]', 'richEditor.listCheck'],
  ['.ql-indent[value="+1"]', 'richEditor.indentMore'],
  ['.ql-indent[value="-1"]', 'richEditor.indentLess']
];

/** Picker option labels, keyed by the option's `data-value` ('' for default). */
const PICKER_LABELS: ReadonlyArray<[string, Record<string, string>]> = [
  [
    '.ql-size',
    {
      '': 'richEditor.sizeDefault',
      '0.85rem': 'richEditor.sizeCaption',
      '0.95rem': 'richEditor.sizeSmall',
      '1.075rem': 'richEditor.sizeLarge',
      '1.75rem': 'richEditor.sizeDisplay'
    }
  ],
  ['.ql-font', { '': 'richEditor.fontSans', mono: 'richEditor.fontMono' }],
  [
    '.ql-header',
    {
      '': 'richEditor.headerDefault',
      '1': 'richEditor.header1',
      '2': 'richEditor.header2',
      '3': 'richEditor.header3',
      '4': 'richEditor.header4'
    }
  ],
  [
    '.ql-align',
    {
      '': 'richEditor.alignLeft',
      center: 'richEditor.alignCenter',
      right: 'richEditor.alignRight',
      justify: 'richEditor.alignJustify'
    }
  ]
];

/**
 * Localise the toolbar Quill generates.
 *
 * Two distinct mechanisms, because Quill uses two:
 *
 *   - `aria-label` on buttons, which Quill fills with the English format name.
 *   - `data-label` on picker options. snow.css carries
 *     `content: attr(data-label)` at a higher specificity than its hardcoded
 *     per-value English labels, so setting the attribute is the supported way to
 *     relabel a picker. `picker.js` also copies it onto the collapsed label.
 */
export function applyToolbarLabels(container: HTMLElement): void {
  container.setAttribute('aria-label', t('richEditor.toolbar'));

  for (const [selector, key] of [...BUTTON_LABELS, ...VALUE_BUTTON_LABELS]) {
    const button = container.querySelector<HTMLElement>(`button${selector}`);
    if (!button) continue;
    button.setAttribute('aria-label', t(key));
    button.setAttribute('title', t(key));
  }

  for (const [selector, values] of PICKER_LABELS) {
    const picker = container.querySelector<HTMLElement>(selector);
    if (!picker) continue;
    // The picker's own trigger is a span with role=button and no name.
    const groupKey =
      selector === '.ql-size'
        ? 'richEditor.size'
        : selector === '.ql-font'
          ? 'richEditor.font'
          : selector === '.ql-header'
            ? 'richEditor.header'
            : 'richEditor.align';
    picker.querySelector('.ql-picker-label')?.setAttribute('aria-label', t(groupKey));
    for (const item of Array.from(picker.querySelectorAll<HTMLElement>('.ql-picker-item'))) {
      const key = values[item.dataset.value ?? ''];
      if (!key) continue;
      item.setAttribute('data-label', t(key));
      item.setAttribute('aria-label', t(key));
      item.setAttribute('title', t(key));
    }

    // Seed the collapsed label too.
    //
    // `picker.js` copies an item's `data-label` onto the collapsed label, but only
    // inside `selectItem`, which Quill last ran during construction — before these
    // labels existed. Left alone, the label falls through to snow.css's hardcoded
    // English ('Normal', 'Sans Serif') until the user picks something. Nothing is
    // selected at first paint, so the default entry's label is the right seed;
    // every later change goes through `selectItem` and picks up our value itself.
    //
    // Only these three pickers need it: snow.css's `content: attr(data-label)`
    // rule covers ql-header, ql-font and ql-size, while align and the colour
    // pickers render icons.
    if (selector !== '.ql-align') {
      const label = picker.querySelector<HTMLElement>('.ql-picker-label');
      const selected = picker.querySelector<HTMLElement>('.ql-picker-item.ql-selected');
      const key = values[selected?.dataset.value ?? ''];
      if (label && key) label.setAttribute('data-label', t(key));
    }
  }

  // Colour swatches are unlabelled spans. The design token name is the clearest
  // available name and needs no translation.
  for (const [selector, entries, groupKey] of [
    ['.ql-color', richTextColors, 'richEditor.color'],
    ['.ql-background', richTextBackgrounds, 'richEditor.background']
  ] as const) {
    const picker = container.querySelector<HTMLElement>(selector);
    if (!picker) continue;
    picker.querySelector('.ql-picker-label')?.setAttribute('aria-label', t(groupKey));
    for (const item of Array.from(picker.querySelectorAll<HTMLElement>('.ql-picker-item'))) {
      const match = entries.find((entry) => entry.value === item.dataset.value);
      if (!match) continue;
      item.setAttribute('aria-label', match.token);
      item.setAttribute('title', match.token);
    }
  }
}

/**
 * Localise snow's link/video/formula popover.
 *
 * Its prompt and its Edit/Remove/Save actions are `content:` literals in
 * snow.css with no `attr()` hook, so the strings are published as data
 * attributes and rich-editor.css renders those instead.
 *
 * CSS `attr()` can only read the attribute of the element the pseudo-element
 * belongs to, so the action labels go on the action elements themselves rather
 * than on the tooltip root.
 */
export function applyTooltipLabels(tooltip: HTMLElement): void {
  tooltip.dataset.labelLink = t('richEditor.tooltipLink');
  tooltip.dataset.labelFormula = t('richEditor.tooltipFormula');
  tooltip.dataset.labelVideo = t('richEditor.tooltipVideo');
  tooltip.dataset.labelVisit = t('richEditor.tooltipVisit');

  const action = tooltip.querySelector<HTMLElement>('a.ql-action');
  if (action) {
    // One element, two states: snow swaps Edit for Save via `.ql-editing`.
    action.dataset.labelEdit = t('richEditor.tooltipEdit');
    action.dataset.labelSave = t('richEditor.tooltipSave');
    action.setAttribute('role', 'button');
  }
  const remove = tooltip.querySelector<HTMLElement>('a.ql-remove');
  if (remove) {
    remove.dataset.labelRemove = t('richEditor.tooltipRemove');
    remove.setAttribute('role', 'button');
  }
}
