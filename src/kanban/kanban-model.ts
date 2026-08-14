// Kanban module domain types. Colors are stored as canonical HEX values; lanes
// represent status, so cards have no independent completion flag.
import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
import { t } from '../i18n';

export type KanbanColor = HexColor;

// Static value list (labels omitted) for logic that only needs the colors:
// preset detection, default selection, type derivation. Kept language-free so
// it stays a stable module constant.
const kanbanColorValues = [
  { value: DESIGN_COLORS.primary, labelKey: 'color.teal' },
  { value: DESIGN_COLORS.success, labelKey: 'color.green' },
  { value: DESIGN_COLORS.info, labelKey: 'color.indigo' },
  { value: DESIGN_COLORS.warning, labelKey: 'color.amber' },
  { value: DESIGN_COLORS.danger, labelKey: 'color.coral' }
] as const;

// Language-aware presets. Reads the active language at call time.
export function kanbanColorPresets(): readonly ColorPreset[] {
  return kanbanColorValues.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
}
export const DEFAULT_KANBAN_COLOR = DESIGN_COLORS.primary;
export const kanbanColors = kanbanColorValues.map(({ value }) => value) as readonly KanbanColor[];

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
