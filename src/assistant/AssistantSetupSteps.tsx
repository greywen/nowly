import { useTranslation } from '../i18n';
import './assistant.css';

/** `null` while the step's settings are still loading. */
export type AssistantSetupStatus = { model: boolean | null; data: boolean | null; voice: boolean | null };

const STEPS = [
  { field: 'model', label: 'settings.aiSetupModel', target: 'settings-ai-model' },
  { field: 'data', label: 'settings.aiSetupData', target: 'settings-ai-data' },
  { field: 'voice', label: 'settings.aiSetupVoice', target: 'settings-ai-voice' }
] as const;

/** The order the AI 助手 page has to be filled in; gone once every step is done. */
export function AssistantSetupSteps({ status }: { status: AssistantSetupStatus }) {
  const { t } = useTranslation();
  const values = STEPS.map(step => status[step.field]);
  if (values.some(value => value === null) || values.every(Boolean)) return null;
  function jump(target: string) {
    const group = document.getElementById(target);
    group?.scrollIntoView?.({ block: 'start' });
    group?.focus({ preventScroll: true });
  }
  return <section className="settings-section assistant-setup" aria-labelledby="assistant-setup-title">
    <div className="assistant-setup__head">
      <h3 id="assistant-setup-title" className="assistant-setup__title">{t('settings.aiSetupTitle')}</h3>
      <p className="settings-section__note">{t('settings.aiSetupHint')}</p>
    </div>
    <ol className="assistant-setup__steps">
      {STEPS.map((step, index) => {
        const done = Boolean(status[step.field]);
        return <li key={step.field}>
          <button type="button" className="assistant-setup__step" onClick={() => jump(step.target)}>
            <span className="assistant-setup__index" aria-hidden="true">{index + 1}</span>
            <span className="assistant-setup__label">{t(step.label)}</span>
            <span className={`assistant-setup__badge assistant-setup__badge--${done ? 'done' : 'todo'}`}>
              {done ? t('settings.aiSetupDone') : t('settings.aiSetupTodo')}
            </span>
          </button>
        </li>;
      })}
    </ol>
  </section>;
}
