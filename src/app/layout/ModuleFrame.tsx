import { GripVertical } from 'lucide-react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { getPreset, type WidgetDefinition, type WidgetId } from '../../widgets/widget-registry';

type ModuleFrameProps = {
  definition: WidgetDefinition;
  presetId: string;
  editing: boolean;
  onCyclePreset: (id: WidgetId) => void;
  children: ReactNode;
  style?: CSSProperties;
  isDropTarget?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLElement>) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
};

export function ModuleFrame({
  definition,
  presetId,
  editing,
  onCyclePreset,
  children,
  style,
  isDropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: ModuleFrameProps) {
  const preset = getPreset(definition.id, presetId) ?? definition.presets[0];
  const className = `card module-frame${editing ? ' is-editing' : ''}${isDropTarget ? ' is-drop-target' : ''}`;

  return (
    <section
      className={className}
      style={style}
      draggable={editing}
      onDragStart={editing ? onDragStart : undefined}
      onDragEnd={editing ? onDragEnd : undefined}
      onDragOver={editing ? onDragOver : undefined}
      onDragLeave={editing ? onDragLeave : undefined}
      onDrop={editing ? onDrop : undefined}
    >
      {editing ? (
        <div className="module-frame__toolbar">
          <span className="module-frame__handle" data-testid="module-frame-handle" aria-hidden="true">
            <GripVertical />
          </span>
          <span className="module-frame__title">{definition.name}</span>
          <button
            type="button"
            className="btn btn-icon module-frame__size"
            aria-label={`切换${definition.name}尺寸`}
            onClick={() => onCyclePreset(definition.id)}
          >
            {preset.label}
          </button>
        </div>
      ) : null}
      <div className="module-frame__body">{children}</div>
      {editing ? <div className="module-frame__overlay" data-testid="module-frame-overlay" /> : null}
    </section>
  );
}
