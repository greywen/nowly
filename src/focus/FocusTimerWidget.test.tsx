import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { FocusTimerWidget } from './FocusTimerWidget';

const api=vi.hoisted(()=>({state:{status:'idle',plannedSeconds:1500},remainingSeconds:1500,focusedSeconds:0,statistics:{status:'ready',data:{totalFocusedSeconds:3600,completedCount:2,interruptedCount:1,completionRate:.66,points:[{period:'2026-08-14',focusedSeconds:3600,completedCount:2,interruptedCount:1}]}},start:vi.fn(),pause:vi.fn(),resume:vi.fn(),interrupt:vi.fn(),enterFullscreen:vi.fn()}));
vi.mock('./FocusTimerContext',()=>({useFocusTimer:()=>api}));

describe('FocusTimerWidget',()=>{
 it('shows presets, total minutes and an accessible trend',()=>{render(<FocusTimerWidget onOpenStatistics={vi.fn()}/>);expect(screen.getByText('25:00')).toBeInTheDocument();expect(screen.getByText('60')).toBeInTheDocument();expect(screen.getByRole('img',{name:/近 7 天专注趋势/})).toBeInTheDocument();expect(screen.getByRole('button',{name:'全屏专注'})).toBeDisabled()});
 it('starts the selected preset and opens statistics',async()=>{const user=userEvent.setup();const open=vi.fn();render(<FocusTimerWidget onOpenStatistics={open}/>);await user.click(screen.getByRole('button',{name:'15 分钟'}));await user.click(screen.getByRole('button',{name:'开始专注'}));expect(api.start).toHaveBeenCalledWith(15);await user.click(screen.getByRole('button',{name:'查看统计'}));expect(open).toHaveBeenCalled()});
 it('accepts custom whole minutes from 1 through 720',async()=>{const user=userEvent.setup();render(<FocusTimerWidget onOpenStatistics={vi.fn()}/>);await user.click(screen.getByRole('button',{name:'自定义'}));const input=screen.getByLabelText('自定义分钟数');await user.clear(input);await user.type(input,'721');expect(screen.getByRole('alert')).toHaveTextContent('1–720');await user.clear(input);await user.type(input,'45');await user.click(screen.getByRole('button',{name:'使用此时长'}));await user.click(screen.getByRole('button',{name:'开始专注'}));expect(api.start).toHaveBeenCalledWith(45)});
});
