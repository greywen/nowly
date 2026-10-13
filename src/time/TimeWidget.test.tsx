import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import { setLanguage } from '../i18n';
import type { NowlyRepository } from '../data/nowly-repository';
import { TimeWidget } from './TimeWidget';
import { defaultTimeSettings, type TimeSettings } from './time-model';

class ResizeObserverMock {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 420, height: 260 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function repository(settings: TimeSettings): NowlyRepository {
  return {
    getTimeSettings: vi.fn().mockResolvedValue(settings),
    saveTimeSettings: vi.fn(),
    listAlarms: vi.fn().mockResolvedValue([]),
    createAlarm: vi.fn(),
    updateAlarm: vi.fn(),
    deleteAlarm: vi.fn()
  } as unknown as NowlyRepository;
}

describe('TimeWidget', () => {
  it('renders a module header with title and alarm action', async () => {
    const onCreateAlarm = vi.fn();
    render(<RepositoryProvider repository={repository(defaultTimeSettings())}><TimeWidget onCreateAlarm={onCreateAlarm} settings={defaultTimeSettings()} /></RepositoryProvider>);
    expect(screen.getByRole('heading', { name: '时间' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加闹钟' })).toBeInTheDocument();
    screen.getByRole('button', { name: /添加闹钟|新建闹钟|alarm/i }).click();
    expect(onCreateAlarm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId('time-widget-alarm')).not.toBeInTheDocument());
  });

  it('keeps settings in the module header and uses the default icon-button surface for adding alarms', async () => {
    const onOpenSettings = vi.fn();
    render(<RepositoryProvider repository={repository(defaultTimeSettings())}><TimeWidget onOpenSettings={onOpenSettings} onCreateAlarm={vi.fn()} settings={defaultTimeSettings()} /></RepositoryProvider>);
    const settingsButton = screen.getByRole('button', { name: '时间设置' });
    expect(settingsButton.closest('.card-header')).not.toBeNull();
    settingsButton.click();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '添加闹钟' })).toHaveClass('btn', 'btn-icon');
    expect(screen.getByRole('button', { name: '添加闹钟' })).not.toHaveClass('btn-primary');
    await waitFor(() => expect(screen.queryByTestId('time-widget-alarm')).not.toBeInTheDocument());
  });

  it('shows the next enabled alarm and refreshes on alarm changes', async () => {
    const alarms = [{ id: 'a', title: '晨会', hour: 14, minute: 30, repeat: { kind: 'once', date: '2026-10-12' }, enabled: true, createdAt: '', updatedAt: '' }];
    const repo = repository(defaultTimeSettings());
    repo.listAlarms = vi.fn().mockResolvedValue(alarms);
    render(<RepositoryProvider repository={repo}><TimeWidget settings={defaultTimeSettings()} now={() => new Date(2026, 9, 12, 13, 0)} /></RepositoryProvider>);
    expect(await screen.findByTestId('time-widget-alarm')).toHaveTextContent('14:30');
    repo.listAlarms = vi.fn().mockResolvedValue([]);
    act(() => window.dispatchEvent(new Event('nowly:alarms-changed')));
    await waitFor(() => expect(screen.queryByTestId('time-widget-alarm')).not.toBeInTheDocument());
  });
  it('ignores disabled and expired once alarms and selects the next weekly occurrence', async () => {
    const repo = repository(defaultTimeSettings());
    repo.listAlarms = vi.fn().mockResolvedValue([
      { id: 'disabled', title: 'Disabled', hour: 13, minute: 1, repeat: { kind: 'once', date: '2026-10-12' }, enabled: false },
      { id: 'expired', title: 'Expired', hour: 12, minute: 1, repeat: { kind: 'once', date: '2026-10-12' }, enabled: true },
      { id: 'weekly', title: 'Weekly', hour: 14, minute: 30, repeat: { kind: 'weekly', weekdays: [1] }, enabled: true }
    ]);
    render(<RepositoryProvider repository={repo}><TimeWidget settings={defaultTimeSettings()} now={() => new Date(2026, 9, 12, 13, 0)} /></RepositoryProvider>);
    expect(await screen.findByTestId('time-widget-alarm')).toHaveTextContent('Weekly');
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('re-reads alarms every minute and cleans up its subscription', async () => {
    vi.useFakeTimers();
    try {
      const repo = repository(defaultTimeSettings());
      const { unmount } = render(<RepositoryProvider repository={repo}><TimeWidget settings={defaultTimeSettings()} now={() => new Date(2026, 9, 12, 13, 0)} /></RepositoryProvider>);
      await act(async () => {});
      expect(repo.listAlarms).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(repo.listAlarms).toHaveBeenCalledTimes(2);
      unmount();
      act(() => window.dispatchEvent(new Event('nowly:alarms-changed')));
      expect(repo.listAlarms).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('applies stacked segments, dates and the same font size to every clock', async () => {
    const settings: TimeSettings = { ...defaultTimeSettings(), appearance: { ...defaultTimeSettings().appearance, hourCycle: 'h12', showSeconds: true, showDate: true, layout: 'stacked', fontMode: 'manual', fontSize: 32 }, clocks: [
      { id: 'stacked', timeZone: 'UTC', label: 'A' },
      { id: 'second', timeZone: 'UTC', label: 'B' }
    ] };
    render(<RepositoryProvider repository={repository(settings)}><TimeWidget settings={settings} now={() => new Date('2026-10-12T23:59:59Z')} /></RepositoryProvider>);
    const stacked = screen.getAllByTestId('time-clock-digital')[0];
    expect(stacked.querySelectorAll('span')).toHaveLength(3);
    expect(stacked).toHaveTextContent('59 PM');
    expect(screen.getAllByTestId('time-clock')[1].style.getPropertyValue('--time-font-size')).toBe(`${32 / 13}rem`);
    expect(document.querySelectorAll('.time-clock__meta')).toHaveLength(2);
    await waitFor(() => expect(screen.queryByTestId('time-widget-alarm')).not.toBeInTheDocument());
  });

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLanguage('zh');
  });

  it('renders pure time with header actions but without tabs, city or date', async () => {
    const { container } = render(
      <RepositoryProvider repository={repository(defaultTimeSettings())}>
        <TimeWidget settings={defaultTimeSettings()} now={() => new Date(2026, 9, 11, 13, 5, 9)} />
      </RepositoryProvider>
    );
    expect(screen.getByText('13:05')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '时间设置' })).toBeDisabled();
    expect(screen.queryByText(/UTC|上海|2026|本地/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/本地 13:05/)).toBeInTheDocument();
    expect(container.querySelector('[data-testid="time-widget-grid"]')?.textContent).toBe('13:05');
  });

  it('omits the default repository label from DOM text while retaining the accessible name', async () => {
    const { container } = render(
      <RepositoryProvider repository={repository({
        ...defaultTimeSettings(),
        clocks: [
          { id: 'local', timeZone: 'local', label: '本地' }
        ]
      })}>
        <TimeWidget now={() => new Date(2026, 9, 11, 13, 5, 9)} />
      </RepositoryProvider>
    );
    expect(await screen.findByText('13:05')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="time-widget-grid"]')?.textContent).toBe('13:05');
    expect(screen.queryByText('本地')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/本地 13:05/)).toBeInTheDocument();
  });

  it('localizes the default local clock name without rendering hidden labels', () => {
    setLanguage('en');
    render(
      <RepositoryProvider
        repository={repository({
          ...defaultTimeSettings(),
          clocks: [{ id: 'local', timeZone: 'local', label: '' }]
        })}
      >
        <TimeWidget now={() => new Date(2026, 9, 11, 13, 5, 9)} />
      </RepositoryProvider>
    );
    expect(screen.getByText('13:05')).toBeInTheDocument();
    expect(screen.queryByText('本地')).not.toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Local 13:05/)).toBeInTheDocument();
  });

  it('updates the accessible local label when the global language changes after mount', () => {
    render(
      <RepositoryProvider repository={repository(defaultTimeSettings())}>
        <TimeWidget settings={defaultTimeSettings()} now={() => new Date(2026, 9, 11, 13, 5, 9)} />
      </RepositoryProvider>
    );
    expect(screen.getByRole('region', { name: '时间' })).toBeInTheDocument();
    expect(screen.getByLabelText(/本地 13:05/)).toBeInTheDocument();
    act(() => setLanguage('en'));
    expect(screen.getByRole('region', { name: 'Time' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Local 13:05/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/本地 13:05/)).not.toBeInTheDocument();
  });

  it('applies mixed mode to all clocks while keeping hidden labels available to assistive tech', async () => {
    const { container } = render(
      <RepositoryProvider
        repository={repository({
          ...defaultTimeSettings(),
          appearance: { ...defaultTimeSettings().appearance, mode: 'mixed' },
          clocks: [
            { id: 'analog', timeZone: 'UTC', label: '伦敦' },
            { id: 'mixed', timeZone: 'Asia/Shanghai', label: '上海' }
          ]
        })}
      >
        <TimeWidget now={() => new Date('2026-10-11T13:05:09Z')} />
      </RepositoryProvider>
    );
    expect(await screen.findByRole('img', { name: /伦敦/ })).toBeInTheDocument();
    expect(screen.queryByText('上海')).not.toBeInTheDocument();
    expect(screen.getByText('21:05')).toBeInTheDocument();
    expect(screen.queryByText('13:05:09')).not.toBeInTheDocument();
    const analogTile = container.querySelector('[data-testid="time-clock"][data-clock-id="analog"]');
    expect(analogTile).toHaveAttribute('data-clock-mode', 'mixed');
    expect(analogTile).toHaveAttribute('data-time-zone', 'UTC');
    const face = container.querySelector('[data-testid="time-clock-face"][data-time-zone="UTC"]');
    expect(face).toHaveAttribute('role', 'img');
    expect(face).toHaveAttribute('data-clock-hour', '13');
    expect(face).toHaveAttribute('data-clock-minute', '5');
    expect(face).toHaveAttribute('data-clock-second', '9');
    expect(face).toHaveAttribute('data-hour-angle', '32.5');
    expect(face).toHaveAttribute('data-minute-angle', '30.9');
    expect(face).toHaveAttribute('data-second-angle', '54');
  });

  it('reduces columns for full 12-hour seconds strings and gives the grid a readable minimum width', async () => {
    const settings: TimeSettings = { ...defaultTimeSettings(), appearance: { ...defaultTimeSettings().appearance, hourCycle: 'h12', showSeconds: true }, clocks: Array.from({ length: 4 }, (_, index) => ({
      id: String(index), timeZone: 'UTC', label: String(index)
    })) };
    render(<RepositoryProvider repository={repository(settings)}>
      <TimeWidget settings={settings} now={() => new Date('2026-10-11T23:59:59Z')} />
    </RepositoryProvider>);
    expect(screen.getAllByTestId('time-clock-digital')).toHaveLength(4);
    for (const time of screen.getAllByTestId('time-clock-digital')) expect(time).toHaveTextContent('11:59:59 PM');
    expect(screen.getByTestId('time-widget')).toHaveAttribute('data-layout-columns', '2');
    expect(Number.parseFloat(screen.getByTestId('time-widget-grid').style.getPropertyValue('--time-cell-min-width'))).toBeGreaterThan(96);
  });

  it('responds to ResizeObserver dimensions with layout data instead of fixed city defaults', async () => {
    const { container } = render(
      <RepositoryProvider
        repository={repository({
          ...defaultTimeSettings(),
          clocks: [
            { id: 'a', timeZone: 'UTC', label: 'A' },
            { id: 'b', timeZone: 'Asia/Kathmandu', label: 'B' }
          ]
        })}
      >
        <TimeWidget now={() => new Date('2026-10-11T13:05:09Z')} />
      </RepositoryProvider>
    );
    await waitFor(() => expect(container.querySelector('.time-widget__grid')).toHaveStyle({ '--time-columns': '2' }));
    expect(container.querySelector('[data-testid="time-widget"]')).toHaveAttribute('data-clock-count', '2');
    expect(container.querySelector('[data-testid="time-widget"]')).toHaveAttribute('data-layout-columns', '2');
  });
});
