// Kanban module domain types. Colors are stored as canonical HEX values; lanes
// represent status, so cards have no independent completion flag.
import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';

export type KanbanColor = HexColor;
export const kanbanColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.info, label: '靛蓝' },
  { value: DESIGN_COLORS.warning, label: '暖黄' },
  { value: DESIGN_COLORS.danger, label: '珊瑚红' }
];
export const DEFAULT_KANBAN_COLOR = DESIGN_COLORS.primary;
export const kanbanColors = kanbanColorPresets.map(({ value }) => value) as readonly KanbanColor[];
export const kanbanColorLabels = Object.fromEntries(kanbanColorPresets.map((preset) => [preset.value, preset.label])) as Record<KanbanColor, string>;

export type KanbanLane = {
  id: string;
  name: string;
  color: KanbanColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type KanbanLaneDraft = {
  name: string;
  color: KanbanColor;
};

export type KanbanCard = {
  id: string;
  laneId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priorityId: string | null;
  position: number;
  tagIds: string[];
  collaboratorIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type KanbanCardDraft = {
  laneId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priorityId: string | null;
  tagIds: string[];
  collaboratorIds: string[];
};

export type KanbanPriority = {
  id: string;
  name: string;
  color: KanbanColor;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type KanbanPriorityDraft = {
  name: string;
  color: KanbanColor;
};

export type KanbanTag = {
  id: string;
  name: string;
  color: KanbanColor;
  createdAt: string;
  updatedAt: string;
};

export type KanbanTagDraft = {
  name: string;
  color: KanbanColor;
};

export type KanbanCollaborator = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type KanbanCollaboratorDraft = {
  name: string;
};

export type KanbanSnapshot = {
  lanes: KanbanLane[];
  cards: KanbanCard[];
  priorities: KanbanPriority[];
  tags: KanbanTag[];
  collaborators: KanbanCollaborator[];
};

// Sort a snapshot so lanes and the cards within each lane follow their stored
// position, giving a deterministic order for rendering and tests.
export function sortSnapshot(snapshot: KanbanSnapshot): KanbanSnapshot {
  const lanes = [...snapshot.lanes].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const lanePosition = new Map(lanes.map((lane, index) => [lane.id, index]));
  const cards = [...snapshot.cards].sort(
    (a, b) =>
      (lanePosition.get(a.laneId) ?? 0) - (lanePosition.get(b.laneId) ?? 0) ||
      a.position - b.position ||
      a.id.localeCompare(b.id)
  );
  const priorities = [...snapshot.priorities].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id)
  );
  return { ...snapshot, lanes, cards, priorities };
}

// Cards belonging to one lane in position order.
export function cardsInLane(cards: KanbanCard[], laneId: string): KanbanCard[] {
  return cards
    .filter((card) => card.laneId === laneId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}
