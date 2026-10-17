import { test,expect,type Page } from '@playwright/test';

async function shell(page:Page,label:string){
 await page.addInitScript(({label})=>{
  localStorage.setItem('nowly.language','zh');let callback=0;const listeners=new Map<string,number>();const calls:{command:string;args:unknown}[]=[];
  let state={sessionId:'7',revision:1,phase:'prepare',width:320,height:0,point:[260,200],region:{x:100,y:100,width:320,height:200},seams:[] as number[],reason:null as string|null};
  const emit=(event:string,payload:unknown)=>{const id=listeners.get(event);if(id)Reflect.get(window,`_${id}`)({payload});};
  const png=()=>{const c=document.createElement('canvas');c.width=320;c.height=900;const x=c.getContext('2d')!;for(let y=0;y<900;y++){x.fillStyle=`rgb(${y%255},${(y*3)%255},${(y*7)%255})`;x.fillRect(0,y,320,1)}return fetch(c.toDataURL()).then(r=>r.arrayBuffer());};
  Object.assign(window,{__SCROLL_TEST__:{calls,emit,review:()=>{state={...state,revision:4,phase:'review',height:900,seams:[200,520],reason:'Target focus changed'};emit('screenshot-scroll-state',state);},adopt:()=>{state={...state,revision:4,phase:'review',height:900,seams:[200,520],reason:'Stopped'};emit('screenshot-scroll-adopted',state);emit('screenshot-scroll-state',{...state,phase:'cancelled'});}},__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener:()=>{}},__TAURI_INTERNALS__:{metadata:{currentWindow:{label},currentWebview:{label}},transformCallback:(fn:unknown)=>{callback++;Object.assign(window,{[`_${callback}`]:fn});return callback;},convertFileSrc:()=>'/scroll-frame.png',invoke:async(command:string,args:any={})=>{
   calls.push({command,args:command==='stage_capture_overlay'?{byteLength:args.byteLength}:args});
   if(command==='plugin:event|listen'){listeners.set(args.event,args.handler);return callback;}
   if(command==='describe_capture_frame')return {path:'7/0',width:1366,height:768,originX:0,originY:0,windowCandidates:[]};
   if(command==='scroll_capture_image')return png();
   if(command==='scroll_capture'){
    if(args.action==='point')state={...state,point:args.point};
    if(args.action==='start')state={...state,phase:'capturing'};
    if(args.action==='pause')state={...state,phase:'paused'};
    if(args.action==='stop')state={...state,phase:'review',reason:'Stopped'};
    if(args.action==='adopt'){emit('screenshot-scroll-adopted',state);return state;}
    if(args.action==='discard'){emit('screenshot-scroll-state',{...state,phase:'cancelled'});return null;}
    return state;
   }
   if(command==='copy_capture_to_clipboard')throw {message:'Simulated clipboard unavailable'};
   return null;
  }}});
 },{label});
 await page.route('**/scroll-frame.png',async route=>{const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');await route.fulfill({contentType:'image/png',body:png});});
}

test('auxiliary explicit manual capture start and partial review',async({page})=>{
 await shell(page,'screenshot-scroll-control-7');await page.goto('/screenshot.html');
 await expect(page.getByRole('button',{name:'开始采集'})).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').calls.filter((c:any)=>c.args.action==='start'))).toHaveLength(0);
 await page.getByRole('button',{name:'开始采集'}).click();await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').review());
 await expect(page.getByRole('button',{name:'使用已截部分'})).toBeVisible();await expect(page.getByRole('combobox',{name:'审核缩放'})).toBeVisible();
 await page.getByRole('combobox',{name:'审核缩放'}).selectOption('1');await expect(page.getByTitle('接缝 520')).toBeVisible();
 await page.getByRole('button',{name:'使用已截部分'}).click();
 expect(await page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').calls.some((c:any)=>c.args.action==='adopt'))).toBe(true);
});

test('adopted long image uses image-local export and retains editor on clipboard failure',async({page})=>{
 await shell(page,'screenshot-overlay-7-0');await page.goto('/screenshot.html');await expect(page.locator('.screenshot-overlay')).toBeVisible();
 // Native adoption can arrive before any frontend selection gesture.
 await page.mouse.move(100,100);
 await page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').adopt());
 await expect(page.locator('.screenshot-overlay--long')).toBeVisible();await expect(page.locator('.long-image-zoom select')).toBeVisible();
 await page.keyboard.press('Control+c');
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').calls.filter((c:any)=>c.command==='copy_capture_to_clipboard').length)).toBe(1);
 const geometry=await page.evaluate(()=>Reflect.get(window,'__SCROLL_TEST__').calls.find((c:any)=>c.command==='copy_capture_to_clipboard').args.geometry);
 expect(geometry).toMatchObject({x:0,y:0,width:320,height:900,hasOverlay:false});
 await expect(page.getByRole('alert')).toContainText('Simulated clipboard unavailable');await expect(page.locator('.screenshot-overlay--long')).toBeVisible();
});
