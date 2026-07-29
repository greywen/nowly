import { describe, expect, it } from 'vitest';
import { defaultWidgets, getEnabledWidgets } from './widget-registry';

describe('widget registry', () => {
  it('contains calendar, matrix, and notes as enabled MVP widgets', () => {
    expect(defaultWidgets.map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
    expect(getEnabledWidgets(defaultWidgets).map((widget) => widget.id)).toEqual(['calendar', 'matrix', 'notes']);
  });
});
