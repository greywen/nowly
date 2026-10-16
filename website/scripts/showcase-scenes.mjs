export const SHOWCASE_SLIDES = [
  ['workspace', '工作桌面', 'Workspace', '日历、四象限与便签，一起安排今天。', 'Plan your day with calendar, priorities and notes.'],
  ['kanban', '看板', 'Kanban', '按进度整理任务，让下一步一目了然。', 'Organize tasks by progress and see what comes next.'],
  ['notes', '笔记', 'Notes', '记录计划、想法与随手灵感。', 'Keep plans, ideas and inspiration close at hand.'],
  ['time', '世界时钟', 'World clocks', '把不同时区的时间放在同一个桌面。', 'Keep multiple time zones on one workspace.'],
  ['focus', '专注时段', 'Focus', '留出一段时间，专心完成重要的事。', 'Make time for what matters with a focus session.'],
  ['stickers', '贴纸', 'Stickers', '用文字贴纸，布置属于自己的工作桌面。', 'Make the workspace yours with text stickers.'],
  ['project', '项目协作', 'Project planning', '日程、看板与笔记，汇聚项目的下一步。', 'Bring project milestones, tasks and decisions together.'],
  ['study', '学习桌面', 'Study workspace', '安排学习重点，记录思考，留出专注时间。', 'Prioritize learning, collect ideas and make room to focus.']
];

const cell = (id, x, y, w, h) => ({ id, x, y, w, h });
const layouts = {
  workspace: [cell('calendar', 0, 0, 7, 8), cell('matrix', 7, 0, 5, 5), cell('notes', 7, 5, 5, 3)],
  kanban: [cell('kanban', 0, 0, 12, 8)],
  notes: [cell('notes', 0, 0, 12, 8)],
  time: [cell('time', 0, 0, 12, 8)],
  focus: [cell('time', 0, 0, 8, 8), cell('notes', 8, 0, 4, 8)],
  stickers: [cell('stickers', 0, 0, 12, 8)],
  project: [cell('calendar', 0, 0, 5, 8), cell('kanban', 5, 0, 7, 5), cell('notes', 5, 5, 7, 3)],
  study: [cell('matrix', 0, 0, 6, 5), cell('notes', 0, 5, 6, 3), cell('time', 6, 0, 6, 4), cell('stickers', 6, 4, 6, 4)]
};

export function getSceneLayout(sceneId) {
  if (!Object.hasOwn(layouts, sceneId)) throw new Error(`Unknown showcase scene: ${sceneId}`);
  return structuredClone(layouts[sceneId]);
}

export function screenshotPath(sceneId, language) {
  getSceneLayout(sceneId);
  if (!['zh', 'en'].includes(language)) throw new Error(`Unsupported showcase language: ${language}`);
  return `screenshots/${language}/${sceneId}.png`;
}
