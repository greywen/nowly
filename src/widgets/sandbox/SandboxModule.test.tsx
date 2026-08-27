import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleHost } from '../extension-module';
import { SANDBOX_CHANNEL } from './sandbox-protocol';
import { SandboxModule } from './SandboxModule';

// Deliver a message to the host's window listener as if it came from `frame`.
// The host trusts a message only when `event.source` is that iframe's window,
// so we mirror that here.
function postFromGuest(frame: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
}

// Signal readiness from a frame and return the init message the host posted
// back to it, so a test can assert on the surface field.
async function readyAndCaptureInit(frame: HTMLIFrameElement) {
  const post = vi.spyOn(frame.contentWindow as Window, 'postMessage');
  await act(async () => {
    postFromGuest(frame, { channel: SANDBOX_CHANNEL, kind: 'ready' });
  });
  return post.mock.calls.map((call) => call[0]).find((m) => m && (m as { kind?: string }).kind === 'init');
}

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

  it('marks the main frame as the main surface at init', async () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state']}
      />
    );
    const frame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    const init = await readyAndCaptureInit(frame);
    expect(init).toMatchObject({ kind: 'init', surface: 'main' });
  });

  it('opens a host-rendered dialog carrying a second frame of the same source', async () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state']}
      />
    );
    const frame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    await act(async () => {
      postFromGuest(frame, { channel: SANDBOX_CHANNEL, kind: 'openDialog', title: '模块设置' });
    });
    // The dialog chrome appears and holds a second iframe titled after the
    // module's requested title.
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const dialogFrame = screen.getByTitle('模块设置') as HTMLIFrameElement;
    expect(dialogFrame.getAttribute('sandbox')).toBe('allow-scripts');
    // Same source, so the second frame loads the same Blob URL.
    expect(dialogFrame.getAttribute('src')).toBe('blob:mock-url');

    // The dialog frame gets init as the dialog surface.
    const init = await readyAndCaptureInit(dialogFrame);
    expect(init).toMatchObject({ kind: 'init', surface: 'dialog' });
  });

  it('closes the dialog when the guest asks to close it', async () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state']}
      />
    );
    const frame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    await act(async () => {
      postFromGuest(frame, { channel: SANDBOX_CHANNEL, kind: 'openDialog' });
    });
    expect(await screen.findByRole('dialog')).toBeTruthy();

    await act(async () => {
      postFromGuest(frame, { channel: SANDBOX_CHANNEL, kind: 'closeDialog' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('broadcasts stateChanged to the other surface after a save', async () => {
    render(
      <SandboxModule
        host={host()}
        source="Nowly.defineModule(() => {});"
        title="沙箱计数器"
        permissions={['state']}
      />
    );
    const mainFrame = screen.getByTitle('沙箱计数器') as HTMLIFrameElement;
    await act(async () => {
      postFromGuest(mainFrame, { channel: SANDBOX_CHANNEL, kind: 'openDialog', title: '模块设置' });
    });
    const dialogFrame = (await screen.findByTitle('模块设置')) as HTMLIFrameElement;

    const mainPost = vi.spyOn(mainFrame.contentWindow as Window, 'postMessage');
    // The dialog surface saves; the main surface must be told to reload.
    await act(async () => {
      postFromGuest(dialogFrame, {
        channel: SANDBOX_CHANNEL,
        kind: 'request',
        id: 1,
        method: 'saveState',
        args: [{ count: 3 }]
      });
    });
    await waitFor(() =>
      expect(mainPost.mock.calls.some((call) => (call[0] as { kind?: string }).kind === 'stateChanged')).toBe(true)
    );
  });
});
