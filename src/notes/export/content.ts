import Quill from 'quill';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { parseContent } from '../../components/rich-text/content';
import { registerRichTextFormats, richTextFormats } from '../../components/rich-text/quill-setup';
import type { DeltaOp } from '../../components/rich-text/delta';

const EMPTY_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const embeddedImage = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const assetUrl = /^assets\/[^\\?#]+$/;

function safeLink(url: string): string {
  if (assetUrl.test(url)) return url;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

/** No user-controlled remote resource is ever inserted into the live DOM. */
export function convertContent(content: string, mapUrl: (url: string) => string = url => url): string {
  const images: string[] = [];
  const formulas: Array<{ marker: string; source: string }> = [];
  const ops: DeltaOp[] = parseContent(content).map(op => {
    const attributes = { ...op.attributes };
    if (typeof attributes.link === 'string') {
      const url = safeLink(mapUrl(attributes.link));
      if (url) attributes.link = url;
      else delete attributes.link;
    }
    if (typeof op.insert === 'string') return { insert: op.insert, attributes };
    if (typeof op.insert.formula === 'string') {
      const marker = `NOWLYFORMULA${crypto.randomUUID().replace(/-/g, '')}`;
      formulas.push({ marker, source: op.insert.formula });
      return { insert: marker, attributes };
    }
    const source = op.insert.image ?? op.insert.video;
    if (typeof source !== 'string') throw new Error('Unsupported note embed');
    const url = mapUrl(source);
    if (op.insert.image && (assetUrl.test(url) || embeddedImage.test(url))) {
      images.push(url);
      return { insert: { image: EMPTY_IMAGE }, attributes };
    }
    const link = safeLink(url);
    if (!link) throw new Error('Unresolved note attachment or media');
    return { insert: `${String(attributes.alt || link)}\n`, attributes: { link } };
  });
  registerRichTextFormats();
  const host = document.createElement('div');
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  let html: string;
  try {
    const quill = new Quill(host, { readOnly: true, formats: richTextFormats, modules: { toolbar: false, table: true, syntax: false } });
    quill.setContents(ops, 'silent');
    html = quill.getSemanticHTML();
    // Disconnect Quill's observer when releasing this detached editor.
    quill.scroll.observer.disconnect();
  } finally { host.remove(); }

  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('img').forEach((image, index) => {
    image.setAttribute('src', images[index]);
    image.removeAttribute('height');
  });
  root.querySelectorAll('a').forEach(anchor => {
    const href = safeLink(anchor.getAttribute('href') ?? '');
    if (href) anchor.setAttribute('href', href);
    else anchor.removeAttribute('href');
    anchor.removeAttribute('target');
  });
  // Quill emits bare PRE, while Turndown's fenced-code rule expects PRE > CODE.
  root.querySelectorAll('pre').forEach(pre => {
    const code = document.createElement('code');
    code.textContent = (pre.textContent ?? '').replace(/^\n|\n$/g, '');
    const language = pre.getAttribute('data-language');
    if (language && language !== 'plain' && /^[a-z0-9_+-]+$/i.test(language)) {
      code.className = `language-${language}`;
    }
    pre.replaceChildren(code);
  });
  // GFM expects a header row. Preserve all Quill cells, using the first row
  // as the exported header rather than silently flattening a table.
  root.querySelectorAll('table tr:first-child td').forEach(cell => {
    const heading = document.createElement('th');
    heading.append(...Array.from(cell.childNodes));
    cell.replaceWith(heading);
  });
  const markdown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**' });
  markdown.use(gfm);
  markdown.addRule('portable-table-cell', {
    filter: ['th', 'td'],
    replacement: (text, node) => {
      const prefix = node.previousSibling ? ' ' : '| ';
      return prefix + text.trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>') + ' |';
    }
  });
  markdown.addRule('checked-list', {
    filter: node => node.nodeName === 'LI' && ['checked', 'unchecked'].includes(node.getAttribute('data-list') ?? ''),
    replacement: (text, node) => {
      const prefix = `- [${(node as HTMLElement).getAttribute('data-list') === 'checked' ? 'x' : ' '}] `;
      return prefix + text.replace(/^\n+|\n+$/g, '').replace(/\n/g, '\n  ')
        + (node.nextSibling ? '\n' : '');
    }
  });
  markdown.addRule('strike', { filter: ['s', 'del'], replacement: text => `~~${text}~~` });
  let md = markdown.turndown(root);
  for (const { marker, source } of formulas) {
    const inTable = Array.from(root.querySelectorAll('th,td')).some(cell => cell.textContent?.includes(marker));
    md = md.split(marker).join(`$${inTable ? source.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') : source}$`);
  }
  return `${md.trim()}\n`;
}
