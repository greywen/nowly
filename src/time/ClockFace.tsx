import type { CSSProperties } from 'react';
import { analogAngles, clockParts } from './time-format';

type ClockFaceProps = {
  now: Date;
  timeZone: string;
  label: string;
  showSeconds: boolean;
  size: number;
};

export function ClockFace({ now, timeZone, label, showSeconds, size }: ClockFaceProps) {
  const parts = clockParts(now, timeZone);
  const angles = analogAngles(parts);
  const dataAngle = (value: number) => Number(value.toFixed(3));
  return (
    <div
      className="time-clock-face"
      data-testid="time-clock-face"
      data-time-zone={timeZone}
      data-clock-hour={parts.hour}
      data-clock-minute={parts.minute}
      data-clock-second={parts.second}
      data-hour-angle={dataAngle(angles.hour)}
      data-minute-angle={dataAngle(angles.minute)}
      data-second-angle={dataAngle(angles.second)}
      role="img"
      aria-label={`${label} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`}
      style={{ '--time-face-size': `${size}px` } as CSSProperties}
    >
      <span className="time-clock-face__tick time-clock-face__tick--12" />
      <span className="time-clock-face__tick time-clock-face__tick--3" />
      <span className="time-clock-face__tick time-clock-face__tick--6" />
      <span className="time-clock-face__tick time-clock-face__tick--9" />
      <span className="time-clock-face__hand time-clock-face__hand--hour" style={{ transform: `rotate(${angles.hour}deg)` }} />
      <span className="time-clock-face__hand time-clock-face__hand--minute" style={{ transform: `rotate(${angles.minute}deg)` }} />
      {showSeconds ? <span className="time-clock-face__hand time-clock-face__hand--second" style={{ transform: `rotate(${angles.second}deg)` }} /> : null}
      <span className="time-clock-face__pin" />
    </div>
  );
}
