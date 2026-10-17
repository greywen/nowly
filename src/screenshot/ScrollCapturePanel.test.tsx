import { render,screen,fireEvent } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import { ScrollCapturePanel } from './ScrollCapturePanel';
describe('manual scroll controls',()=>{
 it('requires explicit start and instructs the user to scroll manually',()=>{
 const command=vi.fn();render(<ScrollCapturePanel state={{sessionId:'1',revision:1,phase:'prepare',width:300,height:0,reason:null}} command={command} />);
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'开始采集'}));expect(command).toHaveBeenCalledWith('start');
 expect(screen.getByText(/手动向下滚动/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'开始自动向下滚动'})).not.toBeInTheDocument();
 });
 it('does not require choosing an automatic wheel injection point',()=>{
 render(<ScrollCapturePanel state={{sessionId:'1',revision:1,phase:'prepare',width:300,height:0,reason:null,point:[150,100],region:{x:0,y:0,width:300,height:200}}} command={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:'滚动点 25%'})).not.toBeInTheDocument();
 });
 it('waits for the initial frame before asking the user to scroll',()=>{
 const {rerender}=render(<ScrollCapturePanel state={{sessionId:'1',revision:1,phase:'capturing',width:300,height:0,reason:null}} command={vi.fn()}/>);
 expect(screen.getByRole('status')).toHaveTextContent('正在采集首帧');
 rerender(<ScrollCapturePanel state={{sessionId:'1',revision:2,phase:'capturing',width:300,height:200,reason:null}} command={vi.fn()}/>);
 expect(screen.getByRole('status')).toHaveTextContent('请在原窗口内缓慢向下滚动');
 expect(screen.getByRole('button',{name:'完成并审核'})).toBeEnabled();
 });
 it('renders review zoom and seam markers outside image output',()=>{
 render(<ScrollCapturePanel state={{sessionId:'1',revision:4,phase:'review',width:300,height:800,reason:'Stopped',seams:[300]}} command={vi.fn()} preview="blob:preview"/>);
 expect(screen.getByRole('combobox',{name:'审核缩放'})).toBeInTheDocument();expect(screen.getByTitle('接缝 300')).toBeInTheDocument();expect(screen.getByRole('button',{name:'使用长图'})).toBeInTheDocument();
 });
 it('labels abnormal results as partial and retains discard',()=>{
 const command=vi.fn();render(<ScrollCapturePanel state={{sessionId:'1',revision:4,phase:'review',width:300,height:800,reason:'Target changed'}} command={command} />);
 fireEvent.click(screen.getByRole('button',{name:'使用已截部分'}));expect(command).toHaveBeenCalledWith('adopt');
 expect(screen.getByRole('button',{name:'放弃长图，返回原截图'})).toBeInTheDocument();
 });
});
