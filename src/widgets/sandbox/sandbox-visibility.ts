// Host-side visibility tracking for sandboxed modules. A module is "visible"
// only when its iframe is on-screen AND the document itself is in the
// foreground (not minimized or backgrounded). Animated modules use this to
// pause their rAF loops when they can't be seen — the guest runtime relays the
// flag to `host.onVisibilityChange`.
//
// This matters on a persistent desktop app: the guest shares the parent's
// render thread, so an off-screen module still burning rAF wakes the GPU/fan.

// Combine the two signals into a single visibility flag.
export function combineVisibility(onScreen: boolean, docState: DocumentVisibilityState): boolean {
  return onScreen && docState === 'visible';
}

// Observe an element's on-screen state and the document's foreground state,
// pushing a combined boolean to `send` on every change (and once immediately).
// Returns a cleanup that removes all listeners. Safe when IntersectionObserver
// is missing (older/embedded webviews): falls back to "assume on-screen".
export function observeVisibility(
  target: Element,
  send: (visible: boolean) => void
): () => void {
  let onScreen = true;

  const docState = (): DocumentVisibilityState =>
    typeof document !== 'undefined' ? document.visibilityState : 'visible';

  const emit = () => send(combineVisibility(onScreen, docState()));

  const onDocChange = () => emit();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onDocChange);
  }

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) onScreen = entry.isIntersecting;
      emit();
    });
    observer.observe(target);
  }

  // Deliver an initial reading so the guest starts in the right state.
  emit();

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onDocChange);
    }
    if (observer) observer.disconnect();
  };
}
