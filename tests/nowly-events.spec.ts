import { expect, test } from '@playwright/test';

declare global { interface Window { __NOWLY_TEST_CALLS__: Array<{command:string;args:any}> } }

test.beforeEach(async ({page})=>{
 await page.addInitScript(()=>{
  try{localStorage.setItem('nowly:onboarding-seen','true');}catch{/* storage disabled */}
  const now='2026-07-23T09:42:00.000Z'; let sequence=1; let events:any[]=[];
  let tasks:any[]=[{id:'t1',title:'发布 Nowly v0.1',quadrant:'important_urgent',dueAt:null,priority:1,completed:false,linkedEventId:null,note:'',createdAt:now,updatedAt:now}];
  const settings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,calendarEnabled:true,matrixEnabled:true,notesEnabled:true};
  window.__NOWLY_TEST_CALLS__=[];
  Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any={})=>{
   window.__NOWLY_TEST_CALLS__.push({command,args});
   if(command==='list_events_in_range')return events.filter(e=>e.startAt>=args.range.startAt&&e.startAt<args.range.endAtExclusive);
   if(command==='create_event'){const e={id:`e${sequence++}`,...args.draft,recurrence:args.draft.recurrence??null,seriesId:null,seriesStartAt:null,occurrenceStartAt:null,isOverridden:false,createdAt:now,updatedAt:now};events.push(e);if(e.linkedTaskId)tasks=tasks.map(t=>t.id===e.linkedTaskId?{...t,linkedEventId:e.id}:t);return e;}
   if(command==='update_event'){const id=args.target?.id??args.id;const old=events.find(e=>e.id===id);const updated={...old,...args.draft,updatedAt:now};events=events.map(e=>e.id===id?updated:e);return updated;}
   if(command==='delete_event'){const id=args.target?.id??args.id;events=events.filter(e=>e.id!==id);return null;}
   if(command==='list_tasks')return tasks;
   if(command==='create_task'){const t={id:`t${sequence++}`,...args.draft,createdAt:now,updatedAt:now};tasks.push(t);return t;}
   if(command==='update_task'){const old=tasks.find(t=>t.id===args.id);const updated={...old,...args.draft,updatedAt:now};tasks=tasks.map(t=>t.id===args.id?updated:t);return updated;}
   if(command==='delete_task'){tasks=tasks.filter(t=>t.id!==args.id);return null;}
   if(command==='set_task_completed'){const old=tasks.find(t=>t.id===args.id);const updated={...old,completed:args.completed,updatedAt:now};tasks=tasks.map(t=>t.id===args.id?updated:t);return updated;}
   if(command==='list_notes')return [];if(command==='get_app_settings')return settings;
   if(command==='enter_wallpaper_mode'||command==='enter_foreground_mode')return 'ok';throw new Error(`Unexpected command: ${command}`);
  },transformCallback:(callback:(payload:unknown)=>void)=>{const id=Math.floor(Math.random()*2**32);Reflect.set(window,`_${id}`,callback);return id;}}});
 });
 await page.goto('/'); await expect(page.getByText(/本月暂无日程/)).toBeVisible();
});

test('creates, edits, and permanently deletes an event',async({page})=>{
 await page.getByRole('button',{name:'新建日程'}).click();
 await page.getByLabel('日程标题').fill('设计评审');
 await page.getByRole('combobox',{name:'关联任务'}).click();
 await page.getByRole('searchbox',{name:'搜索关联任务'}).fill('发布');
 await page.getByRole('option',{name:'发布 Nowly v0.1'}).click();
 await page.getByRole('button',{name:'保存'}).click();
 await expect(page.getByRole('button',{name:/设计评审/})).toBeVisible();
 await page.getByRole('button',{name:/设计评审/}).click();
 await page.getByLabel('日程标题').fill('设计复盘');
 await page.getByRole('button',{name:'保存'}).click();
 await expect(page.getByRole('button',{name:/设计复盘/})).toBeVisible();
 await page.getByRole('button',{name:/设计复盘/}).click();
 await page.getByRole('button',{name:'删除日程'}).click();
 await expect(page.getByRole('dialog',{name:'永久删除“设计复盘”？'})).toContainText('删除后无法恢复');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'编辑日程'})).toBeVisible();
 await page.getByRole('button',{name:'删除日程'}).click();
 await page.getByRole('button',{name:'永久删除'}).click();
 await expect(page.getByRole('button',{name:/设计复盘/})).toHaveCount(0);
});

