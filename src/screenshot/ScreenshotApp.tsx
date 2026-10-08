import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { AnnotationLayer } from './AnnotationLayer';
import {
  canRedo,
  canUndo,
  emptyDocument,
  redo,
  undo,
  type Annotation,
  type AnnotationDocument
} from './annotation-document';
import { hitTestAnnotations } from './annotation-hit';
import type { AnnotationHandle } from './annotation-resize';
import { cursorFor, type PointerTarget } from './cursor';

import {
  framePixelToCss,
  pointerToFramePixel,
  toVirtualDesktop,
  type DisplayOrigin
} from './frame-geometry';
import type { KeyAction } from './key-dispatch';
import { Magnifier } from './Magnifier';
import { PropertyPanel } from './PropertyPanel';
import { moveSelection, resizeSelection } from './screenshot-model';
import { ScreenshotToolbar } from './ScreenshotToolbar';
import { SelectionLayer, SelectionSize } from './SelectionLayer';
import { TextEditor } from './TextEditor';
import { toolbarPlacement } from './toolbar-placement';
import { DEFAULT_TOOL, type ActionId, type ToolId } from './toolbar-model';
import {
  defaultProperties,
  withProperty,
  type AnnotationColor,
  type ToolProperties
} from './tool-properties';
import { useAnnotationDrawing } from './useAnnotationDrawing';
import { useAnnotationEditing } from './useAnnotationEditing';
import { useCancelOnEscape } from './useCancelOnEscape';
import { useCaptureFrame } from './useCaptureFrame';
import { useCaptureKeyboard } from './useCaptureKeyboard';
import { useExport } from './useExport';
import { useMosaicPreview } from './useMosaicPreview';
import { useSelection } from './useSelection';


// The two capture surfaces, mirroring the windows in
// `src-tauri/src/screen_capture/window.rs`.
//
// Per docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md §2.3 the
// capture content is data, not an app surface: no 15.2px radius, no decorative
// blur, and status text is static — never a toast, banner or spinner.

