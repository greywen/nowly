import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    localStorage.setItem('nowly-language', 'zh');
    const settings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true };
    const layout = [{id:'focusTimer',x:0,y:0,w:4,h:4}];
    const emptyStats = {totalFocusedSeconds:0,completedCount:0,interruptedCount:0,completionRate:0,points:Array.from({length:7},(_,index)=>({period:`day-${index}`,focusedSeconds:0,completedCount:0,interruptedCount:0}))};
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{
      invoke:async(command:string,args:any={})=>{
        if(command==='get_app_settings')return settings;
        if(command==='list_events_in_range'||command==='list_tasks'||command==='list_notes'||command==='list_extensions')return[];
        if(command==='list_module_layout')return layout;
        if(command==='get_module_state'||command==='get_pending_focus_completion')return null;
        if(command==='get_focus_statistics')return emptyStats;
        if(command==='start_focus_timer'||command==='pause_focus_timer'||command==='resume_focus_timer'||command==='cancel_focus_timer'||command==='acknowledge_focus_completion'||command==='set_module_state')return null;
        if(command==='enter_wallpaper_mode'||command==='enter_foreground_mode')return'ok';
        if(command==='get_kanban_snapshot')return{lanes:[],cards:[],priorities:[],tags:[],collaborators:[]};
        throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
      },
      transformCallback:(callback:unknown)=>{const id=Math.floor(Math.random()*2**32);Reflect.set(window,`_${id}`,callback);return id;}
    }});
  });
  await page.goto('/');
});

test('starts focus and automatically presents the wallpaper fullscreen timer',async({page})=>{
  await expect(page.getByRole('heading',{name:'专注计时'})).toBeVisible();
  await page.getByRole('button',{name:'开始专注'}).click();
  await page.getByRole('button',{name:/设为壁纸|Set as wallpaper/}).click();
  const fullscreen=page.getByRole('region',{name:'全屏专注'});
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.getByRole('timer')).toContainText(/24:5\d|25:00/);
  const background=await fullscreen.evaluate(element=>{const style=getComputedStyle(element);return{color:style.backgroundColor,image:style.backgroundImage}});
  expect(background).toEqual({color:'rgb(248, 246, 242)',image:'none'});
  await expect(fullscreen.locator('.focus-fullscreen__shape')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'全屏专注'})).toHaveCount(0);
});

test('hides the mini chart in a constrained module without hiding statistics access',async({page})=>{
  await page.locator('.focus-timer').evaluate(element=>{(element as HTMLElement).style.width='400px';(element as HTMLElement).style.height='350px'});
  await expect(page.locator('.focus-timer__trend-chart')).toBeHidden();
  await expect(page.getByRole('button',{name:'查看统计'})).toBeVisible();
  const style=await page.getByRole('button',{name:'查看统计'}).evaluate(element=>getComputedStyle(element));
  expect(style.height).toBe('40px');
  expect(style.transitionDuration).toBe('0s');
});
