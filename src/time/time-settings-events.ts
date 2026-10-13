const timeSettingsEvents = new EventTarget();
const timeSettingsChanged = 'time-settings-changed';

export function notifyTimeSettingsChanged() {
  timeSettingsEvents.dispatchEvent(new Event(timeSettingsChanged));
}

export function subscribeTimeSettingsChanged(listener: () => void) {
  timeSettingsEvents.addEventListener(timeSettingsChanged, listener);
  return () => timeSettingsEvents.removeEventListener(timeSettingsChanged, listener);
}