test('uses immediate calendar time choices and persists six recent times', async ({page}) => {
 await page.getByRole('button', {name:'新建日程'}).click();
 const dialog = page.getByRole('dialog', {name:'新建日程'});
 await expect(dialog.getByRole('button', {name:'15 分钟前', exact:true})).toHaveAttribute('aria-pressed', 'true');
 const start = dialog.getByRole('button', {name:'开始时间'});
 const end = dialog.getByRole('button', {name:'结束时间'});
 await start.click();
 const popup = page.getByRole('dialog', {name:'选择开始时间'});
 await expect(popup.locator('.time-picker__footer')).toHaveCount(0);
 await popup.getByRole('button', {name:'14:00', exact:true}).click();
 await expect(popup).toHaveCount(0);
 await expect(start).toHaveText('14:00');
 await expect(end).toHaveText('15:00');
 for (const time of ['08:17', '10:22', '11:03', '13:41', '16:57', '19:08', '21:34', '13:41']) {
  await start.click();
  const [hour, minute] = time.split(':');
  await popup.getByRole('spinbutton', {name:'小时'}).fill(hour);
  await popup.getByRole('spinbutton', {name:'分钟'}).fill(minute);
  await popup.getByRole('spinbutton', {name:'分钟'}).press('Enter');
  await expect(start).toHaveText(time);
 }
 await end.click();
 const endPopup = page.getByRole('dialog', {name:'选择结束时间'});
 const recent = ['13:41', '21:34', '19:08', '16:57', '11:03', '10:22'];
 await expect(endPopup.locator('.time-picker__quick-values button')).toHaveText(recent);
 await endPopup.getByRole('button', {name:'21:34', exact:true}).click();
 await dialog.getByLabel('日程标题').fill('最近时间日程');
 await dialog.getByRole('button', {name:'保存', exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(() => window.__NOWLY_TEST_CALLS__.find(call => call.command === 'create_event')?.args.draft))
  .toMatchObject({startAt:expect.stringContaining('T13:41'), endAt:expect.stringContaining('T21:34'), reminders:[15]});
 await page.reload();
 await page.getByRole('button', {name:'新建日程'}).click();
 await page.getByRole('button', {name:'开始时间'}).click();
 await expect(popup.locator('.time-picker__quick-values button')).toHaveText(['21:34', '13:41', '19:08', '16:57', '11:03', '10:22']);
 const popupBounds = await popup.boundingBox();
 const dialogBounds = await page.getByRole('dialog', {name:'新建日程'}).boundingBox();
 const headerBounds = await page.locator('.event-dialog .good-dialog__header').boundingBox();
 expect(popupBounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x);
 expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width);
 expect(popupBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
});

test('navigates exact half-open month ranges',async({page})=>{
 const initial=await page.evaluate(()=>window.__NOWLY_TEST_CALLS__.find(c=>c.command==='list_events_in_range')!.args.range);
 await page.getByRole('button',{name:'下一个月'}).click();
 await expect.poll(async()=>page.evaluate(()=>window.__NOWLY_TEST_CALLS__.filter(c=>c.command==='list_events_in_range').length)).toBe(2);
 const ranges=await page.evaluate(()=>window.__NOWLY_TEST_CALLS__.filter(c=>c.command==='list_events_in_range').map(c=>c.args.range));
 expect(ranges[1].startAt).toBe(initial.endAtExclusive);
 await page.getByRole('button',{name:'上一个月'}).click();
 await expect.poll(async()=>page.evaluate(()=>window.__NOWLY_TEST_CALLS__.filter(c=>c.command==='list_events_in_range').length)).toBe(3);
});

test('uses offline keyboard-accessible date and time controls with trapped focus',async({page})=>{
 await page.getByRole('button',{name:'新建日程'}).click();
 await page.getByRole('button',{name:'开始',exact:true}).click();
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'开始时间'}).click();
 const hour=page.getByRole('spinbutton',{name:'小时'});await hour.press('ArrowUp');await hour.press('Enter');
 const startTime=page.getByRole('button',{name:'开始时间'});
 await startTime.click();
 await page.getByRole('spinbutton',{name:'分钟',exact:true}).fill('17');
 await page.getByRole('spinbutton',{name:'分钟',exact:true}).press('Enter');
 await expect(startTime).toContainText(':17');
 const confirmed=await startTime.innerText();
 await startTime.click();
 await page.getByRole('spinbutton',{name:'分钟',exact:true}).fill('29');
 await page.keyboard.press('Escape');
 await expect(startTime).toHaveText(confirmed);
 await expect(startTime).toBeFocused();
 await expect(page.locator('input[type=date],input[type=time]')).toHaveCount(0);
 await page.getByLabel('日程标题').fill('键盘日程');
 await page.getByRole('button',{name:'取消'}).click();
 await expect(page.getByRole('dialog',{name:'放弃更改？'})).toBeVisible();
 await page.keyboard.press('Shift+Tab');
 await expect(page.locator(':focus')).toBeVisible();
});
