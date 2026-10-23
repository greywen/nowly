import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';
import { BarMenuSettings } from './BarMenuSettings';
import { t } from '../i18n';

const [screenshot, history, assistant, createEvent, createTask, createNote] = DEFAULT_BAR_MENU;
const checkboxNames = (group: HTMLElement) =>
  within(group).getAllByRole('checkbox').map(input => input.closest('label')?.textContent);

describe('BarMenuSettings', () => {
  it('lists the quick-create group before the capture group', () => {
    render(<BarMenuSettings menu={DEFAULT_BAR_MENU} onChange={vi.fn()}/>);
    const create = screen.getByRole('group', { name: t('barMenu.groupCreate') });
    const capture = screen.getByRole('group', { name: t('barMenu.groupCapture') });
    expect(checkboxNames(create)).toEqual(['日程', '四象限任务', '便签']);
    expect(checkboxNames(capture)).toEqual(['截图', '截图历史']);
    expect(create.compareDocumentPosition(capture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('toggles one feature without dropping or moving hidden items', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={DEFAULT_BAR_MENU} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('checkbox', { name: t('barMenu.screenshotHistory') }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_BAR_MENU.map(item =>
      item.id === 'screenshotHistory' ? { ...item, visible: false } : item));
  });
  it('moves items only within their group and disables each group boundary', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={DEFAULT_BAR_MENU} onChange={onChange}/>);
    const up = (feature: string) => screen.getByRole('button', { name: t('settings.barMenuMoveUp', { feature }) });
    const down = (feature: string) => screen.getByRole('button', { name: t('settings.barMenuMoveDown', { feature }) });
    expect(up('日程')).toBeDisabled();
    expect(down('便签')).toBeDisabled();
    expect(up('截图')).toBeDisabled();
    expect(down('截图历史')).toBeDisabled();
    expect(down('日程')).toBeEnabled();
    fireEvent.click(up('四象限任务'));
    expect(onChange).toHaveBeenLastCalledWith([screenshot, history, assistant, createTask, createEvent, createNote]);
    fireEvent.click(down('截图'));
    expect(onChange).toHaveBeenLastCalledWith([history, screenshot, assistant, createEvent, createTask, createNote]);
  });
  it('reorders available features while preserving the hidden AI preference', () => {
    const onChange = vi.fn();
    render(<BarMenuSettings menu={[screenshot, assistant, history, createEvent, createTask, createNote]} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('button', { name: t('settings.barMenuMoveUp', { feature: t('barMenu.screenshotHistory') }) }));
    expect(onChange).toHaveBeenCalledWith([history, assistant, screenshot, createEvent, createTask, createNote]);
  });
  it('allows all hidden and reveals an item at its saved position', () => {
    const onChange = vi.fn();
    const menu = [...DEFAULT_BAR_MENU].reverse().map(item => ({ ...item, visible: false }));
    render(<BarMenuSettings menu={menu} onChange={onChange}/>);
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: t('barMenu.assistant') })).not.toBeInTheDocument();
    expect(checkboxNames(screen.getByRole('group', { name: t('barMenu.groupCreate') }))).toEqual(['便签', '四象限任务', '日程']);
    fireEvent.click(screen.getByRole('checkbox', { name: t('barMenu.screenshotHistory') }));
    expect(onChange).toHaveBeenCalledWith(menu.map(item => item.id === 'screenshotHistory' ? { ...item, visible: true } : item));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
