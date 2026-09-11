export type QuickPanelId = 'ai-assistant';

export function nextQuickPanelState(open: boolean, panel: QuickPanelId = 'ai-assistant') {
  return { open: !open, panel };
}
