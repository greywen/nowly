import type {
  KanbanCard,
  KanbanCollaborator,
  KanbanLane,
  KanbanPriority,
  KanbanSnapshot,
  KanbanTag
} from './kanban-model';
import { cardsInLane } from './kanban-model';
import { t } from '../i18n';

// A card enriched with the resolved global fields it references, so the view
// can render names / colors without repeatedly looking them up by id.
export type ResolvedCard = {
  card: KanbanCard;
  priority: KanbanPriority | null;
  tags: KanbanTag[];
  collaborators: KanbanCollaborator[];
};

export function resolveCard(card: KanbanCard, snapshot: KanbanSnapshot): ResolvedCard {
  const priority = card.priorityId
    ? snapshot.priorities.find((item) => item.id === card.priorityId) ?? null
    : null;
  const tags = card.tagIds
    .map((id) => snapshot.tags.find((tag) => tag.id === id))
    .filter((tag): tag is KanbanTag => tag !== undefined);
  const collaborators = card.collaboratorIds
    .map((id) => snapshot.collaborators.find((person) => person.id === id))
    .filter((person): person is KanbanCollaborator => person !== undefined);
  return { card, priority, tags, collaborators };
}

// Total number of cards across every lane, shown in the module header.
export function totalCardCount(snapshot: KanbanSnapshot): number {
  return snapshot.cards.length;
}

// The preset color tokens map straight onto CSS modifier suffixes, so this is
// an identity today, but keeping it as a function documents the seam and lets
// the palette evolve without touching every component.
export function colorClass(color: string): string {
  return color;
}

// Human-friendly due date, e.g. "7 月 23 日" or "今天" when it matches today.
export function formatDueDate(dueDate: string, todayIso: string): string {
  if (dueDate === todayIso) return t('kanbanDue.today');
  const month = Number(dueDate.slice(5, 7));
  const day = Number(dueDate.slice(8, 10));
  if (!month || !day) return dueDate;
  return t('kanbanDue.monthDay', { month, day });
}

// The lane order as ids, used as the base for keyboard "move left / right".
export function laneOrder(snapshot: KanbanSnapshot): string[] {
  return snapshot.lanes.map((lane) => lane.id);
}

// Produce the reordered lane id list after moving `laneId` by `delta` (-1 left,
// +1 right). Returns null when the move is out of bounds.
export function laneOrderAfterMove(
  snapshot: KanbanSnapshot,
  laneId: string,
  delta: number
): string[] | null {
  const order = laneOrder(snapshot);
  const index = order.indexOf(laneId);
  if (index < 0) return null;
  const target = index + delta;
  if (target < 0 || target >= order.length) return null;
  const next = [...order];
  const [removed] = next.splice(index, 1);
  next.splice(target, 0, removed);
  return next;
}

// The index a card currently occupies within its lane.
export function cardIndexInLane(snapshot: KanbanSnapshot, card: KanbanCard): number {
  return cardsInLane(snapshot.cards, card.laneId).findIndex((item) => item.id === card.id);
}

// How many cards a lane holds, used in delete confirmations and counts.
export function laneCardCount(snapshot: KanbanSnapshot, laneId: string): number {
  return snapshot.cards.filter((card) => card.laneId === laneId).length;
}

// How many cards reference a given priority / tag / collaborator, shown before
// deleting a global field so the user understands the impact.
export function priorityUsage(snapshot: KanbanSnapshot, priorityId: string): number {
  return snapshot.cards.filter((card) => card.priorityId === priorityId).length;
}

export function tagUsage(snapshot: KanbanSnapshot, tagId: string): number {
  return snapshot.cards.filter((card) => card.tagIds.includes(tagId)).length;
}

export function collaboratorUsage(snapshot: KanbanSnapshot, collaboratorId: string): number {
  return snapshot.cards.filter((card) => card.collaboratorIds.includes(collaboratorId)).length;
}

// The neighbouring lane id in a direction, or null at the boundary. Used to
// enable / disable the keyboard "move to left / right lane" card actions.
export function adjacentLaneId(
  lanes: KanbanLane[],
  laneId: string,
  delta: number
): string | null {
  const index = lanes.findIndex((lane) => lane.id === laneId);
  if (index < 0) return null;
  const target = index + delta;
  if (target < 0 || target >= lanes.length) return null;
  return lanes[target].id;
}
