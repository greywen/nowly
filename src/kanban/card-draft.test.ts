import { describe, expect, it } from 'vitest';
import type { KanbanCard } from './kanban-model';
import {
  cardToForm,
  createCardForm,
  isCardFormDirty,
  toCardDraft,
  validateCardForm
} from './card-draft';

const card: KanbanCard = {
  id: 'c1',
  laneId: 'lane-a',
  title: '写文档',
  description: '细节说明',
  dueDate: '2026-08-12',
  priorityId: 'p1',
  position: 0,
  tagIds: ['t1', 't2'],
  collaboratorIds: ['u1'],
  createdAt: 'x',
  updatedAt: 'x'
};

describe('card-draft', () => {
  it('creates an empty form with no selected optional fields', () => {
    expect(createCardForm()).toEqual({
      title: '',
      description: '',
      dueDate: '',
      priorityId: '',
      tagIds: [],
      collaboratorIds: []
    });
  });

  it('maps a card to a form and back to a draft with the given lane', () => {
    const form = cardToForm(card);
    expect(form.priorityId).toBe('p1');
    expect(form.tagIds).toEqual(['t1', 't2']);
    const draft = toCardDraft(form, 'lane-b');
    expect(draft.laneId).toBe('lane-b');
    expect(draft.title).toBe('写文档');
    expect(draft.description).toBe('细节说明');
    expect(draft.dueDate).toBe('2026-08-12');
    expect(draft.priorityId).toBe('p1');
    expect(draft.collaboratorIds).toEqual(['u1']);
  });

  it('normalizes empty optional fields to null', () => {
    const draft = toCardDraft({ ...createCardForm(), title: '  待办  ' }, 'lane-a');
    expect(draft.title).toBe('待办');
    expect(draft.description).toBeNull();
    expect(draft.dueDate).toBeNull();
    expect(draft.priorityId).toBeNull();
    expect(draft.tagIds).toEqual([]);
    expect(draft.collaboratorIds).toEqual([]);
  });

  it('requires a title and validates the due date', () => {
    expect(validateCardForm(createCardForm())).toEqual({ title: '请输入任务标题。' });
    expect(validateCardForm({ ...createCardForm(), title: '待办', dueDate: '2026-13-40' })).toEqual({
      dueDate: '请选择有效截止日期。'
    });
    expect(validateCardForm({ ...createCardForm(), title: '待办' })).toEqual({});
  });

  it('detects dirty forms', () => {
    const form = cardToForm(card);
    expect(isCardFormDirty(form, form)).toBe(false);
    expect(isCardFormDirty(form, { ...form, title: '改了' })).toBe(true);
  });
});
