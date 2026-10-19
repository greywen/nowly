import { expect, test } from '@playwright/test';
import { defaultTimeSettings } from '../src/time/time-model';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(timeSettings => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:browser-backend', JSON.stringify({
      settings: { wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced', weekStart: 'monday', dateFormat: 'localized', showWeekends: true },
      timeSettings,
      moduleLayout: [{ id: 'time', x: 0, y: 0, w: 4, h: 4 }]
    }));
  }, {...defaultTimeSettings(),displayContent:'focus'});
  await page.goto('/');
});

test('starts focus and automatically presents the wallpaper fullscreen timer',async({page})=>{
  await expect(page.getByRole('button',{name:'开始专注'})).toBeVisible();
  await page.getByRole('button',{name:'开始专注'}).click();
  await page.getByRole('button',{name:/设为壁纸|Set as wallpaper/}).click();
  const fullscreen=page.getByRole('region',{name:'全屏专注'});
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.getByRole('timer')).toContainText(/24:5\d|25:00/);
  const background=await fullscreen.evaluate(element=>{const style=getComputedStyle(element);return{color:style.backgroundColor,image:style.backgroundImage}});
  expect(background).toEqual({color:'rgb(248, 246, 242)',image:'none'});
  await expect(fullscreen.locator('.focus-fullscreen__shape')).toHaveCount(3);
  await page.evaluate(async () => {
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    await internals.invoke('cancel_focus_timer');
  });
  await expect(page.getByRole('region',{name:'全屏专注'})).toHaveCount(0);
});

for (const pauseFirst of [false, true]) {
  test(`shows clocks after ${pauseFirst ? 'pausing and ' : ''}resetting focus and entering wallpaper`, async ({ page }) => {
    await page.getByRole('button', { name: '开始专注', exact: true }).click();
    if (pauseFirst) await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '重置计时', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
    await expect(page.getByRole('region', { name: '全屏专注' })).toHaveCount(0);
    await expect(page.getByTestId('time-widget')).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByText('双击返回前台以操作专注计时')).toBeHidden();
    await page.getByTestId('time-widget').dblclick();
    await expect(page.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '专注时段', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
}

test('keeps focus statistics access in a constrained unified module',async({page})=>{
  await page.locator('.focus-timer').evaluate(element=>{(element as HTMLElement).style.width='400px';(element as HTMLElement).style.height='350px'});
  await expect(page.locator('.focus-timer__trend-chart')).toBeHidden();
  await expect(page.getByRole('button',{name:'专注统计'})).toBeVisible();
  const style=await page.getByRole('button',{name:'专注统计'}).evaluate(element=>({height:getComputedStyle(element).height,transitionDuration:getComputedStyle(element).transitionDuration}));
  expect(style.height).toBe('40px');
  expect(style.transitionDuration).toBe('0s');
});
