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
  enabled: true, volume: 100, calendar: 'chime-glass', alarm: 'bell-rise', missedSummary: 'tap', focus: 'resolve'
};

export function normalizeSoundSettings(value?: Partial<SoundSettings>): SoundSettings {
  const normalized = { ...defaultSoundSettings };
  for (const scene of Object.keys(soundChoices) as SoundScene[]) {
    const selected = value?.[scene];
    if (selected && (soundChoices[scene] as readonly string[]).includes(selected)) normalized[scene] = selected;
  }
  return normalized;
}