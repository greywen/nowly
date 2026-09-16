import { expect, test, type Page } from '@playwright/test';

// 端到端跑在浏览器里，没有真实的 Tauri 后端，所以命令层被换成一份在内存里实现
// 同一套三选一语义的假后端：展开按规格第 5 节（EXDATE 删除、覆盖行改单次、
// 系列拆分做「此后所有」），查询按半开窗口过滤真实开始时间。
// 时钟钉在 2026-07-15，这样 2026 年 7 月的周一恰好是 6/13/20/27 四天。
async function installBackend(page: Page, options: { seedSeries: boolean }) {
  await page.addInitScript((opts: { seedSeries: boolean }) => {
    // 首启引导会盖住日历并拦截点击，端到端里直接标记为已看过。
    try {
      localStorage.setItem('nowly:onboarding-seen', 'true');
    } catch {
      /* 存储不可用时引导本就默认不展示 */
    }
    const now = '2026-07-15T09:42:00.000Z';
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now);
        // @ts-expect-error forward constructor args
        else super(...args);
      }
      static now() {
        return new RealDate(now).getTime();
      }
    }
    // @ts-expect-error replace global Date
    Date = FixedDate;

    const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const pad = (value: number) => String(value).padStart(2, '0');
    const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const dateOf = (naive: string) => {
      const [year, month, day] = naive.slice(0, 10).split('-').map(Number);
      return new Date(year, month - 1, day);
    };
    const addDays = (date: Date, count: number) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
    const dayDiff = (left: Date, right: Date) => Math.round((left.getTime() - right.getTime()) / 86_400_000);
    const weekStartOf = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

    let sequence = 1;
    let rows: any[] = opts.seedSeries
      ? [
          {
            id: 'series-1',
            title: '健身',
            startAt: '2026-07-06T09:00',
            endAt: '2026-07-06T10:00',
            allDay: false,
            category: 'work',
            color: '#4FC9DA',
            linkedTaskId: null,
            note: '',
            recurrence: { freq: 'weekly', interval: 1, byDay: ['MO'], end: { kind: 'never' } },
            createdAt: now,
            updatedAt: now
          }
        ]
      : [];
    // 例外行：kind 'deleted' 是 EXDATE，'override' 带一整条覆盖草稿。
    let exceptions: any[] = [];

    function matchesRule(rule: any, start: Date, cursor: Date) {
      if (rule.freq === 'daily') return dayDiff(cursor, start) % rule.interval === 0;
      if (rule.freq === 'weekly') {
        if (!rule.byDay.includes(WEEKDAYS[(cursor.getDay() + 6) % 7])) return false;
        return (dayDiff(weekStartOf(cursor), weekStartOf(start)) / 7) % rule.interval === 0;
      }
      if (rule.freq === 'monthly') {
        if (cursor.getDate() !== start.getDate()) return false;
        const months =
          (cursor.getFullYear() - start.getFullYear()) * 12 + (cursor.getMonth() - start.getMonth());
        return months % rule.interval === 0;
      }
      if (cursor.getDate() !== start.getDate() || cursor.getMonth() !== start.getMonth()) return false;
      return (cursor.getFullYear() - start.getFullYear()) % rule.interval === 0;
    }

    // 从 dtstart 逐日走到上界（半开），所以 count 是从系列开头数的，与后端一致。
    function slotsOf(row: any, limitExclusive: string) {
      const rule = row.recurrence;
      const time = row.startAt.slice(11);
      const start = dateOf(row.startAt);
      const limit = dateOf(limitExclusive);
      const until = rule.end.kind === 'until' ? dateOf(rule.end.date) : null;
      const maxCount = rule.end.kind === 'count' ? rule.end.count : Number.POSITIVE_INFINITY;
      const slots: string[] = [];
      let cursor = start;
      for (let guard = 0; guard < 4000; guard += 1) {
        if (cursor >= limit) break;
        if (until && cursor > until) break;
        if (slots.length >= maxCount) break;
        if (matchesRule(rule, start, cursor)) slots.push(`${isoOf(cursor)}T${time}`);
        cursor = addDays(cursor, 1);
      }
      return slots;
    }

    function expandedInstance(row: any, slot: string) {
      const spanDays = dayDiff(dateOf(row.endAt), dateOf(row.startAt));
      return {
        ...row,
        startAt: slot,
        endAt: `${isoOf(addDays(dateOf(slot), spanDays))}T${row.endAt.slice(11)}`,
        seriesId: row.id,
        seriesStartAt: row.startAt,
        occurrenceStartAt: slot,
        isOverridden: false
      };
    }

    function overriddenInstance(row: any, override: any, slot: string) {
      return {
        ...override,
        id: row.id,
        createdAt: row.createdAt,
        updatedAt: now,
        // 覆盖行不带规则也不带任务关联，两者都跟着系列走。
        recurrence: row.recurrence,
        linkedTaskId: row.linkedTaskId,
        seriesId: row.id,
        seriesStartAt: row.startAt,
        occurrenceStartAt: slot,
        isOverridden: true
      };
    }

    function singleEvent(row: any) {
      return { ...row, seriesId: null, seriesStartAt: null, occurrenceStartAt: null, isOverridden: false };
    }

    function listInRange(range: any) {
      // 覆盖行可能把实例挪出窗口、也可能从窗口外挪进来，所以先多展开一段，
      // 再一律按实例真实的开始时间做半开过滤。
      const horizon = `${isoOf(addDays(dateOf(range.endAtExclusive), 60))}T00:00`;
      const result: any[] = [];
      for (const row of rows) {
        if (!row.recurrence) {
          if (row.startAt >= range.startAt && row.startAt < range.endAtExclusive) result.push(singleEvent(row));
          continue;
        }
        for (const slot of slotsOf(row, horizon)) {
          const exception = exceptions.find((item) => item.seriesId === row.id && item.slot === slot);
          if (exception && exception.kind === 'deleted') continue;
          const instance = exception
            ? overriddenInstance(row, exception.row, slot)
            : expandedInstance(row, slot);
          if (instance.startAt >= range.startAt && instance.startAt < range.endAtExclusive) result.push(instance);
        }
      }
      return result;
    }

    function truncateBefore(row: any, slot: string) {
      const end =
        row.recurrence.end.kind === 'count'
          ? { kind: 'count', count: slotsOf(row, slot).length }
          : { kind: 'until', date: isoOf(addDays(dateOf(slot), -1)) };
      row.recurrence = { ...row.recurrence, end };
    }

    function applyToSeries(row: any, draft: any) {
      const slotsChanged =
        row.startAt !== draft.startAt || JSON.stringify(row.recurrence) !== JSON.stringify(draft.recurrence);
      if (slotsChanged) exceptions = exceptions.filter((item) => item.seriesId !== row.id);
      Object.assign(row, draft, { updatedAt: now });
    }

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: any = {}) => {
          if (command === 'list_events_in_range') return listInRange(args.range);
          if (command === 'create_event') {
            const row = { id: `e${sequence++}`, ...args.draft, createdAt: now, updatedAt: now };
            rows.push(row);
            return row.recurrence ? expandedInstance(row, row.startAt) : singleEvent(row);
          }
          if (command === 'update_event') {
            const { target, draft, scope } = args;
            const row = rows.find((item) => item.id === target.id);
            if (!row) throw { code: 'not_found', message: '日程不存在' };
            if (scope === 'all' || !row.recurrence) applyToSeries(row, draft);
            else if (scope === 'occurrence') {
              exceptions = exceptions.filter(
                (item) => !(item.seriesId === row.id && item.slot === target.occurrenceStartAt)
              );
              exceptions.push({
                seriesId: row.id,
                slot: target.occurrenceStartAt,
                kind: 'override',
                row: { ...draft, recurrence: null }
              });
            } else if (target.occurrenceStartAt === row.startAt) {
              // 首个实例上「此后所有」退化为「全部」。
              applyToSeries(row, draft);
            } else {
              exceptions = exceptions.filter(
                (item) => !(item.seriesId === row.id && item.slot >= target.occurrenceStartAt)
              );
              truncateBefore(row, target.occurrenceStartAt);
              rows.push({
                id: `e${sequence++}`,
                ...draft,
                linkedTaskId: null,
                createdAt: now,
                updatedAt: now
              });
            }
            return null;
          }
          if (command === 'delete_event') {
            const { target, scope } = args;
            const row = rows.find((item) => item.id === target.id);
            if (!row) throw { code: 'not_found', message: '日程不存在' };
            const dropSeries = () => {
              rows = rows.filter((item) => item.id !== row.id);
              exceptions = exceptions.filter((item) => item.seriesId !== row.id);
            };
            if (scope === 'all' || !row.recurrence) dropSeries();
            else if (scope === 'occurrence') {
              exceptions = exceptions.filter(
                (item) => !(item.seriesId === row.id && item.slot === target.occurrenceStartAt)
              );
              exceptions.push({ seriesId: row.id, slot: target.occurrenceStartAt, kind: 'deleted' });
            } else if (target.occurrenceStartAt === row.startAt) dropSeries();
            else {
              exceptions = exceptions.filter(
                (item) => !(item.seriesId === row.id && item.slot >= target.occurrenceStartAt)
              );
              truncateBefore(row, target.occurrenceStartAt);
            }
            return null;
          }
          if (command === 'list_tasks') return [];
          if (command === 'list_notes') return [];
          if (command === 'get_app_settings') {
            return {
              wallpaperEnabled: false,
              launchAtLogin: false,
              targetMonitorId: null,
              density: 'balanced',
              weekStart: 'monday',
              dateFormat: 'localized',
              showWeekends: true,
              recentColors: []
            };
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
  }, options);
}

