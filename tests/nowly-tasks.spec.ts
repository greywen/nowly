import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __NOWLY_FAIL_NEXT_COMPLETION__: () => void;
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = '2026-07-23T09:42:00.000Z';
    let sequence = 2;
    let failNextCompletion = false;
    let events: any[] = [{
      id:'e1', title:'设计评审', startAt:'2026-07-23T14:00', endAt:'2026-07-23T15:00',
      allDay:false, category:'work', color:'blue', linkedTaskId:null, note:'', createdAt:now, updatedAt:now
    }];
    const lanes = [
      { id:'lane-todo', name:'待处理', color:'#4FC9DA', position:0, createdAt:now, updatedAt:now },
      { id:'lane-doing', name:'进行中', color:'#E8C444', position:1, createdAt:now, updatedAt:now },
      { id:'lane-done', name:'已完成', color:'#B8D935', position:2, createdAt:now, updatedAt:now }
    ];
    let tasks: any[] = [{
      id:'t1', title:'发布 Nowly', description:'', priority:'important_urgent', dueDate:'2026-07-23',
      completed:false, laneId:'lane-todo', boardPosition:0, tagIds:[], collaboratorIds:[],
      linkedEventId:null, views:['kanban','matrix','calendar'], createdAt:now, updatedAt:now
    }];
    const coordinateViews = (task: any) => ({
      ...task,
      views:['kanban', ...(task.priority ? ['matrix'] : []), ...(task.dueDate ? ['calendar'] : [])]
    });
    const snapshot = () => ({
      tasks, lanes, tags:[], collaborators:[], linkingEnabled:true,
      defaultLaneId:'lane-todo', completionLaneId:'lane-done', viewPreferences:{}
    });
    const settings = {
      wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced',
      weekStart:'monday', dateFormat:'localized', showWeekends:true,
      calendarEnabled:true, matrixEnabled:true, notesEnabled:true
    };
    window.__NOWLY_FAIL_NEXT_COMPLETION__ = () => { failNextCompletion = true; };
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: any = {}) => {
        if (command === 'list_events_in_range') {
          return events.filter((event) => event.startAt >= args.range.startAt && event.startAt < args.range.endAtExclusive);
        }
        if (command === 'get_task_workspace_snapshot') return snapshot();
        if (command === 'list_notes') return [];
        if (command === 'get_app_settings') return settings;
        if (command === 'create_task') {
          const laneId = args.draft.laneId ?? 'lane-todo';
          let task = coordinateViews({
            id:`t${sequence++}`, description:'', priority:null, dueDate:null, completed:false,
            laneId, boardPosition:tasks.filter((item) => item.laneId === laneId).length,
            tagIds:[], collaboratorIds:[], linkedEventId:null, ...args.draft,
            createdAt:now, updatedAt:now
          });
          if (task.linkedEventId) {
            tasks = tasks.map((item) => item.linkedEventId === task.linkedEventId ? { ...item, linkedEventId:null, updatedAt:now } : item);
            events = events.map((event) => event.id === task.linkedEventId ? { ...event, linkedTaskId:task.id, updatedAt:now } : event);
          }
          tasks.push(task);
          return task;
        }
        if (command === 'update_task') {
          const previous = tasks.find((task) => task.id === args.id);
          if (!previous) throw { code:'not_found', message:'未找到该任务。' };
          events = events.map((event) => event.linkedTaskId === args.id ? { ...event, linkedTaskId:null, updatedAt:now } : event);
          tasks = tasks.map((task) => task.id !== args.id && task.linkedEventId === args.draft.linkedEventId
            ? { ...task, linkedEventId:null, updatedAt:now } : task);
          const updated = coordinateViews({ ...previous, ...args.draft, updatedAt:now });
          tasks = tasks.map((task) => task.id === args.id ? updated : task);
          if (updated.linkedEventId) {
            events = events.map((event) => event.id === updated.linkedEventId ? { ...event, linkedTaskId:updated.id, updatedAt:now } : event);
          }
          return updated;
        }
        if (command === 'delete_task') {
          events = events.map((event) => event.linkedTaskId === args.id ? { ...event, linkedTaskId:null, updatedAt:now } : event);
          tasks = tasks.filter((task) => task.id !== args.id);
          return null;
        }
        if (command === 'set_task_completed') {
          if (failNextCompletion) {
            failNextCompletion = false;
            throw { code:'database_error', message:'完成状态保存失败' };
          }
          const task = tasks.find((task) => task.id === args.id);
          if (!task) throw { code:'not_found', message:'未找到该任务。' };
          const updated = {
            ...task,
            completed:args.completed,
            laneId:args.completed ? 'lane-done' : 'lane-todo',
            updatedAt:now
          };
          tasks = tasks.map((task) => task.id === args.id ? updated : task);
          return updated;
        }
        if (command === 'move_task_to_priority') {
          const task = tasks.find((item) => item.id === args.id);
          const updated = coordinateViews({ ...task, priority:args.priority, updatedAt:now });
          tasks = tasks.map((item) => item.id === args.id ? updated : item);
          return updated;
        }
        if (command === 'move_task_to_date') {
          const task = tasks.find((item) => item.id === args.id);
          const updated = coordinateViews({ ...task, dueDate:args.dueDate, updatedAt:now });
          tasks = tasks.map((item) => item.id === args.id ? updated : item);
          return updated;
        }
        if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
        throw new Error(`Unexpected command: ${command}`);
      },
      transformCallback: (callback: (payload: unknown) => void) => {
        const id = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${id}`, callback);
        return id;
      }
    }});
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name:'编辑任务：发布 Nowly' })).toBeVisible();
});

test('creates from date detail, moves quadrant, links, and deletes without deleting the event', async ({ page }) => {
  // Task/event chips occupy the body of the day cell; click its uncovered
  // top-left area rather than bypassing actionability with force.
  await page.getByRole('button', { name:'2026年7月23日' }).click({ position: { x: 8, y: 8 } });
  await page.getByRole('button', { name:'新建任务' }).click();
  await expect(page.getByRole('button', { name:'截止日期' })).toContainText('23 日');
  await page.getByLabel('任务标题').fill('发布任务');
  await page.getByRole('combobox', { name:'所属象限' }).click();
  await page.getByRole('option', { name:'重要且紧急', exact:true }).click();
  await page.getByRole('combobox', { name:'关联日程' }).click();
  await page.getByRole('option', { name:'设计评审' }).click();
  await page.getByRole('button', { name:'保存任务' }).click();
  await page.getByRole('button', { name:'关闭日期详情' }).click();

  await page.getByRole('button', { name:'编辑任务：发布任务' }).click();
  await page.getByRole('combobox', { name:'所属象限' }).click();
  await page.getByRole('option', { name:'重要不紧急', exact:true }).click();
  await page.getByRole('button', { name:'保存任务' }).click();
  const quadrant = page.getByRole('region', { name:'重要不紧急', exact:true });
  await expect(quadrant.getByRole('button', { name:'编辑任务：发布任务' })).toBeVisible();

  await quadrant.getByRole('button', { name:'编辑任务：发布任务' }).click();
  await page.getByRole('button', { name:'删除任务' }).click();
  await expect(page.getByRole('dialog', { name:'永久删除“发布任务”？' })).toContainText('不删除关联日程');
  await page.getByRole('button', { name:'永久删除' }).click();
  await expect(page.getByRole('button', { name:'编辑任务：发布任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name:/设计评审/ })).toBeVisible();
});

test('rolls back failed completion and retries the original target', async ({ page }) => {
  await page.evaluate(() => window.__NOWLY_FAIL_NEXT_COMPLETION__());
  const checkbox = page.getByRole('checkbox', { name:'完成任务：发布 Nowly' });
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.completion-message')).toContainText('完成状态保存失败');
  await page.getByRole('button', { name:'重试完成状态' }).click();
  await expect(page.getByRole('checkbox', { name:'标记任务为未完成：发布 Nowly' })).toBeChecked();
  await expect(page.getByText(/已完成/)).toBeVisible();
});

test('shows metadata inline and never as a hover or focus tooltip', async ({ page }) => {
  // The task row now renders due date and priority as a persistent inline meta
  // line instead of the old hover/focus tooltip, so the metadata is always
  // visible and no tooltip appears on either interaction.
  await expect(page.getByText('今天到期 · 高优先级')).toBeVisible();

  const title = page.getByRole('button', { name:'编辑任务：发布 Nowly' });
  await title.hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await title.focus();
  await expect(title).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});
