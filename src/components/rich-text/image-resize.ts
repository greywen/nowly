import Quill from 'quill';
import { t } from '../../i18n';

/** Keep controls outside Quill's document so they never enter stored content. */
export function installImageResize(quill: Quill, surface: HTMLElement): () => void {
  const frame = document.createElement('div');
  frame.className = 'rich-editor__image-resize';
  frame.hidden = true;
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'rich-editor__image-resize-handle';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', t('richEditor.resizeImage'));
  handle.title = t('richEditor.resizeImageHint');
  frame.append(handle);
  surface.append(frame);

  let image: HTMLImageElement | null = null;
  let drag: { pointerId: number; x: number; y: number; width: number; height: number; preview: number; styleWidth: string } | null = null;

  const maxWidth = () => {
    const styles = getComputedStyle(quill.root);
    return Math.max(1, quill.root.getBoundingClientRect().width - (parseFloat(styles.paddingLeft) || 0) - (parseFloat(styles.paddingRight) || 0));
  };
  const clampWidth = (width: number) => Math.round(Math.max(Math.min(48, maxWidth()), Math.min(maxWidth(), width)));
  const refresh = () => {
    if (!image || !quill.isEnabled() || !quill.root.contains(image)) {
      hide();
      return;
    }
    const rect = image.getBoundingClientRect();
    const parent = surface.getBoundingClientRect();
    const editor = quill.root.getBoundingClientRect();
    frame.style.clipPath = `inset(${Math.max(0, editor.top - rect.top)}px ${Math.max(0, rect.right - editor.right)}px ${Math.max(0, rect.bottom - editor.bottom)}px ${Math.max(0, editor.left - rect.left)}px)`;
    frame.hidden = false;
    frame.style.left = `${rect.left - parent.left + surface.scrollLeft - surface.clientLeft}px`;
    frame.style.top = `${rect.top - parent.top + surface.scrollTop - surface.clientTop}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
    handle.setAttribute('aria-valuemin', String(Math.min(48, maxWidth())));
    handle.setAttribute('aria-valuemax', String(Math.round(maxWidth())));
    handle.setAttribute('aria-valuenow', String(Math.round(rect.width)));
    handle.setAttribute('aria-valuetext', `${Math.round(rect.width)} px`);
  };
  const cancel = () => {
    if (!drag) return;
    if (image) image.style.width = drag.styleWidth;
    const pointerId = drag.pointerId;
    drag = null;
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    refresh();
  };
  function hide() {
    if (drag) cancel();
    image = null;
    frame.hidden = true;
  }
  const commit = (width: number) => {
    if (!image || !quill.isEnabled() || !quill.root.contains(image)) return;
    const blot = Quill.find(image);
    if (!blot || blot instanceof Quill) return;
    // Isolate the gesture from adjacent typing and subsequent undo operations.
    quill.history.cutoff();
    quill.formatText(quill.getIndex(blot), 1, { width: String(clampWidth(width)), height: false }, 'user');
    quill.history.cutoff();
    refresh();
  };
  const onSelect = (event: PointerEvent) => {
    if (frame.contains(event.target as Node)) return;
    if (event.target instanceof HTMLImageElement && quill.root.contains(event.target) && quill.isEnabled()) {
      cancel();
      image = event.target;
      refresh();
    } else {
      hide();
    }
  };
  const onStart = (event: PointerEvent) => {
    if (!image || !quill.isEnabled() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, preview: rect.width, styleWidth: image.style.width };
    handle.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (!drag || !image || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.x;
    const dy = (event.clientY - drag.y) * drag.width / drag.height;
    drag.preview = clampWidth(drag.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy));
    image.style.width = `${drag.preview}px`;
    refresh();
  };
  const onEnd = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    onMove(event);
    if (!drag) return;
    const { preview, width, styleWidth, pointerId } = drag;
    drag = null;
    if (image) image.style.width = styleWidth;
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    if (preview !== width) commit(preview);
    refresh();
  };
  const onCancel = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) cancel();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && image) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      quill.focus({ preventScroll: true });
    } else if (event.target === handle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const width = image?.getBoundingClientRect().width ?? 0;
      const step = event.shiftKey ? 1 : 10;
      commit(width + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step));
    }
  };
  const onFocus = (event: FocusEvent) => {
    if (!surface.contains(event.target as Node)) hide();
  };
  const onDragStart = (event: DragEvent) => {
    if (event.target === image) event.preventDefault();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
  observer?.observe(quill.root);
  const enabledObserver = new MutationObserver(() => {
    if (!quill.isEnabled() || (image && !quill.root.contains(image))) hide();
  });
  enabledObserver.observe(quill.root, { attributes: true, attributeFilter: ['contenteditable'], childList: true, subtree: true });
  document.addEventListener('pointerdown', onSelect, true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('focusin', onFocus);
  surface.addEventListener('keydown', onKey, true);
  surface.addEventListener('dragstart', onDragStart);
  handle.addEventListener('pointerdown', onStart);
  handle.addEventListener('lostpointercapture', onCancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', refresh);
  document.addEventListener('scroll', refresh, true);
  quill.on('text-change', refresh);
  quill.root.addEventListener('load', refresh, true);

  return () => {
    hide();
    observer?.disconnect();
    enabledObserver.disconnect();
    document.removeEventListener('pointerdown', onSelect, true);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('focusin', onFocus);
    surface.removeEventListener('keydown', onKey, true);
    surface.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', refresh);
    document.removeEventListener('scroll', refresh, true);
    quill.off('text-change', refresh);
    quill.root.removeEventListener('load', refresh, true);
    frame.remove();
  };
}