const MONDAYS = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];

/** 某一天格子里标题匹配的日程 chip。断言「哪一次变了」只能靠日期格来分辨。 */
function chipsOn(page: Page, isoDate: string, title: string) {
  return page.locator(`[data-iso-date="${isoDate}"]`).getByRole('button', { name: new RegExp(title) });
}

/** 整个月视图里标题匹配的日程 chip，用来锁死总数。 */
function chipsInMonth(page: Page, title: string) {
  return page.locator('[data-calendar-day]').getByRole('button', { name: new RegExp(title) });
}

/** 打开某一天那一次实例的编辑弹窗。 */
async function openInstance(page: Page, isoDate: string, title = '健身') {
  await chipsOn(page, isoDate, title).click();
  await expect(page.getByRole('dialog', { name: '编辑日程' })).toBeVisible();
}

test('creates a weekly series and renders every occurrence of the month', async ({ page }) => {
  await installBackend(page, { seedSeries: false });
  await page.goto('/');
  await expect(page.getByText('本月暂无日程')).toBeVisible();

  await page.locator('[data-iso-date="2026-07-06"] .day-underlay').dblclick();
  await expect(page.getByRole('dialog', { name: '新建日程' })).toBeVisible();
  await page.getByLabel('日程标题').fill('健身');
  await page.getByRole('combobox', { name: '重复', exact: true }).click();
  await page.getByRole('option', { name: '每周', exact: true }).click();
  await page.getByRole('button', { name: '保存' }).click();

  // 四个周一各一次，且全月只有这四次——总数锁死「不多不少」。
  for (const isoDate of MONDAYS) {
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(1);
  }
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);
  // 非周一没有实例。
  await expect(chipsOn(page, '2026-07-07', '健身')).toHaveCount(0);
  // 每一次都带重复标识。
  await expect(page.locator('.event-repeat')).toHaveCount(4);
});

