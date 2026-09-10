import { expect, test } from '@playwright/test';

test('shows the persisted-data empty dashboard without page overflow or motion', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const settings = {
      wallpaperEnabled: false,
      launchAtLogin: false,
      targetMonitorId: null,
      density: 'balanced',
      weekStart: 'monday',
      dateFormat: 'localized',
      showWeekends: true,
      calendarEnabled: true,
      matrixEnabled: true,
      notesEnabled: true
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'get_app_settings') return settings;
          // The app reads the shared task workspace, not just legacy list_tasks.
          if (command === 'get_task_workspace_snapshot') return {
            tasks: [], lanes: [], tags: [], collaborators: [], linkingEnabled: true,
            defaultLaneId: 'kanban-lane-todo', completionLaneId: 'kanban-lane-done', viewPreferences: {}
          };
          if (command === 'list_events_in_range' || command === 'list_tasks' || command === 'list_notes') return [];
          if (command === 'create_task' || command === 'update_task' || command === 'delete_task' || command === 'set_task_completed') {
            throw new Error('Unexpected task write in empty-startup test');
          }
          if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
          throw new Error(`Unexpected command: ${command}`);
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          const id = Math.floor(Math.random() * 2 ** 32);
          Reflect.set(window, `_${id}`, callback);
          return id;
        }
      }
    });
  });
  await page.goto('/');

  await expect(page.getByText('本月暂无日程')).toBeVisible();
  await expect(page.getByText('暂无任务')).toHaveCount(4);
  await expect(page.getByText('还没有便签')).toBeVisible();
  await expect(page.getByText('设计评审')).toHaveCount(0);

  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    shellBackground: getComputedStyle(document.querySelector('.app-shell')!).backgroundColor,
    topbarBackground: getComputedStyle(document.querySelector('.topbar')!).backgroundColor,
    moduleBackgrounds: Array.from(document.querySelectorAll('.card'), (card) => getComputedStyle(card).backgroundColor),
    transition: getComputedStyle(document.querySelector('.btn')!).transitionDuration,
    animation: getComputedStyle(document.querySelector('.btn')!).animationName
  }));
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.bodyBackground).toBe('rgb(255, 255, 255)');
  expect(metrics.shellBackground).toBe('rgb(255, 255, 255)');
  expect(metrics.topbarBackground).toBe('rgb(248, 246, 242)');
  expect(metrics.moduleBackgrounds.length).toBeGreaterThan(0);
  expect(metrics.moduleBackgrounds.every((background) => background === 'rgba(248, 246, 242, 0.3)')).toBe(true);
  expect(metrics.transition).toBe('0s');
  expect(metrics.animation).toBe('none');

  await page.locator('[data-guide="edit-layout"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('.module-frame__toolbar').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('keeps action buttons at 40px without resizing calendar content controls', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    localStorage.setItem('nowly:browser-backend', JSON.stringify({
      moduleLayout: [{ id: 'calendar', x: 0, y: 0, w: 12, h: 8 }]
    }));
  });
  await page.goto('/');

  const actionButtons = [
    page.getByRole('button', { name: '设为壁纸' }),
    page.getByRole('button', { name: '编辑布局' }),
    page.getByRole('button', { name: '今天' }),
    page.getByRole('button', { name: '新建日程' })
  ];

  for (const button of actionButtons) {
    await expect(button).toHaveCSS('height', '40px');
  }

  await page.getByRole('button', { name: '新建日程' }).click();
  await expect(page.getByRole('button', { name: '取消' })).toHaveCSS('height', '40px');
  await expect(page.getByRole('button', { name: '保存' })).toHaveCSS('height', '40px');

  const calendarDay = page.locator('.day-underlay').first();
  await expect(calendarDay).not.toHaveCSS('height', '40px');
});
