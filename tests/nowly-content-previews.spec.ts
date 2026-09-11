// End-to-end coverage for content previews on kanban cards and notes.
//
// These need a real browser: the thumbnail is a blob: URL built from bytes that
// travel over IPC, and the assertions below check decoded image dimensions and
// computed layout, neither of which jsdom has.
import { expect, test, type Page } from '@playwright/test';

const IMAGE_ID = '0123456789abcdef0123456789abcdef.png';
const FILE_ID = 'fedcba9876543210fedcba9876543210.pdf';

// A real 64x40 PNG in the brand cyan. Decoding it proves the bytes survived the
// IPC round trip; a solid block also makes object-fit easy to judge.
const PNG = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,64,0,0,0,40,8,2,0,0,0,193,172,107,190,0,0,0,89,73,68,65,84,120,156,237,207,81,9,0,32,20,192,192,215,208,220,86,48,141,33,252,56,132,193,2,220,102,237,243,117,195,5,13,104,65,3,90,208,128,22,52,160,5,13,104,65,3,90,208,128,22,52,160,5,13,104,65,3,90,208,128,22,52,160,5,13,104,65,3,90,208,128,22,52,160,5,13,104,65,3,90,208,128,22,60,118,1,240,140,117,30,161,83,83,223,0,0,0,0,73,69,78,68,174,66,96,130];

type SeedArgs = { imageId: string; fileId: string; png: number[]; view: 'list' | 'board' };

