import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../data/nowly-repository';
import { SettingsDialog } from './SettingsDialog';

const settings:AppSettings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,iconStyle:'duotone',hideTopbarInWallpaper:true};

describe('SettingsDialog',()=>{
  it('records a shortcut in its own settings tab and preserves the draft on conflict', async () => {
    const save = vi.fn().mockRejectedValue({ message: '快捷键已被占用，请更换组合。' });
    const close = vi.fn();
    render(<SettingsDialog settings={settings} onClose={close} onSave={save}/>);
    fireEvent.click(screen.getByRole('tab', { name: '快捷窗口' }));
    const field = screen.getByRole('textbox', { name: '快捷窗口快捷键' });
    expect(field).toHaveValue('Ctrl+Space');
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true });
    expect(field).toHaveValue('Ctrl+Shift+K');
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('快捷键已被占用');
    expect(close).not.toHaveBeenCalled();
    expect(field).toHaveValue('Ctrl+Shift+K');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ quickPanelShortcut: 'Ctrl+Shift+K', quickPanelEnabled: true }));
  });
  it('rejects unmodified letter shortcuts and can disable the quick window', async () => {
    const save = vi.fn(async value => value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    fireEvent.click(screen.getByRole('tab', { name: '快捷窗口' }));
    const field = screen.getByRole('textbox', { name: '快捷窗口快捷键' });
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK' });
    expect(field).toHaveValue('Ctrl+Space');
    expect(screen.getByRole('alert')).toHaveTextContent('Ctrl');
    fireEvent.click(screen.getByRole('checkbox', { name: '启用快捷窗口' }));
    expect(field).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ quickPanelEnabled: false }));
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
});
