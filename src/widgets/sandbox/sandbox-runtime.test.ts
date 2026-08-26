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

  it('injects the generated nm-* stylesheet and drops the old drifted values', () => {
    const doc = buildSandboxDocument('');
    expect(doc).toContain('--nm-text-primary: #211f1c');
    expect(doc).toContain('.nm-btn');
    // The old hardcoded drift must be gone.
    expect(doc).not.toContain('#1f2733');
    expect(doc).not.toContain('border-radius: 8px');
  });

  it('wires the visibility API into the guest host', () => {
    const doc = buildSandboxDocument('');
    // The guest runtime exposes host.onVisibilityChange and handles the
    // 'visibility' message so animated modules can pause when off-screen.
    expect(doc).toContain('onVisibilityChange');
    expect(doc).toContain("'visibility'");
  });

  it('injects the optional widget factories after the runtime', () => {
    const doc = buildSandboxDocument('');
    // The widgets augment window.Nowly with Select/Tabs/DatePicker/etc. They
    // must appear after the runtime that creates the Nowly global, and before
    // the extension source that may call them.
    expect(doc).toContain('N.Select');
    expect(doc).toContain('N.DatePicker');
    const runtimeAt = doc.indexOf('window.Nowly = {');
    const widgetsAt = doc.indexOf('N.Select');
    expect(runtimeAt).toBeGreaterThan(-1);
    expect(widgetsAt).toBeGreaterThan(runtimeAt);
  });

  it('escapes a closing script tag so the source cannot break out', () => {
    // Malicious/careless source containing </script> must not terminate the
    // injected <script> element early.
    const doc = buildSandboxDocument('var x = "</script><img src=x>";');
    expect(doc).not.toContain('</script><img');
    expect(doc).toContain('<\\/script>');
  });
});
