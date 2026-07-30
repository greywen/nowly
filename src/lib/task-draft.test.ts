import { describe, expect, it } from 'vitest';
import type { MatrixTask } from '../matrix/matrix-model';
import { compareTasks, createTaskForm, formatTaskMeta, isTaskFormDirty, taskToForm, toTaskDraft, validateTaskForm } from './task-draft';

const base: MatrixTask = { id:'high', title:'发布', quadrant:'important_urgent', dueAt:'2026-07-23', priority:1, completed:false, linkedEventId:'e1', note:'', createdAt:'2026-07-20T00:00:00Z', updatedAt:'x' };
const earlier={...base,id:'earlier',dueAt:'2026-07-01',priority:2 as const};
const low={...base,id:'low',priority:3 as const};
const noDue={...base,id:'no-due',dueAt:null};
const done={...base,id:'done',dueAt:'2026-07-01',completed:true};

describe('task draft helpers',()=>{
 it('creates approved defaults and date-detail defaults',()=>{
  expect(createTaskForm(null)).toEqual({title:'',quadrant:'important_urgent',dueAt:'',priority:2,completed:false,linkedEventId:'',note:''});
  expect(createTaskForm('2026-07-23').dueAt).toBe('2026-07-23');
 });
 it('normalizes and validates forms',()=>{
  const form={...createTaskForm('2026-07-23'),title:'  发布 Nowly  ',note:' 保留 '};
  expect(toTaskDraft(form)).toMatchObject({title:'发布 Nowly',dueAt:'2026-07-23',note:' 保留 '});
  expect(validateTaskForm({...form,title:' '})).toEqual({title:'请输入任务标题。'});
  expect(validateTaskForm({...form,dueAt:'2026-02-30'})).toEqual({dueAt:'请选择有效截止日期。'});
 });
 it('sorts like the server and formats metadata',()=>{
  expect([done,noDue,low,base,earlier].sort(compareTasks).map(task=>task.id)).toEqual(['earlier','high','low','no-due','done']);
  expect(formatTaskMeta(base,new Date(2026,6,23))).toBe('今天到期 · 高优先级');
  expect(formatTaskMeta(noDue,new Date(2026,6,23))).toBe('无截止日期 · 高优先级');
  expect(formatTaskMeta(done,new Date(2026,6,23))).toContain('已完成');
 });
 it('round trips and compares semantic dirtiness',()=>{
  const form=taskToForm(base);
  expect(toTaskDraft(form).linkedEventId).toBe('e1');
  expect(isTaskFormDirty(form,{...form})).toBe(false);
  expect(isTaskFormDirty(form,{...form,note:'changed'})).toBe(true);
 });
});
