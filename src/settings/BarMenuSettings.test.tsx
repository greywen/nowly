import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';
import { BarMenuSettings } from './BarMenuSettings';
import { t } from '../i18n';

describe('BarMenuSettings', () => {
  it('toggles one feature without dropping or moving hidden items', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={DEFAULT_BAR_MENU} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('checkbox', { name: t('barMenu.screenshotHistory') }));
    expect(onChange).toHaveBeenCalledWith([
      { id: 'screenshot', visible: true }, { id: 'screenshotHistory', visible: false },
      { id: 'assistant', visible: true }
    ]);
  });
  it('moves the whole ordered list and disables boundary actions', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={DEFAULT_BAR_MENU} onChange={onChange}/>);
    const up = screen.getAllByRole('button', { name: /settings.barMenuMoveUp|上移|Move .* up/i });
    const down = screen.getAllByRole('button', { name: /settings.barMenuMoveDown|下移|Move .* down/i });
    expect(up[0]).toBeDisabled();
    expect(down).toHaveLength(2);
    expect(down[1]).toBeDisabled();
    fireEvent.click(up[1]);
    expect(onChange).toHaveBeenLastCalledWith([DEFAULT_BAR_MENU[1], DEFAULT_BAR_MENU[0], DEFAULT_BAR_MENU[2]]);
    fireEvent.click(down[0]);
    expect(onChange).toHaveBeenLastCalledWith([DEFAULT_BAR_MENU[1], DEFAULT_BAR_MENU[0], DEFAULT_BAR_MENU[2]]);
  });
  it('reorders available features while preserving the hidden AI preference', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={[DEFAULT_BAR_MENU[0], DEFAULT_BAR_MENU[2], DEFAULT_BAR_MENU[1]]} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('button', { name: t('settings.barMenuMoveUp', { feature: t('barMenu.screenshotHistory') }) }));
    expect(onChange).toHaveBeenCalledWith([DEFAULT_BAR_MENU[1], DEFAULT_BAR_MENU[2], DEFAULT_BAR_MENU[0]]);
  });
  it('allows all hidden and reveals an item at its saved position', () => {
    const onChange = vi.fn();
    const menu = [...DEFAULT_BAR_MENU].reverse().map(item => ({ ...item, visible: false }));
    render(<BarMenuSettings menu={menu} onChange={onChange}/>);
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: t('barMenu.assistant') })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: t('barMenu.screenshotHistory') }));
    expect(onChange).toHaveBeenCalledWith([menu[0], { ...menu[1], visible: true }, menu[2]]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
