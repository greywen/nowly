import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { NowlyRepository } from '../data/nowly-repository';
import { setLanguage } from '../i18n';
import { TimeWidget } from './TimeWidget';
import { TimeSettingsDialog } from './TimeSettingsDialog';
import type { Alarm, TimeSettings } from './time-model';

const baseClock = { id: 'local', timeZone: 'local', label: '本地', mode: 'digital' as const, hourCycle: 'h23' as const, showSeconds: false, showLabel: false, showDate: false, showDifference: false };
const alarm: Alarm = {
  id: 'alarm-1',
  title: '喝水',
  hour: 7,
  minute: 3,
  repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] },
  enabled: true,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z'
};
const secondAlarm: Alarm = {
  id: 'alarm-2',
  title: '瑜伽',
  hour: 8,
  minute: 45,
  repeat: { kind: 'weekly', weekdays: [6, 7] },
  enabled: true,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z'
};

function repository({
  settings = { clocks: [baseClock] },
  alarms = [alarm],
  saveTimeSettings = vi.fn().mockResolvedValue(settings)
}: {
  settings?: TimeSettings;
  alarms?: Alarm[];
  saveTimeSettings?: ReturnType<typeof vi.fn>;
} = {}): NowlyRepository {
  return {
    getTimeSettings: vi.fn().mockResolvedValue(settings),
    saveTimeSettings,
    listAlarms: vi.fn().mockResolvedValue(alarms),
    createAlarm: vi.fn().mockImplementation(async (draft) => ({ id: 'alarm-new', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', ...draft })),
    updateAlarm: vi.fn().mockImplementation(async (id, draft) => ({ id, createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', ...draft })),
    deleteAlarm: vi.fn().mockResolvedValue(undefined)
  } as unknown as NowlyRepository;
}

function renderDialog(repo: NowlyRepository) {
  return render(
    <RepositoryProvider repository={repo}>
      <TimeSettingsDialog onClose={vi.fn()} />
    </RepositoryProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TimeSettingsDialog', () => {
  afterEach(() => setLanguage('zh'));

  it('opens the alarm editor directly when launched from the module add icon', async () => {
    render(<RepositoryProvider repository={repository({ alarms: [] })}>
      <TimeSettingsDialog onClose={vi.fn()} createAlarm />
    </RepositoryProvider>);
    expect(await screen.findByRole('tab', { name: /闹钟/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: '标题' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加闹钟' })).not.toBeInTheDocument();
  });

  it('keeps focus inside the dialog when changing tabs with a restore trigger', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { unmount } = render(<RepositoryProvider repository={repository()}>
      <TimeSettingsDialog onClose={vi.fn()} trigger={trigger} />
    </RepositoryProvider>);
    const tab = await screen.findByRole('tab', { name: /闹钟/ });
    await user.click(tab);
    expect(tab).toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('localizes self-contained time setting strings for English browsers', async () => {
    setLanguage('en');
    renderDialog(repository());
    expect(await screen.findByRole('dialog', { name: 'Time settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Clocks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add clock' })).toBeInTheDocument();
  });

  it('updates self-contained strings when the global language changes after mount', async () => {
    renderDialog(repository());
    expect(await screen.findByRole('dialog', { name: '时间设置' })).toBeInTheDocument();
    act(() => setLanguage('en'));
    expect(screen.getByRole('dialog', { name: 'Time settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add clock' })).toBeInTheDocument();
  });

  it('retranslates all clock mode and hour-cycle options after a mounted language change', async () => {
    const user = userEvent.setup();
    renderDialog(repository());
    await screen.findByRole('combobox', { name: '显示模式' });
    act(() => setLanguage('en'));
    expect(screen.getByRole('combobox', { name: 'Display mode' })).toHaveTextContent('Digital');
    expect(screen.getByRole('combobox', { name: 'Hour cycle' })).toHaveTextContent('24-hour');
    await user.click(screen.getByRole('combobox', { name: 'Display mode' }));
    for (const name of ['Digital', 'Analog', 'Mixed']) expect(screen.getByRole('option', { name })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Analog' }));
    await user.click(screen.getByRole('combobox', { name: 'Hour cycle' }));
    for (const name of ['24-hour', '12-hour']) expect(screen.getByRole('option', { name })).toBeInTheDocument();
    act(() => setLanguage('zh'));
    expect(screen.getByRole('combobox', { name: '显示模式' })).toHaveTextContent('纯指针');
    expect(screen.getByRole('option', { name: '12 小时' })).toBeInTheDocument();
  });

  it('translates alarm enabled states and named actions when the language changes', async () => {
    const user = userEvent.setup();
    renderDialog(repository({ alarms: [alarm, { ...secondAlarm, enabled: false }] }));
    await user.click(await screen.findByRole('tab', { name: /闹钟/ }));
    await screen.findByRole('button', { name: '编辑 喝水' });
    act(() => setLanguage('en'));
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Disabled' })).not.toBeChecked();
    for (const title of [alarm.title, secondAlarm.title]) {
      expect(screen.getByRole('button', { name: `Edit ${title}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Delete ${title}` })).toBeInTheDocument();
    }
    act(() => setLanguage('zh'));
    expect(screen.getByRole('checkbox', { name: '已启用' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '已停用' })).not.toBeChecked();
  });

  it('loads clock settings, adds/removes/reorders clocks, enforces at least one clock and saves drafts', async () => {
    const user = userEvent.setup();
    const repo = repository();
    renderDialog(repo);
    expect(await screen.findByRole('dialog', { name: '时间设置' })).toBeInTheDocument();
    expect(document.body.querySelector('[data-testid="time-settings-dialog"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '添加时钟' }));
    const clockDetails = document.querySelectorAll<HTMLDetailsElement>('.time-clock-settings-card details');
    clockDetails.forEach((details) => { details.open = true; });
    expect(screen.getByDisplayValue('新时钟')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '上移 新时钟' }));
    await user.click(screen.getByRole('button', { name: '删除 本地' }));
    expect(screen.queryByDisplayValue('本地')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除 新时钟' })).toBeDisabled();
    await waitFor(() => expect(repo.saveTimeSettings).toHaveBeenLastCalledWith({ clocks: [expect.objectContaining({ label: '新时钟' })] }));
    expect(screen.queryByRole('button', { name: '保存时间设置' })).not.toBeInTheDocument();
  });

  it('refreshes an already mounted widget immediately when clock settings change', async () => {
    const user = userEvent.setup();
    let stored: TimeSettings = { clocks: [baseClock] };
    const repo = {
      ...repository(),
      getTimeSettings: vi.fn().mockImplementation(async () => stored),
      saveTimeSettings: vi.fn().mockImplementation(async (settings: TimeSettings) => {
        stored = settings;
        return stored;
      })
    } as unknown as NowlyRepository;
    const { container } = render(
      <RepositoryProvider repository={repo}>
        <TimeWidget now={() => new Date(2026, 9, 11, 13, 5, 9)} />
        <TimeSettingsDialog onClose={vi.fn()} />
      </RepositoryProvider>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="time-widget"]')).toHaveAttribute('data-clock-count', '1'));
    await user.click(await screen.findByRole('button', { name: '添加时钟' }));
    await waitFor(() => expect(container.querySelector('[data-testid="time-widget"]')).toHaveAttribute('data-clock-count', '2'));
  });

  it('updates the actual module layout and font size while persistence is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeSettings>();
    const repo = repository({ saveTimeSettings: vi.fn(() => pending.promise) });
    render(<RepositoryProvider repository={repo}><TimeWidget /><TimeSettingsDialog onClose={vi.fn()} /></RepositoryProvider>);
    await user.click(await screen.findByRole('combobox', { name: '布局' }));
    await user.click(screen.getByRole('option', { name: '上下排列' }));
    expect(screen.getByTestId('time-clock')).toHaveAttribute('data-clock-layout', 'stacked');
    await user.click(screen.getByRole('combobox', { name: '字号模式' }));
    await user.click(screen.getByRole('option', { name: '手动字号' }));
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '33' } });
    expect(slider).toHaveValue('33');
    expect(screen.getByTestId('time-clock').style.getPropertyValue('--time-font-size')).toBe(`${33 / 13}rem`);
    expect(screen.getByRole('status')).toHaveTextContent('自动保存中');
    await act(async () => pending.resolve({ clocks: [baseClock] }));
  });

  it('disables clock configuration and saving until settings load successfully', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeSettings>();
    const saveTimeSettings = vi.fn().mockResolvedValue({ clocks: [baseClock] });
    const repo = {
      ...repository({ saveTimeSettings }),
      getTimeSettings: vi.fn().mockReturnValue(pending.promise)
    } as unknown as NowlyRepository;
    renderDialog(repo);
    expect(await screen.findByText(/加载时间设置/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加时钟' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存时间设置' })).not.toBeInTheDocument();
    expect(saveTimeSettings).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ clocks: [baseClock] }));
    expect(await screen.findByRole('button', { name: '添加时钟' })).toBeInTheDocument();
  });

  it('keeps the latest edits on save failure and lets the user retry saving', async () => {
    const user = userEvent.setup();
    const saveTimeSettings = vi.fn().mockRejectedValue(new Error('保存失败'));
    const repo = repository({ saveTimeSettings });
    renderDialog(repo);
    const label = await screen.findByDisplayValue('本地');
    await user.clear(label);
    await user.type(label, '办公室');
    expect(await screen.findByText(/未保存: 保存失败/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/办公室/)).toBeInTheDocument();
    saveTimeSettings.mockImplementation(async (settings: TimeSettings) => settings);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
  });

  it('compares local input across zones without saving the real clock configuration', async () => {
    const user = userEvent.setup();
    const repo = repository({
      settings: {
        clocks: [
          baseClock,
          { ...baseClock, id: 'ktm', timeZone: 'Asia/Kathmandu', label: '加德满都', showLabel: true }
        ]
      }
    });
    renderDialog(repo);
    await user.click(await screen.findByRole('tab', { name: '时差对照' }));
    await user.clear(screen.getByLabelText('本地日期时间'));
    await user.type(screen.getByLabelText('本地日期时间'), '2026-10-11T00:00');
    expect(screen.getByText(/加德满都/)).toBeInTheDocument();
    expect(screen.getByText(/UTC\+05:45/)).toBeInTheDocument();
    expect(repo.saveTimeSettings).not.toHaveBeenCalled();
  });

  it('creates, toggles and deletes local-time alarms with arbitrary minute validation inside time files', async () => {
    const user = userEvent.setup();
    const repo = repository({ alarms: [] });
    renderDialog(repo);
    await user.click(await screen.findByRole('tab', { name: '闹钟(0)' }));
    await user.click(screen.getByRole('button', { name: '添加闹钟' }));
    await user.clear(screen.getByLabelText('标题'));
    await user.type(screen.getByLabelText('标题'), '喝水');
    await user.clear(screen.getByLabelText('分钟'));
    await user.type(screen.getByLabelText('分钟'), '61');
    await user.click(screen.getByRole('button', { name: '创建闹钟' }));
    expect(screen.getByText('分钟必须是 0 到 59')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('分钟'));
    await user.type(screen.getByLabelText('分钟'), '3');
    await user.click(screen.getByRole('combobox', { name: '重复' }));
    await user.click(screen.getByRole('option', { name: '工作日' }));
    await user.click(screen.getByRole('button', { name: '创建闹钟' }));
    await waitFor(() => expect(repo.createAlarm).toHaveBeenCalledWith(expect.objectContaining({ title: '喝水', hour: expect.any(Number), minute: 3, repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] } })));
  });

  it('notifies alarm counts after rendering without updating the dialog during a panel render', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<StrictMode><RepositoryProvider repository={repository()}>
        <TimeSettingsDialog onClose={vi.fn()} />
      </RepositoryProvider></StrictMode>);
      await user.click(await screen.findByRole('tab', { name: /闹钟/ }));
      await user.click(await screen.findByRole('button', { name: '编辑 喝水' }));
      await user.click(screen.getByRole('button', { name: '结束编辑' }));
      await user.click(screen.getByRole('button', { name: '添加闹钟' }));
      await user.click(screen.getByRole('button', { name: '创建闹钟' }));
      await waitFor(() => expect(screen.getByRole('tab', { name: '闹钟(2)' })).toBeInTheDocument());
      expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/Cannot update a component.*while rendering a different component/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('resets the alarm editor draft when switching from one alarm to another', async () => {
    const user = userEvent.setup();
    const repo = repository({ alarms: [alarm, secondAlarm] });
    renderDialog(repo);
    await user.click(await screen.findByRole('tab', { name: /闹钟/ }));
    await user.click(screen.getByRole('button', { name: '编辑 喝水' }));
    await user.clear(screen.getByLabelText('标题'));
    await user.type(screen.getByLabelText('标题'), '临时草稿');
    await user.click(screen.getByRole('button', { name: '编辑 瑜伽' }));
    expect(screen.getByDisplayValue('瑜伽')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存闹钟' })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('分钟'));
    await user.type(screen.getByLabelText('分钟'), '46');
    await waitFor(() => expect(repo.updateAlarm).toHaveBeenCalledWith('alarm-2', expect.objectContaining({ title: '瑜伽', hour: 8, minute: 46 })));
  });
});
