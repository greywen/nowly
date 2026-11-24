import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { Mic } from '../components/icons';

const BARS = 12;
const MIN_PX = 4;
const MAX_PX = 16;
/** 3s of 50ms level frames. */
const QUIET_FRAMES = 60;
const QUIET_LEVEL = 0.05;

/**
 * The listening waveform (design.md §12.9): the last twelve 50ms microphone
 * levels, newest on the right. Heights come straight from each frame; nothing
 * interpolates or loops, so silence is a flat 4px line.
 */
export function VoiceWave({ seq, onQuietChange }: { seq: number; onQuietChange?: (quiet: boolean) => void }) {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const quietFrames = useRef(0);
  const quiet = useRef(false);
  const report = useRef(onQuietChange);
  report.current = onQuietChange;

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    quietFrames.current = 0;
    setLevels(Array(BARS).fill(0));
    void listen<{ seq: number; level: number }>('voice-level', event => {
      if (event.payload.seq !== seq) return;
      const level = Math.min(1, Math.max(0, event.payload.level));
      setLevels(current => [...current.slice(1), level]);
      quietFrames.current = level < QUIET_LEVEL ? quietFrames.current + 1 : 0;
      const next = quietFrames.current >= QUIET_FRAMES;
      if (next !== quiet.current) {
        quiet.current = next;
        report.current?.(next);
      }
    }).then(unlisten => { if (disposed) unlisten(); else remove = unlisten; });
    return () => { disposed = true; remove?.(); };
  }, [seq]);

  return (
    <span className="voice-wave" data-quiet={quiet.current} aria-hidden="true">
      <span className="voice-wave__bars">
        {levels.map((level, index) => (
          <span key={index} style={{ height: `${Math.round(MIN_PX + level * (MAX_PX - MIN_PX))}px` }} />
        ))}
      </span>
      <Mic className="voice-wave__static" />
    </span>
  );
}
