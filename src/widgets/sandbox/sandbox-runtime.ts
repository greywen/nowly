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
  // Which surface this frame is ('main' or 'dialog'), and listeners for the
  // host's 'stateChanged' broadcast. Both surfaces share one moduleId (one
  // state row), so when one saves, the host tells the other to reload — see
  // spec §11 Q3.
  var surface = 'main';
  var stateChangedListeners = [];

  // Dialog surface only: measure the natural content height and report it so
  // the host can size the dialog to fit. The parent is a null-origin frame and
  // cannot read our layout, so we compute it here. Because the injected CSS
  // stretches html/body/#root to 100% height, scrollHeight would just echo the
  // frame height; instead we take the lowest bottom edge across the rendered
  // subtree (including any open popups like Select/DatePicker), relative to the
  // top of the document, and add the root's bottom padding.
  var lastReportedHeight = -1;
  function measureContentHeight() {
    var root = document.getElementById('root');
    if (!root) return 0;
    var nodes = root.querySelectorAll('*');
    // Bound the scan so a pathological subtree can never freeze the frame.
    var limit = Math.min(nodes.length, 5000);
    var max = 0;
    for (var i = 0; i < limit; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (rect.bottom > max) max = rect.bottom;
    }
    // Fall back to the root's own box when it has no measurable children.
    if (max === 0) max = root.getBoundingClientRect().bottom;
    // getBoundingClientRect is viewport-relative; #root starts at the top of
    // the (unscrolled) document, and its 16px padding sits inside that origin.
    // Add the matching bottom padding so content is not flush against the edge.
    return Math.ceil(max + 16);
  }
  function reportHeight() {
    if (surface !== 'dialog') return;
    var height = measureContentHeight();
    if (height <= 0 || height === lastReportedHeight) return;
    lastReportedHeight = height;
    parent.postMessage({ channel: CHANNEL, kind: 'resize', surface: surface, height: height }, '*');
  }
  function watchContentSize() {
    if (surface !== 'dialog') return;
    // Re-measure on any DOM or size change. A short burst of rAF-timed reads
    // after init catches late layout from fonts and async content without a
    // persistent loop (which would violate the no-animation rule).
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () { reportHeight(); });
      ro.observe(document.documentElement);
      var root = document.getElementById('root');
      if (root) ro.observe(root);
    }
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(function () { reportHeight(); });
      mo.observe(document.getElementById('root') || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    }
    var frames = 0;
    function settle() {
      reportHeight();
      frames++;
      if (frames < 6) requestAnimationFrame(settle);
    }
    requestAnimationFrame(settle);
  }

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
    host.surface = surface;
    // Ask the host to open/close the dialog surface. The host mounts a second
    // iframe loading this same source (surface: 'dialog'); closing tears it
    // down. Either surface may call these; redundant requests are ignored.
    host.openDialog = function (title) {
      parent.postMessage(
        { channel: CHANNEL, kind: 'openDialog', title: typeof title === 'string' ? title : undefined },
        '*'
      );
    };
    host.closeDialog = function () {
      parent.postMessage({ channel: CHANNEL, kind: 'closeDialog' }, '*');
    };
    // Register for the host's post-save broadcast so this surface can reload
    // state after the other surface changed it.
    host.onStateChanged = function (fn) {
      if (typeof fn !== 'function') return function () {};
      stateChangedListeners.push(fn);
      return function () {
        var i = stateChangedListeners.indexOf(fn);
        if (i !== -1) stateChangedListeners.splice(i, 1);
      };
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

    if (data.kind === 'stateChanged') {
      for (var j = 0; j < stateChangedListeners.length; j++) {
        try { stateChangedListeners[j](); } catch (e) {}
      }
      return;
    }

    if (data.kind === 'init') {
      if (typeof userModule !== 'function') return;
      if (typeof data.errorPrefix === 'string') errorPrefix = data.errorPrefix;
      if (typeof data.visible === 'boolean') visible = data.visible;
      if (data.surface === 'dialog' || data.surface === 'main') surface = data.surface;
      var host = makeHost(data);
      var root = document.getElementById('root');
      try {
        Promise.resolve(userModule({ host: host, root: root })).catch(function (error) {
          root.textContent = errorPrefix + (error && error.message ? error.message : error);
        });
      } catch (error) {
        root.textContent = errorPrefix + (error && error.message ? error.message : error);
      }
      // Start reporting content height once the dialog surface has rendered.
      watchContentSize();
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
