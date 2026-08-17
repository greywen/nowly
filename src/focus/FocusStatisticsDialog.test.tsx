import{render,screen}from'@testing-library/react';
import userEvent from'@testing-library/user-event';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{setLanguage}from'../i18n';
import{FocusStatisticsDialog}from'./FocusStatisticsDialog';

const api=vi.hoisted(()=>({statistics:{status:'ready',data:{totalFocusedSeconds:5400,completedCount:3,interruptedCount:1,completionRate:.75,points:[{period:'2026-08-14',focusedSeconds:5400,completedCount:3,interruptedCount:1}]}},loadStatistics:vi.fn()}));
vi.mock('./FocusTimerContext',async(importOriginal)=>({...await importOriginal<typeof import('./FocusTimerContext')>(),useFocusTimer:()=>api}));

beforeEach(()=>{setLanguage('zh');api.statistics.status='ready';vi.clearAllMocks()});
afterEach(()=>setLanguage('zh'));

it('shows summaries and switches reporting period without charts',async()=>{
 const user=userEvent.setup();render(<FocusStatisticsDialog onClose={vi.fn()}/>);
 expect(screen.getByText('90 分钟')).toBeInTheDocument();
 expect(screen.getByText('75%')).toBeInTheDocument();
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
 expect(screen.queryByText(/青绿色折线/)).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'近 30 天'}));
 expect(api.loadStatistics).toHaveBeenCalledWith(expect.any(Array));
});

it('localizes the report in English',()=>{
 setLanguage('en');render(<FocusStatisticsDialog onClose={vi.fn()}/>);
 expect(screen.getByRole('dialog',{name:'Focus statistics'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Last 30 days'})).toBeInTheDocument();
 expect(screen.getByText('90 minutes')).toBeInTheDocument();
 expect(screen.getByText('3 completed')).toBeInTheDocument();
 expect(screen.getByText('1 interrupted')).toBeInTheDocument();
 expect(screen.getByText('75%')).toBeInTheDocument();
});

it('shows a localized retry action after a load error',async()=>{
 api.statistics.status='error';const user=userEvent.setup();render(<FocusStatisticsDialog onClose={vi.fn()}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('统计暂时无法加载');
 await user.click(screen.getByRole('button',{name:'重试'}));
 expect(api.loadStatistics).toHaveBeenCalled();
});
