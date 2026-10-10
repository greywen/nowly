import { describe, expect, it } from 'vitest';
import { routeForLabel } from './window-route';

describe('routeForLabel', () => {
  it('routes independent screenshot history and menu windows', () => {
    expect(routeForLabel('screenshot-history')).toBe('screenshot-history');
    expect(routeForLabel('screenshot-menu')).toBe('screenshot-menu');
  });

  it('routes the status rail by its compatibility label', () => {
    expect(routeForLabel('quick-panel-handle')).toBe('status-island');
  });

  it('routes session-scoped capture windows to the static placeholder', () => {
    // This window owns the only taskbar/Alt+Tab entry, so it must never render
    // desktop pixels: Peek and the taskbar thumbnail would expose them.
    expect(routeForLabel('screenshot-session-1')).toBe('screenshot-session');
    expect(routeForLabel('screenshot-session-42')).toBe('screenshot-session');
  });

  it('routes every session-scoped per-display overlay to the capture overlay', () => {
    expect(routeForLabel('screenshot-overlay-1-0')).toBe('screenshot-overlay');
    expect(routeForLabel('screenshot-overlay-42-12')).toBe('screenshot-overlay');
  });

  it('falls back to the main app for anything unrecognised', () => {
    // main.tsx runs this at module top level: an unknown label must still render
    // a working window rather than a blank page.
    expect(routeForLabel('main')).toBe('main');
    expect(routeForLabel('')).toBe('main');
    expect(routeForLabel('screenshot')).toBe('main');
    expect(routeForLabel('screenshot-session')).toBe('main');
    expect(routeForLabel('screenshot-session-x')).toBe('main');
    expect(routeForLabel('screenshot-')).toBe('main');
    expect(routeForLabel('screenshot-overlay-0')).toBe('main');
    expect(routeForLabel('screenshot-overlay-1-x')).toBe('main');
  });
});
