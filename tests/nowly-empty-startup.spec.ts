import { expect, test } from '@playwright/test';

test('shows the persisted-data empty dashboard without page overflow or motion', async ({ page }) => {
  await page.addInitScript(() => {
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
    transition: getComputedStyle(document.querySelector('.btn')!).transitionDuration,
    animation: getComputedStyle(document.querySelector('.btn')!).animationName
  }));
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.transition).toBe('0s');
  expect(metrics.animation).toBe('none');
});
