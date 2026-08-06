import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleHost } from '../extension-module';
import { SandboxModule } from './SandboxModule';

function host(): ModuleHost {
  return {
    moduleId: 'sandbox:demo',
    todayIso: '2026-07-23',
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined)
  };
}

// jsdom has no Blob URL support; stub it so the component can build a src.
beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SandboxModule', () => {
  it('mounts the extension in an iframe sandboxed without same-origin access', () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state', 'today']}
      />
    );
    const frame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    // allow-scripts but NOT allow-same-origin: the guest runs at a null origin
    // and cannot reach this window's DOM, storage, or Tauri.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('loads the frame from a Blob URL rather than inlining markup', () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state']}
      />
    );
    const frame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('blob:mock-url');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});
