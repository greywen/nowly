import { describe, expect, it } from 'vitest';
import { isQuickCreateKind, normalizeQuickCreateRequest } from './request';

describe('quick-create request', () => {
  it('accepts the three create kinds only', () => {
    expect(['event', 'task', 'note'].every(isQuickCreateKind)).toBe(true);
    expect(isQuickCreateKind('screenshot')).toBe(false);
    expect(isQuickCreateKind(undefined)).toBe(false);
  });
  it('normalizes a native request and rejects malformed payloads', () => {
    expect(normalizeQuickCreateRequest({ id: 3, kind: 'note', maxHeight: 640 })).toEqual({ id: 3, kind: 'note', maxHeight: 640 });
    for (const value of [null, 'event', { id: -1, kind: 'event', maxHeight: 640 }, { id: 1.5, kind: 'event', maxHeight: 640 },
      { id: 1, kind: 'calendar', maxHeight: 640 }, { id: 1, kind: 'event', maxHeight: 0 }, { id: 1, kind: 'event' }]) {
      expect(normalizeQuickCreateRequest(value)).toBeNull();
    }
  });
});