/// Owns the single taskbar and Alt+Tab entry for a session.
///
/// It deliberately renders only a static placeholder: §3.3 forbids the task
/// switcher, taskbar thumbnail and Peek from showing the frozen desktop or
/// unredacted content, and a suspended session must not leave an old sensitive
/// frame behind either.
export function ScreenshotSessionApp() {
  const { t } = useTranslation();
  useCancelOnEscape();
  useEffect(() => {
    let active = true;
    void invoke('capture_window_ready').catch((error: unknown) => {
      if (active) console.error('failed to report the capture session window readiness', error);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="screenshot-session" aria-label={t('screenshot.sessionTitle')}>
      <p className="screenshot-session__note">{t('screenshot.sessionPlaceholder')}</p>
    </main>
  );
}

/// One per display, covering that display's physical rectangle.
///
/// Shows the frozen frame for its own display, and the selection drawn over it.
/// The toolbar and magnifier follow in the rest of 02-editor.
export function ScreenshotOverlayApp() {
  const { t } = useTranslation();
  const frame = useCaptureFrame();
  const framePlan = frame.status === 'decoding' || frame.status === 'ready' ? frame.frame : null;
  const displayOrigin: DisplayOrigin = framePlan
    ? { x: framePlan.originX, y: framePlan.originY }
    : { x: 0, y: 0 };
  const frameRef = useRef<HTMLImageElement | null>(null);
  const selection = useSelection(frameRef, framePlan?.windowCandidates ?? []);
  const {
    state,
    pointerPixelRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setSelection
  } = selection;
  const [tool, setTool] = useState<ToolId>(DEFAULT_TOOL);
  // §4.1 line 160: the magnifier's hint reports the copy's outcome, and the next pointer
  // move restores the plain hint.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // What the pointer is over, which decides the cursor. Nothing in the annotation
  // layer receives pointer events — one pointer stream is the whole point — so the
  // surface has to hit test to know what a press would do.
  const [pointerTarget, setPointerTarget] = useState<PointerTarget>('none');
  // The grip under the pointer, kept separate from `pointerTarget` because a grip
  // sits outside its object's own hit area — it is pushed onto the frame, past the
  // shape's edge — so neither one implies the other.
  const [hoveredHandle, setHoveredHandle] = useState<AnnotationHandle | null>(null);
  // The open text editor's live content, mirrored here so a press elsewhere can
  // commit it. A ref rather than state: it changes on every keystroke and nothing
  // renders from it, so holding it in state would re-render the whole surface per
  // character.
  const textDraft = useRef<string | null>(null);
  const [doc, setDoc] = useState<AnnotationDocument>(emptyDocument);
  const [properties, setProperties] = useState(defaultProperties);
  // The live annotation SVG, rasterised as-is for export so the file matches the
  // preview rather than coming from a second renderer.
  const annotationRef = useRef<SVGSVGElement | null>(null);
  // Measured rather than assumed: §5.1 line 103 lets the fixed groups wrap to fit
  // the available width, so the toolbar's size is not a constant.
  const [toolbarBox, setToolbarBox] = useState({ width: 0, height: 0 });
  const measureToolbar = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setToolbarBox((current) =>
      current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height }
    );
  }, []);

  // The rectangle on screen: the live drag while dragging, the committed one after.
  const rect = state.draft ?? state.selection;
  const { box } = state;
  // The pointer in CSS pixels, derived from the sampled pixel so the card follows
  // the same resolution the sample came from.
  const pointerCss =
    box && state.pointerPixel
      ? {
          x: (state.pointerPixel.x / box.frameWidth) * box.renderedWidth,
          y: (state.pointerPixel.y / box.frameHeight) * box.renderedHeight
        }
      : null;

  // §4.2 line 166: the toolbar appears only once the selection is committed.
  const committed = state.phase === 'editing' && state.selection && box;
  const toolbarAt =
    committed && box && state.selection && toolbarBox.width > 0
      ? toolbarPlacement(
          framePixelToCss(state.selection, box),
          toolbarBox,
          { width: box.renderedWidth, height: box.renderedHeight }
        )
      : null;

  // Annotations live in the selection, so drawing only exists after it commits.
  const drawing = useAnnotationDrawing(
    tool,
    properties,
    state.selection ?? { x: 0, y: 0, width: 0, height: 0 },
    doc,
    setDoc
  );

  // One set of handlers for the surface: aiming goes to the selection, editing to
  // the annotations, so a single pointer stream never drives both.
  const editing = state.phase === 'editing' && state.selection !== null;
  // The selection is locked once the first annotation is drawn (WeChat behavior).
  const selectionLocked = doc.objects.length > 0;
  const exporter = useExport(doc, state.selection, () => annotationRef.current, displayOrigin);
  const exporting =
    exporter.state.status === 'copying' || exporter.state.status === 'saving';
  // Committed objects stay editable: the select tool picks one up, moves it, and
  // the keyboard deletes or nudges it. §8.1 freezes the document during an export,
  // so the hook is disabled rather than left able to start a move it cannot commit.
  const objects = useAnnotationEditing(
    state.selection ?? { x: 0, y: 0, width: 0, height: 0 },
    doc,
    setDoc,
    !exporting
  );
  // Undo can remove the object a selection or an open editor points at, and so can
  // a delete. Dropping the stale reference here keeps every writer of `doc` from
  // having to remember to do it.
  const reconcileSelection = objects.reconcile;
  useEffect(() => {
    reconcileSelection(doc);
  }, [doc, reconcileSelection]);
  const selectedObject = objects.state.selectedId
    ? doc.objects.find((object) => object.id === objects.state.selectedId) ?? null
    : null;
  // The property panel follows the selected object when there is one, and the active
  // tool otherwise. Without this the panel only ever set defaults for the *next*
  // shape, so a committed rectangle's colour and thickness were fixed the moment it
  // was drawn — which is most of what "it cannot be edited afterwards" meant.
  const propertyKind: Annotation['kind'] | null = selectedObject
    ? selectedObject.kind
    : tool === 'select'
      ? null
      : (tool as Annotation['kind']);
  // The rows show the object's own values, so the swatch that looks active and the
  // shape on screen cannot disagree.
  const panelProperties: ToolProperties = selectedObject
    ? {
        ...properties,
        ...(selectedObject.kind === 'mosaic'
          ? { mosaicBlockSize: selectedObject.blockSize }
          : // The document stores a plain string, but every colour that reaches it
            // came from the panel's own palette, so the row is one of the eight.
            { color: selectedObject.color as AnnotationColor }),
        ...(selectedObject.kind === 'text' ? { fontSize: selectedObject.fontSize } : {}),
        ...('strokeWidth' in selectedObject
          ? { strokeWidth: selectedObject.strokeWidth }
          : {}),
        ...(selectedObject.kind === 'rect' || selectedObject.kind === 'ellipse'
          ? { filled: selectedObject.filled === true }
          : {})
      }
    : properties;
  // What the layer paints: committed objects, with the dragged one substituted in
  // place so a move is visible before it is committed, plus the in-progress draft.
  // A text object being re-edited is hidden, because the live textarea is drawn on
  // top of it and two copies of the same string look like a rendering bug.
  const moving = objects.state.moving;
  const reeditingId = objects.state.editingText?.id ?? null;
  const visibleObjects = (() => {
    let next: Annotation[] = doc.objects.map((object) =>
      moving && object.id === moving.id ? moving : object
    );
    if (reeditingId) next = next.filter((object) => object.id !== reeditingId);
    if (drawing.state.draft) next = [...next, drawing.state.draft];
    return next;
  })();
  const mosaicPreview = useMosaicPreview(
    doc.objects,
    state.selection,
    doc.past.length,
    displayOrigin
  );
  const pixelOf = useCallback(
    (event: React.PointerEvent) =>
      box ? pointerToFramePixel({ x: event.clientX, y: event.clientY }, box) : null,
    [box]
  );
  const handleDown = useCallback(
    (event: React.PointerEvent) => {
      if (frame.status !== 'ready' || exporting || event.button !== 0) return;
      let started = false;
      if (!editing) {
        started = onPointerDown(event);
      } else {
        const pixel = pixelOf(event);
        if (!pixel) return;
        // An open text editor is committed before this press does anything else,
        // and the press then stops there: it finishes the note rather than placing
        // the next one. One click should leave text-entry mode, not stay in it.
        //
        // Blur cannot be relied on for the commit: the text tool calls
        // `preventDefault` on its own pointerdown so a new editor keeps focus, and
        // that also suppresses the blur of the open one, which silently dropped
        // what had been typed. Committing explicitly also fixes the order — the
        // note exists before anything else runs, rather than racing a focus event.
        const openDraft = textDraft.current;
        const hadEditor = drawing.state.pendingText !== null || objects.state.editingText !== null;
        if (drawing.state.pendingText) {
          drawing.commitText(openDraft ?? '');
        } else if (objects.state.editingText) {
          objects.commitTextEdit(openDraft ?? '');
        }
        textDraft.current = null;
        if (hadEditor) {
          // Switch to select tool after committing text
          setTool('select');
          // Consumed. Returning before `setPointerCapture` matters: capturing for a
          // gesture that was never started would send the following move and up
          // events to a surface that is not expecting them.
          return;
        }
        // A press that lands on a committed object picks it up, whichever tool is
        // active. Requiring the select tool first is what made a drawn shape look
        // inert: the tool stays on "rectangle" after a drag, so the next press on
        // that rectangle drew a second one on top of it instead of moving it.
        //
        // Only the object's own geometry counts as a hit — an open shape's stroke,
        // a painted mosaic cell — so a new shape can still be drawn in the space
        // beside or inside an existing one.
        const grabbed = objects.onPointerDown(pixel);
        if (grabbed && tool !== 'select') {
          // Show what happened: the toolbar follows the object the user grabbed,
          // and the next press draws again only after they pick a tool.
          setTool('select');
        }
        started =
          grabbed ||
          (tool === 'select'
            ? !selectionLocked && selection.beginMove(pixel)
            : drawing.onPointerDown(pixel));
        // Creating the textarea during pointerdown focuses it immediately. Cancel
        // this pointer's default canvas focus, or the browser blurs and discards
        // the new empty editor before the user can type.
        if (started && tool === 'text') event.preventDefault();
      }
      if (
        started &&
        typeof event.pointerId === 'number' &&
        event.currentTarget.setPointerCapture
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [frame.status, exporting, editing, onPointerDown, pixelOf, tool, drawing, objects, selection, selectionLocked]
  );
  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      if (frame.status !== 'ready' || exporting) return;
      onPointerMove(event);
      // §4.1 line 160: moving restores the plain hint after a copy result.
      setCopyState((current) => (current === 'idle' ? current : 'idle'));
      if (!editing) return;
      const pixel = pixelOf(event);
      if (!pixel) return;
      // Both are no-ops unless they own a gesture, so the move is routed by what
      // actually started rather than by the current tool. Routing by the tool was
      // wrong: grabbing an object switches the tool, and the switch lands a render
      // later than this event, so the first few pixels of the drag went nowhere.
      objects.onPointerMove(pixel);
      drawing.onPointerMove(pixel);
      // The pointer is over something draggable: a committed object, or the capture
      // rectangle itself while it is still adjustable.
      const region = state.selection;
      const insideSelection =
        !selectionLocked &&
        region !== null &&
        pixel.x >= region.x &&
        pixel.y >= region.y &&
        pixel.x < region.x + region.width &&
        pixel.y < region.y + region.height;
      const target: PointerTarget =
        hitTestAnnotations(doc.objects, pixel) !== null
          ? 'object'
          : insideSelection
            ? 'selection'
            : 'none';
      setPointerTarget((current) => (current === target ? current : target));
      // The grip the press would grab, so the cursor names the axis before the
      // drag rather than after it.
      const handle = objects.handleAt(pixel);
      setHoveredHandle((current) => (current === handle ? current : handle));
    },
    [
      frame.status,
      exporting,
      editing,
      onPointerMove,
      pixelOf,
      drawing,
      objects,
      doc.objects,
      state.selection,
      selectionLocked
    ]
  );
  const handleUp = useCallback(
    (event: React.PointerEvent) => {
      if (frame.status !== 'ready' || exporting) return;
      // The selection's own release always runs: while editing it finishes a move or
      // resize of the capture rectangle, and does nothing when no such gesture is
      // in progress. The other two are idempotent in the same way, so the release
      // reaches whichever one owns the gesture without consulting the tool.
      onPointerUp();
      if (editing) {
        objects.onPointerUp();
        drawing.onPointerUp();
      }
      if (
        typeof event.pointerId === 'number' &&
        event.currentTarget.hasPointerCapture?.(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [frame.status, exporting, editing, onPointerUp, drawing, objects]
  );

  // §4 of the 2026-09-30 amendment: one interruption undoes exactly one layer of
  // uncommitted work, and an object transform is such a layer.
  const cancelCurrentGesture = useCallback(() => {
    if (drawing.cancelDraft()) return true;
    if (objects.cancelMove()) return true;
    return selection.cancelGesture();
  }, [drawing, objects, selection]);

  useEffect(() => {
    const rollback = () => {
      if (!exporting) cancelCurrentGesture();
    };
    window.addEventListener('blur', rollback);
    return () => window.removeEventListener('blur', rollback);
  }, [cancelCurrentGesture, exporting]);

  // §7: every key has one owner, and the dispatcher decides which. This applies
  // the result; it does not re-decide priority.
  const applyKey = useCallback(
    (action: KeyAction) => {
      const bounds = box ? { x: 0, y: 0, width: box.frameWidth, height: box.frameHeight } : null;
      const mutatesEditor = ![
        'cancelSession',
        'copyImageAndFinish',
        'savePng',
        'copyHex'
      ].includes(action.type);
      if (exporting && mutatesEditor) return;

      switch (action.type) {
        case 'cancelSession':
          void invoke('cancel_screen_capture').catch((error: unknown) => {
            // The window is about to be destroyed on success, so only a rejection
            // is worth reporting, and only to the log.
            console.error('failed to cancel the capture session', error);
          });
          return;
        case 'undo':
          setDoc(undo(doc));
          return;
        case 'redo':
          setDoc(redo(doc));
          return;
        case 'dismissTool':
          setTool('select');
          return;
        case 'cancelDraft':
          cancelCurrentGesture();
          return;
        case 'cancelTextEdit':
          // Whichever editor is open: a new object's, or a committed object's.
          if (drawing.state.pendingText) drawing.cancelText();
          else objects.cancelTextEdit();
          return;
        case 'deselectObject':
          objects.deselect();
          return;
        case 'deleteObject':
          objects.deleteSelected();
          return;
        case 'moveObject':
          objects.nudge(action.dx, action.dy);
          return;
        case 'editSelectedText':
          objects.beginTextEditOfSelection();
          return;
        case 'savePng':
          void exporter.save();
          return;
        case 'copyImageAndFinish':
          void exporter.copy();
          return;
        case 'moveSelection':
          if (state.selection && bounds && !selectionLocked) {
            setSelection(moveSelection(state.selection, action.dx, action.dy, bounds));
          }
          return;
        case 'resizeSelection':
          if (state.selection && bounds && !selectionLocked) {
            // The bottom-right handle, so Alt+arrow grows and shrinks from the
            // corner the size readout describes.
            setSelection(resizeSelection(state.selection, 'se', action.dx, action.dy, bounds));
          }
          return;
        case 'copyHex': {
          // §4.1 line 157: Rust samples the frozen frame, so the copied value is the
          // base image's own pixel rather than one re-derived from a canvas.
          const at = pointerPixelRef.current;
          if (!at) return;
          void invoke<boolean>('copy_capture_color', toVirtualDesktop(at, displayOrigin))
            .then((copied) => {
              // A desktop gap reports false: §4.1 line 159 leaves the clipboard alone,
              // so the hint must not claim a colour was copied.
              setCopyState(copied ? 'copied' : 'idle');
            })
            .catch(() => setCopyState('failed'));
          return;
        }
        default:
          // copyImageAndFinish, savePng and the scroll actions belong to 03-output and
          // 04-scroll. The scroll ones stay inert rather than pretending to have
          // captured something.
          return;
      }
    },
    // `state.pointerPixel` belongs here: `copyHex` reads it, and leaving it out closed
    // this callback over a `state` from before the pointer moved, so the copy always saw
    // a null pixel and silently did nothing.
    [
      doc,
      box,
      state.selection,
      state.pointerPixel,
      setSelection,
      drawing,
      objects,
      exporter,
      exporting,
      selectionLocked,
      cancelCurrentGesture,
      displayOrigin
    ]
  );

  useCaptureKeyboard(
    {
      phase: editing ? 'editing' : 'aiming',
      saveDialogOpen: false,
      // The hook merges the event's own isComposing, which is the only reliable
      // source for an unfinished composition.
      composing: false,
      textEditing:
        drawing.state.pendingText !== null || objects.state.editingText !== null,
      popoverOpen: false,
      draftInProgress:
        state.phase === 'dragging' ||
        state.transforming ||
        drawing.state.draft !== null ||
        objects.state.moving !== null,
      // Only kinds the dispatcher branches on, so Enter can re-enter text editing
      // without the dispatcher knowing the annotation model.
      selectedObject: selectedObject
        ? { id: selectedObject.id, kind: selectedObject.kind === 'text' ? 'text' : 'other' }
        : null,
      focus: 'canvas',
      annotationCount: doc.objects.length,
      toolActive: tool !== 'select'
    },
    applyKey
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (frame.status !== 'ready' || exporting) return;
      if (drawing.state.pendingText) {
        drawing.cancelText();
        return;
      }
      if (objects.state.editingText) {
        objects.cancelTextEdit();
        return;
      }
      if (cancelCurrentGesture()) return;
      // §4 of the amendment: the selected object is dismissed before the tool, and
      // the tool before the selection, so one right-click undoes one layer.
      if (objects.deselect()) return;
      if (tool !== 'select') {
        setTool('select');
        return;
      }
      if (state.selection && doc.objects.length === 0) {
        selection.reset();
        return;
      }
      if (state.phase === 'aiming') {
        void invoke('cancel_screen_capture').catch((error: unknown) => {
          console.error('failed to cancel the capture session', error);
        });
      }
    },
    [
      frame.status,
      exporting,
      drawing,
      objects,
      cancelCurrentGesture,
      doc,
      tool,
      state.selection,
      state.phase,
      selection
    ]
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (frame.status !== 'ready' || exporting || !editing || !box || !state.selection) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.screenshot-toolbar-anchor, .screenshot-text-editor') !== null
      ) {
        return;
      }
      const pixel = pointerToFramePixel({ x: event.clientX, y: event.clientY }, box);
      if (!pixel) return;
      // §6 of the amendment: a double-click on a text object re-edits that object,
      // and only an empty-area double-click finishes the capture. Checked in that
      // order, so re-editing text can never also copy the image.
      if (objects.beginTextEdit(pixel)) return;
      // A double-click on any other object selects it rather than finishing: the
      // user aimed at a shape, so exporting would be a surprise.
      if (hitTestAnnotations(doc.objects, pixel)) return;
      const region = state.selection;
      if (
        pixel.x >= region.x &&
        pixel.y >= region.y &&
        pixel.x < region.x + region.width &&
        pixel.y < region.y + region.height
      ) {
        void exporter.copy();
      }
    },
    [frame.status, exporting, editing, box, state.selection, doc, objects, exporter]
  );

  // The surface is the only thing that can show a cursor, so it shows the one the
  // next press would act on rather than a fixed crosshair.
  const cursor = cursorFor({
    ready: frame.status === 'ready',
    exporting,
    phase: state.phase,
    tool,
    transforming: state.transforming,
    movingObject: objects.state.moving !== null,
    // A drag keeps the grip it started on: `hoveredHandle` is recomputed from the
    // pointer, which has usually left the grip by the second frame of the drag.
    handle: objects.state.draggingHandle ?? hoveredHandle,
    over: pointerTarget
  });

  return (
    <main
      className={`screenshot-overlay${rect ? ' screenshot-overlay--editing' : ''}`}
      style={{ cursor }}
      aria-label={t('screenshot.overlayLabel')}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={() => cancelCurrentGesture()}
      onLostPointerCapture={() => cancelCurrentGesture()}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      {frame.status === 'decoding' || frame.status === 'ready' ? (
        <img
          ref={frameRef}
          className="screenshot-overlay__frame"
          src={frame.frame.src}
          crossOrigin="anonymous"
          width={frame.frame.width}
          height={frame.frame.height}
          // Decorative: it is the captured desktop, described by the region's own
          // label rather than by alt text that would be read as content.
          alt=""
          draggable={false}
          onLoad={(event) => {
            void frame.onFrameLoad(event.currentTarget);
          }}
          onError={frame.onFrameError}
        />
      ) : (
        <p className="screenshot-overlay__note">
          {frame.status === 'failed'
            ? t('screenshot.overlayFailed')
            : t('screenshot.overlayPending')}
        </p>
      )}
      {/* §4.2 masks the non-selection area, and before the first drag the whole frame
          is non-selection. Without this the overlay is a pixel-identical copy of the
          desktop: the bar hides, nothing else changes, and the session looks like it
          did nothing at all. The selection layer takes the mask over from the moment
          a rectangle exists, so the two never stack. */}
      {frame.status === 'ready' && !rect ? (
        <div className="screenshot-overlay__aim-dim" aria-hidden="true" />
      ) : null}
      {/* §5.3: real mosaic pixels, rendered by the same `mosaic.rs` that renders the
          export, laid over the frozen frame at the selection's position. It sits
          below the annotation layer so shapes drawn after a mosaic stay visible, and
          below the selection border so the border is not covered. */}
      {mosaicPreview.url && box && state.selection ? (
        <img
          className="screenshot-overlay__mosaic"
          src={mosaicPreview.url}
          style={(() => {
            const css = framePixelToCss(state.selection, box);
            return { left: css.left, top: css.top, width: css.width, height: css.height };
          })()}
          alt=""
          draggable={false}
        />
      ) : null}
      {rect && box ? (
        <>
          <SelectionLayer
            rect={rect}
            box={box}
            // §4.2: the handles exist while the rectangle is still adjustable, which
            // is until the first annotation locks it. The aiming draft gets none,
            // because there is nothing committed to resize yet.
            onResizeStart={
              committed && !selectionLocked
                ? (handle, event) => {
                    const pixel = pixelOf(event);
                    if (!pixel) return;
                    if (
                      selection.beginResize(handle, pixel) &&
                      typeof event.pointerId === 'number' &&
                      event.currentTarget.setPointerCapture
                    ) {
                      // The handle is 8px: without capture the pointer leaves it on
                      // the first move and the resize stops after a pixel.
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }
                  }
                : undefined
            }
          />
          <SelectionSize rect={rect} box={box} />
        </>
      ) : null}
      {editing && box && state.selection ? (
        <AnnotationLayer
          // The draft joins the committed objects for display only, so an
          // in-progress shape is visible without entering the history. A dragged
          // object is substituted the same way, so the move is visible before it is
          // committed on release.
          objects={visibleObjects}
          // Chrome only: the id is never written into the document, so undo cannot
          // bring a selection back and the export cannot contain one.
          selectedId={objects.state.selectedId}
          selection={state.selection}
          box={box}
          svgRef={annotationRef}
        />
      ) : null}
      {/* §4.2 line 166: the magnifier shows while aiming and dragging, and is
          hidden once the selection is committed and the toolbar appears. */}
      {box && state.phase !== 'editing' ? (
        <Magnifier
          pixel={state.pointerPixel}
          pointer={pointerCss}
          box={box}
          image={frameRef.current}
          copyState={copyState}
        />
      ) : null}
      {editing && box && state.selection && drawing.state.pendingText ? (
        <TextEditor
          // Keyed by the pending object, so a press that opens an editor somewhere
          // else mounts a fresh, focused one. Without it React reused the same
          // textarea: its content state survived while only its position changed,
          // so the previous note appeared to teleport to the click instead of
          // staying where it was typed.
          key={drawing.state.pendingText.id}
          at={drawing.state.pendingText}
          selection={state.selection}
          box={box}
          color={drawing.state.pendingText.color}
          fontSize={drawing.state.pendingText.fontSize}
          initialContent={drawing.state.pendingText.initialContent}
          onDraftChange={(content) => {
            textDraft.current = content;
          }}
          onCommit={(content) => {
            textDraft.current = null;
            drawing.commitText(content);
          }}
          onCancel={() => {
            textDraft.current = null;
            drawing.cancelText();
          }}
        />
      ) : null}
      {/* Re-editing a committed text object. The same control as a new one, keyed by
          the object's id so switching objects remounts it with the right seed text
          instead of keeping the previous object's draft. */}
      {editing && box && state.selection && objects.state.editingText ? (
        <TextEditor
          key={objects.state.editingText.id}
          at={objects.state.editingText}
          selection={state.selection}
          box={box}
          color={objects.state.editingText.color}
          fontSize={objects.state.editingText.fontSize}
          initialContent={objects.state.editingText.initialContent}
          onDraftChange={(content) => {
            textDraft.current = content;
          }}
          onCommit={(content) => {
            textDraft.current = null;
            objects.commitTextEdit(content);
          }}
          onCancel={() => {
            textDraft.current = null;
            objects.cancelTextEdit();
          }}
        />
      ) : null}
      {committed ? (
        <div
          ref={measureToolbar}
          className="screenshot-toolbar-anchor"
          // The toolbar is a child of the capture surface, so without this a click
          // on a button also runs the canvas handler: with the select tool that
          // hit-tests where the button is, misses, and clears the selection the
          // user was about to act on.
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          style={
            toolbarAt
              ? { left: toolbarAt.left, top: toolbarAt.top }
              : // Before the first measurement, keep it off-screen rather than
                // flashing at the wrong place.
                { left: 0, top: 0, visibility: 'hidden' }
          }
        >
          <ScreenshotToolbar
            activeTool={tool}
            onSelectTool={setTool}
            onAction={(action: ActionId) => {
              // Undo and redo are local to the document. Copy runs the real export;
              // save belongs to the rest of 03-output and stays inert rather than
              // pretending to succeed.
              if (action === 'undo') setDoc(undo(doc));
              else if (action === 'redo') setDoc(redo(doc));
              else if (action === 'done') void exporter.copy();
              else if (action === 'save') void exporter.save();
              else if (action === 'cancel') {
                void invoke('cancel_screen_capture').catch((error: unknown) => {
                  console.error('failed to cancel the capture session', error);
                });
              }
            }}
            state={{
              selectionCrossesDisplays: false,
              annotationCount: doc.objects.length,
              baseImageIsLong: false,
              captureTargetUnavailable: false,
              canUndo: canUndo(doc),
              canRedo: canRedo(doc),
              exporting: exporter.state.status === 'copying' || exporter.state.status === 'saving'
            }}
          />
          {/* §5.2's fixed value sets, as discrete choices. Selected object first: the rows
              then edit it rather than the next shape's defaults. */}
          <PropertyPanel
            kind={propertyKind}
            properties={panelProperties}
            onChange={(row, value) => {
              if (exporting) return;
              // A selected object is restyled in place, as one undo step. Only when
              // nothing is selected does the change mean "the next shape".
              if (objects.restyleSelected(row, value)) return;
              // Not an edit, so it must not enter the undo history.
              setProperties((current) =>
                withProperty(
                  current,
                  row === 'blockSize' ? 'mosaicBlockSize' : row === 'fill' ? 'filled' : row,
                  value as never
                )
              );
            }}
          />
          {/* §8.1/§2.3: a static line beside the controls. Never a toast, banner or
              spinner, and the failure keeps the session so the user can retry. */}
          {exporter.state.status === 'copying' ? (
            <p className="screenshot-export-status">{t('screenshot.export.copying')}</p>
          ) : null}
          {exporter.state.status === 'saving' ? (
            <p className="screenshot-export-status">{t('screenshot.export.saving')}</p>
          ) : null}
          {exporter.state.status === 'failed' ? (
            <p className="screenshot-export-status screenshot-export-status--failed" role="alert">
              {/* A Rust rejection carries its own localised message, phrased per
                  §8.3 as a category and a next step. A local failure has no such
                  message, so a localised fallback is used rather than English. */}
              {exporter.state.message ?? t(exporter.state.fallbackKey ?? 'screenshot.export.copyFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