test('edits a single occurrence and leaves every other occurrence untouched', async ({ page }) => {
  await installBackend(page, { seedSeries: true });
  await page.goto('/');
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);

  await openInstance(page, '2026-07-13');
  await page.getByLabel('日程标题').fill('瑜伽');
  await page.getByRole('button', { name: '保存' }).click();

  const scope = page.getByRole('dialog', { name: '编辑重复日程' });
  await expect(scope).toBeVisible();
  // 非首个实例上三个范围都给。
  await expect(scope.getByRole('radio', { name: '此后所有' })).toHaveCount(1);
  await scope.getByRole('radio', { name: '仅此次' }).check();
  await scope.getByRole('button', { name: '确定' }).click();

  // 被改的那一次变了……
  await expect(chipsOn(page, '2026-07-13', '瑜伽')).toHaveCount(1);
  await expect(chipsOn(page, '2026-07-13', '健身')).toHaveCount(0);
  // ……其余三次一次都没动，且没有多出第五次。
  for (const isoDate of ['2026-07-06', '2026-07-20', '2026-07-27']) {
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(1);
    await expect(chipsOn(page, isoDate, '瑜伽')).toHaveCount(0);
  }
  await expect(chipsInMonth(page, '健身')).toHaveCount(3);
  await expect(chipsInMonth(page, '瑜伽')).toHaveCount(1);
});

