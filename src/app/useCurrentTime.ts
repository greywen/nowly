import { useEffect, useState } from 'react';

function delayUntilNextMinute(date: Date) {
  return 60_000 - (date.getSeconds() * 1_000 + date.getMilliseconds());
}

export function useCurrentTime() {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: number | undefined;

    function scheduleNextMinute() {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const now = new Date();
      timeoutId = window.setTimeout(syncTime, delayUntilNextMinute(now));
    }

    function syncTime() {
      setCurrentTime(new Date());
      scheduleNextMinute();
    }

    function syncWhenVisible() {
      if (document.visibilityState === 'visible') syncTime();
    }

    scheduleNextMinute();
    document.addEventListener('visibilitychange', syncWhenVisible);
    window.addEventListener('focus', syncTime);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', syncWhenVisible);
      window.removeEventListener('focus', syncTime);
    };
  }, []);

  return currentTime;
}
