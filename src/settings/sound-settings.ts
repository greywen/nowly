export const soundChoices = {
  calendar: ['chime-glass', 'chime-wood'],
  alarm: ['bell-rise', 'beep-soft'],
  missedSummary: ['tap', 'low-knock'],
  focus: ['resolve', 'done-blip']
} as const;

export type SoundScene = keyof typeof soundChoices;
export type SoundId = typeof soundChoices[SoundScene][number] | 'none';
export type SoundSettings = { enabled: boolean; volume: number } & Record<SoundScene, SoundId>;
export const defaultSoundSettings: SoundSettings = {
  enabled: true, volume: 35, calendar: 'chime-glass', alarm: 'bell-rise', missedSummary: 'tap', focus: 'resolve'
};