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
    render(<ShortcutRecorder id="capture" label="Capture" value="Ctrl+Alt+A" otherValues={['Ctrl+Alt+H', '', 'ctrl+alt+n']} onChange={change}/>);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'h', code: 'KeyH', ctrlKey: true, altKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent('快捷键不能与其他快捷键重复');
    fireEvent.keyDown(input, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent('快捷键不能与其他快捷键重复');
    expect(change).not.toHaveBeenCalled();
  });
  it('keeps required recorders without a clear action or empty placeholder', () => {
    render(<ShortcutRecorder id="capture" label="Capture" value="Ctrl+Alt+A" onChange={vi.fn()}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Capture' })).not.toHaveAttribute('placeholder');
  });
  it('shows an unset optional shortcut and clears a set one', () => {
    const change = vi.fn();
    const { rerender } = render(<ShortcutRecorder id="note" label="新建便签" value="" optional onChange={change}/>);
    expect(screen.getByRole('textbox', { name: '新建便签' })).toHaveAttribute('placeholder', '未设置');
    expect(screen.getByRole('button', { name: '清除「新建便签」快捷键' })).toBeDisabled();
    rerender(<ShortcutRecorder id="note" label="新建便签" value="Ctrl+Alt+N" optional onChange={change}/>);
    fireEvent.click(screen.getByRole('button', { name: '清除「新建便签」快捷键' }));
    expect(change).toHaveBeenLastCalledWith('');
    change.mockClear();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '新建便签' }), { key: 'Backspace', code: 'Backspace' });
    expect(change).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('treats Backspace as an invalid binding for a required shortcut', () => {
    const change = vi.fn();
    render(<ShortcutRecorder id="capture" label="Capture" value="Ctrl+Alt+A" onChange={change}/>);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Capture' }), { key: 'Backspace', code: 'Backspace' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
});
