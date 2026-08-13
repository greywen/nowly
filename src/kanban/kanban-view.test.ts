import { describe, expect, it } from 'vitest';
import type { KanbanCard, KanbanLane, KanbanSnapshot } from './kanban-model';
import {
  adjacentLaneId,
  cardIndexInLane,
  collaboratorUsage,
  formatDueDate,
  laneCardCount,
  laneOrderAfterMove,
  priorityUsage,
  resolveCard,
  tagUsage,
  totalCardCount
} from './kanban-view';

function lane(id: string, position: number): KanbanLane {
  return { id, name: id, color: 'primary', position, createdAt: 'x', updatedAt: 'x' };
}

function card(id: string, laneId: string, position: number, extra: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id, laneId, title: id, description: null, dueDate: null, priorityId: null,
    position, tagIds: [], collaboratorIds: [], createdAt: 'x', updatedAt: 'x', ...extra
  };
}

const snapshot: KanbanSnapshot = {
  lanes: [lane('a', 0), lane('b', 1), lane('c', 2)],
  cards: [
    card('c1', 'a', 0, { priorityId: 'p1', tagIds: ['t1', 't2'], collaboratorIds: ['u1'] }),
    card('c2', 'a', 1, { priorityId: 'p1' }),
    card('c3', 'b', 0, { tagIds: ['t1'] })
  ],
  priorities: [{ id: 'p1', name: '高', color: 'danger', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [
    { id: 't1', name: '前端', color: 'primary', createdAt: 'x', updatedAt: 'x' },
    { id: 't2', name: '设计', color: 'info', createdAt: 'x', updatedAt: 'x' }
  ],
  collaborators: [{ id: 'u1', name: '小明', createdAt: 'x', updatedAt: 'x' }]
};

describe('kanban view helpers', () => {
  it('resolves a card to its priority, tags, and collaborators', () => {
    const resolved = resolveCard(snapshot.cards[0], snapshot);
    expect(resolved.priority?.name).toBe('高');
    expect(resolved.tags.map((t) => t.name)).toEqual(['前端', '设计']);
    expect(resolved.collaborators.map((c) => c.name)).toEqual(['小明']);
  });

  it('drops references to fields that no longer exist', () => {
    const resolved = resolveCard(card('x', 'a', 0, { priorityId: 'gone', tagIds: ['gone'], collaboratorIds: ['gone'] }), snapshot);
    expect(resolved.priority).toBeNull();
    expect(resolved.tags).toEqual([]);
    expect(resolved.collaborators).toEqual([]);
  });

  it('counts total cards', () => {
    expect(totalCardCount(snapshot)).toBe(3);
  });

  it('formats due dates and recognizes today', () => {
    expect(formatDueDate('2026-07-23', '2026-07-23')).toBe('今天到期');
    expect(formatDueDate('2026-07-23', '2026-07-24')).toBe('7 月 23 日');
  });

  it('computes lane order after keyboard moves and rejects out-of-bounds', () => {
    expect(laneOrderAfterMove(snapshot, 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(laneOrderAfterMove(snapshot, 'c', 1)).toBeNull();
    expect(laneOrderAfterMove(snapshot, 'a', -1)).toBeNull();
  });

  it('finds a card index within its lane', () => {
    expect(cardIndexInLane(snapshot, snapshot.cards[1])).toBe(1);
  });

  it('counts lane cards and field usage', () => {
    expect(laneCardCount(snapshot, 'a')).toBe(2);
    expect(priorityUsage(snapshot, 'p1')).toBe(2);
    expect(tagUsage(snapshot, 't1')).toBe(2);
    expect(collaboratorUsage(snapshot, 'u1')).toBe(1);
  });

  it('resolves adjacent lanes and boundaries', () => {
    expect(adjacentLaneId(snapshot.lanes, 'a', -1)).toBeNull();
    expect(adjacentLaneId(snapshot.lanes, 'a', 1)).toBe('b');
    expect(adjacentLaneId(snapshot.lanes, 'c', 1)).toBeNull();
  });
});
