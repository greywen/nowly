export type ScrollState = { sessionId: string; revision: number; phase: 'prepare'|'capturing'|'paused'|'review'|'cancelled'; width:number; height:number; point?:[number,number];region?:{x:number;y:number;width:number;height:number};seams?:number[]; reason:string|null };
export function acceptScrollUpdate(current:ScrollState|null,next:ScrollState):ScrollState { return current && (current.sessionId!==next.sessionId || current.revision>next.revision) ? current : next; }
export function initialLongZoom(width:number,available:number) { return Math.min(1, available/width); }
