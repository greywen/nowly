import { expect, test } from '@playwright/test';

// A self-contained in-memory kanban backend injected as the Tauri IPC layer, so
// the acceptance flow exercises the real UI, hook, and repository adapter
// without the native host. It mirrors the transactional renumbering the Rust
// backend performs so optimistic updates and reloads stay consistent.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = '2026-07-23T09:42:00.000Z';
    let sequence = 1;
    const nextId = (prefix: string) => `${prefix}-${sequence++}`;

    let lanes: any[] = [
      { id: 'lane-todo', name: '待处理', color: 'primary', position: 0, createdAt: now, updatedAt: now },
      { id: 'lane-doing', name: '进行中', color: 'warning', position: 1, createdAt: now, updatedAt: now }
    ];
    let defaultLaneId: string | null = 'lane-todo';
    let cards: any[] = [];
    let workspaceTasks: any[] = [];
    let priorities: any[] = [];
    let tags: any[] = [];
    const cardTags: Record<string, string[]> = {};

    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced',
      weekStart: 'monday', dateFormat: 'localized', showWeekends: true,
      calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };

    // Module layout persists in memory so adding kanban survives a reload. The
    // acceptance flow starts from an empty canvas so the 8x5 kanban module has
    // room to be placed by the picker.
    let layout: any[] = [];

    const renumberLane = (laneId: string) => {
      cards
        .filter((card) => card.laneId === laneId)
        .sort((a, b) => a.position - b.position)
        .forEach((card, index) => { card.position = index; });
    };

    const buildCard = (card: any) => ({
      ...card,
      tagIds: cardTags[card.id] ?? []
    });

    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: any = {}) => {
        if (command.startsWith('plugin:event|')) return 1;
        switch (command) {
          case 'list_events_in_range': return [];
          case 'list_tasks': return [];
          case 'list_notes': return [];
          case 'get_app_settings': return settings;
          case 'list_monitors': return [];
          case 'list_extensions': return [];
          case 'list_module_layout': return layout;
          case 'save_module_layout': layout = args.layout; return layout;
          case 'get_module_state': return null;
          case 'set_module_state': return null;
          case 'enter_wallpaper_mode':
          case 'enter_foreground_mode': return 'ok';
          case 'get_window_mode': return 'foreground';

          case 'get_task_workspace_snapshot':
            return {
              tasks: workspaceTasks,
              lanes: [...lanes].sort((a, b) => a.position - b.position),
              tags: tags.map((tag) => ({ ...tag, archivedAt: null })),
              defaultLaneId,
              viewPreferences: {}
            };
          case 'create_task': {
            const draft = args.draft;
            const laneId = draft.laneId ?? null;
            const task = {
              id: nextId('task'), title: draft.title, description: draft.description ?? '',
              priority: draft.priority ?? 'not_important_not_urgent', dueDate: draft.dueDate ?? null,
              completed: draft.completed ?? false, completedAt: draft.completed ? new Date().toISOString() : null, laneId,
              boardPosition: workspaceTasks.filter((item) => item.laneId === laneId).length,
              tagIds: draft.tagIds ?? [], steps: [],
              linkedEventId: draft.linkedEventId ?? null,
              createdAt: now, updatedAt: now
            };
            workspaceTasks.push(task);
            return task;
          }
          case 'update_task': {
            const current = workspaceTasks.find((item) => item.id === args.id);
            if (!current) throw { code: 'not_found', message: '未找到该任务。' };
            const draft = args.draft;
            const updated = {
              ...current, ...draft,
              updatedAt: now
            };
            workspaceTasks = workspaceTasks.map((item) => item.id === args.id ? updated : item);
            return updated;
          }
          case 'delete_task':
            workspaceTasks = workspaceTasks.filter((item) => item.id !== args.id);
            return null;
          case 'set_task_completed': {
            // Mirrors the backend: completion keeps the lane, and reopening puts
            // the task at the top of that lane.
            const task = workspaceTasks.find((item) => item.id === args.id);
            const updated = {
              ...task, completed: args.completed, completedAt: args.completed ? new Date().toISOString() : null,
              boardPosition: args.completed ? task.boardPosition : -1, updatedAt: now
            };
            workspaceTasks = workspaceTasks.map((item) => item.id === args.id ? updated : item);
            if (!args.completed && updated.laneId) {
              workspaceTasks.filter((item) => item.laneId === updated.laneId).sort((a, b) => a.boardPosition - b.boardPosition)
                .forEach((item, index) => { item.boardPosition = index; });
            }
            return workspaceTasks.find((item) => item.id === args.id);
          }
          case 'move_task_to_lane': {
            // The index counts open tasks; moving a task into a lane reopens it.
            const task = workspaceTasks.find((item) => item.id === args.id);
            const sourceLaneId = task.laneId;
            const others = workspaceTasks
              .filter((item) => item.id !== args.id && item.laneId === args.laneId)
              .sort((a, b) => a.boardPosition - b.boardPosition);
            const target = [...others.filter((item) => !item.completed), ...others.filter((item) => item.completed)];
            target.splice(args.targetIndex, 0, task);
            const targetPositions = new Map(target.map((item, index) => [item.id, index]));
            let updated: any;
            workspaceTasks = workspaceTasks.map((item) => {
              if (item.id === args.id) {
                updated = {
                  ...item, laneId: args.laneId, boardPosition: targetPositions.get(item.id),
                  completed: false, completedAt: null, updatedAt: now
                };
                return updated;
              }
              if (item.laneId === args.laneId) return { ...item, boardPosition: targetPositions.get(item.id) };
              return item;
            });
            workspaceTasks.filter((item) => item.laneId === sourceLaneId).sort((a, b) => a.boardPosition - b.boardPosition)
              .forEach((item, index) => { item.boardPosition = index; });
            return updated;
          }
          case 'create_task_lane': {
            const lane = { id: nextId('lane'), ...args.draft, position: lanes.length, createdAt: now, updatedAt: now };
            lanes.push(lane);
            return lane;
          }
          case 'update_task_lane': {
            const lane = lanes.find((item) => item.id === args.id);
            Object.assign(lane, args.draft, { updatedAt: now });
            return lane;
          }
          case 'delete_task_lane': {
            // The lane's tasks leave the board and stay in the matrix.
            workspaceTasks = workspaceTasks.map((task) => task.laneId === args.id
              ? { ...task, laneId: null, boardPosition: 0, updatedAt: now }
              : task);
            lanes = lanes.filter((lane) => lane.id !== args.id);
            lanes.sort((a, b) => a.position - b.position).forEach((lane, index) => { lane.position = index; });
            if (defaultLaneId === args.id) defaultLaneId = lanes[0]?.id ?? null;
            return {
              tasks: workspaceTasks, lanes, tags: tags.map((tag) => ({ ...tag, archivedAt: null })),
              defaultLaneId, viewPreferences: {}
            };
          }
          case 'reorder_task_lanes':
            (args.orderedIds as string[]).forEach((id, index) => {
              const lane = lanes.find((item) => item.id === id);
              if (lane) lane.position = index;
            });
            return [...lanes].sort((a, b) => a.position - b.position);
          case 'create_task_tag': {
            const tag = { id: nextId('tag'), ...args.draft, archivedAt: null, createdAt: now, updatedAt: now };
            tags.push(tag);
            return tag;
          }
          case 'update_task_tag': {
            const tag = tags.find((item) => item.id === args.id);
            Object.assign(tag, args.draft, { updatedAt: now });
            return tag;
          }
          case 'delete_task_tag':
            tags = tags.filter((item) => item.id !== args.id);
            workspaceTasks = workspaceTasks.map((task) => ({ ...task, tagIds: task.tagIds.filter((id: string) => id !== args.id) }));
            return null;

          case 'get_kanban_snapshot':
            return {
              lanes: [...lanes].sort((a, b) => a.position - b.position),
              cards: cards.map(buildCard),
              priorities: [...priorities].sort((a, b) => a.position - b.position),
              tags
            };

          case 'create_kanban_lane': {
            const lane = { id: nextId('lane'), name: args.draft.name, color: args.draft.color, position: lanes.length, createdAt: now, updatedAt: now };
            lanes.push(lane);
            return lane;
          }
          case 'update_kanban_lane': {
            const lane = lanes.find((item) => item.id === args.id);
            Object.assign(lane, args.draft, { updatedAt: now });
            return lane;
          }
          case 'delete_kanban_lane': {
            cards = cards.filter((card) => card.laneId !== args.id);
            lanes = lanes.filter((lane) => lane.id !== args.id);
            lanes.sort((a, b) => a.position - b.position).forEach((lane, index) => { lane.position = index; });
            return null;
          }
          case 'reorder_kanban_lanes': {
            (args.orderedIds as string[]).forEach((id, index) => {
              const lane = lanes.find((item) => item.id === id);
              if (lane) lane.position = index;
            });
            return [...lanes].sort((a, b) => a.position - b.position);
          }

          case 'create_kanban_card': {
            const laneCards = cards.filter((card) => card.laneId === args.draft.laneId);
            const card = {
              id: nextId('card'), laneId: args.draft.laneId, title: args.draft.title,
              description: args.draft.description ?? null, dueDate: args.draft.dueDate ?? null,
              priorityId: args.draft.priorityId ?? null, position: laneCards.length,
              createdAt: now, updatedAt: now
            };
            cards.push(card);
            cardTags[card.id] = args.draft.tagIds ?? [];
            return buildCard(card);
          }
          case 'update_kanban_card': {
            const card = cards.find((item) => item.id === args.id);
            Object.assign(card, {
              title: args.draft.title, description: args.draft.description ?? null,
              dueDate: args.draft.dueDate ?? null, priorityId: args.draft.priorityId ?? null,
              updatedAt: now
            });
            cardTags[card.id] = args.draft.tagIds ?? [];
            return buildCard(card);
          }
          case 'delete_kanban_card': {
            const card = cards.find((item) => item.id === args.id);
            cards = cards.filter((item) => item.id !== args.id);
            if (card) renumberLane(card.laneId);
            return null;
          }
          case 'move_kanban_card': {
            const card = cards.find((item) => item.id === args.id);
            const sourceLane = card.laneId;
            card.laneId = args.targetLaneId;
            const others = cards
              .filter((item) => item.laneId === args.targetLaneId && item.id !== card.id)
              .sort((a, b) => a.position - b.position);
            others.splice(args.targetIndex, 0, card);
            others.forEach((item, index) => { item.position = index; });
            if (sourceLane !== args.targetLaneId) renumberLane(sourceLane);
            return null;
          }

          case 'create_kanban_priority': {
            const priority = { id: nextId('priority'), name: args.draft.name, color: args.draft.color, position: priorities.length, createdAt: now, updatedAt: now };
            priorities.push(priority);
            return priority;
          }
          case 'update_kanban_priority': {
            const priority = priorities.find((item) => item.id === args.id);
            Object.assign(priority, args.draft, { updatedAt: now });
            return priority;
          }
          case 'delete_kanban_priority': {
            priorities = priorities.filter((item) => item.id !== args.id);
            cards.forEach((card) => { if (card.priorityId === args.id) card.priorityId = null; });
            return null;
          }
          case 'reorder_kanban_priorities': {
            (args.orderedIds as string[]).forEach((id, index) => {
              const priority = priorities.find((item) => item.id === id);
              if (priority) priority.position = index;
            });
            return [...priorities].sort((a, b) => a.position - b.position);
          }

          case 'create_kanban_tag': {
            const tag = { id: nextId('tag'), name: args.draft.name, color: args.draft.color, createdAt: now, updatedAt: now };
            tags.push(tag);
            return tag;
          }
          case 'update_kanban_tag': {
            const tag = tags.find((item) => item.id === args.id);
            Object.assign(tag, args.draft, { updatedAt: now });
            return tag;
          }
          case 'delete_kanban_tag': {
            tags = tags.filter((item) => item.id !== args.id);
            Object.keys(cardTags).forEach((cardId) => {
              cardTags[cardId] = cardTags[cardId].filter((id) => id !== args.id);
            });
            return null;
          }


          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      },
      transformCallback: (callback: (payload: unknown) => void) => {
        const id = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${id}`, callback);
        return id;
      }
    }});
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

async function addKanbanModule(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '编辑布局' }).click();
  await page.getByRole('button', { name: '添加模块' }).click();
  await page.getByRole('button', { name: '添加看板' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '完成编辑' }).click();
}

test('adds the kanban module with its lanes and a done entry outside them', async ({ page }) => {
  await addKanbanModule(page);
  await expect(page.getByRole('region', { name: '泳道：待处理' })).toBeVisible();
  await expect(page.getByRole('region', { name: '泳道：进行中' })).toBeVisible();
  await expect(page.locator('.kanban-lane')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '已完成：最近 7 天 0 件' })).toBeVisible();
});

async function addInline(lane: import('@playwright/test').Locator, laneName: string, title: string) {
  await lane.getByRole('button', { name: `在${laneName}添加任务` }).click();
  const input = lane.getByRole('textbox', { name: `在${laneName}添加任务` });
  await input.fill(title);
  await input.press('Enter');
  await expect(lane.getByRole('article', { name: `任务：${title}` })).toBeVisible();
  return input;
}

test('adds tasks inline under the default quadrant and keeps the input open', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  const input = await addInline(todo, '待处理', '撰写发布说明');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.fill('整理截图');
  await input.press('Enter');
  await expect(todo.getByRole('article', { name: '任务：整理截图' })).toBeVisible();
  await input.press('Escape');
  await expect(todo.getByRole('textbox')).toHaveCount(0);

  const card = todo.getByRole('article', { name: '任务：撰写发布说明' });
  // A bare card shows the quadrant dot and title only.
  await expect(card.getByRole('img', { name: '不重要不紧急' })).toBeVisible();
  await expect(card.locator('.kanban-card__meta')).toHaveCount(0);
  const workspace = await page.evaluate(async () =>
    (window as any).__TAURI_INTERNALS__.invoke('get_task_workspace_snapshot')
  ) as { tasks: Array<{ title: string; priority: string; completed: boolean }> };
  expect(workspace.tasks.find((task) => task.title === '撰写发布说明')).toMatchObject({
    priority: 'not_important_not_urgent', completed: false
  });
});

test('manages tags from the toolbar and applies them in the task dialog', async ({ page }) => {
  await addKanbanModule(page);

  await page.getByRole('button', { name: '管理标签' }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByLabel('新增标签').fill('性能');
  await page.getByRole('button', { name: '添加标签' }).click();
  await expect(page.getByRole('list', { name: '标签列表' })).toContainText('性能');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '新建任务' }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog.getByRole('radio', { name: '不重要不紧急' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '已完成' })).toHaveCount(0);
  await dialog.getByLabel('任务标题').fill('调优性能');
  await dialog.getByText('重要且紧急', { exact: true }).click();
  await expect(dialog.getByRole('radio', { name: '重要且紧急' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: '性能' }).check();
  await dialog.getByRole('button', { name: '保存任务' }).click();

  const card = page.getByRole('region', { name: '泳道：待处理' }).getByRole('article', { name: '任务：调优性能' });
  await expect(card.locator('.kanban-tag')).toContainText('性能');
  await expect(card.getByRole('img', { name: '重要且紧急' })).toBeVisible();
});

test('moves a card to an adjacent lane by dragging it', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await addInline(todo, '待处理', '迁移数据');
  const card = todo.getByRole('article', { name: '任务：迁移数据' });

  // Cards move by native HTML5 drag-and-drop. The drag payload lives in
  // component state (dataTransfer is unreliable in the webview), so dispatching
  // dragstart on the card and drop on the target lane is enough to move it. A
  // shared DataTransfer handle keeps the handlers' setData/effectAllowed happy.
  const doing = page.getByRole('region', { name: '泳道：进行中' });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer });
  await doing.dispatchEvent('dragover', { dataTransfer });
  await doing.dispatchEvent('drop', { dataTransfer });

  await expect(doing.getByRole('article', { name: '任务：迁移数据' })).toBeVisible();
  await expect(todo.getByRole('article', { name: '任务：迁移数据' })).toHaveCount(0);
});

test('creates a lane to the right from the lane menu', async ({ page }) => {
  await addKanbanModule(page);
  await page.getByRole('button', { name: '待处理泳道操作' }).click();
  await page.getByRole('menuitem', { name: '在右侧新建泳道' }).click();
  await page.getByLabel('泳道名称').fill('等待反馈');
  await page.getByRole('button', { name: '保存泳道' }).click();
  await expect(page.locator('.kanban-lane__name')).toHaveText(['待处理', '等待反馈', '进行中']);
});

test('completes a card by dropping it on the done zone and reopens it from the done list', async ({ page }) => {
  await addKanbanModule(page);
  const doing = page.getByRole('region', { name: '泳道：进行中' });
  const input = await addInline(doing, '进行中', '已有任务');
  await input.fill('发布版本');
  await input.press('Enter');
  await expect(doing.getByRole('article', { name: '任务：发布版本' })).toBeVisible();
  await input.press('Escape');
  const card = doing.getByRole('article', { name: '任务：发布版本' });

  await expect(page.getByTestId('kanban-done-drop')).toHaveCount(0);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer });
  const zone = page.getByTestId('kanban-done-drop');
  await expect(zone).toBeVisible();
  await expect(zone).toContainText('拖到这里标记完成');
  await zone.dispatchEvent('dragover', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });

  await expect(doing.getByRole('article', { name: '任务：发布版本' })).toHaveCount(0);
  const doneButton = page.getByRole('button', { name: '已完成：最近 7 天 1 件' });
  await expect(doneButton).toBeVisible();
  await expect(page.getByTestId('kanban-done-drop')).toHaveCount(0);

  await doneButton.click();
  const popup = page.getByRole('dialog', { name: '已完成' });
  await expect(popup).toContainText('发布版本');
  await expect(popup).toContainText('进行中 · 今天');
  await popup.getByRole('checkbox', { name: '标记任务为未完成：发布版本' }).click();

  await expect(doing.getByRole('article').first()).toHaveAccessibleName('任务：发布版本');
  await expect(page.getByRole('button', { name: '已完成：最近 7 天 0 件' })).toBeVisible();
  await expect(popup).toContainText('最近 7 天还没有完成的任务');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('deleting a lane takes its tasks off the board, and the last lane can go too', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await addInline(todo, '待处理', '临时任务');
  await todo.getByRole('textbox').press('Escape');

  await page.getByRole('button', { name: '待处理泳道操作' }).click();
  await page.getByRole('menuitem', { name: '删除泳道' }).click();
  await expect(page.getByRole('dialog', { name: /永久删除泳道“待处理”/ }))
    .toContainText('删除后，该泳道的 1 张任务会离开看板，仍保留在四象限中。');
  await page.getByRole('button', { name: '永久删除' }).click();

  await expect(page.getByRole('region', { name: '泳道：待处理' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: '任务：临时任务' })).toHaveCount(0);
  const workspace = await page.evaluate(async () =>
    (window as any).__TAURI_INTERNALS__.invoke('get_task_workspace_snapshot')
  ) as { tasks: Array<{ title: string; laneId: string | null }> };
  expect(workspace.tasks.find((task) => task.title === '临时任务')).toMatchObject({ laneId: null });

  await page.getByRole('button', { name: '进行中泳道操作' }).click();
  await page.getByRole('menuitem', { name: '删除泳道' }).click();
  await page.getByRole('button', { name: '永久删除' }).click();
  await expect(page.getByText(/还没有泳道/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^已完成/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
});

test('uses a single vertical scroll container so the board never scrolls horizontally', async ({ page }) => {
  await addKanbanModule(page);
  const scroll = page.getByTestId('kanban-scroll');
  await expect(scroll).toHaveCount(1);
  await expect(scroll).toHaveCSS('overflow-x', 'hidden');
  await expect(scroll).toHaveCSS('overflow-y', 'auto');
});
