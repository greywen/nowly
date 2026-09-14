import { useEffect } from 'react';

/**
 * Forces this window's document surfaces transparent.
 *
 * Both top-surface windows are declared `transparent` with a `#00000000`
 * background, and the stylesheet already targets them with `:has()` rules. That
 * is not enough in some Windows WebView2 builds: the WebView keeps its own opaque
 * default, which shows up wherever the content does not cover the window — most
 * visibly as grey wedges outside the rounded corners of the island and its
 * details panel, since both fill their window edge to edge.
 *
 * Inline `!important` on the three roots is the one thing that reliably wins.
 */
export function useTransparentSurfaces(): void {
  useEffect(() => {
    for (const element of [document.documentElement, document.body, document.getElementById('root')]) {
      element?.style.setProperty('background', 'transparent', 'important');
      element?.style.setProperty('background-color', 'transparent', 'important');
    }
  }, []);
}