function seed({ imageId, fileId, png, view }: SeedArgs) {
  try {
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:onboarding-seen', 'true');
    // The notes view lives in localStorage, not in module state.
    localStorage.setItem('nowly:notes-view', view);
  } catch { /* storage disabled */ }

  const now = '2026-07-23T09:42:00.000Z';
  const envelope = (ops: unknown[]) => JSON.stringify({ v: 1, ops });

  // Text, an image embed and a file link: everything a preview must summarise.
  const rich = envelope([
    { insert: '季度回顾的要点：设计稿已定稿，待评审。\n' },
    { insert: { image: `attachment:${imageId}` }, attributes: { alt: '预览图.png' } },
    { insert: '附件清单', attributes: { link: `attachment:${fileId}` } },
    { insert: '\n' }
  ]);

  const settings = {
    wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced',
    weekStart: 'monday', dateFormat: 'localized', showWeekends: true, iconStyle: 'duotone',
    hideTopbarInWallpaper: true, recentColors: [], calendarEnabled: true, matrixEnabled: true, notesEnabled: true
  };

  const notes = [
    { id: 'n1', title: '季度回顾', content: rich, color: '#E8C444', pinned: true, styleVariant: 2, icon: 'star', createdAt: now, updatedAt: now },
    { id: 'n2', title: '纯文字便签', content: '没有附件，只有一段普通的文字内容。', color: '#B8D935', pinned: false, styleVariant: 4, icon: '', createdAt: now, updatedAt: now }
  ];

  const lanes = [
    { id: 'lane-todo', name: '待处理', color: '#4FC9DA', position: 0, createdAt: now, updatedAt: now },
    { id: 'lane-doing', name: '进行中', color: '#E8C444', position: 1, createdAt: now, updatedAt: now }
  ];

  const workspace = {
    tasks: [
      { id: 't1', title: '整理发布说明', description: rich, priority: 'important_urgent', dueDate: '2026-07-23', completed: false, laneId: 'lane-todo', boardPosition: 0, tagIds: ['tag-1'], collaboratorIds: ['who-1'], views: ['kanban'], createdAt: now, updatedAt: now },
      { id: 't2', title: '无描述的任务', description: '', priority: null, dueDate: null, completed: false, laneId: 'lane-todo', boardPosition: 1, tagIds: [], collaboratorIds: [], views: ['kanban'], createdAt: now, updatedAt: now }
    ],
    lanes,
    tags: [{ id: 'tag-1', name: '设计', color: '#4F55DA', archivedAt: null, createdAt: now, updatedAt: now }],
    collaborators: [{ id: 'who-1', name: '小林', archivedAt: null, createdAt: now, updatedAt: now }],
    linkingEnabled: true,
    defaultLaneId: 'lane-todo',
    completionLaneId: 'lane-doing',
    viewPreferences: {}
  };

  // Both modules are placed directly; the picker flow is covered elsewhere.
  const layout = [
    { id: 'kanban', x: 0, y: 0, w: 6, h: 5 },
    { id: 'notes', x: 6, y: 0, w: 6, h: 5 }
  ];

  const attachments: Record<string, unknown> = {
    [imageId]: { id: imageId, fileName: '预览图.png', relPath: `attachments/${imageId}`, byteSize: png.length, mime: 'image/png', createdAt: now },
    [fileId]: { id: fileId, fileName: '附件清单.pdf', relPath: `attachments/${fileId}`, byteSize: 9, mime: 'application/pdf', createdAt: now }
  };

  const reads: string[] = [];
  (window as unknown as { __reads: () => string[] }).__reads = () => reads;

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case 'list_events_in_range':
          case 'list_external_events_in_range':
          case 'list_calendar_subscriptions':
          case 'list_extensions':
          case 'list_focus_sessions':
          case 'list_oauth_accounts':
          case 'list_tasks':
            return [];
          case 'list_notes': return notes;
          case 'get_app_settings': return settings;
          case 'list_module_layout': return layout;
          case 'save_module_layout': return layout;
          case 'get_module_state': return null;
          case 'set_module_state': return undefined;
          case 'get_task_workspace_snapshot': return workspace;
          case 'list_attachments': return (args.ids as string[]).map((id) => attachments[id]).filter(Boolean);
          case 'read_attachment':
            reads.push(args.id);
            return args.id === imageId ? png : [1, 2, 3];
          case 'enter_wallpaper_mode':
          case 'enter_foreground_mode':
            return 'ok';
          default: return null;
        }
      },
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${id}`, cb);
        return id;
      }
    }
  });
}

async function boot(page: Page, view: 'list' | 'board') {
  await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
  await page.addInitScript(seed, { imageId: IMAGE_ID, fileId: FILE_ID, png: PNG, view });
  await page.goto('/');
}

test('a kanban card shows its description and an attachment count', async ({ page }) => {
  await boot(page, 'list');
  const card = page.getByRole('article', { name: '任务：整理发布说明' });
  await expect(card).toBeVisible();

  // Flattened, not rendered: a clamped preview reads badly as markup, and this
  // keeps innerHTML out of the card. The space before 预览图.png matters — an
  // embed's stand-in text must not fuse with the prose beside it.
  await expect(card.locator('.kanban-card__desc')).toHaveText('季度回顾的要点：设计稿已定稿，待评审。 预览图.png 附件清单');
  // Images and files both count; the card has no room for a thumbnail, so the
  // paperclip is the only signal that anything is attached.
  await expect(card.getByLabel('2 个附件')).toHaveText('2');

  const style = await card.locator('.kanban-card__desc').evaluate((node) => {
    const s = getComputedStyle(node);
    return { fontSize: s.fontSize, color: s.color, clamp: s.webkitLineClamp };
  });
  // design.md Caption (0.85rem at the 13px root) and text-muted, matching the
  // due-date row so the card's meta text stays one scale.
  expect(style.fontSize).toBe('11.05px');
  expect(style.color).toBe('rgb(150, 142, 126)');
  expect(style.clamp).toBe('2');

  // A card with no description renders no description region at all.
  const bare = page.getByRole('article', { name: '任务：无描述的任务' });
  await expect(bare.locator('.kanban-card__desc')).toHaveCount(0);
  await expect(bare.locator('.kanban-card__clip')).toHaveCount(0);
});

test('a note in list view shows a thumbnail beside its text', async ({ page }) => {
  await boot(page, 'list');
  await expect(page.getByTestId('notes-list')).toBeVisible();

  const thumb = page.locator('.note-thumb');
  await expect(thumb).toBeVisible();
  const probe = await thumb.evaluate((node) => {
    const image = node as HTMLImageElement;
    const s = getComputedStyle(image);
    return {
      isBlob: image.src.startsWith('blob:'),
      // Non-zero natural size proves the bytes survived the IPC round trip.
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: s.width,
      height: s.height,
      radius: s.borderRadius,
      objectFit: s.objectFit
    };
  });
  expect(probe.isBlob).toBe(true);
  expect(probe.naturalWidth).toBe(64);
  expect(probe.naturalHeight).toBe(40);
  expect(probe.width).toBe('48px');
  expect(probe.height).toBe('48px');
  // radius-sm, matching the row's own corner per design.md §5.
  expect(probe.radius).toBe('7.6px');
  expect(probe.objectFit).toBe('cover');

  await expect(page.locator('.note-clip').first()).toHaveText('2');
  // Only the image is fetched. Reading the file's bytes would build an object
  // URL nothing renders, at up to 1MB each.
  expect(await page.evaluate(() => (window as unknown as { __reads(): string[] }).__reads())).toEqual([IMAGE_ID]);

  // The plain note gets neither a thumbnail nor a paperclip.
  const plain = page.getByRole('button', { name: /纯文字便签/ });
  await expect(plain.locator('.note-thumb')).toHaveCount(0);
  await expect(plain.locator('.note-clip')).toHaveCount(0);
});

test('a sticky note shows its thumbnail without breaking the sheet', async ({ page }) => {
  await boot(page, 'board');
  await expect(page.getByTestId('notes-board')).toBeVisible();

  const thumb = page.locator('.sticky-note__thumb');
  await expect(thumb).toBeVisible();
  const probe = await thumb.evaluate((node) => {
    const image = node as HTMLImageElement;
    const s = getComputedStyle(image);
    const sheet = image.closest('.sticky-note')!.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      // Read the CSS box, not the client rect: the sheet carries a rotate()
      // transform, so the rect is the rotated element's axis-aligned bounds and
      // is taller than the element itself.
      cssHeight: s.height,
      radius: s.borderRadius,
      spillsRight: Math.round(box.right - sheet.right),
      spillsBottom: Math.round(box.bottom - sheet.bottom)
    };
  });
  expect(probe.naturalWidth).toBe(64);
  // 3x the sheet's 24px ruled-line spacing, so the ruling stays in step with the
  // text above the image.
  expect(probe.cssHeight).toBe('72px');
  expect(Number(probe.cssHeight.replace('px', '')) % 24).toBe(0);
  expect(probe.radius).toBe('7.6px');
  expect(probe.spillsRight).toBeLessThanOrEqual(0);
  expect(probe.spillsBottom).toBeLessThanOrEqual(0);

  await expect(page.locator('.sticky-note__clip').first()).toHaveText('2');
});
