import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly:browser-backend')) {
      localStorage.setItem('nowly:browser-backend', JSON.stringify({
        alarmFormatVersion: 1,
        notes: Array.from({ length: 30 }, (_, index) => ({
          id: `note-${index}`, content: index < 2 ? '重复标题\n中文正文' : `便签 ${index}\n完整正文`,
          color: '#E8C444', pinned: false, styleVariant: 0, icon: '',
          createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z'
        })),
        moduleLayout: [{ id: 'notes', x: 0, y: 0, w: 12, h: 8 }]
      }));
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: '查看全部便签' }).click();
});

test('downloads selected notes in a portable ZIP and keeps the stored notes unchanged', async ({ page }) => {
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('nowly:browser-backend')!).notes);
  await page.getByRole('button', { name: '导出便签', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出所选便签' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '选择便签：重复标题', exact: true }).nth(0).check();
  await page.getByRole('checkbox', { name: '选择便签：重复标题', exact: true }).nth(1).check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出所选便签' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Nowly-Notes-markdown.zip');
  const files = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files)).toEqual(['001-重复标题/重复标题.md', '002-重复标题/重复标题.md']);
  for (const bytes of Object.values(files)) expect(strFromU8(bytes)).toContain('中文正文');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowly:browser-backend')!).notes)).toEqual(original);
  await expect(page.getByRole('status')).toHaveText('已导出');
});

test('keeps the last note and export actions reachable in short and narrow windows', async ({ page }, info) => {
  await page.getByRole('button', { name: '导出便签', exact: true }).click();
  for (const viewport of [{width:1366,height:768}, {width:1024,height:600}, {width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const last = page.getByRole('checkbox', {name:'选择便签：便签 9',exact:true});
    await last.scrollIntoViewIfNeeded();
    await last.check();
    const clipped = await last.evaluate(element => {
      const box = element.getBoundingClientRect();
      const body = element.closest('.good-dialog__body')!.getBoundingClientRect();
      return box.bottom > body.bottom || box.top < body.top;
    });
    expect(clipped).toBe(false);
    await expect(page.getByRole('checkbox', {name:'全选便签',exact:true})).toBeInViewport();
    expect(await page.locator('.good-dialog__body').evaluate(element => element.scrollTop)).toBe(0);
    const card = last.locator('..');
    expect(await card.evaluate(element => {
      const box = element.getBoundingClientRect();
      const list = element.closest('.notes-manager-list')!.getBoundingClientRect();
      return box.right <= list.right && box.left >= list.left;
    })).toBe(true);
    await expect(page.getByRole('button', {name:'导出所选便签'})).toBeInViewport();
    expect(await page.locator('.notes-manager-dialog').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  }
  await page.screenshot({path:info.outputPath('note-export-mobile.png')});
});

test('exports a Markdown image link that resolves to the original bytes in the ZIP', async ({ page }) => {
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'新增便签',exact:true}).click();
  await page.locator('#note-content').fill('附件测试\n图片正文');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFk0AAAAASUVORK5CYII=', 'base64');
  await page.locator('.rich-editor__file-input').setInputFiles({name:'中文 图片.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('#note-content img')).toBeVisible();
  await page.getByRole('button',{name:'保存便签',exact:true}).click();
  await page.getByRole('button',{name:'查看全部便签'}).click();
  await page.getByRole('button',{name:/编辑便签：.*附件测试/}).click();
  await page.getByRole('button',{name:'导出便签',exact:true}).click();
  await expect(page.getByText(/完整解压 ZIP.*保留.*assets\//)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button',{name:'导出所选便签'}).click();
  const file = await downloading;
  const files = unzipSync(await readFile((await file.path())!));
  const markdownPaths = Object.keys(files).filter(name => name.endsWith('.md'));
  expect(markdownPaths).toHaveLength(1);
  const [markdownPath] = markdownPaths;
  const md = strFromU8(files[markdownPath]);
  const imageLink = /!\[中文 图片\.png\]\((assets\/[^)\s]+)\)/.exec(md);
  expect(imageLink, md).not.toBeNull();
  const image = files[posix.join(posix.dirname(markdownPath), decodeURIComponent(imageLink![1]))];
  expect(image).toEqual(new Uint8Array(png));
  expect(md).not.toMatch(/attachment:|blob:/);
});
