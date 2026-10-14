import { useEffect, useRef, useState } from 'react';
import { Play, Stop } from '../components/icons';
import { Select } from '../components/Select';
import { useTranslation } from '../i18n';
import { soundChoices, type SoundId, type SoundScene, type SoundSettings } from './sound-settings';
import './sound-settings.css';

export function SoundSettingsPanel({ value, onChange }: { value: SoundSettings; onChange(value: SoundSettings): void }) {
  const { t } = useTranslation();
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<SoundScene | null>(null);
  const [error, setError] = useState(false);

  function stop() {
    player.current?.pause();
    player.current = null;
    setPlaying(null);
  }

  useEffect(() => {
    stop();
    setError(false);
    return () => { player.current?.pause(); player.current = null; };
  }, [value]);

  useEffect(() => {
    const stopHidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', stopHidden);
    return () => document.removeEventListener('visibilitychange', stopHidden);
  }, []);

  async function preview(scene: SoundScene) {
    if (playing === scene) { stop(); return; }
    stop();
    setError(false);
    const audio = new Audio(`/sounds/${value[scene]}.wav`);
    player.current = audio;
    audio.volume = value.volume / 100;
    audio.onended = () => { if (player.current === audio) stop(); };
    setPlaying(scene);
    try { await audio.play(); }
    catch { if (player.current === audio) { stop(); setError(true); } }
  }

  return <section className="sound-settings" aria-labelledby="sound-settings-title">
    <h3 id="sound-settings-title">{t('sounds.title')}</h3>
    <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })}/>
      <span className="form-check-label">{t('sounds.enabled')}</span>
    </label>
    <label className="sound-settings__volume" htmlFor="sound-volume">
      <span>{t('sounds.volume')}</span>
      <input id="sound-volume" aria-label={t('sounds.volume')} type="range" min="0" max="100" step="1" value={value.volume} disabled={!value.enabled} onChange={event => onChange({ ...value, volume: Number(event.target.value) })}/>
      <output htmlFor="sound-volume">{value.volume}%</output>
    </label>
    <div className="sound-settings__choices">
      {(Object.keys(soundChoices) as SoundScene[]).map(scene => <div className="sound-settings__choice" key={scene}>
        <Select id={`sound-${scene}`} label={t(`sounds.${scene}`)} value={value[scene]} options={['none', ...soundChoices[scene]].map(id => ({ value: id, label: t(`sounds.${id}`) }))} onChange={id => onChange({ ...value, [scene]: id as SoundId })}/>
        <button type="button" className="good-icon-button" title={t(playing === scene ? 'sounds.stop' : 'sounds.preview')} aria-label={`${t(playing === scene ? 'sounds.stop' : 'sounds.preview')} · ${t(`sounds.${scene}`)}`} disabled={!value.enabled || value.volume === 0 || value[scene] === 'none'} onClick={() => void preview(scene)}>{playing === scene ? <Stop/> : <Play/>}</button>
      </div>)}
    </div>
    {error && <p className="sound-settings__error" role="alert">{t('sounds.error')}</p>}
  </section>;
}