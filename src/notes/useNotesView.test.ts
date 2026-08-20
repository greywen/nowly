import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTES_VIEW, NOTES_VIEW_STORAGE_KEY, useNotesView } from './useNotesView';

describe('useNotesView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts on the list view when nothing is stored', () => {
    const { result } = renderHook(() => useNotesView());
    expect(result.current.view).toBe(DEFAULT_NOTES_VIEW);
    expect(DEFAULT_NOTES_VIEW).toBe('list');
  });

  it('persists the selected view', () => {
    const { result } = renderHook(() => useNotesView());

    act(() => result.current.setView('board'));
    expect(result.current.view).toBe('board');
    expect(localStorage.getItem(NOTES_VIEW_STORAGE_KEY)).toBe('board');
  });

  it('restores a stored view on mount', () => {
    localStorage.setItem(NOTES_VIEW_STORAGE_KEY, 'board');
    const { result } = renderHook(() => useNotesView());
    expect(result.current.view).toBe('board');
  });

  it('falls back to the default for unknown stored values', () => {
    localStorage.setItem(NOTES_VIEW_STORAGE_KEY, 'gallery');
    const { result } = renderHook(() => useNotesView());
    expect(result.current.view).toBe(DEFAULT_NOTES_VIEW);
  });
});
