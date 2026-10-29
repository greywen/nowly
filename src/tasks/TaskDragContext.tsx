import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// Shares a matrix task drag with the kanban board so the task can be dropped
// into a lane. Board-internal drags stay local to the board.
type TaskDragValue = {
  matrixTaskId: string | null;
  startMatrixDrag(taskId: string): void;
  endMatrixDrag(): void;
};

const inert: TaskDragValue = {
  matrixTaskId: null,
  startMatrixDrag: () => undefined,
  endMatrixDrag: () => undefined
};

const TaskDragContext = createContext<TaskDragValue>(inert);

export function TaskDragProvider({ children }: { children: ReactNode }) {
  const [matrixTaskId, setMatrixTaskId] = useState<string | null>(null);
  const value = useMemo<TaskDragValue>(() => ({
    matrixTaskId,
    startMatrixDrag: setMatrixTaskId,
    endMatrixDrag: () => setMatrixTaskId(null)
  }), [matrixTaskId]);
  return <TaskDragContext.Provider value={value}>{children}</TaskDragContext.Provider>;
}

// Outside a provider (isolated widget tests) cross-module drags are inert.
export function useTaskDrag() {
  return useContext(TaskDragContext);
}
