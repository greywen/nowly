import { ChevronDown, ChevronUp } from '../components/icons';
import { groupBarMenu, moveBarMenuItem, normalizeBarMenu, type BarFeatureId, type BarMenuItem } from '../app/bar-menu';
import { useTranslation } from '../i18n';
import './bar-menu-settings.css';

// The AI entry is hidden for now; its saved preference is kept but not editable.
const HIDDEN = new Set<BarFeatureId>(['assistant']);
const groupLabels = { create: 'barMenu.groupCreate', capture: 'barMenu.groupCapture' } as const;

export function BarMenuSettings({ menu, onChange }: {
  menu?: readonly BarMenuItem[];
  onChange(menu: BarMenuItem[]): void;
}) {
  const { t } = useTranslation();
  const items = normalizeBarMenu(menu);
  const groups = groupBarMenu(items, item => !HIDDEN.has(item.id)).filter(group => group.items.length);
  return <fieldset className="bar-menu-settings">
    <legend className="bar-menu-settings__legend">{t('settings.barMenu')}</legend>
    <p className="bar-menu-settings__hint">{t('settings.barMenuHint')}</p>
    {groups.map(group => <fieldset className="bar-menu-settings__group" key={group.id}>
      <legend className="bar-menu-settings__group-legend">{t(groupLabels[group.id])}</legend>
      <div className="bar-menu-settings__list">
        {group.items.map((item, index) => {
          const label = t(`barMenu.${item.id}`);
          return <div className="bar-menu-settings__row" key={item.id}>
            <label className="form-check form-check-custom form-check-solid">
              <input className="form-check-input" type="checkbox" checked={item.visible}
                onChange={event => onChange(items.map(entry => entry.id === item.id ? { ...entry, visible: event.target.checked } : entry))}/>
              <span className="form-check-label">{label}</span>
            </label>
            <div className="bar-menu-settings__actions">
              <button type="button" className="good-icon-button" disabled={index === 0}
                aria-label={t('settings.barMenuMoveUp', { feature: label })}
                onClick={() => onChange(moveBarMenuItem(items, item.id, -1, HIDDEN))}>
                <ChevronUp aria-hidden="true"/>
              </button>
              <button type="button" className="good-icon-button" disabled={index === group.items.length - 1}
                aria-label={t('settings.barMenuMoveDown', { feature: label })}
                onClick={() => onChange(moveBarMenuItem(items, item.id, 1, HIDDEN))}>
                <ChevronDown aria-hidden="true"/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </fieldset>)}
  </fieldset>;
}
