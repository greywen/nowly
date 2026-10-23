import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR_MENU, barMenuGroupOf, groupBarMenu, moveBarMenuItem, normalizeBarMenu, quickCreateKindOf } from './bar-menu';

const legacyMenu = [
  { id: 'screenshot', visible: true },
  { id: 'screenshotHistory', visible: true },
  { id: 'assistant', visible: true }
];
const createItems = [
  { id: 'createEvent', visible: true },
  { id: 'createTask', visible: true },
  { id: 'createNote', visible: true }
];

describe('normalizeBarMenu', () => {
  it('defaults to the capture features followed by the quick-create features, all visible', () => {
    expect(normalizeBarMenu(undefined)).toEqual([...legacyMenu, ...createItems]);
    expect(normalizeBarMenu(null)).toEqual(DEFAULT_BAR_MENU);
  });
  it('appends the quick-create features to a stored legacy menu', () => {
    expect(normalizeBarMenu([
      { id: 'screenshotHistory', visible: false }, { id: 'screenshot', visible: true }, { id: 'assistant', visible: true }
    ])).toEqual([
      { id: 'screenshotHistory', visible: false }, { id: 'screenshot', visible: true }, { id: 'assistant', visible: true },
      ...createItems
    ]);
  });
  it('retains order and hidden items without mutating input', () => {
    const menu = [
      { id: 'createNote', visible: false }, { id: 'assistant', visible: false }, { id: 'screenshot', visible: false },
      { id: 'createEvent', visible: true }, { id: 'screenshotHistory', visible: true }, { id: 'createTask', visible: true }
    ];
    expect(normalizeBarMenu(menu)).toEqual(menu);
    expect(normalizeBarMenu(menu)).not.toBe(menu);
  });
  it('drops unknown and duplicate IDs and appends missing features', () => {
    expect(normalizeBarMenu([
      { id: 'assistant', visible: false }, { id: 'unknown', visible: true },
      { id: 'assistant', visible: true }, { id: 'screenshot', visible: false }
    ])).toEqual([
      { id: 'assistant', visible: false }, { id: 'screenshot', visible: false },
      { id: 'screenshotHistory', visible: true }, ...createItems
    ]);
  });
  it('recovers malformed entries and defaults invalid visibility to visible', () => {
    expect(normalizeBarMenu([null, 'screenshot', { id: 'assistant', visible: 'no' }])).toEqual([
      { id: 'assistant', visible: true }, { id: 'screenshot', visible: true },
      { id: 'screenshotHistory', visible: true }, ...createItems
    ]);
    expect(normalizeBarMenu({})).toEqual(DEFAULT_BAR_MENU);
  });
});

describe('bar menu groups', () => {
  it('assigns every feature to a fixed group', () => {
    expect(barMenuGroupOf('createEvent')).toBe('create');
    expect(barMenuGroupOf('createTask')).toBe('create');
    expect(barMenuGroupOf('createNote')).toBe('create');
    expect(barMenuGroupOf('screenshot')).toBe('capture');
    expect(barMenuGroupOf('screenshotHistory')).toBe('capture');
    expect(barMenuGroupOf('assistant')).toBe('capture');
  });
  it('lists the create group first and keeps the stored order inside each group', () => {
    const menu = normalizeBarMenu([
      { id: 'screenshotHistory', visible: true }, { id: 'createNote', visible: true },
      { id: 'screenshot', visible: false }, { id: 'createEvent', visible: true }
    ]);
    expect(groupBarMenu(menu, item => item.visible && item.id !== 'assistant')).toEqual([
      { id: 'create', items: [{ id: 'createNote', visible: true }, { id: 'createEvent', visible: true }, { id: 'createTask', visible: true }] },
      { id: 'capture', items: [{ id: 'screenshotHistory', visible: true }] }
    ]);
  });
  it('maps quick-create features to their window kind', () => {
    expect(quickCreateKindOf('createEvent')).toBe('event');
    expect(quickCreateKindOf('createTask')).toBe('task');
    expect(quickCreateKindOf('createNote')).toBe('note');
    expect(quickCreateKindOf('screenshot')).toBeNull();
  });
});

describe('moveBarMenuItem', () => {
  const menu = normalizeBarMenu(undefined);
  const ids = (items: ReturnType<typeof normalizeBarMenu>) => items.map(item => item.id);
  it('swaps an item with its neighbour inside the same group only', () => {
    expect(ids(moveBarMenuItem(menu, 'createTask', -1))).toEqual([
      'screenshot', 'screenshotHistory', 'assistant', 'createTask', 'createEvent', 'createNote'
    ]);
    expect(ids(moveBarMenuItem(menu, 'screenshot', 1))).toEqual([
      'screenshotHistory', 'screenshot', 'assistant', 'createEvent', 'createTask', 'createNote'
    ]);
  });
  it('does not move past the group edges or over excluded features', () => {
    expect(moveBarMenuItem(menu, 'createEvent', -1)).toEqual(menu);
    expect(moveBarMenuItem(menu, 'createNote', 1)).toEqual(menu);
    expect(moveBarMenuItem(menu, 'screenshotHistory', 1, new Set(['assistant']))).toEqual(menu);
  });
  it('returns a new list without mutating the input', () => {
    const before = menu.map(item => ({ ...item }));
    expect(moveBarMenuItem(menu, 'createTask', 1)).not.toBe(menu);
    expect(menu).toEqual(before);
  });
});
