import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../data/nowly-repository';
import { SettingsDialog } from './SettingsDialog';

const settings:AppSettings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,calendarEnabled:true,matrixEnabled:true,notesEnabled:true};

describe('SettingsDialog',()=>{
  it('edits a copied draft and saves the complete document',async()=>{
    const user=userEvent.setup(); const save=vi.fn().mockImplementation(async value=>value);
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={save}/>);
    expect(screen.getByRole('dialog',{name:'设置'})).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox',{name:'显示周末'}));
    expect(settings.showWeekends).toBe(true);
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({showWeekends:false}));
  });

  it('retains the dialog and reports save failures',async()=>{
    const user=userEvent.setup();
    render(<SettingsDialog settings={settings} onClose={vi.fn()} onSave={vi.fn().mockRejectedValue({message:'设置保存失败'})}/>);
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('设置保存失败');
    expect(screen.getByRole('dialog',{name:'设置'})).toBeInTheDocument();
  });
});
