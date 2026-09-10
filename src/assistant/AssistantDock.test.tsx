import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantDock } from './AssistantDock';
import { historyCount } from './AssistantHistory';
import type { AssistantClient, AssistantConfig, InterpretRequest, Plan, Reply } from './types';

const config: AssistantConfig = { endpoint: 'https://example.com/v1', model: 'fixture-model', hasKey: true, permissions: { calendar: true, tasks: true, external: false } };
function plan(id = 'plan-1'): Plan {
  return {
    id, status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 300000, revision: 1,
    actions: [{ kind: 'createEvent', draft: { title: '早会', startAt: '2026-09-09T08:00', reminders: [0] } }],
    changes: [{ key: 'calendar:fixture:', kind: 'createEvent', title: '早会', before: null, after: {
      id: 'fixture', title: '早会', startAt: '2026-09-09T08:00', endAt: '2026-09-09T09:00', allDay: false,
      category: 'work', color: '#4fc9da', note: '', reminders: [0], linkedTaskId: null,
      seriesId: null, occurrenceStartAt: null, startTz: 'Asia/Shanghai', endTz: 'Asia/Shanghai'
    } }], warnings: ['仅修改本地数据；确认前不会提交。'], options: {}
  };
}
function clientFixture() {
  const p = plan();
  return {
    getConfig: vi.fn(async () => config), saveConfig: vi.fn(async () => config),
    interpret: vi.fn(async (_request: InterpretRequest): Promise<Reply> => ({ kind: 'plan', message: '检查预览', records: [], plan: p })),
    cancelRequest: vi.fn(async () => {}), cancelPlan: vi.fn(async () => {}),
    revise: vi.fn(async () => plan('plan-2')),
    execute: vi.fn(async () => ({ ...p, status: 'committed' as const })),
    undo: vi.fn(async () => ({ ...p, status: 'undone' as const })),
    history: vi.fn(async () => [] as Plan[]), status: vi.fn(async (): Promise<Plan> => ({ ...p, status: 'committed' }))
  } satisfies AssistantClient;
}
// The panel only exists when the dock has something to report. While the config
// is still loading the dock shows the setup state, so leaving it is the signal
// that a ready connection has landed.
async function connected() {
  await waitFor(() => expect(document.querySelector('.assistant-panel')).not.toHaveAttribute('data-state', 'setup'));
}
async function send() {
  const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await connected();
  await act(async () => {
    fireEvent.change(input, { target: { value: '周三8点提醒我早会' } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  return input;
}
async function click(element: HTMLElement) { await act(async () => { fireEvent.click(element); }); }
describe('AssistantDock execution boundary', () => {
  it('counts local calendar days across daylight-saving boundaries', () => {
    vi.stubEnv('TZ', 'America/New_York');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:30:00-05:00'));
    try {
      expect(historyCount([{ ...plan(), createdAt: new Date('2026-10-31T00:30:00-04:00').getTime() }], '3')).toBe(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
  it('presents a generated plan as a card inside the single chat stream', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    const stream = within(panel).getByRole('list', { name: '当前聊天消息' });
    expect(within(stream).getByRole('region', { name: '变更预览' })).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: '变更预览' })).not.toBeInTheDocument();
  });
  it('keeps the assistant rationale bubble above a generated plan card', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const stream = screen.getByRole('list', { name: '当前聊天消息' });
    const rationale = within(stream).getByText('检查预览').closest('li');
    const preview = within(stream).getByRole('region', { name: '变更预览' }).closest('li');
    expect(rationale).toHaveAttribute('data-role', 'assistant');
    expect(rationale!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('distinguishes chat roles without visible identity labels', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const messages = screen.getAllByRole('listitem').filter(item => item.matches('.assistant-chat-message'));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toHaveAttribute('aria-label', '你说');
    expect(messages[1]).toHaveAttribute('aria-label', 'Nowly 回复');
    expect(within(messages[0]).queryByText('你', { exact: true })).not.toBeInTheDocument();
    expect(within(messages[1]).queryByText('Nowly', { exact: true })).not.toBeInTheDocument();
  });
  it('progressively discloses the single change editor under a named summary', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const summary = screen.getByText('调整新建日程 · 早会', { selector: 'summary' });
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: '标题 1' })).toBeVisible();
  });
  it('does not execute a model proposal until the exact confirmation button is pressed', async () => {
    const client = clientFixture(); const refresh = vi.fn();
    render(<AssistantDock client={client} onRefresh={refresh} />);
    await send();
    const confirm = await screen.findByRole('button', { name: '确认执行 1 项' });
    expect(client.execute).not.toHaveBeenCalled();
    expect(screen.getByText('2026-09-09 08:00')).toBeInTheDocument();
    await click(confirm);
    await screen.findByRole('region', { name: '操作状态：已执行' });
    expect(client.execute).toHaveBeenCalledExactlyOnceWith('plan-1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/不代表系统通知已送达/)).toBeInTheDocument();
  });
  it('associates a completed chat card detail button with its detail region', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
    const details = screen.getByRole('button', { name: '查看早会详情' });
    expect(screen.getByRole('button', { name: '撤销早会' })).toBeInTheDocument();
    expect(details).toHaveAttribute('aria-controls');
    await click(details);
    expect(document.getElementById(details.getAttribute('aria-controls')!)).toBeInTheDocument();
  });
  it('invalidates the old plan immediately on editing and confirms only a revised plan', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    fireEvent.change(await screen.findByRole('textbox', { name: '标题 1' }), { target: { value: '团队早会' } });
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeDisabled();
    await waitFor(() => expect(client.cancelPlan).toHaveBeenCalledWith('plan-1'));
    await click(screen.getByRole('button', { name: '更新预览' }));
    await waitFor(() => expect(client.revise).toHaveBeenCalledWith('plan-1', [expect.objectContaining({ draft: expect.objectContaining({ title: '团队早会' }) })]));
    await click(screen.getByRole('button', { name: '确认执行 1 项' }));
    await waitFor(() => expect(client.execute).toHaveBeenCalledExactlyOnceWith('plan-2'));
  });
  it('ignores a late cancellation failure after a revised preview replaces the old plan', async () => {
    const client = clientFixture();
    let rejectCancellation!: (error: unknown) => void;
    client.cancelPlan.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectCancellation = reject; }));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    fireEvent.change(await screen.findByRole('textbox', { name: '标题 1' }), { target: { value: '团队早会' } });
    await click(screen.getByRole('button', { name: '更新预览' }));
    await waitFor(() => expect(client.revise).toHaveBeenCalledTimes(1));
    await act(async () => rejectCancellation(new Error('late cancellation failure')));
    expect(screen.queryByText('无法核实旧预览已取消。请重新发送请求。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
  });
  it('carries its own previous answer in history so a clarification is not repeated', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await send();
    expect(client.interpret).toHaveBeenCalledTimes(2);
    expect(client.interpret.mock.calls[1][0].history).toEqual([
      { role: 'user', content: '周三8点提醒我早会' },
      { role: 'assistant', content: '检查预览' }
    ]);
  });
  it('IME Enter does not send and Escape preserves draft', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    fireEvent.change(input, { target: { value: '早会' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(client.interpret).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('早会');
  });
  it('uses Shift+Enter for a newline without sending', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    fireEvent.change(input, { target: { value: '今天3点添加会议' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(client.interpret).not.toHaveBeenCalled();
  });
  it('looks up the same plan after uncertain execution instead of executing again', async () => {
    const client = clientFixture(); client.execute.mockRejectedValueOnce(new Error('transport lost'));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
    await screen.findByRole('region', { name: '操作状态：已执行' });
    expect(client.status).toHaveBeenCalledExactlyOnceWith('plan-1');
    expect(client.execute).toHaveBeenCalledTimes(1);
  });
  it('ignores a late reply after stop and cancels its orphan preview', async () => {
    const client = clientFixture();
    let resolve!: (value: Reply) => void;
    client.interpret.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(await screen.findByRole('button', { name: '停止处理' }));
    await act(async () => resolve({ kind: 'plan', message: '', records: [], plan: plan() }));
    expect(screen.queryByRole('button', { name: '确认执行 1 项' })).not.toBeInTheDocument();
    expect(client.cancelPlan).toHaveBeenCalledWith('plan-1');
    expect(client.execute).not.toHaveBeenCalled();
  });
  it('opens committed operations in history and supports undo', async () => {
    const client = clientFixture(); client.history.mockResolvedValue([{ ...plan(), status: 'committed' }]);
    const refresh = vi.fn();
    render(<AssistantDock client={client} onRefresh={refresh} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '查看早会详情' }));
    expect(screen.getByText('2026-09-09 08:00')).toBeInTheDocument();
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await screen.findByText('已撤销');
    expect(client.undo).toHaveBeenCalledWith('plan-1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('opens the single chat on composer focus without loading operation history', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    await act(async () => { fireEvent.focus(input); });
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    expect(within(panel).getByRole('heading', { name: '当前聊天' })).toBeInTheDocument();
    expect(client.history).not.toHaveBeenCalled();
  });
  it('keeps completed user, assistant and plan items in the current chat', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await send();
    await act(async () => {
      fireEvent.blur(input);
      fireEvent.focus(input);
    });
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    expect(within(panel).getByText('周三8点提醒我早会')).toBeInTheDocument();
    expect(within(panel).getByText('检查预览')).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: '变更预览' })).toBeInTheDocument();
  });
  it('keeps operation history separate while plans stay inside the current chat', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([{ ...plan(), status: 'committed', createdAt: Date.now() }]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const chat = screen.getByRole('region', { name: '当前聊天' });
    expect(within(chat).getByRole('region', { name: '变更预览' })).toBeInTheDocument();

    await click(screen.getByRole('button', { name: '操作记录' }));
    const history = screen.getByRole('region', { name: '操作记录' });
    expect(history).toHaveAttribute('data-state', 'history');
    expect(within(history).getByRole('tab', { name: '近 7 天' })).toBeInTheDocument();
    expect(within(history).queryByRole('list', { name: '当前聊天消息' })).not.toBeInTheDocument();

    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('region', { name: '当前聊天' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '变更预览' })).toBeInTheDocument();
  });
  it('refreshes operation history after it is collapsed and reopened', async () => {
    const client = clientFixture();
    client.history.mockResolvedValueOnce([{ ...plan(), status: 'committed' }])
      .mockResolvedValueOnce([{ ...plan(), status: 'undone' }]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const button = await screen.findByRole('button', { name: '操作记录' });
    await click(button);
    expect(screen.getByText('已执行')).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '收起助手' }));
    await click(button);
    expect(screen.getByText('已撤销')).toBeInTheDocument();
    expect(screen.queryByText('已执行')).not.toBeInTheDocument();
    expect(client.history).toHaveBeenCalledTimes(2);
  });
  it('keeps loaded history out of the current chat stream', async () => {
    const client = clientFixture();
    const now = Date.now();
    client.history.mockResolvedValue([
      { ...plan('newer'), status: 'committed', createdAt: now, changes: [{ ...plan().changes[0], title: '较新操作' }] },
      { ...plan('older'), status: 'committed', createdAt: now - 1000, changes: [{ ...plan().changes[0], title: '较早操作' }] }
    ]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    const history = screen.getByRole('region', { name: '操作记录' });
    expect(within(history).getByText('较早操作')).toBeInTheDocument();
    expect(within(history).getByText('较新操作')).toBeInTheDocument();
    expect(within(history).queryByRole('list', { name: '当前聊天消息' })).not.toBeInTheDocument();
  });
  it('renders one primary history row for each operation', async () => {
    const client = clientFixture();
    const multiChange = plan('multi-change');
    multiChange.status = 'committed';
    multiChange.changes = [
      multiChange.changes[0],
      { ...multiChange.changes[0], key: 'calendar:fixture-2:', title: '设计评审' }
    ];
    client.history.mockResolvedValue([multiChange]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    const history = screen.getByRole('region', { name: '操作记录' });
    expect(history.querySelectorAll('.assistant-history-row')).toHaveLength(1);
    expect(within(history).getByText('新建日程 · 2 项')).toBeInTheDocument();
    expect(within(history).getAllByText('已执行')).toHaveLength(1);
  });
  it('names history actions with their operation target', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([
      { ...plan('morning'), status: 'committed', changes: [{ ...plan().changes[0], title: '团队早会' }] },
      { ...plan('review'), status: 'committed', changes: [{ ...plan().changes[0], title: '设计评审' }] }
    ]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('button', { name: '查看团队早会详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销设计评审' })).toBeInTheDocument();
  });
  it('upserts a repeated plan id instead of adding a duplicate card', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send(); await send();
    expect(screen.getAllByRole('region', { name: '变更预览' })).toHaveLength(1);
  });
  it('keeps processing and error status cards inside the chat stream', async () => {
    const client = clientFixture(); let reject!: (cause: unknown) => void;
    client.interpret.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    const stream = screen.getByRole('list', { name: '当前聊天消息' });
    expect(within(stream).getByRole('status')).toHaveTextContent('正在理解与查询');
    await act(async () => reject(new Error('模型不可用')));
    expect(within(stream).getByRole('alert')).toHaveTextContent('模型不可用');
  });
  it('updates an expired preview to an expired operation card', async () => {
    const client = clientFixture();
    client.interpret.mockImplementation(async () => {
      const expiring = plan(); expiring.expiresAt = Date.now() + 500;
      return { kind: 'plan', message: '', records: [], plan: expiring };
    });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' }); await connected();
    await act(async () => { fireEvent.change(input, { target: { value: '创建早会' } }); fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(await screen.findByRole('region', { name: '变更预览' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '操作状态：已过期' })).toBeInTheDocument();
  });
  it('closes history on an outside pointer press and refreshes it when reopened', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const button = await screen.findByRole('button', { name: '操作记录' });
    await click(button);
    const panel = screen.getByRole('region', { name: '操作记录' });
    fireEvent.pointerDown(document.body);
    expect(panel).toHaveAttribute('data-open', 'false');
    await click(button);
    expect(panel).toHaveAttribute('data-state', 'history');
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(client.history).toHaveBeenCalledTimes(2);
  });
  it('loads newer history state after the panel was collapsed and reopened', async () => {
    const client = clientFixture();
    client.history.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...plan(), status: 'committed' }]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const button = await screen.findByRole('button', { name: '操作记录' });
    await click(button);
    await click(screen.getByRole('button', { name: '收起助手' }));
    await click(button);
    expect(await screen.findByText('已执行')).toBeInTheDocument();
    expect(client.history).toHaveBeenCalledTimes(2);
  });
  it('closes the current chat on an outside pointer press without clearing its messages', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await send();
    fireEvent.blur(input); fireEvent.focus(input);
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    fireEvent.pointerDown(document.body);
    expect(panel).toHaveAttribute('data-open', 'false');
    fireEvent.focus(input);
    expect(panel).toHaveAttribute('data-state', 'chat');
    expect(within(panel).getByText('周三8点提醒我早会')).toBeInTheDocument();
    expect(within(panel).getByText('检查预览')).toBeInTheDocument();
  });
  it('keeps the current chat open on ordinary blur', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    fireEvent.focus(input); fireEvent.blur(input);
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    expect(panel).toHaveAttribute('data-open', 'true');
  });
  it('expands only the selected operation when history contains repeated record keys', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([
      { ...plan('history-1'), status: 'committed' },
      { ...plan('history-2'), status: 'committed' }
    ]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    await click(screen.getAllByRole('button', { name: /^查看/ })[0]);
    expect(document.querySelectorAll('.assistant-timeline-detail')).toHaveLength(1);
  });
  it('opens current chat when configuration finishes loading under a focused composer', async () => {
    const client = clientFixture();
    let resolveConfig!: (value: AssistantConfig) => void;
    client.getConfig.mockImplementationOnce(() => new Promise(resolve => { resolveConfig = resolve; }));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    fireEvent.focus(input);
    await act(async () => resolveConfig(config));
    await waitFor(() => expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true'));
  });
  it('keeps the full visible chat while limiting only the model context', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    for (let turn = 1; turn <= 7; turn++) {
      fireEvent.change(input, { target: { value: `请求 ${turn}` } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(client.interpret).toHaveBeenCalledTimes(turn));
    }
    fireEvent.blur(input); fireEvent.focus(input);
    expect(document.querySelectorAll('.assistant-chat-message[data-role="user"]')).toHaveLength(7);
  });
  it('keeps the chat preview when visiting and leaving operation history', async () => {
    const client = clientFixture(); client.history.mockResolvedValue([{ ...plan(), status: 'committed' }]);
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('region', { name: '操作记录' })).toHaveAttribute('data-state', 'history');
    await click(screen.getByRole('button', { name: '操作记录' }));
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(within(panel).getByRole('region', { name: '变更预览' })).toBeInTheDocument();
  });
  it('keeps a blocked current preview blocked after undoing an older history entry', async () => {
    const client = clientFixture();
    client.cancelPlan.mockRejectedValueOnce(new Error('cancel unavailable'));
    client.history.mockResolvedValue([{ ...plan('history-1'), status: 'committed' }]);
    client.undo.mockResolvedValue({ ...plan('history-1'), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    fireEvent.change(await screen.findByRole('textbox', { name: '标题 1' }), { target: { value: '团队早会' } });
    await screen.findByText('无法核实旧预览已取消。请重新发送请求。');
    await click(screen.getByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await screen.findByText('已撤销');
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeDisabled();
    expect(screen.getByText('无法核实旧预览已取消。请重新发送请求。')).toBeInTheDocument();
  });
  it('keeps history loading errors out of the current chat', async () => {
    const client = clientFixture(); client.history.mockRejectedValueOnce(new Error('历史读取失败'));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('region', { name: '操作记录' })).toHaveTextContent('历史读取失败');
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('region', { name: '当前聊天' })).not.toHaveTextContent('历史读取失败');
    expect(screen.getByRole('region', { name: '变更预览' })).toBeInTheDocument();
  });
  it('preserves the current pending preview when undoing an older history entry', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([{ ...plan('history-1'), status: 'committed' }]);
    client.undo.mockResolvedValue({ ...plan('history-1'), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await screen.findByText('已撤销');
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('textbox', { name: '标题 1' })).toHaveValue('早会');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
    expect(client.cancelPlan).not.toHaveBeenCalledWith('plan-1');
  });
  it('preserves the current preview after retrying an uncertain history undo', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([{ ...plan('history-1'), status: 'committed' }]);
    client.undo.mockRejectedValueOnce(new Error('transport lost'));
    client.status.mockRejectedValueOnce(new Error('status unavailable'))
      .mockResolvedValueOnce({ ...plan('history-1'), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await click(await screen.findByRole('button', { name: '核实操作状态' }));
    await screen.findByText('已撤销');
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('textbox', { name: '标题 1' })).toHaveValue('早会');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
  });
  it('does not block the current chat while a history undo is awaiting verification', async () => {
    const client = clientFixture();
    client.history.mockResolvedValue([{ ...plan('history-1'), status: 'committed' }]);
    client.undo.mockRejectedValueOnce(new Error('transport lost'));
    client.status.mockRejectedValueOnce(new Error('status unavailable'));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await screen.findByRole('button', { name: '核实操作状态' });
    await click(screen.getByRole('button', { name: '操作记录' }));
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '告诉 Nowly 你想做什么' })).toBeEnabled();
  });
  it('reports an undo conflict instead of calling the committed receipt a successful undo', async () => {
    const client = clientFixture(); client.history.mockResolvedValue([{ ...plan(), status: 'committed' }]);
    client.undo.mockRejectedValueOnce(new Error('相关数据已有后续修改，无法安全撤销'));
    const refresh = vi.fn();
    render(<AssistantDock client={client} onRefresh={refresh} />);
    await click(await screen.findByRole('button', { name: '操作记录' }));
    await click(await screen.findByRole('button', { name: '撤销早会' }));
    await screen.findByText(/相关数据已有后续修改/);
    expect(screen.queryByText('已执行 1 项本地变更')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('disables confirmation when all targets are excluded', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(await screen.findByRole('checkbox', { name: '新建日程 · 早会' }));
    expect(screen.getByRole('button', { name: '确认执行 0 项' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更新预览' })).toBeDisabled();
    expect(client.execute).not.toHaveBeenCalled();
  });
  it('preserves a newer draft typed while waiting for a response', async () => {
    const client = clientFixture(); let resolve!: (reply: Reply) => void;
    client.interpret.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await send();
    fireEvent.change(input, { target: { value: '另外查看明天的任务' } });
    await act(async () => resolve({ kind: 'clarify', message: '上午还是晚上？', records: [], plan: null }));
    expect(input).toHaveValue('另外查看明天的任务');
  });
  it('shows the normalized lane in a clean confirmable preview', async () => {
    const client = clientFixture(); const p = plan();
    p.actions = [{ kind: 'updateTask', id: 'task', patch: { laneId: 'done', completed: false } }];
    p.changes = [{ key: 'tasks:task', kind: 'updateTask', title: '待办', before: { id: 'task', title: '待办', laneId: 'done', completed: true },
      after: { id: 'task', title: '待办', laneId: 'todo', completed: false, priority: null, dueDate: null, description: '' } }];
    p.options = { lanes: [{ id: 'todo', name: '待处理' }, { id: 'done', name: '已完成列' }], defaultLaneId: 'todo', completionLaneId: 'done' };
    client.interpret.mockResolvedValue({ kind: 'plan', message: '', records: [], plan: p });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    expect(await screen.findByRole('combobox', { name: '看板列 1' })).toHaveTextContent('待处理');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
  });
  it('invalidates confirmation as soon as a keyboard time adjustment is visible', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(screen.getByRole('button', { name: '开始 1时间' }));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '小时' }), { key: 'ArrowUp' });
    expect(screen.getByRole('spinbutton', { name: '小时' })).toHaveAttribute('aria-valuenow', '9');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeDisabled();
    expect(client.execute).not.toHaveBeenCalled();
  });
});
