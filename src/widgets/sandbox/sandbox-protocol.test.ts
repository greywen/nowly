import { describe, expect, it, vi } from 'vitest';
import type { ModuleHost } from '../extension-module';
import {
  SANDBOX_CHANNEL,
  createRateLimiter,
  handleSandboxRequest,
  isSandboxReady,
  isSandboxRequest,
  type SandboxGrant,
  type SandboxRequest
} from './sandbox-protocol';

const fullGrant: SandboxGrant = { permissions: ['state', 'today'], allow: () => true };

function host(overrides: Partial<ModuleHost> = {}): ModuleHost {
  return {
    moduleId: 'sandboxDemo',
    todayIso: '2026-07-23',
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function request(overrides: Partial<SandboxRequest> = {}): SandboxRequest {
  return { channel: SANDBOX_CHANNEL, kind: 'request', id: 1, method: 'loadState', args: [], ...overrides };
}

describe('isSandboxRequest', () => {
  it('accepts a well-formed request on the channel', () => {
    expect(isSandboxRequest(request())).toBe(true);
    expect(isSandboxRequest(request({ method: 'saveState', args: [{ n: 1 }] }))).toBe(true);
  });

  it('rejects foreign, malformed, or off-channel messages', () => {
    expect(isSandboxRequest(null)).toBe(false);
    expect(isSandboxRequest({ channel: 'other', kind: 'request', id: 1, method: 'loadState', args: [] })).toBe(false);
    expect(isSandboxRequest(request({ method: 'evalDangerously' as unknown as 'loadState' }))).toBe(false);
    expect(isSandboxRequest({ ...request(), args: undefined as unknown as unknown[] })).toBe(false);
  });
});

describe('isSandboxReady', () => {
  it('recognizes only the ready signal on the channel', () => {
    expect(isSandboxReady({ channel: SANDBOX_CHANNEL, kind: 'ready' })).toBe(true);
    expect(isSandboxReady({ channel: SANDBOX_CHANNEL, kind: 'request' })).toBe(false);
    expect(isSandboxReady({ channel: 'other', kind: 'ready' })).toBe(false);
  });
});

describe('handleSandboxRequest', () => {
  it('dispatches loadState and returns the stored result', async () => {
    const loadState = vi.fn().mockResolvedValue({ count: 7 });
    const response = await handleSandboxRequest(host({ loadState }), request({ id: 5 }));
    expect(loadState).toHaveBeenCalledOnce();
    expect(response).toEqual({ channel: SANDBOX_CHANNEL, kind: 'response', id: 5, ok: true, result: { count: 7 } });
  });

  it('dispatches saveState with the first argument', async () => {
    const saveState = vi.fn().mockResolvedValue(undefined);
    const response = await handleSandboxRequest(
      host({ saveState }),
      request({ id: 9, method: 'saveState', args: [{ count: 2 }] })
    );
    expect(saveState).toHaveBeenCalledWith({ count: 2 });
    expect(response).toEqual({ channel: SANDBOX_CHANNEL, kind: 'response', id: 9, ok: true });
  });

  it('reports host failures as an error response instead of throwing', async () => {
    const loadState = vi.fn().mockRejectedValue(new Error('存储不可用'));
    const response = await handleSandboxRequest(host({ loadState }), request({ id: 3 }));
    expect(response).toEqual({
      channel: SANDBOX_CHANNEL,
      kind: 'response',
      id: 3,
      ok: false,
      error: '存储不可用'
    });
  });

  it('denies a method whose permission was not granted', async () => {
    const loadState = vi.fn().mockResolvedValue(null);
    const response = await handleSandboxRequest(host({ loadState }), request({ id: 4 }), {
      permissions: [],
      allow: () => true
    });
    expect(loadState).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    expect(response.error).toContain('state');
  });

  it('rejects a request once the throttle is saturated', async () => {
    const response = await handleSandboxRequest(host(), request({ id: 6 }), {
      permissions: ['state'],
      allow: () => false
    });
    expect(response.ok).toBe(false);
    expect(response.error).toContain('限流');
  });
});

describe('createRateLimiter', () => {
  it('allows up to the limit then rejects within the window', () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow()).toBe(true);
    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });
});
