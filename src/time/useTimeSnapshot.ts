import { useEffect, useState } from 'react';

export function useTimeSnapshot(now: () => Date = () => new Date()) {
  const [snapshot, setSnapshot] = useState(() => now());

  useEffect(() => {
    let timer: number | undefined;

    function stop() {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    }

    function start() {
      stop();
      timer = window.setInterval(() => setSnapshot(now()), 1000);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      setSnapshot(now());
      start();
    }

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [now]);

  return snapshot;
}
