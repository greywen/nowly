// Rich text editor shared by every long-form field: event notes, task
// descriptions and note bodies.
//
// Value in and out is Markdown (see markdown.ts for why). Quill is uncontrolled
// internally and this component reconciles it against the `value` prop, which
// needs care on two fronts:
//
//   1. IME composition. Rewriting Quill's contents mid-composition drops or
//      duplicates Chinese input, so reloads are skipped while the editor holds
//      focus or is composing. The editor is the source of truth while the user
//      is in it; the prop is the source of truth otherwise.
//   2. StrictMode. Effects run twice in development, so setup must be
//      idempotent and teardown must remove the toolbar Quill injects as a
//      sibling of its own root.
//
// Attachments are uploaded through the repository and referenced from the
// Markdown as `attachment:<id>`; the content is the only record of what is in
// use. See useAttachments for the blob-URL bridge.

import Quill from 'quill';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n';
import {
  attachmentIdsIn,
  formatByteSize,
  isDisplayableImage,
  removeAttachmentReference,
  attachmentUrl,
  type Attachment
} from '../../lib/attachment';
import { FileText, Paperclip, X } from '../icons';
import { deltaToMarkdown, markdownToDelta, type DeltaOp } from './delta';
import { registerRichTextFormats, richTextFormats, richTextToolbar } from './quill-setup';
import { useAttachments } from './useAttachments';
import './rich-editor.css';

type Props = {
  id: string;
  value: string;
  onChange(markdown: string): void;
  disabled?: boolean;
  placeholder?: string;
  /** Id of the visible label, wired to the editing surface for screen readers. */
  labelledBy?: string;
};

export function RichEditor({ id, value, onChange, disabled = false, placeholder, labelledBy }: Props) {
  const attachments = useAttachments();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Latest props for use inside Quill callbacks, which are registered once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Signature of what is currently loaded into Quill: the Markdown plus how each
  // of its attachments currently maps to a display URL. The mapping has to be
  // part of it because an unresolved `attachment:` URL turns into a `blob:` URL
  // once its bytes arrive, without the Markdown changing at all. Comparing the
  // Markdown alone would leave every image permanently unresolved.
  const signatureOf = useCallback(
    (markdown: string) =>
      [
        markdown,
        ...attachmentIdsIn(markdown).map((id) => attachmentsRef.current.mapToDisplay(attachmentUrl(id)))
      ].join('\u0000'),
    []
  );
  const loadedSignature = useRef<string | null>(null);
  const composing = useRef(false);
  const [dropping, setDropping] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const errorId = useId();

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

  // Create Quill once per mount.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
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
      modules: {
        toolbar: {
          container: richTextToolbar,
          handlers: {
            // Replace the stock handler, which base64-inlines the image into the
            // document and would bloat the database.
            image: () => fileInputRef.current?.click()
          }
        },
        // Quill's uploader only accepts image mimetypes and base64-inlines them.
        // Disabled so the drop handler below owns every dropped file.
        uploader: { mimetypes: [] }
      }
    });
    quillRef.current = quill;

    // Emit for every source except 'silent', which is what the load path below
    // uses. Loading normalised content must not look like a user edit, or every
    // dialog would open already dirty and prompt to discard on close.
    const emit = (
      _delta: unknown,
      _old: unknown,
      source: string
    ) => {
      if (source === 'silent') return;
      const markdown = deltaToMarkdown(
        quill.getContents().ops as DeltaOp[],
        attachmentsRef.current.mapToStorage
      );
      // Record the echo of our own emit so the reconcile effect below does not
      // treat the value coming back down as an external change and reset the
      // caret mid-typing.
      loadedSignature.current = signatureOf(markdown);
      onChangeRef.current(markdown);
    };
    quill.on('text-change', emit);

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

    return () => {
      quill.off('text-change', emit);
      quill.root.removeEventListener('compositionstart', onCompositionStart);
      quill.root.removeEventListener('compositionend', onCompositionEnd);
      quillRef.current = null;
      loadedSignature.current = null;
      wrapper.replaceChildren();
    };
  }, [id, labelledBy, placeholder]);

  // Fetch bytes for any attachment the content references.
  useEffect(() => {
    if (attachmentIdsIn(value).length) void attachments.resolve(value);
  }, [attachments, value]);

  // Reconcile prop -> editor. Runs for external value changes and again when
  // attachments resolve, since resolving swaps `attachment:` URLs for blob URLs.
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    // Never rewrite under the user's cursor: it would collapse the selection and
    // break IME composition.
    if (quill.hasFocus() || composing.current) return;
    const signature = signatureOf(value);
    if (signature === loadedSignature.current) return;

    const ops = markdownToDelta(value, attachments.mapToDisplay);
    loadedSignature.current = signature;
    quill.setContents(ops, 'silent');
  }, [attachments.mapToDisplay, attachments.resolved, signatureOf, value]);

  useEffect(() => {
    quillRef.current?.enable(!disabled);
  }, [disabled]);

  const referenced = attachmentIdsIn(value);

  return (
    <div className="rich-editor" data-disabled={disabled ? 'true' : undefined}>
      <div
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
      >
        <div ref={wrapperRef} className="rich-editor__quill" />
      </div>

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
                <span className="rich-editor__attachment-name">
                  {record?.fileName ?? t('richEditor.attachmentPending')}
                </span>
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
                  onClick={() => onChange(removeAttachmentReference(value, attachmentId))}
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
