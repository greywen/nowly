import { expect, test } from '@playwright/test';

// A self-contained in-memory kanban backend injected as the Tauri IPC layer, so
// the acceptance flow exercises the real UI, hook, and repository adapter
// without the native host. It mirrors the transactional renumbering the Rust
// backend performs so optimistic updates and reloads stay consistent.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
  await page.addInitScript(() => {
    const now = '2026-07-23T09:42:00.000Z';
    let sequence = 1;
    const nextId = (prefix: string) => `${prefix}-${sequence++}`;

    let lanes: any[] = [
      { id: 'lane-todo', name: '待处理', color: 'primary', position: 0, createdAt: now, updatedAt: now },
      { id: 'lane-doing', name: '进行中', color: 'warning', position: 1, createdAt: now, updatedAt: now },
      { id: 'lane-done', name: '已完成', color: 'success', position: 2, createdAt: now, updatedAt: now }
    ];
    let cards: any[] = [];
    let priorities: any[] = [];
    let tags: any[] = [];
    let collaborators: any[] = [];
    const cardTags: Record<string, string[]> = {};
    const cardCollaborators: Record<string, string[]> = {};

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
      tagIds: cardTags[card.id] ?? [],
      collaboratorIds: cardCollaborators[card.id] ?? []
    });

    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: any = {}) => {
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

          case 'get_kanban_snapshot':
            return {
              lanes: [...lanes].sort((a, b) => a.position - b.position),
              cards: cards.map(buildCard),
              priorities: [...priorities].sort((a, b) => a.position - b.position),
              tags,
              collaborators
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
            cardCollaborators[card.id] = args.draft.collaboratorIds ?? [];
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
            cardCollaborators[card.id] = args.draft.collaboratorIds ?? [];
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

          case 'create_kanban_collaborator': {
            const person = { id: nextId('person'), name: args.draft.name, createdAt: now, updatedAt: now };
            collaborators.push(person);
            return person;
          }
          case 'update_kanban_collaborator': {
            const person = collaborators.find((item) => item.id === args.id);
            Object.assign(person, args.draft, { updatedAt: now });
            return person;
          }
          case 'delete_kanban_collaborator': {
            collaborators = collaborators.filter((item) => item.id !== args.id);
            Object.keys(cardCollaborators).forEach((cardId) => {
              cardCollaborators[cardId] = cardCollaborators[cardId].filter((id) => id !== args.id);
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
  await page.goto('/');
});

async function addKanbanModule(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '编辑布局' }).click();
  await page.getByRole('button', { name: '添加模块' }).click();
  await page.getByRole('button', { name: '添加看板' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '编辑布局' }).click();
}

test('adds the kanban module, showing the three default lanes', async ({ page }) => {
  await addKanbanModule(page);
  await expect(page.getByRole('region', { name: '泳道：待处理' })).toBeVisible();
  await expect(page.getByRole('region', { name: '泳道：进行中' })).toBeVisible();
  await expect(page.getByRole('region', { name: '泳道：已完成' })).toBeVisible();
});

test('creates a task in a lane and shows only the fields that have values', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await todo.getByRole('button', { name: '在待处理新增任务' }).click();

  await expect(page.getByRole('dialog', { name: /在“待处理”新建任务/ })).toBeVisible();
  await page.getByLabel('任务标题').fill('撰写发布说明');
  await page.getByRole('button', { name: '保存任务' }).click();

  await expect(todo.getByRole('button', { name: '任务操作：撰写发布说明' })).toBeVisible();
  const card = todo.getByRole('article', { name: '任务：撰写发布说明' });
  // Empty optional fields render nothing at all.
  await expect(card.locator('.kanban-card__desc')).toHaveCount(0);
  await expect(card.locator('.kanban-badge')).toHaveCount(0);
  await expect(card.locator('.kanban-card__meta')).toHaveCount(0);
});

test('manages global fields from the board menu and applies them to a card', async ({ page }) => {
  await addKanbanModule(page);

  await page.getByRole('button', { name: '看板更多操作' }).click();
  await page.getByRole('menuitem', { name: '管理字段' }).click();
  await page.getByLabel('新增优先级').fill('高');
  await page.getByRole('button', { name: '添加优先级' }).click();
  await expect(page.getByRole('list', { name: '优先级列表' })).toContainText('高');
  await page.getByRole('button', { name: '关闭' }).click();

  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await todo.getByRole('button', { name: '在待处理新增任务' }).click();
  await page.getByLabel('任务标题').fill('调优性能');
  await page.getByRole('combobox', { name: '优先级' }).click();
  await page.getByRole('option', { name: '高' }).click();
  await page.getByRole('button', { name: '保存任务' }).click();

  const card = todo.getByRole('article', { name: '任务：调优性能' });
  await expect(card.locator('.kanban-badge')).toContainText('高');
});

test('moves a card to an adjacent lane through the keyboard menu', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await todo.getByRole('button', { name: '在待处理新增任务' }).click();
  await page.getByLabel('任务标题').fill('迁移数据');
  await page.getByRole('button', { name: '保存任务' }).click();

  await todo.getByRole('button', { name: '任务操作：迁移数据' }).click();
  await page.getByRole('menuitem', { name: '移至右侧泳道' }).click();

  const doing = page.getByRole('region', { name: '泳道：进行中' });
  await expect(doing.getByRole('button', { name: '任务操作：迁移数据' })).toBeVisible();
  await expect(todo.getByRole('button', { name: '任务操作：迁移数据' })).toHaveCount(0);
});

test('deleting a lane confirms the task count and cascades', async ({ page }) => {
  await addKanbanModule(page);
  const todo = page.getByRole('region', { name: '泳道：待处理' });
  await todo.getByRole('button', { name: '在待处理新增任务' }).click();
  await page.getByLabel('任务标题').fill('临时任务');
  await page.getByRole('button', { name: '保存任务' }).click();

  await todo.getByRole('button', { name: '泳道操作：待处理' }).click();
  await page.getByRole('menuitem', { name: '编辑泳道' }).click();
  await page.getByRole('button', { name: '删除泳道' }).click();
  await expect(page.getByRole('dialog', { name: /永久删除泳道“待处理”/ })).toContainText('1 张任务');
  await page.getByRole('button', { name: '永久删除' }).click();

  await expect(page.getByRole('region', { name: '泳道：待处理' })).toHaveCount(0);
});

test('uses a single bidirectional scroll container for the board', async ({ page }) => {
  await addKanbanModule(page);
  const scroll = page.getByTestId('kanban-scroll');
  await expect(scroll).toHaveCount(1);
  await expect(scroll).toHaveCSS('overflow', 'auto');
});
