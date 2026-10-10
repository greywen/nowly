import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutRecorder, normalizeShortcut } from './ShortcutRecorder';

describe('screenshot shortcut recorder', () => {
  it('normalizes modifier order and rejects unmodified or modifier-only keys', () => {
    expect(normalizeShortcut('alt+control+a')).toBe('Ctrl+Alt+A');
    expect(normalizeShortcut('A')).toBeNull();
    expect(normalizeShortcut('Ctrl+Alt')).toBeNull();
    expect(normalizeShortcut('Ctrl+Ctrl+A')).toBeNull();
  });
  it('records physical keys, prevents app actions, and ignores repeats', () => {
    const change = vi.fn();
    render(<ShortcutRecorder id="capture" label="Capture" value="Ctrl+Alt+A" onChange={change}/>);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })).toBe(false);
    expect(change).toHaveBeenCalledWith('Ctrl+Alt+H');
    change.mockClear();
    fireEvent.keyDown(input, { key: 'h', code: 'KeyH', ctrlKey: true, repeat: true });
    expect(change).not.toHaveBeenCalled();
  });
  it('reports invalid and duplicate bindings without changing the value', () => {
    const change = vi.fn();
    render(<ShortcutRecorder id="capture" label="Capture" value="Ctrl+Alt+A" otherValue="Ctrl+Alt+H" onChange={change}/>);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent('两个快捷键不能相同');
    expect(change).not.toHaveBeenCalled();
  });
});
