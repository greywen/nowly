import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { framePixelToCss, type FrameBox } from './frame-geometry';

// The annotation text editor.
//
// §5.3 line 210 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md:
// Enter inserts a newline, Ctrl+Enter commits, clicking outside commits non-empty
// content, and Esc reverts this round of editing. A Chinese IME must work
// normally, so the editor is a real focused `<textarea>` rather than a
// contenteditable or a synthetic input: only a native control gets proper
// composition, candidate window placement and clipboard behaviour.
//
// The font size is image content in physical pixels (§5.2), so the on-screen size
// is scaled to match what will be exported.

export type TextEditorProps = {
  /// Where the text starts, in frame physical pixels.
  at: { x: number; y: number };
  /// The selection origin, since the editor is positioned within it.
  selection: { x: number; y: number; width: number; height: number };
  box: FrameBox;
  color: string;
  /// Output physical pixels.
  fontSize: number;
  /// The content being re-edited, or empty for a new object.
  initialContent?: string;
  /// Reports the live draft upward on every change.
  ///
  /// The surface needs it to commit this editor when a press opens another one:
  /// relying on the browser's blur for that does not work, because the same press
  /// cancels the focus change so the new editor can keep focus. Without it the
  /// typed text was silently dropped.
  onDraftChange?: (content: string) => void;
  onCommit: (content: string) => void;
  onCancel: () => void;
};

export function TextEditor({
  at,
  selection,
  box,
  color,
  fontSize,
  initialContent = '',
  onDraftChange,
  onCommit,
  onCancel
}: TextEditorProps) {
  const [content, setContent] = useState(initialContent);
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Tracks the composition, so Esc during one cancels the candidate rather than
  // the whole edit.
  const composing = useRef(false);
  // Esc unmounts the editor, and the resulting blur would otherwise commit the
  // very content Esc just discarded.
  const finished = useRef(false);

  useEffect(() => {
    // Focus immediately: the click that created the editor was consumed by the
    // capture layer, so nothing else will focus it.
    ref.current?.focus();
    // Seed the surface with this editor's starting content, so a press that opens
    // another editor commits the right text even if nothing was typed into this
    // one — a re-edit starts non-empty.
    onDraftChange?.(initialContent);
    // Mount only: `onDraftChange` is reported again on every change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function cancelOnWindowBlur() {
      if (finished.current) return;
      finished.current = true;
      onCancel();
    }
    window.addEventListener('blur', cancelOnWindowBlur);
    return () => window.removeEventListener('blur', cancelOnWindowBlur);
  }, [onCancel]);

  // Physical pixels to CSS, so the editor shows the exported size.
  const scale = box.renderedWidth / box.frameWidth;
  const css = framePixelToCss({ ...selection, width: 0, height: 0 }, box);
  const left = css.left + (at.x - selection.x) * scale;
  const top = css.top + (at.y - selection.y) * scale;

  return (
    <textarea
      ref={ref}
      className="screenshot-text-editor"
      value={content}
      style={{
        left,
        top,
        color,
        fontSize: fontSize * scale,
        // 1.4 matches the renderer's line spacing, so committing does not shift
        // the text.
        lineHeight: 1.4,
        fontWeight: 500
      }}
      // The pointer must not reach the capture surface underneath, or a click
      // inside the editor would start drawing.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (finished.current) return;
        finished.current = true;
        onCancel();
      }}
      onChange={(event) => {
        setContent(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(event) => {
        // This control owns its keys, so nothing here reaches the capture
        // shortcuts: Ctrl+C copies text, not the image.
        event.stopPropagation();

        if (event.key === 'Escape') {
          if (composing.current || event.nativeEvent.isComposing) return;
          event.preventDefault();
          finished.current = true;
          onCancel();
          return;
        }
        if (event.key === 'Enter') {
          if (composing.current || event.nativeEvent.isComposing) return;
          if (event.ctrlKey) {
            event.preventDefault();
            finished.current = true;
            onCommit(content);
          }
          // A plain Enter falls through to the textarea's own newline.
        }
      }}
      // Clicking elsewhere commits non-empty content, per line 210.
      onBlur={() => {
        if (finished.current) return;
        finished.current = true;
        onCommit(content);
      }}
      aria-label={t('screenshot.textEditorLabel')}
      spellCheck={false}
    />
  );
}
