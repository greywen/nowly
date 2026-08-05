import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  GRID_COLS,
  GRID_ROWS,
  canPlace,
  clampToBounds,
  getWidgetDefinition,
  type LayoutState,
  type Rect,
  type WidgetId
} from '../../widgets/widget-registry';
import { ModuleFrame } from './ModuleFrame';

export type ModuleGridItem = {
  id: WidgetId;
  rect: Rect;
  content: ReactNode;
};

type ModuleGridProps = {
  items: ModuleGridItem[];
  editing: boolean;
  onMove: (id: WidgetId, position: { x: number; y: number }) => void;
  onResize: (id: WidgetId, size: { w: number; h: number }) => void;
};

type DragMode = 'move' | 'resize';

type DragState = {
  mode: DragMode;
  id: WidgetId;
  startX: number;
  startY: number;
  origin: Rect;
  draft: Rect;
  valid: boolean;
};

export function ModuleGrid({ items, editing, onMove, onResize }: ModuleGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Layout the grid currently reasons about — only the modules on screen.
  const layout: LayoutState = items.map((item) => ({ id: item.id, ...item.rect }));

  function cellStride() {
    const box = gridRef.current?.getBoundingClientRect();
    const width = box?.width ?? 0;
    const height = box?.height ?? 0;
    return {
      col: width > 0 ? width / GRID_COLS : 1,
      row: height > 0 ? height / GRID_ROWS : 1
    };
  }

  function beginDrag(mode: DragMode, id: WidgetId, event: PointerEvent<HTMLElement>) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    gridRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({
      mode,
      id,
      startX: event.clientX,
      startY: event.clientY,
      origin: item.rect,
      draft: item.rect,
      valid: true
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const stride = cellStride();
    const deltaCol = Math.round((event.clientX - drag.startX) / stride.col);
    const deltaRow = Math.round((event.clientY - drag.startY) / stride.row);

    let draft: Rect;
    if (drag.mode === 'move') {
      draft = clampToBounds({
        x: drag.origin.x + deltaCol,
        y: drag.origin.y + deltaRow,
        w: drag.origin.w,
        h: drag.origin.h
      });
    } else {
      const w = Math.min(Math.max(drag.origin.w + deltaCol, 1), GRID_COLS - drag.origin.x);
      const h = Math.min(Math.max(drag.origin.h + deltaRow, 1), GRID_ROWS - drag.origin.y);
      draft = { x: drag.origin.x, y: drag.origin.y, w, h };
    }

    const valid = canPlace(layout, drag.id, draft);
    setDrag((current) => (current ? { ...current, draft, valid } : current));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    gridRef.current?.releasePointerCapture?.(event.pointerId);
    const { mode, id, origin, draft, valid } = drag;
    setDrag(null);
    if (!valid) return;
    if (mode === 'move') {
      if (draft.x !== origin.x || draft.y !== origin.y) onMove(id, { x: draft.x, y: draft.y });
    } else if (draft.w !== origin.w || draft.h !== origin.h) {
      onResize(id, { w: draft.w, h: draft.h });
    }
  }

  return (
    <div
      className="module-grid"
      data-testid="module-grid"
      ref={gridRef}
      onPointerMove={editing ? handlePointerMove : undefined}
      onPointerUp={editing ? endDrag : undefined}
    >
      {items.map((item) => {
        const definition = getWidgetDefinition(item.id);
        if (!definition) return null;
        const isDragging = drag?.id === item.id;
        const rect = isDragging ? drag.draft : item.rect;
        return (
          <ModuleFrame
            key={item.id}
            definition={definition}
            editing={editing}
            isDragging={isDragging}
            isInvalid={isDragging && !drag.valid}
            style={{
              gridColumn: `${rect.x + 1} / span ${rect.w}`,
              gridRow: `${rect.y + 1} / span ${rect.h}`
            }}
            onMovePointerDown={(event) => beginDrag('move', item.id, event)}
            onResizePointerDown={(event) => beginDrag('resize', item.id, event)}
          >
            {item.content}
          </ModuleFrame>
        );
      })}
    </div>
  );
}
