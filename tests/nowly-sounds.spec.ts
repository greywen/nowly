import { expect, test } from '@playwright/test';

test('sound settings preview all assets and preserve choices after reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    localStorage.setItem('nowly.language', 'zh');
    const observed = window as unknown as { soundPlayers: HTMLAudioElement[] };
    observed.soundPlayers = [];
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio {
      constructor(source?: string) {
        super(source);
        observed.soundPlayers.push(this);
      }
    };
  });
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('tab', { name: 'Nowly Bar' }).click();
  await expect(dialog.getByRole('slider', { name: '提醒音量' })).toHaveValue('35');
  await dialog.getByRole('slider', { name: '提醒音量' }).fill('20');
  const choices = [
    ['日历提醒音效', '玻璃轻铃', 'chime-glass'], ['日历提醒音效', '木琴双音', 'chime-wood'],
    ['闹钟提醒音效', '上行铃声', 'bell-rise'], ['闹钟提醒音效', '柔和双音', 'beep-soft'],
    ['错过闹钟汇总音效', '轻点', 'tap'], ['错过闹钟汇总音效', '低敲', 'low-knock'],
    ['专注完成音效', '暖和弦', 'resolve'], ['专注完成音效', '完成短音', 'done-blip']
  ];
  for (const [scene, label, id] of choices) {
    await dialog.getByRole('combobox', { name: scene, exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await dialog.getByRole('button', { name: `试听 · ${scene}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const players = (window as unknown as { soundPlayers: HTMLAudioElement[] }).soundPlayers;
      return players.at(-1)?.currentTime ?? 0;
    })).toBeGreaterThan(0);
    expect(await page.evaluate(soundId => {
      const players = (window as unknown as { soundPlayers: HTMLAudioElement[] }).soundPlayers;
      const active = players.at(-1)!;
      return active.src.endsWith(`/sounds/${soundId}.wav`) && active.volume === 0.2 && active.error === null && players.slice(0, -1).every(player => player.paused);
    }, id)).toBe(true);
  }
  await dialog.getByRole('checkbox', { name: '启用提醒音效' }).uncheck();
  expect(await page.evaluate(() => (window as unknown as { soundPlayers: HTMLAudioElement[] }).soundPlayers.every(player => player.paused))).toBe(true);
  await dialog.getByRole('combobox', { name: '日历提醒音效' }).click();
  await page.getByRole('option', { name: '无', exact: true }).click();
  await page.screenshot({ path: 'test-results/nowly-sounds-desktop.png' });
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Nowly Bar' }).click();
  await expect(dialog.getByRole('checkbox', { name: '启用提醒音效' })).not.toBeChecked();
  await expect(dialog.getByRole('slider', { name: '提醒音量' })).toHaveValue('20');
  await expect(dialog.getByRole('combobox', { name: '日历提醒音效' })).toHaveText('无');
  await expect(dialog.getByRole('combobox', { name: '闹钟提醒音效' })).toHaveText('柔和双音');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => dialog.locator('.good-dialog__body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => dialog.locator('.settings-form').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.locator('.sound-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/nowly-sounds-mobile.png' });
});