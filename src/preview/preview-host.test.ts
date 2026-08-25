import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewHost } from './preview-host';

describe('createPreviewHost', () => {
  it('exposes the module id and today', () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25' });
    expect(host.moduleId).toBe('m');
    expect(host.todayIso).toBe('2026-08-25');
  });

  it('loads null before anything is saved', async () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25' });
    expect(await host.loadState()).toBeNull();
  });

  it('round-trips saved state', async () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25' });
    await host.saveState({ count: 3 });
    expect(await host.loadState()).toEqual({ count: 3 });
  });

  it('seeds initial state', async () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25', initialState: { seeded: true } });
    expect(await host.loadState()).toEqual({ seeded: true });
  });

  it('deep-copies on save so later mutation does not leak in', async () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25' });
    const value = { nested: { n: 1 } };
    await host.saveState(value);
    value.nested.n = 99;
    expect(await host.loadState()).toEqual({ nested: { n: 1 } });
  });

  it('has no fetch without an allow-list', () => {
    const host = createPreviewHost({ moduleId: 'm', todayIso: '2026-08-25' });
    expect(host.fetch).toBeUndefined();
  });

  it('exposes fetch when an allow-list is given', () => {
    const host = createPreviewHost({
      moduleId: 'm',
      todayIso: '2026-08-25',
      allowedHosts: ['api.example.com']
    });
    expect(typeof host.fetch).toBe('function');
  });

  describe('fetch', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('parses a JSON body and returns the response shape', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          text: async () => '{"temp":21}'
        }))
      );
      const host = createPreviewHost({
        moduleId: 'm',
        todayIso: '2026-08-25',
        allowedHosts: ['api.example.com']
      });
      const res = await host.fetch!('https://api.example.com/x');
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.text).toBe('{"temp":21}');
      expect(res.json).toEqual({ temp: 21 });
    });

    it('returns json null when the body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => 'plain text'
        }))
      );
      const host = createPreviewHost({
        moduleId: 'm',
        todayIso: '2026-08-25',
        allowedHosts: ['api.example.com']
      });
      const res = await host.fetch!('https://api.example.com/x');
      expect(res.json).toBeNull();
      expect(res.text).toBe('plain text');
    });
  });
});
