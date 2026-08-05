import { GripVertical } from 'lucide-react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import type { WidgetDefinition } from '../../widgets/widget-registry';

type ModuleFrameProps = {
  definition: WidgetDefinition;
  editing: boolean;
  children: ReactNode;
  style?: CSSProperties;
  isInvalid?: boolean;
  isDragging?: boolean;
  onMovePointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onResizePointerDown?: (event: PointerEvent<HTMLElement>) => void;
};

export function ModuleFrame({
  definition,
  editing,
  children,
  style,
  isInvalid = false,
  isDragging = false,
  onMovePointerDown,
  onResizePointerDown
}: ModuleFrameProps) {
  const className = [
    'card',
    'module-frame',
    editing ? 'is-editing' : '',
    isInvalid ? 'is-invalid' : '',
    isDragging ? 'is-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className} style={style} data-testid="module-frame" data-widget-id={definition.id}>
      {editing ? (
        <div className="module-frame__toolbar">
          <span
            className="module-frame__handle"
            data-testid="module-frame-handle"
            aria-hidden="true"
            onPointerDown={onMovePointerDown}
          >
            <GripVertical />
          </span>
          <span className="module-frame__title">{definition.name}</span>
        </div>
      ) : null}
      <div className="module-frame__body">
        {children}
        {editing ? (
          <div className="module-frame__overlay" data-testid="module-frame-overlay" />
        ) : null}
      </div>
      {editing ? (
        <span
          className="module-frame__resize"
          data-testid="module-frame-resize"
          aria-hidden="true"
          onPointerDown={onResizePointerDown}
        />
      ) : null}
    </section>
  );
}
