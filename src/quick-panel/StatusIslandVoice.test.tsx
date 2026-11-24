import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusIslandApp } from './StatusIslandApp';
import type { NativeStatusIslandSnapshot } from './useStatusIslandSnapshot';
import type { Plan } from '../assistant/types';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const statusSnapshot: NativeStatusIslandSnapshot = {
  sampledAt: '2026-09-12T14:18',
  localDate: '2026-09-12',
  events: [],
  externalEvents: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0, sessionId: null, stageSequence: 0, stageChangedAt: null },
  reminders: [],
  notificationMode: 'persistent'
};

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', status: 'committed', createdAt: 0, expiresAt: Date.now() + 600_000, revision: 1,
    actions: [], warnings: [], options: {},
    changes: [{
      key: 'c1', kind: 'createEvent', title: '项目讨论会议', before: null,
      after: { title: '项目讨论会议', startAt: `${today()}T15:00`, endAt: `${today()}T16:00`, allDay: false }
    }],
    ...overrides
  };
}

const idle = { seq: 0, holdKey: 'Ctrl+Super', primed: false, phase: 'idle' };

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function emit(name: string, payload: unknown) {
  await flush();
  const listener = listenMock.mock.calls.find(call => call[0] === name)?.[1];
  expect(listener).toBeTypeOf('function');
  await act(async () => listener({ payload }));
}

function voiceReports() {
  return invokeMock.mock.calls.filter(call => call[0] === 'set_status_island_voice').map(call => call[1].surface);
}

function rail() {
  return document.querySelector('.status-rail')!;
}

function shownLayer() {
  return document.querySelector<HTMLElement>('.status-rail__voice[data-shown="true"]');
}

describe('voice input on the Nowly Bar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('pointer: fine'), addEventListener: vi.fn(), removeEventListener: vi.fn()
    })));
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_status_island_snapshot') return Promise.resolve(statusSnapshot);
      if (command === 'voice_state') return Promise.resolve(idle);
      if (command === 'assistant_execute') return Promise.resolve(plan());
      return Promise.resolve(null);
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('primes the Logo slot without touching geometry, then grows to listen', async () => {
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, primed: true });
    expect(rail()).toHaveAttribute('data-voice', 'primed');
    expect(rail()).not.toHaveAttribute('data-voice-anim');
    expect(shownLayer()).toBeNull();
    expect(voiceReports()).toEqual(['narrow']);

    await emit('voice-session', { ...idle, seq: 1, primed: true, phase: 'listening', transcript: '' });
    expect(rail()).toHaveAttribute('data-voice', 'wide');
    expect(rail()).toHaveAttribute('data-voice-anim', 'grow');
    expect(voiceReports()).toEqual(['narrow', 'wide']);
    expect(shownLayer()).toHaveAttribute('data-at', 'wide');
    expect(shownLayer()).toHaveTextContent('正在聆听…');
    expect(shownLayer()).toHaveTextContent('松开 Ctrl+Win 结束');
    expect(document.querySelector('.status-rail__header')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('.voice-wave__bars > span')).toHaveLength(12);
  });

  it('collapses onto the capsule slots with undo, and narrows the clip only after the shrink', async () => {
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, seq: 1, primed: true, phase: 'interpreting', transcript: '今天下午三点安排一个项目讨论会议' });
    expect(shownLayer()).toHaveTextContent('正在理解 · 0s');
    await emit('voice-session', { ...idle, seq: 1, phase: 'created', transcript: 't', plan: plan() });
    expect(rail()).toHaveAttribute('data-voice', 'narrow');
    expect(rail()).toHaveAttribute('data-voice-anim', 'shrink');
    expect(shownLayer()).toHaveAttribute('data-at', 'narrow');
    expect(shownLayer()).toHaveTextContent('项目讨论会议');
    expect(shownLayer()).toHaveTextContent('已创建 · 今天 15:00–16:00');
    expect(voiceReports()).toEqual(['wide']);
    await act(async () => { vi.advanceTimersByTime(239); });
    expect(voiceReports()).toEqual(['wide']);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(voiceReports()).toEqual(['wide', 'narrow']);

    fireEvent.click(screen.getByRole('button', { name: '撤销创建：项目讨论会议' }));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('assistant_undo', { planId: 'plan-1' });
    expect(shownLayer()).toHaveTextContent('已撤销');
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect(invokeMock).toHaveBeenCalledWith('voice_dismiss');
  });

  it('pauses the 30 second undo window under the pointer', async () => {
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, seq: 1, phase: 'created', transcript: 't', plan: plan() });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    fireEvent.pointerEnter(document.querySelector('.screen-status-island-root')!);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(invokeMock).not.toHaveBeenCalledWith('voice_dismiss');
    fireEvent.pointerLeave(document.querySelector('.screen-status-island-root')!);
    await act(async () => { vi.advanceTimersByTime(9_999); });
    expect(invokeMock).not.toHaveBeenCalledWith('voice_dismiss');
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(invokeMock).toHaveBeenCalledWith('voice_dismiss');
  });

  it('asks before changing data and commits only on confirm', async () => {
    const pending = plan({
      status: 'pending',
      changes: [{
        key: 'c1', kind: 'updateEvent', title: '项目讨论会议',
        before: { startAt: `${today()}T15:00` }, after: { startAt: `${today()}T16:00` }
      }]
    });
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, seq: 2, phase: 'confirm', transcript: 't', plan: pending });
    expect(shownLayer()).toHaveTextContent('修改 项目讨论会议');
    expect(shownLayer()).toHaveTextContent('15:00 → 16:00');
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(invokeMock).not.toHaveBeenCalledWith('voice_dismiss');
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('assistant_execute', { planId: 'plan-1' });
    expect(shownLayer()).toHaveTextContent('已创建 · 今天 15:00–16:00');
  });

  it('cancels a pending change and offers the way out of an error', async () => {
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, seq: 3, phase: 'confirm', transcript: 't', plan: plan({ status: 'pending' }) });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('assistant_cancel_plan', { planId: 'plan-1' });
    expect(invokeMock).toHaveBeenCalledWith('voice_dismiss');

    await emit('voice-session', { ...idle, seq: 4, phase: 'error', kind: 'modelMissing', message: '', transcript: '' });
    expect(rail()).toHaveAttribute('data-voice', 'wide');
    expect(shownLayer()).toHaveTextContent('语音模型未下载');
    fireEvent.click(screen.getByRole('button', { name: '下载模型' }));
    expect(invokeMock).toHaveBeenCalledWith('voice_open_settings', { section: 'voice' });
  });

  it('lets an empty recording go after three seconds', async () => {
    render(<StatusIslandApp />);
    await emit('voice-session', { ...idle, seq: 5, phase: 'error', kind: 'empty', message: '', transcript: '' });
    expect(shownLayer()).toHaveTextContent('没有听清');
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(invokeMock).toHaveBeenCalledWith('voice_dismiss');
  });
});
