import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../data/nowly-repository';
import { SettingsDialog } from './SettingsDialog';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockRejectedValue(new Error('unsupported')) }));

const settings:AppSettings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,iconStyle:'duotone',hideTopbarInWallpaper:true};

describe('SettingsDialog',()=>{
  it('provides default screenshot recorders and saves both shortcuts', async () => {
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }));
    const capture = screen.getByRole('textbox', { name: '截图快捷键' });
    expect(capture).toHaveValue('Ctrl+Alt+A');
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

  it('configures the Nowly Bar app buttons and saves them with the document',async()=>{
    const user=userEvent.setup(); const save=vi.fn().mockImplementation(async value=>value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    await user.click(screen.getByRole('tab',{name:'Nowly Bar'}));
    await user.click(screen.getByRole('button',{name:'添加应用按钮到第 1 个位置'}));
    await user.click(screen.getByRole('menuitemradio',{name:/截屏/}));
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({barButtons:['screenshot']}));
  });
});
