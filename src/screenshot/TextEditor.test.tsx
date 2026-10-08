import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FrameBox } from './frame-geometry';
import { TextEditor } from './TextEditor';

const box: FrameBox = {
  frameWidth: 2240,
  frameHeight: 1400,
  renderedWidth: 1493.3333333333333,
  renderedHeight: 933.3333333333334,
  offsetX: 0,
  offsetY: 0
};

const selection = { x: 200, y: 100, width: 800, height: 600 };

function renderEditor(props: Partial<React.ComponentProps<typeof TextEditor>> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <TextEditor
      at={{ x: 350, y: 250 }}
      selection={selection}
      box={box}
      color="#F06445"
      fontSize={24}
      onCommit={onCommit}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onCommit, onCancel, editor: screen.getByRole('textbox') as HTMLTextAreaElement };
}

describe('the text editor', () => {
  it('is a real focused textarea, so an IME works normally', () => {
    // §5.3: a Chinese IME must work, which needs a native control rather than a
    // contenteditable or synthetic input.
    const { editor } = renderEditor();

    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor).toHaveFocus();
  });

  it('shows the exported font size, scaled to the display', () => {
    // The font size is image content in physical pixels, so at 150% a 24px font
    // renders at 16 CSS pixels.
    const { editor } = renderEditor();

    expect(Number.parseFloat(editor.style.fontSize)).toBeCloseTo(16, 5);
    expect(editor.style.color).toBe('rgb(240, 100, 69)');
  });

  it('is positioned at the click, relative to the selection', () => {
    // 350 - 200 = 150 physical from the selection's left, which is 100 CSS, plus
    // the selection's own 133.33 offset.
    const { editor } = renderEditor();

    expect(Number.parseFloat(editor.style.left)).toBeCloseTo(233.333, 2);
    expect(Number.parseFloat(editor.style.top)).toBeCloseTo(166.667, 2);
  });

  it('inserts a newline on plain Enter', async () => {
    const user = userEvent.setup();
    const { editor, onCommit } = renderEditor();

    await user.type(editor, 'first{Enter}second');

    expect(editor.value).toBe('first\nsecond');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const { editor, onCommit } = renderEditor();

    await user.type(editor, 'hello');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onCommit).toHaveBeenCalledWith('hello');
  });

  it('reverts this round on Esc', async () => {
    const user = userEvent.setup();
    const { editor, onCommit, onCancel } = renderEditor();

    await user.type(editor, 'draft');
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not commit again after Esc', () => {
    // Esc unmounts the editor, and the blur that follows would otherwise commit
    // exactly the content Esc discarded.
    const { editor, onCommit, onCancel } = renderEditor();

    fireEvent.change(editor, { target: { value: 'draft' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.blur(editor);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits when focus moves elsewhere', () => {
    // §5.3 line 210: clicking outside commits the current non-empty content.
    const { editor, onCommit } = renderEditor();

    fireEvent.change(editor, { target: { value: 'typed' } });
    fireEvent.blur(editor);

    expect(onCommit).toHaveBeenCalledWith('typed');
  });

  it('leaves Esc and Enter to an unfinished composition', () => {
    // §7: the IME owns both keys first, so neither ends the edit mid-candidate.
    const { editor, onCommit, onCancel } = renderEditor();

    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    // Once the composition ends, the keys work again.
    fireEvent.compositionEnd(editor);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('keeps its keys away from the capture shortcuts', () => {
    // Ctrl+C in the editor must copy text, not the image, so the event must not
    // propagate to the window listener.
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const { editor } = renderEditor();

    fireEvent.keyDown(editor, { key: 'c', ctrlKey: true, bubbles: true });

    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('keeps pointer events away from the drawing surface', () => {
    // A click inside the editor must not start a shape underneath it.
    const onSurfacePointer = vi.fn();
    const { container } = render(
      <div onPointerDown={onSurfacePointer}>
        <TextEditor
          at={{ x: 350, y: 250 }}
          selection={selection}
          box={box}
          color="#F06445"
          fontSize={24}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>
    );

    fireEvent.pointerDown(container.querySelector('textarea')!);

    expect(onSurfacePointer).not.toHaveBeenCalled();
  });

  it('uses right-click to cancel the local text edit without opening a menu', () => {
    const { editor, onCommit, onCancel } = renderEditor({ initialContent: 'before' });

    const event = fireEvent.contextMenu(editor);

    expect(event).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels instead of committing when the capture window loses focus', () => {
    const { editor, onCommit, onCancel } = renderEditor({ initialContent: 'before' });
    fireEvent.change(editor, { target: { value: 'draft' } });

    fireEvent.blur(window);
    fireEvent.blur(editor);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('starts from existing content when re-editing', () => {
    const { editor } = renderEditor({ initialContent: 'existing' });

    expect(editor.value).toBe('existing');
  });
});

describe('reporting the live draft', () => {
  function renderWithDraft(props: Partial<React.ComponentProps<typeof TextEditor>> = {}) {
    const onDraftChange = vi.fn();
    const result = renderEditor({ onDraftChange, ...props });
    return { ...result, onDraftChange };
  }

  it('reports the seed content on mount', () => {
    // A press elsewhere commits whatever the surface last heard. Without the seed,
    // clicking away from an untouched re-edit would commit an empty string and
    // delete the object.
    const { onDraftChange } = renderWithDraft({ initialContent: 'existing' });

    expect(onDraftChange).toHaveBeenCalledWith('existing');
  });

  it('reports every keystroke', () => {
    // The surface cannot read the editor's internal state, and blur does not fire
    // when the next press calls preventDefault to keep focus for a new editor.
    const { editor, onDraftChange } = renderWithDraft();

    fireEvent.change(editor, { target: { value: 'ab' } });

    expect(onDraftChange).toHaveBeenLastCalledWith('ab');
  });

  it('works without the callback, since re-editing is optional chrome', () => {
    const { editor } = renderEditor();

    expect(() => fireEvent.change(editor, { target: { value: 'x' } })).not.toThrow();
  });
});
