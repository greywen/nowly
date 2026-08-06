import { describe, expect, it } from 'vitest';
import { buildSandboxDocument } from './sandbox-runtime';
import { SANDBOX_CHANNEL } from './sandbox-protocol';

describe('buildSandboxDocument', () => {
  it('embeds the runtime, the channel marker, and the extension source', () => {
    const doc = buildSandboxDocument('Nowly.defineModule(() => {});');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain(JSON.stringify(SANDBOX_CHANNEL));
    expect(doc).toContain('Nowly.defineModule(() => {});');
    expect(doc).toContain('id="root"');
  });

  it('exposes only the Nowly.defineModule entry point to the guest', () => {
    const doc = buildSandboxDocument('');
    // The runtime hands the extension a `Nowly` global with defineModule; there
    // is no ambient access to the parent, Tauri, or storage in the source.
    expect(doc).toContain('window.Nowly');
    expect(doc).toContain('defineModule');
  });

  it('locks the document down with a network-blocking CSP', () => {
    const doc = buildSandboxDocument('');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
  });

  it('escapes a closing script tag so the source cannot break out', () => {
    // Malicious/careless source containing </script> must not terminate the
    // injected <script> element early.
    const doc = buildSandboxDocument('var x = "</script><img src=x>";');
    expect(doc).not.toContain('</script><img');
    expect(doc).toContain('<\\/script>');
  });
});