test('edits this and following occurrences and leaves earlier ones untouched', async ({ page }) => {
  await installBackend(page, { seedSeries: true });
  await page.goto('/');
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);

  await openInstance(page, '2026-07-20');
  await page.getByLabel('日程标题').fill('晨练');
  await page.getByRole('button', { name: '保存' }).click();

  const scope = page.getByRole('dialog', { name: '编辑重复日程' });
  await scope.getByRole('radio', { name: '此后所有' }).check();
  await scope.getByRole('button', { name: '确定' }).click();

  // 切点之前原封不动。
  for (const isoDate of ['2026-07-06', '2026-07-13']) {
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(1);
    await expect(chipsOn(page, isoDate, '晨练')).toHaveCount(0);
  }
  // 切点及之后全变，且仍然是重复日程。
  for (const isoDate of ['2026-07-20', '2026-07-27']) {
    await expect(chipsOn(page, isoDate, '晨练')).toHaveCount(1);
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(0);
  }
  await expect(chipsInMonth(page, '健身')).toHaveCount(2);
  await expect(chipsInMonth(page, '晨练')).toHaveCount(2);
  await expect(page.locator('.event-repeat')).toHaveCount(4);
});

test('deletes a single occurrence and keeps the rest of the series', async ({ page }) => {
  await installBackend(page, { seedSeries: true });
  await page.goto('/');
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);

  await openInstance(page, '2026-07-13');
  await page.getByRole('button', { name: '删除日程' }).click();

  const scope = page.getByRole('dialog', { name: '删除重复日程' });
  await expect(scope).toBeVisible();
  await scope.getByRole('radio', { name: '仅此次' }).check();
  await scope.getByRole('button', { name: '确定' }).click();

  // 少了被删的那一次……
  await expect(chipsOn(page, '2026-07-13', '健身')).toHaveCount(0);
  // ……其余三次都还在，总数正好少一个。
  for (const isoDate of ['2026-07-06', '2026-07-20', '2026-07-27']) {
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(1);
  }
  await expect(chipsInMonth(page, '健身')).toHaveCount(3);
});

test('deletes the whole series from the first occurrence', async ({ page }) => {
  await installBackend(page, { seedSeries: true });
  await page.goto('/');
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);

  await openInstance(page, '2026-07-06');
  await page.getByRole('button', { name: '删除日程' }).click();

  const scope = page.getByRole('dialog', { name: '删除重复日程' });
  // 首个实例上「此后所有」等价于「全部」，不该出现。
  await expect(scope.getByRole('radio', { name: '此后所有' })).toHaveCount(0);
  await expect(scope.getByRole('radio', { name: '仅此次' })).toHaveCount(1);
  await scope.getByRole('radio', { name: '全部' }).check();
  await scope.getByRole('button', { name: '确定' }).click();

  // 整个系列都没了。
  await expect(chipsInMonth(page, '健身')).toHaveCount(0);
  for (const isoDate of MONDAYS) {
    await expect(chipsOn(page, isoDate, '健身')).toHaveCount(0);
  }
  await expect(page.getByText('本月暂无日程')).toBeVisible();
});

test('narrows the edit scopes on the first occurrence and applies to the whole series', async ({ page }) => {
  await installBackend(page, { seedSeries: true });
  await page.goto('/');
  await expect(chipsInMonth(page, '健身')).toHaveCount(4);

  await openInstance(page, '2026-07-06');
  await page.getByLabel('日程标题').fill('晨练');
  await page.getByRole('button', { name: '保存' }).click();

  const scope = page.getByRole('dialog', { name: '编辑重复日程' });
  await expect(scope.getByRole('radio', { name: '此后所有' })).toHaveCount(0);
  await scope.getByRole('radio', { name: '全部' }).check();
  await scope.getByRole('button', { name: '确定' }).click();

  for (const isoDate of MONDAYS) {
    await expect(chipsOn(page, isoDate, '晨练')).toHaveCount(1);
  }
  await expect(chipsInMonth(page, '晨练')).toHaveCount(4);
  await expect(chipsInMonth(page, '健身')).toHaveCount(0);
});
