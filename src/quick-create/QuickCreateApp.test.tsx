import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { TaskWorkspaceProvider } from '../tasks/TaskWorkspaceContext';
import type { TaskWorkspaceSnapshot } from '../tasks/task-model';
import { QuickCreateApp } from './QuickCreateApp';
import type { QuickCreateRequest } from './request';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>()
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: tauri.emit,
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    // Every registration is its own listener, as in Tauri.
    const listener = (event: { payload: unknown }) => handler(event);
    tauri.listeners.set(name, listener);
    return Promise.resolve(() => {
      if (tauri.listeners.get(name) === listener) tauri.listeners.delete(name);
    });
  })
}));

const workspace: TaskWorkspaceSnapshot = {
  tasks: [],
  lanes: [{ id: 'lane-a', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
  tags: [],
  defaultLaneId: 'lane-a',
  viewPreferences: {}
};

function createRepository() {
  return {
    getSettings: vi.fn().mockResolvedValue({ density: 'comfortable', iconStyle: 'duotone' }),
    listCategories: vi.fn().mockResolvedValue([]),
    listCalendarSubscriptions: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockImplementation(async (draft: object) => ({ id: 'e1', ...draft })),
    createNote: vi.fn().mockImplementation(async (draft: object) => ({ id: 'n1', ...draft, styleVariant: 0, createdAt: 'x', updatedAt: 'x' })),
    getTaskWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace),
    createWorkspaceTask: vi.fn().mockImplementation(async (_view: string, draft: object) => ({
      id: 't1', ...draft, boardPosition: 0, createdAt: 'x', updatedAt: 'x'
    }))
  };
}

let pending: QuickCreateRequest | null = null;

// Strict mode, as in main.tsx: it replays mount effects, which move focus again.
function renderApp(repository = createRepository()) {
  render(
    <StrictMode>
      <RepositoryProvider repository={repository as unknown as NowlyRepository}>
        <TaskWorkspaceProvider><QuickCreateApp /></TaskWorkspaceProvider>
      </RepositoryProvider>
    </StrictMode>
  );
  return repository;
}

async function deliver(request: unknown) {
  await act(async () => tauri.listeners.get('quick-create-open')?.({ payload: request }));
}

async function requestNativeClose() {
  await act(async () => tauri.listeners.get('quick-create-close-requested')?.({ payload: null }));
}

const discard = () => within(screen.getByRole('dialog', { name: '放弃更改？' }));

beforeEach(() => {
  pending = null;
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command: string) => command === 'get_quick_create_request' ? pending : undefined);
  tauri.emit.mockReset();
  tauri.emit.mockResolvedValue(undefined);
  // jsdom does no layout; the dialog stands in at a fixed height.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('good-dialog') ? 520 : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  tauri.listeners.clear();
});

