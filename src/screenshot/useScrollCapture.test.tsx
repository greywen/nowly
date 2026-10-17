import { act,renderHook,waitFor } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { useScrollCapture } from './useScrollCapture';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),receive:null as null|((event:{payload:unknown})=>void)}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn((_event,callback)=>{mocks.receive=callback;return Promise.resolve(()=>{});})}));
afterEach(()=>vi.clearAllMocks());
const state={sessionId:'1',revision:3,phase:'capturing',width:300,height:0,reason:null};
describe('scroll lifecycle',()=>{
 it('does not send start on mount and rejects another session update',async()=>{
 mocks.invoke.mockResolvedValue(null);const {result}=renderHook(()=>useScrollCapture());expect(mocks.invoke).not.toHaveBeenCalled();
 act(()=>mocks.receive?.({payload:state}));act(()=>mocks.receive?.({payload:{...state,sessionId:'2',revision:4}}));expect(result.current.state?.sessionId).toBe('1');
 });
 it('native discard clears the original overlay scroll state',async()=>{
 mocks.invoke.mockResolvedValue(null);const {result}=renderHook(()=>useScrollCapture());act(()=>mocks.receive?.({payload:state}));act(()=>mocks.receive?.({payload:{...state,phase:'cancelled'}}));expect(result.current.state).toBeNull();
 });
 it('ignores a cancelled event belonging to another session',()=>{
 mocks.invoke.mockResolvedValue(null);const {result}=renderHook(()=>useScrollCapture());act(()=>mocks.receive?.({payload:state}));act(()=>mocks.receive?.({payload:{...state,sessionId:'2',phase:'cancelled'}}));expect(result.current.state?.sessionId).toBe('1');
 });
 it('sends explicit pause with current revision and keeps errors visible',async()=>{
 mocks.invoke.mockRejectedValue('Target changed');const {result}=renderHook(()=>useScrollCapture());act(()=>mocks.receive?.({payload:state}));await act(()=>result.current.command('pause'));expect(mocks.invoke).toHaveBeenCalledWith('scroll_capture',{action:'pause',revision:3});await waitFor(()=>expect(result.current.error).toBe('Target changed'));
 });
});
