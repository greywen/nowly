export type WidgetId = 'calendar' | 'matrix' | 'notes' | 'focusTimer' | 'newsWordCloud' | 'vocabulary';

export type WidgetConfig = {
  id: WidgetId;
  name: string;
  enabled: boolean;
  order: number;
  size: 'main' | 'side-large' | 'side-medium';
};

export const defaultWidgets: WidgetConfig[] = [
  { id: 'calendar', name: '日历', enabled: true, order: 1, size: 'main' },
  { id: 'matrix', name: '四象限', enabled: true, order: 2, size: 'side-large' },
  { id: 'notes', name: '便签', enabled: true, order: 3, size: 'side-medium' }
];

export function getEnabledWidgets(widgets: WidgetConfig[]): WidgetConfig[] {
  return widgets.filter((widget) => widget.enabled).sort((left, right) => left.order - right.order);
}
