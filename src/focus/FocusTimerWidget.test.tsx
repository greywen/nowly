import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {setLanguage} from '../i18n';
import {FocusTimerWidget} from './FocusTimerWidget';

const api=vi.hoisted(()=>({state:{status:'idle',plannedSeconds:1500},remainingSeconds:1500,focusedSeconds:0,statistics:{status:'ready',data:{totalFocusedSeconds:3600,completedCount:2,interruptedCount:1,completionRate:.66,points:[{period:'2026-08-14',focusedSeconds:3600,completedCount:2,interruptedCount:1}]}},start:vi.fn(),pause:vi.fn(),resume:vi.fn(),interrupt:vi.fn()}));
vi.mock('./FocusTimerContext',()=>({useFocusTimer:()=>api}));

beforeEach(()=>{setLanguage('zh');vi.clearAllMocks()});
afterEach(()=>setLanguage('zh'));

describe('FocusTimerWidget',()=>{
  it('renders a simplified foreground card with icon-only secondary actions',()=>{
    render(<FocusTimerWidget mode="foreground" onOpenStatistics={vi.fn()}/>);
    expect(screen.getByText('25:00')).toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'专注计时'})).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'查看统计'})).toHaveTextContent('');
    expect(screen.getByRole('button',{name:'重置计时'})).toHaveTextContent('');
    expect(screen.queryByRole('button',{name:'全屏专注'})).not.toBeInTheDocument();
    expect(screen.queryByText('近 7 天分钟')).not.toBeInTheDocument();
  });

  it('starts the selected preset and opens statistics',async()=>{
    const user=userEvent.setup();const open=vi.fn();
    render(<FocusTimerWidget mode="foreground" onOpenStatistics={open}/>);
    await user.click(screen.getByRole('button',{name:'15 分钟'}));
    await user.click(screen.getByRole('button',{name:'开始专注'}));
    expect(api.start).toHaveBeenCalledWith(15);
    await user.click(screen.getByRole('button',{name:'查看统计'}));
    expect(open).toHaveBeenCalled();
  });

  it('renders wallpaper mode as read-only countdown and guidance',()=>{
    render(<FocusTimerWidget mode="wallpaper" onOpenStatistics={vi.fn()}/>);
    expect(screen.getByRole('timer')).toHaveTextContent('25:00');
    expect(screen.getByText('双击返回前台以操作专注计时')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('localizes controls and custom duration validation in English',async()=>{
    setLanguage('en');const user=userEvent.setup();
    render(<FocusTimerWidget mode="foreground" onOpenStatistics={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'View statistics'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Reset timer'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Start focus'})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Custom'}));
    const input=screen.getByLabelText('Custom minutes');
    await user.type(input,'721');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 720 minutes.');
  });
});
