import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../data/nowly-repository';
import { SettingsDialog } from './SettingsDialog';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_BAR_MENU } from '../app/bar-menu';
import { t } from '../i18n';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockRejectedValue(new Error('unsupported')) }));

const settings:AppSettings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,iconStyle:'duotone',hideTopbarInWallpaper:true};

describe('SettingsDialog',()=>{
  afterEach(() => vi.restoreAllMocks());

  it('hides AI configuration and its Bar option without removing saved preferences', async () => {
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={{ ...settings, barMenu: [...DEFAULT_BAR_MENU] }} onClose={vi.fn()} onSave={save}/>);
    expect(screen.queryByRole('tab', { name: t('settings.model') })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Nowly Bar' }));
    expect(screen.queryByRole('checkbox', { name: t('barMenu.assistant') })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ barMenu: DEFAULT_BAR_MENU }));
  });

  it('groups wallpaper appearance and saves the independent background option', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    expect(screen.getByRole('group', { name: '壁纸模式外观' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: '隐藏导航栏及模块顶部栏' })).toBeChecked();
    const background = screen.getByRole('checkbox', { name: '隐藏模块背景颜色和边框' });
    expect(background).not.toBeChecked();
    await user.click(background);
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ hideTopbarInWallpaper: true, hideModuleBackgroundInWallpaper: true }));
  });

  it('only exposes sound choices and previews in the sound tab', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    await user.click(screen.getByRole('tab', { name: 'Nowly Bar' }));
    expect(screen.queryByRole('combobox', { name: t('sounds.calendar') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    expect(screen.getByRole('tabpanel', { name: t('settings.sound') })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: t('sounds.enabled') })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    for (const scene of ['calendar', 'alarm', 'missedSummary', 'focus']) {
      expect(screen.getByRole('combobox', { name: t('sounds.' + scene) })).toBeVisible();
    }
    await user.click(screen.getByRole('combobox', { name: t('sounds.calendar') }));
    expect(screen.queryByRole('option', { name: t('sounds.none') })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: t('settings.notificationMode') })).not.toBeInTheDocument();
  });

  it('restores legacy muted settings and preserves sound choice edits across tabs', async () => {
    const user = userEvent.setup();
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={{ ...settings, soundSettings: { enabled: false, volume: 0, calendar: 'none', alarm: 'beep-soft', missedSummary: 'low-knock', focus: 'done-blip' } }} onClose={vi.fn()} onSave={save}/>);
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    expect(screen.getByRole('combobox', { name: t('sounds.calendar') })).toHaveTextContent(t('sounds.chime-glass'));
    await user.click(screen.getByRole('combobox', { name: t('sounds.calendar') }));
    await user.click(screen.getByRole('option', { name: t('sounds.chime-wood') }));
    await user.click(screen.getByRole('tab', { name: 'Nowly Bar' }));
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    expect(screen.getByRole('combobox', { name: t('sounds.calendar') })).toHaveTextContent(t('sounds.chime-wood'));
    await user.click(screen.getByRole('button', { name: t('settings.saveSettings') }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ soundSettings: { enabled: true, volume: 100, calendar: 'chime-wood', alarm: 'beep-soft', missedSummary: 'low-knock', focus: 'done-blip' } }));
  });

  it('previews at system volume and stops on scene switch and tab exit', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const save = vi.fn();
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    await user.click(screen.getByRole('button', { name: t('sounds.preview') + ' · ' + t('sounds.calendar') }));
    const calendar = play.mock.contexts[0] as HTMLAudioElement;
    expect(calendar.getAttribute('src')).toBe('/sounds/chime-glass.wav');
    expect(calendar.volume).toBe(1);
    await user.click(screen.getByRole('button', { name: t('sounds.preview') + ' · ' + t('sounds.alarm') }));
    expect(pause.mock.contexts).toContain(calendar);
    await user.click(screen.getByRole('tab', { name: 'Nowly Bar' }));
    expect(pause.mock.contexts).toContain(play.mock.contexts[1]);
    expect(save).not.toHaveBeenCalled();
  });

  it('reports preview failures', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('audio output failed'));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    await user.click(screen.getByRole('button', { name: t('sounds.preview') + ' · ' + t('sounds.calendar') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('sounds.error'));
  });

  it('does not save sound edits when cancelled', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const close = vi.fn();
    render(<SettingsDialog settings={settings} onClose={close} onSave={save}/>);
    await user.click(screen.getByRole('tab', { name: t('settings.sound') }));
    await user.click(screen.getByRole('combobox', { name: t('sounds.calendar') }));
    await user.click(screen.getByRole('option', { name: t('sounds.chime-wood') }));
    await user.click(screen.getByRole('button', { name: t('common.cancel') }));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps module time settings out of the interface tab', () => {
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(screen.getByRole('tab', { name: '界面' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图标风格' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '时间设置' })).not.toBeInTheDocument();
  });
  it('provides default screenshot recorders and saves both shortcuts', async () => {
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));
    const capture = screen.getByRole('textbox', { name: '截图快捷键' });
    expect(capture).toHaveValue('Ctrl+Alt+A');
    expect(screen.getByRole('textbox', { name: '截图快捷键' })).toHaveAttribute('aria-describedby', 'settings-shortcut-hint');
    expect(screen.getByRole('textbox', { name: '截图历史快捷键' })).toHaveAttribute('aria-describedby', 'settings-shortcut-hint');
    expect(screen.getAllByText('点击输入框后按下组合键，保存后生效。')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '截图历史快捷键' })).toHaveValue('Ctrl+Alt+H');
    fireEvent.keyDown(capture, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ screenshotShortcut:'Ctrl+Shift+K', screenshotHistoryShortcut:'Ctrl+Alt+H' }));
  });
  it('displays native registration failures rather than claiming configured bindings work', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({screenshot:{shortcut:'Ctrl+Alt+A',registered:false,error:'conflict'},history:{shortcut:'Ctrl+Alt+H',registered:true,error:null}});
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    fireEvent.click(screen.getByRole('tab', { name:'快捷键' }));
    expect(await screen.findByText(/截图快捷键: Ctrl\+Alt\+A — 全局快捷键不可用/)).toBeInTheDocument();
    expect(screen.getByText(/截图历史快捷键: Ctrl\+Alt\+H — 已注册全局快捷键/)).toBeInTheDocument();
  });
  it('does not expose a separate Nowly Bar enable switch or shortcut field', async () => {
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    expect(screen.queryByRole('checkbox', { name: '启用 Nowly Bar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '快捷窗口快捷键' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ quickPanelEnabled: true }));
  });
  it('edits a copied draft and saves the complete document',async()=>{
    const user=userEvent.setup(); const save=vi.fn().mockImplementation(async value=>value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    expect(screen.getByRole('dialog',{name:'设置'})).toBeInTheDocument();
    // The interface tab is the landing tab; startup options live behind the second tab.
    expect(screen.getByRole('tab',{name:'界面'})).toHaveAttribute('aria-selected','true');
    expect(screen.queryByRole('checkbox',{name:'开机自动启动'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab',{name:'桌面与启动'}));
    await user.click(screen.getByRole('checkbox',{name:'开机自动启动'}));
    expect(settings.launchAtLogin).toBe(false);
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({launchAtLogin:true}));
  });

  it('retains the dialog and reports save failures',async()=>{
    const user=userEvent.setup();
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn().mockRejectedValue({message:'设置保存失败'})}/>);
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('设置保存失败');
    expect(screen.getByRole('dialog',{name:'设置'})).toBeInTheDocument();
  });

  it('switches the icon style between the three drawing modes',async()=>{
    const user=userEvent.setup(); const save=vi.fn().mockImplementation(async value=>value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    await user.click(screen.getByRole('combobox',{name:'图标风格'}));
    await user.click(screen.getByRole('option',{name:'线性 Outline'}));
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({iconStyle:'outline'}));
  });

  it('saves all hidden menu items with their draft order',async()=>{
    const user=userEvent.setup(); const save=vi.fn().mockImplementation(async value=>value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    await user.click(screen.getByRole('tab',{name:'Nowly Bar'}));
    for (const item of DEFAULT_BAR_MENU.filter(item=>item.id!=='assistant')) await user.click(screen.getByRole('checkbox',{name:t(`barMenu.${item.id}`)}));
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({barMenu:DEFAULT_BAR_MENU.map(item=>({...item,visible:item.id==='assistant'}))}));
  });
  it('cancels menu edits without saving or mutating the provided settings',async()=>{
    const user=userEvent.setup(); const save=vi.fn(); const close=vi.fn();
    const configured={...settings,barMenu:DEFAULT_BAR_MENU.map(item=>({...item}))};
    render(<SettingsDialog settings={configured} onClose={close} onSave={save}/>);
    await user.click(screen.getByRole('tab',{name:'Nowly Bar'}));
    await user.click(screen.getByRole('checkbox',{name:t('barMenu.screenshot')}));
    await user.click(screen.getByRole('button',{name:'取消'}));
    expect(close).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(configured.barMenu).toEqual(DEFAULT_BAR_MENU);
  });
});
