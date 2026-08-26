import { SANDBOX_CHANNEL } from './sandbox-protocol';
import { NOWLY_MODULE_CSS } from './nowly-module-css';
import { SANDBOX_WIDGETS } from './sandbox-widgets';

// The script that runs *inside* the sandboxed iframe. It is injected as source
// text into the iframe document, so it must be self-contained plain JS (no
// imports, no bundler help). It sets up the `Nowly` global an extension author
// uses, bridges the host API over postMessage, and signals readiness.
//
// The extension author writes, e.g.:
//   Nowly.defineModule(async ({ host, root }) => {
//     root.textContent = host.todayIso;
//     const saved = await host.loadState();
//     await host.saveState({ ... });
//   });
//
// The iframe is sandboxed with `allow-scripts` only (no `allow-same-origin`),
// so this code cannot reach the parent DOM, cookies, or Tauri — it can only
// talk back through the postMessage channel below.
export const SANDBOX_RUNTIME = `(() => {
  var CHANNEL = ${JSON.stringify(SANDBOX_CHANNEL)};
  var pending = {};
  var nextId = 1;
  var userModule = null;
  var errorPrefix = 'Extension error: ';
  // Visibility state and the module's registered listeners. The host pushes
  // 'visibility' messages when the module scrolls out of view, the window is
  // minimized/backgrounded, or focus mode starts. Animated modules must pause
  // their rAF loops when not visible — the runtime just relays the flag.
  var visible = true;
  var visibilityListeners = [];

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage(
        { channel: CHANNEL, kind: 'request', id: id, method: method, args: args || [] },
        '*'
      );
    });
  }

  // The host handle handed to the extension. This is its entire world; fields
  // absent from init (e.g. todayIso without the 'today' permission) stay
  // undefined, and fetch is attached only when 'network' was granted.
  function makeHost(init) {
    var host = {
      moduleId: init.moduleId,
      todayIso: init.todayIso,
      loadState: function () { return call('loadState', []); },
      saveState: function (value) { return call('saveState', [value]); }
    };
    host.isVisible = function () { return visible; };
    host.onVisibilityChange = function (fn) {
      if (typeof fn !== 'function') return function () {};
      visibilityListeners.push(fn);
      // Deliver the current state immediately so a module can set its initial
      // running/paused state without waiting for the next transition.
      try { fn(visible); } catch (e) {}
      return function () {
        var i = visibilityListeners.indexOf(fn);
        if (i !== -1) visibilityListeners.splice(i, 1);
      };
    };
    if (init.permissions && init.permissions.indexOf('network') !== -1) {
      host.fetch = function (url, options) {
        options = options || {};
        return call('fetch', [url, {
          method: options.method,
          headers: options.headers,
          body: options.body
        }]);
      };
    }
    return host;
  }

  window.Nowly = {
    defineModule: function (fn) { userModule = fn; }
  };

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channel !== CHANNEL) return;

    if (data.kind === 'response') {
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error || 'host error'));
      return;
    }

    if (data.kind === 'visibility') {
      visible = data.visible === true;
      for (var i = 0; i < visibilityListeners.length; i++) {
        try { visibilityListeners[i](visible); } catch (e) {}
      }
      return;
    }

    if (data.kind === 'init') {
      if (typeof userModule !== 'function') return;
      if (typeof data.errorPrefix === 'string') errorPrefix = data.errorPrefix;
      if (typeof data.visible === 'boolean') visible = data.visible;
      var host = makeHost(data);
      var root = document.getElementById('root');
      try {
        Promise.resolve(userModule({ host: host, root: root })).catch(function (error) {
          root.textContent = errorPrefix + (error && error.message ? error.message : error);
        });
      } catch (error) {
        root.textContent = errorPrefix + (error && error.message ? error.message : error);
      }
    }
  });

  // Announce readiness only after inline scripts (runtime + extension) have all
  // executed, so \`userModule\` is registered before the parent sends init.
  function announce() {
    parent.postMessage({ channel: CHANNEL, kind: 'ready' }, '*');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  } else {
    announce();
  }
})();`;

// A locked-down Content-Security-Policy for the sandbox document. It permits the
// inline runtime/extension scripts and inline styles we inject, but blocks all
// network egress (no fetch, XHR, websockets, remote scripts, images, or frames)
// — a defense-in-depth layer on top of the null-origin sandbox.
const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

// Prevent an extension's source from breaking out of the <script> element by
// closing it early. `</script>` in JS source is escaped to `<\/script>`, which
// is identical to the parser inside a string/regex but no longer a closing tag.
function escapeScript(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

// Assemble the full HTML document loaded into the iframe: CSP, styles, the
// runtime, then the extension's own source. Scripts run top-to-bottom, so the
// runtime is initialized before the extension calls `Nowly.defineModule`.
export function buildSandboxDocument(extensionSource: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}" />
<style>${NOWLY_MODULE_CSS}</style>
</head>
<body>
<div id="root"></div>
<script>${escapeScript(SANDBOX_RUNTIME)}</script>
<script>${escapeScript(SANDBOX_WIDGETS)}</script>
<script>${escapeScript(extensionSource)}</script>
</body>
</html>`;
}

// Build a Blob URL for the sandbox document. Loading the frame from a Blob URL
// (rather than srcdoc) keeps the document out of the parent's markup and works
// cleanly with the CSP above. Callers must revoke the URL when done.
export function createSandboxUrl(extensionSource: string): string {
  const blob = new Blob([buildSandboxDocument(extensionSource)], { type: 'text/html' });
  return URL.createObjectURL(blob);
}
