// Rich text editor shared by every long-form field: event notes, task
// descriptions and note bodies.
//
// Value in and out is a Delta JSON envelope (see content.ts). Quill is
// uncontrolled internally and this component reconciles it against the `value`
// prop, which needs care on four fronts:
//
//   1. IME composition. Rewriting Quill's contents mid-composition drops or
//      duplicates Chinese input, so reloads are skipped while the editor holds
//      focus or is composing. The editor is the source of truth while the user
//      is in it; the prop is the source of truth otherwise.
//   2. StrictMode. Effects run twice in development, so setup must be
//      idempotent and teardown must remove the toolbar Quill injects as a
//      sibling of its own root.
//   3. Lazy dependencies. KaTeX and highlight.js must exist *before* Quill is
//      constructed, so construction waits on `loadRichTextDeps`. A failure
//      degrades to an editor without highlighting or formula rendering rather
//      than taking the dialog down.
//   4. Localisation. Quill labels its controls in English and snow.css hardcodes
//      its popover labels, so both are overridden after construction.
//
// Attachments are uploaded through the repository and referenced from the
// content as `attachment:<id>`; the content is the only record of what is in
// use. See useAttachments for the blob-URL bridge.

import Quill from 'quill';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { t } from '../../i18n';
import {
  attachmentIdFromUrl,
  attachmentIdsIn,
  formatByteSize,
  isDisplayableImage,
  attachmentUrl,
  type Attachment
} from '../../lib/attachment';
import { FileText, Paperclip, X } from '../icons';
import { parseContent, removeAttachmentFromContent, serializeContent, stripFormulas } from './content';
import type { DeltaOp } from './delta';
import { loadRichTextDeps, type RichTextDeps } from './rich-deps';
import {
  applyToolbarLabels,
  applyTooltipLabels,
  registerRichTextFormats,
  richTextFormats,
  richTextToolbar
} from './quill-setup';
import { useAttachments } from './useAttachments';
import './rich-editor.css';

/** Quill's table module surface, narrowed to what the context bar drives. */
type TableModule = {
  insertTable(rows: number, columns: number): void;
  insertRowAbove(): void;
  insertRowBelow(): void;
  insertColumnLeft(): void;
  insertColumnRight(): void;
  deleteRow(): void;
  deleteColumn(): void;
  deleteTable(): void;
  getTable(): [unknown, unknown, unknown, number];
};

type Props = {
  id: string;
  value: string;
  onChange(content: string): void;
  disabled?: boolean;
  placeholder?: string;
  /** Id of the visible label, wired to the editing surface for screen readers. */
  labelledBy?: string;
};

