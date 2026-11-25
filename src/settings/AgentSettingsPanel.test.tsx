import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AgentSettingsPanel, type AgentBridgeClient, type AgentConfig } from './AgentSettingsPanel';

const off: AgentConfig = { enabled: false, permissions: { calendar: false, tasks: false, external: false, notes: false, alarms: false, externalWrite: false } };

function client(config: AgentConfig, overrides: Partial<AgentBridgeClient> = {}): AgentBridgeClient {
  return {
    getConfig: vi.fn(async () => config),
    saveConfig: vi.fn(async (next: AgentConfig) => next),
    skillMd: vi.fn(async () => '---\nname: nowly\n---'),
    ...overrides
  };
}

it('keeps permissions locked until agents are allowed, and saves both together', async () => {
  const fixture = client(off);
  render(<AgentSettingsPanel client={fixture} />);
  const allow = await screen.findByRole('checkbox', { name: '允许外部代理连接' });
  await waitFor(() => expect(allow).toBeEnabled());
  expect(screen.getByRole('checkbox', { name: '看板与四象限任务' })).toBeDisabled();
  fireEvent.click(allow);
  fireEvent.click(screen.getByRole('checkbox', { name: '看板与四象限任务' }));
  expect(screen.getByRole('checkbox', { name: '新建和修改外部日历日程（Google / Microsoft）' })).toBeDisabled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存代理设置' })));
  expect(fixture.saveConfig).toHaveBeenCalledWith({ enabled: true, permissions: { ...off.permissions, tasks: true } });
  expect(screen.getByRole('status')).toHaveTextContent('SKILL 设置已保存。');
});

it('offers only copying SKILL.md, inside a three-step install flow', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<AgentSettingsPanel client={client(off)} />);
  const copy = await screen.findByRole('button', { name: '复制 SKILL.md' });
  await waitFor(() => expect(copy).toBeEnabled());
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /安装到/ })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(copy));
  expect(writeText).toHaveBeenCalledWith('---\nname: nowly\n---');
  expect(screen.getByRole('status')).toHaveTextContent('SKILL.md 已复制到剪贴板。');
});
