import { useState, type DragEvent, type ReactNode } from 'react';
import { getPreset, getWidgetDefinition, type WidgetId } from '../../widgets/widget-registry';
import { ModuleFrame } from './ModuleFrame';

export type ModuleGridItem = {
  id: WidgetId;
  presetId: string;
  content: ReactNode;
};

type ModuleGridProps = {
  items: ModuleGridItem[];
  editing: boolean;
  onReorder: (fromId: WidgetId, toId: WidgetId) => void;
  onCyclePreset: (id: WidgetId) => void;
};

export function ModuleGrid({ items, editing, onReorder, onCyclePreset }: ModuleGridProps) {
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null);
  const [targetId, setTargetId] = useState<WidgetId | null>(null);

  function handleDragStart(id: WidgetId) {
    setDraggingId(id);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setTargetId(null);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, id: WidgetId) {
    if (draggingId === null) return;
    event.preventDefault();
    if (id !== targetId) setTargetId(id);
  }

  function handleDrop(id: WidgetId) {
    if (draggingId !== null && draggingId !== id) {
      onReorder(draggingId, id);
    }
    setDraggingId(null);
    setTargetId(null);
  }

  return (
    <div className="module-grid" data-testid="module-grid">
      {items.map((item) => {
        const definition = getWidgetDefinition(item.id);
        if (!definition) return null;
        const preset = getPreset(item.id, item.presetId) ?? definition.presets[0];
        return (
          <ModuleFrame
            key={item.id}
            definition={definition}
            presetId={item.presetId}
            editing={editing}
            onCyclePreset={onCyclePreset}
            style={{ gridColumn: `span ${preset.cols}`, gridRow: `span ${preset.rows}` }}
            isDropTarget={editing && targetId === item.id && draggingId !== item.id}
            onDragStart={() => handleDragStart(item.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(event) => handleDragOver(event, item.id)}
            onDragLeave={() => setTargetId((current) => (current === item.id ? null : current))}
            onDrop={() => handleDrop(item.id)}
          >
            {item.content}
          </ModuleFrame>
        );
      })}
    </div>
  );
}
