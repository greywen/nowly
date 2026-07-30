import { priorityLabels, type MatrixTask, type Quadrant, type TaskDraft, type TaskPriority } from '../matrix/matrix-model';

export type TaskFormDraft={title:string;quadrant:Quadrant;dueAt:string;priority:TaskPriority;completed:boolean;linkedEventId:string;note:string};
export type TaskFieldErrors=Partial<Record<'title'|'quadrant'|'dueAt'|'priority'|'linkedEventId',string>>;
export function createTaskForm(sourceDate:string|null):TaskFormDraft{return{title:'',quadrant:'important_urgent',dueAt:sourceDate??'',priority:2,completed:false,linkedEventId:'',note:''};}
export function taskToForm(task:MatrixTask):TaskFormDraft{return{title:task.title,quadrant:task.quadrant,dueAt:task.dueAt??'',priority:task.priority,completed:task.completed,linkedEventId:task.linkedEventId??'',note:task.note};}
export function toTaskDraft(form:TaskFormDraft):TaskDraft{return{...form,title:form.title.trim(),dueAt:form.dueAt||null,linkedEventId:form.linkedEventId||null};}
function validDate(value:string){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const [y,m,d]=match.slice(1).map(Number);const date=new Date(y,m-1,d);return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;}
export function validateTaskForm(form:TaskFormDraft):TaskFieldErrors{if(!form.title.trim())return{title:'请输入任务标题。'};if(form.dueAt&&!validDate(form.dueAt))return{dueAt:'请选择有效截止日期。'};return{};}
export function isTaskFormDirty(initial:TaskFormDraft,current:TaskFormDraft){return JSON.stringify(initial)!==JSON.stringify(current);}
export function compareTasks(a:MatrixTask,b:MatrixTask){return Number(a.completed)-Number(b.completed)||(a.dueAt===null?1:0)-(b.dueAt===null?1:0)||(a.dueAt??'').localeCompare(b.dueAt??'')||a.priority-b.priority||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);}
export function sortTasks(tasks:MatrixTask[]){return[...tasks].sort(compareTasks);}
export function formatTaskMeta(task:MatrixTask,today=new Date()){let due='无截止日期';if(task.dueAt){const local=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;due=task.dueAt===local?'今天到期':`${Number(task.dueAt.slice(5,7))} 月 ${Number(task.dueAt.slice(8,10))} 日到期`;}return`${due} · ${priorityLabels[task.priority]}优先级${task.completed?' · 已完成':''}`;}
