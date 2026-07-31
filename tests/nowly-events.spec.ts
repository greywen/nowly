import { expect, test } from '@playwright/test';

declare global { interface Window { __NOWLY_TEST_CALLS__: Array<{command:string;args:any}> } }

test.beforeEach(async ({page})=>{
 await page.addInitScript(()=>{
  const now='2026-07-23T09:42:00.000Z'; let sequence=1; let events:any[]=[];
  let tasks:any[]=[{id:'t1',title:'发布 Nowly v0.1',quadrant:'important_urgent',dueAt:null,priority:1,completed:false,linkedEventId:null,note:'',createdAt:now,updatedAt:now}];
  const settings={wallpaperEnabled:false,launchAtLogin:false,targetMonitorId:null,density:'balanced',weekStart:'monday',dateFormat:'localized',showWeekends:true,calendarEnabled:true,matrixEnabled:true,notesEnabled:true};
  window.__NOWLY_TEST_CALLS__=[];
  Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string,args:any={})=>{
   window.__NOWLY_TEST_CALLS__.push({command,args});
   if(command==='list_events_in_range')return events.filter(e=>e.startAt>=args.range.startAt&&e.startAt<args.range.endAtExclusive);
   if(command==='create_event'){const e={id:`e${sequence++}`,...args.draft,createdAt:now,updatedAt:now};events.push(e);if(e.linkedTaskId)tasks=tasks.map(t=>t.id===e.linkedTaskId?{...t,linkedEventId:e.id}:t);return e;}
   if(command==='update_event'){const old=events.find(e=>e.id===args.id);const updated={...old,...args.draft,updatedAt:now};events=events.map(e=>e.id===args.id?updated:e);return updated;}
   if(command==='delete_event'){events=events.filter(e=>e.id!==args.id);return null;}
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
 await page.getByRole('button',{name:'开始日期'}).click();
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'开始时间'}).click();
 const hour=page.getByRole('spinbutton',{name:'小时'});await hour.press('ArrowUp');await hour.press('Enter');
 await expect(page.locator('input[type=date],input[type=time]')).toHaveCount(0);
 await page.getByLabel('日程标题').fill('键盘日程');
 await page.getByRole('button',{name:'取消'}).click();
 await expect(page.getByRole('dialog',{name:'放弃更改？'})).toBeVisible();
 await page.keyboard.press('Shift+Tab');
 await expect(page.locator(':focus')).toBeVisible();
});
