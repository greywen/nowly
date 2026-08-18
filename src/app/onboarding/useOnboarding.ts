import { useCallback, useState } from 'react';

// First-run guided tour flag. We persist a single "seen" marker locally so the
// coach-mark tour appears only on the first launch, mirroring the best-effort
// localStorage pattern used by `useBlur` (persistence never blocks the UI).

export const ONBOARDING_STORAGE_KEY = 'nowly:onboarding-seen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    // If storage is unavailable we treat the tour as already seen, so we never
    // trap the user in a guide we cannot dismiss persistently.
    return true;
  }
}

export function useOnboarding() {
  const [seen, setSeen] = useState<boolean>(() => readSeen());

  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch {
      /* persistence is best-effort; the live value still applies */
    }
  }, []);

  return { shouldShow: !seen, dismiss };
}
