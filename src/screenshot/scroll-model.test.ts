import { describe,it,expect } from 'vitest';
import { acceptScrollUpdate, initialLongZoom } from './scroll-model';
describe('scroll updates',()=>{
 it('ignores a late revision and another session',()=>{
 const current={sessionId:'1',revision:4,phase:'capturing' as const,width:100,height:300,reason:null};
 expect(acceptScrollUpdate(current,{...current,revision:3})).toBe(current);
 expect(acceptScrollUpdate(current,{...current,sessionId:'2',revision:5})).toBe(current);
 expect(acceptScrollUpdate(current,{...current,revision:5})).toEqual({...current,revision:5});
 });
 it('fits long images without upscaling',()=>{expect(initialLongZoom(1000,500)).toBe(.5);expect(initialLongZoom(100,500)).toBe(1);});
});
