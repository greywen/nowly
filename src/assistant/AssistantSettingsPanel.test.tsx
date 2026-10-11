import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantSettingsPanel } from './AssistantSettingsPanel';
import type { AssistantClient, AssistantConfig } from './types';

function clientFixture(config: AssistantConfig, saveConfig = vi.fn(async () => config)) {
  return { getConfig: vi.fn(async () => config), saveConfig } as unknown as AssistantClient;
}
async function loaded() { await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeEnabled()); }

it('requires only URL, Key and Model ID without exposing protocol controls', async () => {
  const config: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };
  render(<AssistantSettingsPanel client={clientFixture(config)} />);
  await loaded();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Azure API 版本')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Model ID')).toBeInTheDocument();
  expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '检测并保存连接' })).toBeInTheDocument();
});

  it('keeps essential model connection safeguards concise', async () => {
    const config: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };
    render(<AssistantSettingsPanel client={clientFixture(config)} />);
    await loaded();
    expect(screen.getByText('填写 API 地址、Model ID 和 Key；保存时会自动检测连接。')).toBeInTheDocument();
    expect(screen.getByText(/本机地址可用 HTTP 和空 Key；远程地址需 HTTPS 和 Key/)).toBeInTheDocument();
    expect(screen.getByText(/检测请求不包含日历、任务或对话，可能产生少量费用/)).toBeInTheDocument();
  });

it('sends explicit consent and a password only to the native settings boundary', async () => {
  const config: AssistantConfig = { endpoint: 'https://example.com/v1', model: 'model', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };
  const saveConfig = vi.fn(async () => ({ ...config, hasKey: true }));
  render(<AssistantSettingsPanel client={clientFixture(config, saveConfig)} />);
  await loaded();
  expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-secret' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '本地日程' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' })));
  expect(saveConfig).toHaveBeenCalledWith({ ...config, permissions: { calendar: true, tasks: false, external: false } }, 'fixture-secret', false);
  expect(screen.getByRole('status')).toHaveTextContent('连接与权限已保存。');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
  expect(localStorage.getItem('fixture-secret')).toBeNull();
});

it('freezes inputs during detection, avoids duplicate submissions and shows one concise failure', async () => {
  const config: AssistantConfig = { endpoint: 'https://example.com/v1', model: 'claude-fixture', hasKey: false, permissions: { calendar: true, tasks: false, external: false } };
  let reject!: (error: unknown) => void;
  const saveConfig = vi.fn(() => new Promise<AssistantConfig>((_, fail) => { reject = fail; }));
  render(<AssistantSettingsPanel client={clientFixture(config, saveConfig as never)} />);
  await loaded();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' }));
  expect(screen.getByRole('status')).toHaveTextContent('正在检测连接，最长约 2 分钟');
  expect(screen.getByLabelText('API 地址')).toBeDisabled();
  expect(screen.getByLabelText('Model ID')).toBeDisabled();
  expect(screen.getByLabelText('API Key')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '正在检测接口…' }));
  expect(saveConfig).toHaveBeenCalledTimes(1);
  await act(async () => reject({ message: '自动检测失败；原设置未更改。\nAnthropic Messages：HTTP 401\nOpenAI Chat Completions：HTTP 404' }));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('连接失败，请检查地址、Model ID 和 Key 后重试。');
  expect(screen.getByText('查看错误详情', { selector: 'summary' })).toBeInTheDocument();
  expect(screen.getByText(/Anthropic Messages：HTTP 401/)).not.toBeVisible();
  fireEvent.click(screen.getByText('查看错误详情', { selector: 'summary' }));
  expect(screen.getByText(/Anthropic Messages：HTTP 401/)).toBeVisible();
  expect(screen.getByLabelText('API 地址')).toHaveValue(config.endpoint);
  expect(screen.getByLabelText('Model ID')).toHaveValue(config.model);
  expect(screen.getByLabelText('API Key')).toHaveValue('fixture-secret');
});