describe('QuickCreateApp', () => {
  it('pulls the pending request and lays the window out at the dialog height', async () => {
    pending = { id: 1, kind: 'note', maxHeight: 600 };
    renderApp();
    expect(await screen.findByRole('dialog', { name: '新建便签' })).toBeInTheDocument();
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('quick_create_layout', { requestId: 1, kind: 'note', height: 520 }), { timeout: 3000 });
    const root = document.documentElement;
    expect(root.dataset.surface).toBe('quick-create');
    expect(root.dataset.density).toBe('comfortable');
    expect(root.style.getPropertyValue('--quick-create-max-h')).toBe('600px');
    await waitFor(() => expect(document.getElementById('note-content')).toHaveFocus());
  });

  it('focuses the title of a new event so typing can start at once', async () => {
    pending = { id: 2, kind: 'event', maxHeight: 700 };
    renderApp();
    const title = await screen.findByLabelText('日程标题');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('saves an event, tells the main window, and closes', async () => {
    const user = userEvent.setup();
    pending = { id: 3, kind: 'event', maxHeight: 700 };
    const repository = renderApp();
    await user.type(await screen.findByLabelText('日程标题'), '周会');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('close_quick_create', { requestId: 3 }));
    expect(repository.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: '周会' }));
    expect(tauri.emit).toHaveBeenCalledWith('nowly-records-changed', { kind: 'event' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves a task off the board in the fourth quadrant and notifies the main window', async () => {
    const user = userEvent.setup();
    pending = { id: 4, kind: 'task', maxHeight: 700 };
    const repository = renderApp();
    await user.type(await screen.findByLabelText('任务标题'), '写周报');
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(tauri.emit).toHaveBeenCalledWith('nowly-records-changed', { kind: 'task' }));
    expect(repository.createWorkspaceTask).toHaveBeenCalledWith(expect.objectContaining({
      title: '写周报', priority: 'not_important_not_urgent', laneId: null
    }));
    expect(tauri.invoke).toHaveBeenCalledWith('close_quick_create', { requestId: 4 });
  });

  it('closes without saving when cancelled', async () => {
    const user = userEvent.setup();
    pending = { id: 5, kind: 'note', maxHeight: 700 };
    const repository = renderApp();
    await user.click(await screen.findByRole('button', { name: '取消' }));
    expect(tauri.invoke).toHaveBeenCalledWith('close_quick_create', { requestId: 5 });
    expect(repository.createNote).not.toHaveBeenCalled();
    expect(tauri.emit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the draft when the same kind is requested again and follows the new request', async () => {
    const user = userEvent.setup();
    pending = { id: 6, kind: 'event', maxHeight: 700 };
    renderApp();
    await user.type(await screen.findByLabelText('日程标题'), '草稿');
    await deliver({ id: 7, kind: 'event', maxHeight: 640 });
    expect(screen.getByLabelText('日程标题')).toHaveValue('草稿');
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('quick_create_layout', { requestId: 7, kind: 'event', height: 520 }));
    expect(document.documentElement.style.getPropertyValue('--quick-create-max-h')).toBe('640px');
  });

  it('switches straight to another kind while the draft is untouched', async () => {
    pending = { id: 8, kind: 'event', maxHeight: 700 };
    renderApp();
    await screen.findByRole('dialog', { name: '新建日程' });
    await deliver({ id: 9, kind: 'note', maxHeight: 700 });
    expect(await screen.findByRole('dialog', { name: '新建便签' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '新建日程' })).not.toBeInTheDocument();
  });

  it('asks before another kind replaces a draft with changes', async () => {
    const user = userEvent.setup();
    pending = { id: 10, kind: 'event', maxHeight: 700 };
    renderApp();
    await user.type(await screen.findByLabelText('日程标题'), '草稿');
    await deliver({ id: 11, kind: 'task', maxHeight: 700 });
    await user.click(discard().getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '放弃更改？' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('日程标题')).toHaveValue('草稿');
    // The event dialog stays, so the window keeps the event width for the new request.
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('quick_create_layout', { requestId: 11, kind: 'event', height: 520 }));

    await deliver({ id: 12, kind: 'task', maxHeight: 700 });
    await user.click(discard().getByRole('button', { name: '放弃更改' }));
    expect(await screen.findByRole('dialog', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.queryByLabelText('日程标题')).not.toBeInTheDocument();
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('quick_create_layout', { requestId: 12, kind: 'task', height: 520 }));
  });

  it('closes on a native close request, confirming first when there are changes', async () => {
    const user = userEvent.setup();
    pending = { id: 13, kind: 'event', maxHeight: 700 };
    renderApp();
    await user.type(await screen.findByLabelText('日程标题'), '草稿');
    await requestNativeClose();
    expect(tauri.invoke).not.toHaveBeenCalledWith('close_quick_create', expect.anything());
    await user.click(discard().getByRole('button', { name: '放弃更改' }));
    expect(tauri.invoke).toHaveBeenCalledWith('close_quick_create', { requestId: 13 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes at once on a native close request with nothing to lose', async () => {
    pending = { id: 14, kind: 'note', maxHeight: 700 };
    renderApp();
    await screen.findByRole('dialog', { name: '新建便签' });
    await requestNativeClose();
    expect(tauri.invoke).toHaveBeenCalledWith('close_quick_create', { requestId: 14 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores malformed and already handled requests', async () => {
    const user = userEvent.setup();
    pending = { id: 15, kind: 'event', maxHeight: 700 };
    renderApp();
    await user.click(await screen.findByRole('button', { name: '取消' }));
    await deliver({ id: 15, kind: 'event', maxHeight: 700 });
    await deliver({ id: 16, kind: 'calendar', maxHeight: 700 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a retry when the task workspace cannot be read', async () => {
    const user = userEvent.setup();
    pending = { id: 17, kind: 'task', maxHeight: 700 };
    const repository = createRepository();
    repository.getTaskWorkspaceSnapshot.mockRejectedValue({ message: '读取失败' });
    renderApp(repository);
    const failure = await screen.findByRole('dialog', { name: '新建任务' });
    expect(within(failure).getByText('读取失败')).toBeInTheDocument();
    repository.getTaskWorkspaceSnapshot.mockResolvedValue(workspace);
    await user.click(within(failure).getByRole('button', { name: '重试' }));
    expect(await screen.findByLabelText('任务标题')).toBeInTheDocument();
  });
});
