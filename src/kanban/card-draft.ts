import type { KanbanCard, KanbanCardDraft } from './kanban-model';

// The editable form shape for a card. Uses '' for the empty date / priority so
// native controls stay controlled; converted back to null on submit.
export type CardFormDraft = {
  title: string;
  description: string;
  dueDate: string;
  priorityId: string;
  tagIds: string[];
  collaboratorIds: string[];
};

export type CardFieldErrors = Partial<Record<'title' | 'dueDate', string>>;

export function createCardForm(): CardFormDraft {
  return { title: '', description: '', dueDate: '', priorityId: '', tagIds: [], collaboratorIds: [] };
}

export function cardToForm(card: KanbanCard): CardFormDraft {
  return {
    title: card.title,
    description: card.description ?? '',
    dueDate: card.dueDate ?? '',
    priorityId: card.priorityId ?? '',
    tagIds: [...card.tagIds],
    collaboratorIds: [...card.collaboratorIds]
  };
}

// Build the repository draft from a form. laneId is supplied by the caller
// because a card's lane is decided by where it is created / already lives, not
// by a form field.
export function toCardDraft(form: CardFormDraft, laneId: string): KanbanCardDraft {
  return {
    laneId,
    title: form.title.trim(),
    description: form.description.trim() ? form.description.trim() : null,
    dueDate: form.dueDate || null,
    priorityId: form.priorityId || null,
    tagIds: [...form.tagIds],
    collaboratorIds: [...form.collaboratorIds]
  };
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function validateCardForm(form: CardFormDraft): CardFieldErrors {
  if (!form.title.trim()) return { title: '请输入任务标题。' };
  if (form.dueDate && !validDate(form.dueDate)) return { dueDate: '请选择有效截止日期。' };
  return {};
}

export function isCardFormDirty(initial: CardFormDraft, current: CardFormDraft) {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
