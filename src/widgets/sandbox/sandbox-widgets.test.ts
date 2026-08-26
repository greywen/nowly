import { afterEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_WIDGETS } from './sandbox-widgets';

// The widgets ship as a self-contained IIFE string injected into the sandbox
// iframe. They are pure DOM factories (no postMessage), so we can evaluate the
// string against jsdom's window/document and drive real keyboard interaction —
// the meaningful a11y coverage — without a browser.
function loadWidgets(): any {
  (window as any).Nowly = undefined;
  // eslint-disable-next-line no-new-func
  new Function(SANDBOX_WIDGETS)();
  return (window as any).Nowly;
}

function key(target: Element, k: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
  (window as any).Nowly = undefined;
  vi.restoreAllMocks();
});

describe('SANDBOX_WIDGETS exposes the optional widget factories', () => {
  it('attaches Select / Tabs / DatePicker / TimePicker / ColorPicker to Nowly', () => {
    const N = loadWidgets();
    for (const name of ['Select', 'Tabs', 'DatePicker', 'TimePicker', 'ColorPicker']) {
      expect(typeof N[name]).toBe('function');
    }
  });

  it('keeps an existing Nowly.defineModule when injected after the runtime', () => {
    (window as any).Nowly = { defineModule() {} };
    // eslint-disable-next-line no-new-func
    new Function(SANDBOX_WIDGETS)();
    expect(typeof (window as any).Nowly.defineModule).toBe('function');
    expect(typeof (window as any).Nowly.Select).toBe('function');
  });
});

describe('Select', () => {
  it('is a keyboard-operable combobox that reports the chosen value', () => {
    const N = loadWidgets();
    const onChange = vi.fn();
    const el = N.Select({
      label: '优先级',
      options: [
        { value: 'low', label: '低' },
        { value: 'mid', label: '中' },
        { value: 'high', label: '高' }
      ],
      value: 'low',
      onChange
    });
    document.body.appendChild(el);

    const trigger = el.querySelector('[role="combobox"]') as HTMLElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    // Enter opens; the active option is the current value.
    key(trigger, 'Enter');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // Arrow down to '中', Enter selects it.
    key(trigger, 'ArrowDown');
    key(trigger, 'Enter');
    expect(onChange).toHaveBeenCalledWith('mid');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes get/set value helpers for controlled use', () => {
    const N = loadWidgets();
    const el = N.Select({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' }
      ],
      value: 'a',
      onChange() {}
    });
    expect(el.nowlyGetValue()).toBe('a');
    el.nowlySetValue('b');
    expect(el.nowlyGetValue()).toBe('b');
  });
});

describe('Tabs', () => {
  it('roves selection with the arrow keys and toggles the panels', () => {
    const N = loadWidgets();
    const onChange = vi.fn();
    const el = N.Tabs({
      tabs: [
        { id: 'one', label: '一', panel: '第一页' },
        { id: 'two', label: '二', panel: '第二页' }
      ],
      value: 'one',
      onChange
    });
    document.body.appendChild(el);

    const tabs = Array.from(el.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');

    // ArrowRight moves to the second tab and activates it.
    key(tabs[0], 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('two');
    const after = Array.from(el.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(after[1].getAttribute('aria-selected')).toBe('true');
    const panels = Array.from(el.querySelectorAll('[role="tabpanel"]')) as HTMLElement[];
    const visible = panels.filter((p) => !p.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe('第二页');
  });
});

describe('ColorPicker', () => {
  it('is a radio group that selects a swatch with the keyboard', () => {
    const N = loadWidgets();
    const onChange = vi.fn();
    const el = N.ColorPicker({ label: '颜色', onChange });
    document.body.appendChild(el);

    const group = el.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group).toBeTruthy();
    const swatches = Array.from(el.querySelectorAll('[role="radio"]')) as HTMLElement[];
    expect(swatches.length).toBeGreaterThan(0);

    // Move to the next swatch and select it.
    swatches[0].focus();
    key(swatches[0], 'ArrowRight');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(String(onChange.mock.calls[0][0])).toMatch(/^#/);
  });
});

describe('TimePicker', () => {
  it('lists times at the given step and reports the chosen one', () => {
    const N = loadWidgets();
    const onChange = vi.fn();
    const el = N.TimePicker({ label: '时间', value: '09:00', step: 30, onChange });
    document.body.appendChild(el);

    const trigger = el.querySelector('[role="combobox"]') as HTMLElement;
    key(trigger, 'Enter');
    key(trigger, 'ArrowDown');
    key(trigger, 'Enter');
    expect(onChange).toHaveBeenCalledWith('09:30');
  });
});

describe('DatePicker', () => {
  it('opens a grid and selects a day with Enter', () => {
    const N = loadWidgets();
    const onChange = vi.fn();
    const el = N.DatePicker({ label: '日期', value: '2026-08-15', onChange });
    document.body.appendChild(el);

    const trigger = el.querySelector('[aria-haspopup="grid"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    key(trigger, 'Enter');
    const grid = el.querySelector('[role="grid"]') as HTMLElement;
    expect(grid).toBeTruthy();

    // The current day is active; move one day forward and select it.
    key(grid, 'ArrowRight');
    key(grid, 'Enter');
    expect(onChange).toHaveBeenCalledWith('2026-08-16');
  });
});