export function RichEditor({ id, value, onChange, disabled = false, placeholder, labelledBy }: Props) {
  const attachments = useAttachments();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Latest props for use inside Quill callbacks, which are registered once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Signature of what is currently loaded into Quill: the content plus how each
  // of its attachments currently maps to a display URL. The mapping has to be
  // part of it because an unresolved `attachment:` URL turns into a `blob:` URL
  // once its bytes arrive, without the content changing at all. Comparing the
  // content alone would leave every image permanently unresolved.
  const signatureOf = useCallback(
    (content: string) =>
      [
        content,
        ...attachmentIdsIn(content).map((id) => attachmentsRef.current.mapToDisplay(attachmentUrl(id)))
      ].join('\u0000'),
    []
  );
  const loadedSignature = useRef<string | null>(null);
  const composing = useRef(false);
  const [dropping, setDropping] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deps, setDeps] = useState<{ value: RichTextDeps | null } | null>(null);
  const [inTable, setInTable] = useState(false);
  const errorId = useId();

  // Load the optional dependencies. Wrapped in an object so a failed load
  // (`{ value: null }`) is distinguishable from "still loading" (`null`).
  useEffect(() => {
    let active = true;
    loadRichTextDeps().then(
      (loaded) => {
        if (active) setDeps({ value: loaded });
      },
      (error: unknown) => {
        // Degrade rather than block: the editor still works without syntax
        // highlighting, and formulas fall back to their LaTeX source.
        console.error('Rich text dependencies failed to load', error);
        if (active) setDeps({ value: null });
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const insertFile = useCallback((quill: Quill, record: Attachment, displayUrl: string | null) => {
    // Taken from Quill's own registry rather than importing `quill-delta`
    // directly: that package is only a transitive dependency here.
    const Delta = Quill.import('delta');
    const range = quill.getSelection(true) ?? { index: quill.getLength() - 1, length: 0 };
    const update = new Delta().retain(range.index).delete(range.length);
    if (displayUrl && isDisplayableImage(record.mime)) {
      // Alt carries the original file name so it survives to storage and back.
      update.insert({ image: displayUrl }, { alt: record.fileName });
    } else {
      // Non-images cannot render inline, so they become a link the strip lists.
      update.insert(record.fileName, { link: attachmentUrl(record.id) });
    }
    quill.updateContents(update, 'user');
    quill.setSelection(range.index + 1, 0, 'silent');
  }, []);

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      const quill = quillRef.current;
      if (!quill || !files.length) return;
      setUploadError('');
      for (const file of files) {
        try {
          const record = await attachmentsRef.current.upload(file);
          insertFile(quill, record, attachmentsRef.current.mapToDisplay(attachmentUrl(record.id)));
        } catch (error) {
          const message =
            typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
              ? error.message
              : t('richEditor.uploadFailed');
          setUploadError(message);
          // Stop at the first failure: a size rejection usually applies to the
          // rest of a multi-file drop too.
          break;
        }
      }
    },
    [insertFile]
  );

  // Create Quill once the dependencies have settled.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !deps) return;
    registerRichTextFormats();

    // Quill inserts its toolbar as a sibling of the editor root, so give it a
    // host it fully owns and drop the whole host on teardown.
    wrapper.replaceChildren();
    const host = document.createElement('div');
    wrapper.append(host);

    const quill = new Quill(host, {
      theme: 'snow',
      formats: richTextFormats,
      placeholder,
      // Keeps the link / formula / video tooltip inside the surface. Quill
      // defaults this to document.body, and since it only checks that boundary
      // it will place the tooltip outside the editor entirely (measured at
      // left:-165px for a link at the start of a line) where our
      // `overflow:hidden` clips it. Must be the element rather than a selector:
      // `resolveSelector` takes the first match in the document, which would be
      // the wrong editor whenever two are mounted.
      bounds: surfaceRef.current ?? host,
      modules: {
        toolbar: {
          container: richTextToolbar,
          handlers: {
            // Replace the stock handler, which base64-inlines the image into the
            // document and would bloat the database.
            image: () => fileInputRef.current?.click(),
            // Quill ships the table model but no UI, so the button seeds a table
            // and the context bar below edits it.
            table: () => (quill.getModule('table') as TableModule).insertTable(3, 3)
          }
        },
        // Quill's uploader only accepts image mimetypes and base64-inlines them.
        // Disabled so the drop handler below owns every dropped file.
        uploader: { mimetypes: [] },
        table: true,
        // `false` disables highlighting entirely, which is the degraded path.
        syntax: deps.value ? { hljs: deps.value.hljs, languages: [...deps.value.languages] } : false
      }
    });
    quillRef.current = quill;

    // Emit for every source except 'silent', which is what the load path below
    // uses. Loading normalised content must not look like a user edit, or every
    // dialog would open already dirty and prompt to discard on close.
    const emit = (_delta: unknown, _old: unknown, source: string) => {
      if (source === 'silent') return;
      const content = serializeContent(
        quill.getContents().ops as DeltaOp[],
        attachmentsRef.current.mapToStorage
      );
      // Record the echo of our own emit so the reconcile effect below does not
      // treat the value coming back down as an external change and reset the
      // caret mid-typing.
      loadedSignature.current = signatureOf(content);
      onChangeRef.current(content);
    };
    quill.on('text-change', emit);

    // Show the table bar only while the caret is inside a table.
    const table = quill.getModule('table') as TableModule;
    const syncTableState = () => {
      const range = quill.getSelection();
      setInTable(Boolean(range) && table.getTable()[0] !== null);
    };
    quill.on('editor-change', syncTableState);

    // Quill exposes no composition state, so track it on the DOM directly.
    const onCompositionStart = () => {
      composing.current = true;
    };
    const onCompositionEnd = () => {
      composing.current = false;
    };
    quill.root.addEventListener('compositionstart', onCompositionStart);
    quill.root.addEventListener('compositionend', onCompositionEnd);

    if (labelledBy) quill.root.setAttribute('aria-labelledby', labelledBy);
    quill.root.setAttribute('aria-multiline', 'true');
    quill.root.id = id;

    // Localise the generated toolbar and, if snow built one, its popover.
    const toolbarRoot = host.previousElementSibling;
    if (toolbarRoot instanceof HTMLElement) applyToolbarLabels(toolbarRoot);
    const tooltip = quill.container.querySelector('.ql-tooltip');
    if (tooltip instanceof HTMLElement) applyTooltipLabels(tooltip);

    return () => {
      quill.off('text-change', emit);
      quill.off('editor-change', syncTableState);
      quill.root.removeEventListener('compositionstart', onCompositionStart);
      quill.root.removeEventListener('compositionend', onCompositionEnd);
      quillRef.current = null;
      loadedSignature.current = null;
      setInTable(false);
      wrapper.replaceChildren();
    };
  }, [deps, id, labelledBy, placeholder, signatureOf]);

  // Fetch bytes for any attachment the content references.
  useEffect(() => {
    if (attachmentIdsIn(value).length) void attachments.resolve(value);
  }, [attachments, value]);

  // Reconcile prop -> editor. Runs for external value changes and again when
  // attachments resolve, since resolving swaps `attachment:` URLs for blob URLs.
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || !deps) return;
    // Never rewrite under the user's cursor: it would collapse the selection and
    // break IME composition.
    if (quill.hasFocus() || composing.current) return;
    const signature = signatureOf(value);
    if (signature === loadedSignature.current) return;

    const ops = parseContent(value, attachments.mapToDisplay);
    loadedSignature.current = signature;
    // Without KaTeX the formula blot throws on creation, so degrade to source.
    quill.setContents(deps.value ? ops : stripFormulas(ops), 'silent');
  }, [attachments.mapToDisplay, attachments.resolved, deps, signatureOf, value]);

  useEffect(() => {
    quillRef.current?.enable(!disabled);
  }, [disabled, deps]);

  const referenced = attachmentIdsIn(value);

  // Hand an attachment to the OS. Failures are shown in the same place upload
  // failures are: the backend refuses a file type it would have to execute, and
  // reports an attachment whose file has gone missing.
  const openAttachment = useCallback(async (attachmentId: string) => {
    setUploadError('');
    try {
      await attachmentsRef.current.open(attachmentId);
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : t('richEditor.openFailed');
      setUploadError(message);
    }
  }, []);

  // A file in the body is a link whose href is `attachment:<id>`, or the blob URL
  // it resolved to. Neither is something the webview can navigate to, so a click
  // is intercepted and sent to the OS instead. Without this the only way to open
  // a file would be the strip below, and clicking its name in the text — the
  // obvious thing to try — would appear to do nothing.
  const onSurfaceClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      const attachmentId = attachmentIdFromUrl(attachments.mapToStorage(href));
      if (!attachmentId) return;
      event.preventDefault();
      void openAttachment(attachmentId);
    },
    [attachments, openAttachment]
  );

  const tableAction = (run: (table: TableModule) => void) => () => {
    const quill = quillRef.current;
    if (!quill) return;
    run(quill.getModule('table') as TableModule);
  };

  return (
    <div className="rich-editor" data-disabled={disabled ? 'true' : undefined}>
      <div
        ref={surfaceRef}
        className="rich-editor__surface"
        data-dropping={dropping ? 'true' : undefined}
        onDragOver={(event) => {
          if (disabled || !attachments.supported) return;
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          // Ignore moves between descendants of the surface.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropping(false);
        }}
        onDrop={(event) => {
          if (disabled || !attachments.supported) return;
          const files = Array.from(event.dataTransfer.files ?? []);
          if (!files.length) return;
          event.preventDefault();
          setDropping(false);
          void uploadFiles(files);
        }}
        onClick={attachments.canOpen ? onSurfaceClick : undefined}
      >
        <div ref={wrapperRef} className="rich-editor__quill" aria-busy={deps ? undefined : 'true'} />
        {deps ? null : <p className="rich-editor__loading">{t('richEditor.loading')}</p>}
      </div>

      {inTable ? (
        <div className="rich-editor__table-bar" role="group" aria-label={t('richEditor.tableControls')}>
          {(
            [
              ['richEditor.tableRowAbove', (table: TableModule) => table.insertRowAbove()],
              ['richEditor.tableRowBelow', (table: TableModule) => table.insertRowBelow()],
              ['richEditor.tableColumnLeft', (table: TableModule) => table.insertColumnLeft()],
              ['richEditor.tableColumnRight', (table: TableModule) => table.insertColumnRight()],
              ['richEditor.tableDeleteRow', (table: TableModule) => table.deleteRow()],
              ['richEditor.tableDeleteColumn', (table: TableModule) => table.deleteColumn()],
              ['richEditor.tableDelete', (table: TableModule) => table.deleteTable()]
            ] as const
          ).map(([key, run]) => (
            <button
              key={key}
              type="button"
              className="rich-editor__table-button"
              disabled={disabled}
              onClick={tableAction(run)}
            >
              {t(key)}
            </button>
          ))}
        </div>
      ) : null}

      {attachments.supported ? (
        <div className="rich-editor__actions">
          <button
            type="button"
            className="good-icon-button"
            disabled={disabled}
            aria-label={t('richEditor.attachFile')}
            title={t('richEditor.attachFile')}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip aria-hidden="true" />
          </button>
          <span className="rich-editor__hint">{t('richEditor.dropHint')}</span>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="rich-editor__file-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so selecting the same file twice fires change again.
          event.target.value = '';
          void uploadFiles(files);
        }}
      />

      {uploadError ? (
        <span id={errorId} role="alert" className="field-error">
          {uploadError}
        </span>
      ) : null}

      {referenced.length ? (
        <ul className="rich-editor__attachments">
          {referenced.map((attachmentId) => {
            const record = attachments.resolved.get(attachmentId);
            return (
              <li key={attachmentId} className="rich-editor__attachment">
                <FileText aria-hidden="true" className="rich-editor__attachment-icon" />
                {record && attachments.canOpen ? (
                  // Not gated on `disabled`: opening a file is reading it, which a
                  // read-only field should still allow.
                  <button
                    type="button"
                    className="rich-editor__attachment-open"
                    // The visible label is the file name, which does not say what
                    // clicking does. The accessible name adds the action and keeps
                    // the file name inside it, so it still matches what is on
                    // screen (WCAG 2.5.3 Label in Name).
                    aria-label={t('richEditor.openAttachment', { name: record.fileName })}
                    // Long names are ellipsized, so a hover tooltip with the full
                    // name is worth having.
                    title={record.fileName}
                    onClick={() => void openAttachment(attachmentId)}
                  >
                    {record.fileName}
                  </button>
                ) : (
                  <span className="rich-editor__attachment-name">
                    {record?.fileName ?? t('richEditor.attachmentPending')}
                  </span>
                )}
                {record ? (
                  <span className="rich-editor__attachment-size">{formatByteSize(record.byteSize)}</span>
                ) : null}
                <button
                  type="button"
                  className="good-icon-button rich-editor__attachment-remove"
                  disabled={disabled}
                  aria-label={t('richEditor.removeAttachment', {
                    name: record?.fileName ?? t('richEditor.attachmentPending')
                  })}
                  onClick={() => onChange(removeAttachmentFromContent(value, attachmentId))}
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
