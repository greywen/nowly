import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantDock } from './AssistantDock';
import { ChangeDetails } from './PlanCard';
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

// A second, visibly distinct plan so a committed card and a newer pending
// preview can coexist in one chat without ambiguous accessible names.
function laterPlan(): Plan {
  const base = plan('plan-2');
  return {
    ...base,
    actions: [{ kind: 'createEvent', draft: { title: '复盘', startAt: '2026-09-10T10:00', reminders: [0] } }],
    changes: [{ ...base.changes[0], key: 'calendar:later:', title: '复盘', after: { ...base.changes[0].after!, id: 'later', title: '复盘' } }]
  };
}

// Commit the first plan, then send again so the chat holds an older committed
// card plus a newer pending preview. Undoing the older card is the only way to
// reach the "preserve the current preview" path now that the assistant has a
// single chat surface.
async function commitThenSendAgain(client: ReturnType<typeof clientFixture>) {
  await send();
  await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
  await screen.findByRole('region', { name: '操作状态：已执行' });
  client.interpret.mockResolvedValue({ kind: 'plan', message: '再检查一遍', records: [], plan: laterPlan() });
  await send();
  await screen.findByRole('textbox', { name: '标题 1' });
}

// Expand the older committed card and undo it.
async function undoOlderCard() {
  await click(screen.getByRole('button', { name: /新建日程.*早会.*已执行/ }));
  await click(screen.getByRole('button', { name: '撤销早会' }));
}
describe('AssistantDock execution boundary', () => {
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
    // Undo lives behind the operation row, not beside it.
    await click(screen.getByRole('button', { name: /新建日程.*早会.*已执行/ }));
    expect(screen.getByText(/不代表系统通知已送达/)).toBeInTheDocument();
  });
  it('uses the completed operation row as the accessible detail trigger', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await send();
    await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
    const details = screen.getByRole('button', { name: /新建日程.*早会.*已执行/ });
    expect(details).toHaveAttribute('aria-controls');
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(details.querySelector('svg')).toHaveClass('app-icon');
    expect(screen.queryByText('查看详情')).not.toBeInTheDocument();
    expect(screen.queryByText(/不代表系统通知已送达/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销早会' })).not.toBeInTheDocument();
    await click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(details.getAttribute('aria-controls')!)).toBeInTheDocument();
    expect(screen.getByText('分类')).toBeInTheDocument();
    expect(screen.queryByText('颜色')).not.toBeInTheDocument();
    expect(screen.getByText(/不代表系统通知已送达/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销早会' })).toBeInTheDocument();
  });
  it('leaves an event color out of the diff but keeps a task color in it', () => {
    const p = plan();
    const calendarChange = p.changes[0];
    // An event's color follows its category, so the preview does not ask the
    // user to verify it. A task color is a real field and stays visible.
    const { rerender } = render(<ChangeDetails change={calendarChange} plan={p} />);
    expect(screen.getByText('分类')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.queryByText('颜色')).not.toBeInTheDocument();

    rerender(<ChangeDetails change={{ ...calendarChange, kind: 'createTask' }} plan={p} />);
    expect(screen.getByText('颜色')).toBeInTheDocument();
    expect(screen.getByText('#4fc9da')).toBeInTheDocument();
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
  it('opens the chat on composer focus', async () => {
    const client = clientFixture();
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    await act(async () => { fireEvent.focus(input); });
    const panel = screen.getByRole('region', { name: '当前聊天' });
    expect(panel).toHaveAttribute('data-state', 'chat');
    expect(panel).toHaveAttribute('data-open', 'true');
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
  it('undoes a committed operation from its card in the chat', async () => {
    const client = clientFixture(); const refresh = vi.fn();
    render(<AssistantDock client={client} onRefresh={refresh} />);
    await send();
    await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
    await click(screen.getByRole('button', { name: /新建日程.*早会.*已执行/ }));
    await click(screen.getByRole('button', { name: '撤销早会' }));
    await screen.findByRole('region', { name: '操作状态：已撤销' });
    expect(client.undo).toHaveBeenCalledWith('plan-1');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('preserves the current pending preview when undoing an older committed card', async () => {
    const client = clientFixture();
    client.undo.mockResolvedValue({ ...plan(), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await commitThenSendAgain(client);
    await undoOlderCard();
    await screen.findByRole('region', { name: '操作状态：已撤销' });
    // The newer preview is untouched: still editable, still confirmable, and
    // never cancelled on its behalf.
    expect(screen.getByRole('textbox', { name: '标题 1' })).toHaveValue('复盘');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
    expect(client.cancelPlan).not.toHaveBeenCalledWith('plan-2');
  });
  it('keeps a blocked current preview blocked after undoing an older committed card', async () => {
    const client = clientFixture();
    client.cancelPlan.mockRejectedValueOnce(new Error('cancel unavailable'));
    client.undo.mockResolvedValue({ ...plan(), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await commitThenSendAgain(client);
    fireEvent.change(await screen.findByRole('textbox', { name: '标题 1' }), { target: { value: '季度复盘' } });
    await screen.findByText('无法核实旧预览已取消。请重新发送请求。');
    await undoOlderCard();
    await screen.findByRole('region', { name: '操作状态：已撤销' });
    // Succeeding on the older card says nothing about the current preview, so
    // its block and its reason both survive.
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeDisabled();
    expect(screen.getByText('无法核实旧预览已取消。请重新发送请求。')).toBeInTheDocument();
  });
  it('does not block the current chat while an older undo awaits verification', async () => {
    const client = clientFixture();
    client.undo.mockRejectedValueOnce(new Error('transport lost'));
    client.status.mockRejectedValueOnce(new Error('status unavailable'));
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await commitThenSendAgain(client);
    await undoOlderCard();
    // The uncertainty is reported on the card it belongs to, and the current
    // preview stays usable.
    await screen.findByRole('button', { name: '核实操作状态' });
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '告诉 Nowly 你想做什么' })).toBeEnabled();
  });
  it('preserves the current preview after retrying an uncertain older undo', async () => {
    const client = clientFixture();
    client.undo.mockRejectedValueOnce(new Error('transport lost'));
    client.status.mockRejectedValueOnce(new Error('status unavailable'))
      .mockResolvedValueOnce({ ...plan(), status: 'undone' });
    render(<AssistantDock client={client} onRefresh={() => {}} />);
    await commitThenSendAgain(client);
    await undoOlderCard();
    await click(await screen.findByRole('button', { name: '核实操作状态' }));
    await screen.findByRole('region', { name: '操作状态：已撤销' });
    expect(screen.getByRole('textbox', { name: '标题 1' })).toHaveValue('复盘');
    expect(screen.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
  });
  it('reports an undo conflict instead of calling the committed receipt a successful undo', async () => {
    const client = clientFixture();
    client.undo.mockRejectedValueOnce(new Error('相关数据已有后续修改，无法安全撤销'));
    const refresh = vi.fn();
    render(<AssistantDock client={client} onRefresh={refresh} />);
    await send();
    await click(await screen.findByRole('button', { name: '确认执行 1 项' }));
    refresh.mockClear();
    await click(screen.getByRole('button', { name: /新建日程.*早会.*已执行/ }));
    await click(screen.getByRole('button', { name: '撤销早会' }));
    await screen.findByText(/相关数据已有后续修改/);
    // A committed receipt is not an undo. The card stays committed and nothing
    // is refreshed as though data had changed.
    expect(screen.getByRole('region', { name: '操作状态：已执行' })).toBeInTheDocument();
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
  it('opens the embedded chat immediately and keeps it open while submitting', async () => {
    const client = clientFixture();
    let resolve!: (reply: Reply) => void;
    client.interpret.mockImplementationOnce(() => new Promise(reply => { resolve = reply; }));
    render(
      <AssistantDock
        client={client}
       
        autoFocus
        onRefresh={() => {}}
      />
    );
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    await waitFor(() => expect(input).toHaveFocus());

    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');

    fireEvent.change(input, { target: { value: '明天下午三点创建产品评审' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
    expect(within(screen.getByRole('list', { name: '当前聊天消息' }))
      .getByText('明天下午三点创建产品评审')).toBeInTheDocument();
    expect(screen.getByText('正在理解与查询…尚未执行任何变更。')).toBeInTheDocument();

    await act(async () => resolve({ kind: 'clarify', message: '需要提醒吗？', records: [], plan: null }));
  });
  it('keeps the embedded Nowly Bar input minimal and swaps voice for send only when text exists', async () => {
    render(
      <AssistantDock
        client={clientFixture()}
       
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();

    expect(document.querySelector('.assistant-composer-mark')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '操作记录' })).not.toBeInTheDocument();
    expect(screen.queryByText('当前聊天')).not.toBeInTheDocument();
    expect(screen.queryByText('今天还没有对话。')).not.toBeInTheDocument();
    const voice = screen.getByRole('button', { name: '语音输入' });
    expect(voice).toBeInTheDocument();
    expect(voice.querySelector('svg')).toHaveClass('app-icon');
    expect(screen.queryByRole('button', { name: '发送请求' })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '明天下午三点开会' } });

    expect(screen.queryByRole('button', { name: '语音输入' })).not.toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: '发送请求' });
    expect(sendButton).toBeInTheDocument();
    expect(sendButton.querySelector('svg')).toHaveClass('app-icon');
  });
  it('continues an embedded request while the Nowly Bar conversation is hidden', async () => {
    const client = clientFixture();
    let resolve!: (reply: Reply) => void;
    client.interpret.mockImplementationOnce(() => new Promise(reply => { resolve = reply; }));
    const view = render(
      <AssistantDock
        client={client}
       
        active
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();
    fireEvent.change(input, { target: { value: '继续处理这段对话' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    view.rerender(
      <AssistantDock
        client={client}
       
        active={false}
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    await act(async () => resolve({ kind: 'clarify', message: '对话仍在继续', records: [], plan: null }));

    expect(client.cancelRequest).not.toHaveBeenCalled();
    expect(screen.getByText('对话仍在继续')).toBeInTheDocument();
  });
  it('keeps a revised embedded preview when the Nowly Bar conversation is hidden', async () => {
    const client = clientFixture();
    let resolve!: (next: Plan) => void;
    client.revise.mockImplementationOnce(() => new Promise(next => { resolve = next; }));
    const view = render(
      <AssistantDock
        client={client}
       
        active
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    await send();
    fireEvent.change(await screen.findByRole('textbox', { name: '标题 1' }), { target: { value: '团队早会' } });
    await click(screen.getByRole('button', { name: '更新预览' }));

    view.rerender(
      <AssistantDock
        client={client}
       
        active={false}
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    await act(async () => resolve(plan('plan-2')));
    view.rerender(
      <AssistantDock
        client={client}
       
        active
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );

    expect(client.cancelPlan).not.toHaveBeenCalledWith('plan-2');
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
    await click(screen.getByRole('button', { name: '确认执行 1 项' }));
    expect(client.execute).toHaveBeenCalledWith('plan-2');
  });
  it('does not collapse an embedded conversation when another surface is clicked', async () => {
    render(
      <AssistantDock
        client={clientFixture()}
       
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    await send();
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');

    fireEvent.pointerDown(document.body);

    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
  });
  it('hides an embedded conversation with Escape without collapsing its previous answer state', async () => {
    const onRequestClose = vi.fn();
    const view = render(
      <AssistantDock
        client={clientFixture()}
       
        active
        expandOnFocus={false}
        onRequestClose={onRequestClose}
        onRefresh={() => {}}
      />
    );
    const input = await send();
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');

    view.rerender(
      <AssistantDock
        client={clientFixture()}
       
        active={false}
        expandOnFocus={false}
        onRequestClose={onRequestClose}
        onRefresh={() => {}}
      />
    );
    view.rerender(
      <AssistantDock
        client={clientFixture()}
       
        active
        expandOnFocus={false}
        onRequestClose={onRequestClose}
        onRefresh={() => {}}
      />
    );

    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
    expect(screen.getByText('检查预览')).toBeInTheDocument();
  });
  it('leaves embedded closing to the rail header and keeps voice as the default empty-input action', async () => {
    const onRequestClose = vi.fn();
    render(
      <AssistantDock
        client={clientFixture()}
       
        expandOnFocus={false}
        onRequestClose={onRequestClose}
        onRefresh={() => {}}
      />
    );
    await send();

    expect(screen.queryByRole('button', { name: '收起助手' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '折叠助手' })).not.toBeInTheDocument();
    const voice = screen.getByRole('button', { name: '语音输入' });
    expect(screen.queryByRole('button', { name: '发送请求' })).not.toBeInTheDocument();

    voice.focus();
    fireEvent.keyDown(voice, { key: 'Escape' });

    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
  it('keeps an embedded answer expanded when a query record is selected', async () => {
    const client = clientFixture();
    client.interpret.mockResolvedValue({
      kind: 'results',
      message: '找到一条日程',
      records: [{
        key: 'calendar:event-1',
        domain: 'calendar',
        title: '产品评审',
        source: '本地日历',
        readOnly: false,
        data: { startAt: '2026-09-18T15:00' }
      }],
      plan: null
    });
    render(
      <AssistantDock
        client={client}
       
        expandOnFocus={false}
        onRefresh={() => {}}
      />
    );
    await send();
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');

    await click(screen.getByRole('button', { name: '产品评审' }));

    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
  });
  it('asks the host to close when Escape is pressed in the embedded assistant', async () => {
    const onRequestClose = vi.fn();
    render(
      <AssistantDock
        client={clientFixture()}
       
        onRequestClose={onRequestClose}
        onRefresh={() => {}}
      />
    );
    const input = await screen.findByRole('textbox', { name: '告诉 Nowly 你想做什么' });
    await connected();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'true');
  });
});
