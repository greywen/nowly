import type { RefObject } from 'react';
import { KanbanFieldManagerDialog } from '../kanban/KanbanFieldManagerDialog';
import { useTaskWorkspace } from './TaskWorkspaceContext';
import { kanbanSnapshotFromWorkspace } from './task-projections';

export function TaskSettingsDialog({
  onClose,
  restoreFocusRef,
  recentColors = [],
  onRememberCustomColor
}: {
  onClose(): void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  recentColors?: string[];
  onRememberCustomColor?: (color: string) => Promise<void> | void;
}) {
  const workspace = useTaskWorkspace();
  const snapshot = kanbanSnapshotFromWorkspace(workspace.workspace.data);

  return (
    <KanbanFieldManagerDialog
      snapshot={snapshot}
      linkingEnabled={workspace.workspace.data.linkingEnabled}
      onSetLinking={workspace.setTaskViewLinking}
      fixedPrioritiesReadOnly
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
      createPriority={async () => { throw new Error('Fixed priorities cannot be created.'); }}
      updatePriority={async () => { throw new Error('Fixed priorities cannot be changed.'); }}
      deletePriority={async () => { throw new Error('Fixed priorities cannot be deleted.'); }}
      reorderPriorities={async () => snapshot.priorities}
      createTag={workspace.createTag}
      updateTag={workspace.updateTag}
      deleteTag={workspace.deleteTag}
      createCollaborator={workspace.createCollaborator}
      updateCollaborator={workspace.updateCollaborator}
      deleteCollaborator={workspace.deleteCollaborator}
      recentColors={recentColors}
      onRememberCustomColor={onRememberCustomColor}
    />
  );
}
