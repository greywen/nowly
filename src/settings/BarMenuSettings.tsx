import { ChevronDown, ChevronUp } from '../components/icons';
import { normalizeBarMenu, type BarMenuItem } from '../app/bar-menu';
import { useTranslation } from '../i18n';
import './bar-menu-settings.css';

export function BarMenuSettings({ menu, onChange }: {
  menu?: readonly BarMenuItem[];
  onChange(menu: BarMenuItem[]): void;
}) {
  const { t } = useTranslation();
  const items = normalizeBarMenu(menu);
  function move(index: number, offset: number) {
    const next = [...items];
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return <fieldset className="bar-menu-settings">
    <legend className="bar-menu-settings__legend">{t('settings.barMenu')}</legend>
    <p className="bar-menu-settings__hint">{t('settings.barMenuHint')}</p>
    <div className="bar-menu-settings__list">
      {items.map((item, index) => {
        const label = t(`barMenu.${item.id}`);
        return <div className="bar-menu-settings__row" key={item.id}>
          <label className="form-check form-check-custom form-check-solid">
            <input className="form-check-input" type="checkbox" checked={item.visible}
              onChange={event => onChange(items.map(entry => entry.id === item.id ? { ...entry, visible: event.target.checked } : entry))}/>
            <span className="form-check-label">{label}</span>
          </label>
          <div className="bar-menu-settings__actions">
            <button type="button" className="good-icon-button" disabled={index === 0}
              aria-label={t('settings.barMenuMoveUp', { feature: label })} onClick={() => move(index, -1)}>
              <ChevronUp aria-hidden="true"/>
            </button>
            <button type="button" className="good-icon-button" disabled={index === items.length - 1}
              aria-label={t('settings.barMenuMoveDown', { feature: label })} onClick={() => move(index, 1)}>
              <ChevronDown aria-hidden="true"/>
            </button>
          </div>
        </div>;
      })}
    </div>
  </fieldset>;
}
