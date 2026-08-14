import { priorityLabel, type MatrixTask, type Quadrant, type TaskDraft, type TaskPriority } from '../matrix/matrix-model';
import { t } from '../i18n';

export type TaskFormDraft={title:string;quadrant:Quadrant;dueAt:string;priority:TaskPriority;completed:boolean;linkedEventId:string;note:string};
export type TaskFieldErrors=Partial<Record<'title'|'quadrant'|'dueAt'|'priority'|'linkedEventId',string>>;
export function createTaskForm(sourceDate:string|null):TaskFormDraft{return{title:'',quadrant:'important_urgent',dueAt:sourceDate??'',priority:2,completed:false,linkedEventId:'',note:''};}
export function taskToForm(task:MatrixTask):TaskFormDraft{return{title:task.title,quadrant:task.quadrant,dueAt:task.dueAt??'',priority:task.priority,completed:task.completed,linkedEventId:task.linkedEventId??'',note:task.note};}
export function toTaskDraft(form:TaskFormDraft):TaskDraft{return{...form,title:form.title.trim(),dueAt:form.dueAt||null,linkedEventId:form.linkedEventId||null};}
function validDate(value:string){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const [y,m,d]=match.slice(1).map(Number);const date=new Date(y,m-1,d);return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;}
export function validateTaskForm(form:TaskFormDraft):TaskFieldErrors{if(!form.title.trim())return{title:t('taskDraft.errorTitle')};if(form.dueAt&&!validDate(form.dueAt))return{dueAt:t('taskDraft.errorDueDate')};return{};}
export function isTaskFormDirty(initial:TaskFormDraft,current:TaskFormDraft){return JSON.stringify(initial)!==JSON.stringify(current);}
export function compareTasks(a:MatrixTask,b:MatrixTask){return Number(a.completed)-Number(b.completed)||(a.dueAt===null?1:0)-(b.dueAt===null?1:0)||(a.dueAt??'').localeCompare(b.dueAt??'')||a.priority-b.priority||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);}
export function sortTasks(tasks:MatrixTask[]){return[...tasks].sort(compareTasks);}
export function formatTaskMeta(task:MatrixTask,today=new Date()){let due=t('taskDraft.noDueDate');if(task.dueAt){const local=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;due=task.dueAt===local?t('taskDraft.dueToday'):t('taskDraft.dueMonthDay',{month:Number(task.dueAt.slice(5,7)),day:Number(task.dueAt.slice(8,10))});}const priority=priorityLabel(task.priority);return task.completed?t('taskDraft.metaCompleted',{due,priority}):t('taskDraft.meta',{due,priority});}
