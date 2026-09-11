import { describe, expect, it } from 'vitest';
import { nextQuickPanelState } from './quick-panel';

describe('quick panel routing', () => {
  it('toggles the requested panel without changing its identity', () => {
    expect(nextQuickPanelState(false)).toEqual({ open: true, panel: 'ai-assistant' });
    expect(nextQuickPanelState(true, 'ai-assistant')).toEqual({ open: false, panel: 'ai-assistant' });
  });
});
