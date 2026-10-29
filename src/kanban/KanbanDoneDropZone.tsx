import type { DragEvent } from 'react';
import { Check } from '../components/icons';
import { t } from '../i18n';

type KanbanDoneDropZoneProps = {
  active: boolean;
  // Set briefly after a drop. `solid` is the reduced-motion confirmation.
  confirmation: { title: string; solid: boolean } | null;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragLeave(): void;
  onDrop(event: DragEvent<HTMLElement>): void;
};

// Floats over the bottom of the board only while a board card is dragged, so
// completion never takes up a lane.
export function KanbanDoneDropZone({ active, confirmation, onDragOver, onDragLeave, onDrop }: KanbanDoneDropZoneProps) {
  const solid = confirmation?.solid ?? false;
  return (
    <div
      className={`kanban-done-drop${active ? ' kanban-done-drop--over' : ''}${solid ? ' kanban-done-drop--solid' : ''}`}
      data-testid="kanban-done-drop"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Check aria-hidden="true" />
      <span>{solid && confirmation ? t('kanbanDone.dropped', { title: confirmation.title }) : t('kanbanDone.dropZone')}</span>
    </div>
  );
}
