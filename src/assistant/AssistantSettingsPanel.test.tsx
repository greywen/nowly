import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantSettingsPanel } from './AssistantSettingsPanel';
import type { AssistantClient, AssistantConfig } from './types';

const permissions = { calendar: false, tasks: false, external: false };
const empty: AssistantConfig = { endpoint: '', model: '', hasKey: false, permissions };

function clientFixture(config: AssistantConfig, overrides: Partial<AssistantClient> = {}) {
  return {
    getConfig: vi.fn(async () => config),
    saveConfig: vi.fn(async () => config),
    listModels: vi.fn(async () => ['gpt-b', 'gpt-a']),
    ...overrides
  } as unknown as AssistantClient & { listModels: ReturnType<typeof vi.fn>; saveConfig: ReturnType<typeof vi.fn> };
}
async function loaded() { await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeEnabled()); }
const model = () => screen.getByRole('combobox', { name: '模型' });

it('lists models once the URL and key are filled and saves the chosen one', async () => {
  const client = clientFixture(empty);
  render(<AssistantSettingsPanel client={client} />);
  await loaded();
  expect(screen.getByRole('status')).toHaveTextContent('未连接');
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://example.com/v1/' } });
  expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-secret' } });
  await waitFor(() => expect(client.listModels).toHaveBeenCalledWith('https://example.com/v1', 'fixture-secret'), { timeout: 2000 });
  expect(client.listModels).toHaveBeenCalledTimes(1);

  fireEvent.click(model());
  const options = await screen.findAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['gpt-b', 'gpt-a']);
  fireEvent.click(screen.getByRole('option', { name: 'gpt-a' }));
  expect(model()).toHaveValue('gpt-a');
  expect(screen.getByRole('status')).toHaveTextContent('有未保存的更改');

  fireEvent.click(screen.getByRole('checkbox', { name: '本地日程' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' })));
  expect(client.saveConfig).toHaveBeenCalledWith({ ...empty, endpoint: 'https://example.com/v1/', model: 'gpt-a', permissions: { ...permissions, calendar: true } }, 'fixture-secret', false);
  expect(localStorage.getItem('fixture-secret')).toBeNull();
});

it('accepts a typed model when the list cannot be loaded', async () => {
  const client = clientFixture(empty, { listModels: vi.fn(async () => { throw { message: '无法获取模型列表。\nhttps://example.com/v1/models：HTTP 404' }; }) });
  render(<AssistantSettingsPanel client={client} />);
  await loaded();
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://example.com/v1' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } });
  expect(await screen.findByText('无法获取模型列表，可直接输入模型名称。', {}, { timeout: 2000 })).toBeVisible();
  expect(screen.getByText(/HTTP 404/)).not.toBeVisible();
  fireEvent.change(model(), { target: { value: 'my-deployment' } });
  expect(screen.getByText('没有匹配的模型，将使用输入的名称')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' })));
  expect(client.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'my-deployment' }), 'k', false);
});

it('shows a saved key as a state, reuses it only for the same address, and can replace or remove it', async () => {
  const config: AssistantConfig = { endpoint: 'https://example.com/v1', model: 'gpt-a', hasKey: true, protocol: 'azure', permissions };
  const client = clientFixture(config);
  render(<AssistantSettingsPanel client={client} />);
  await loaded();
  expect(screen.getByRole('status')).toHaveTextContent('已连接 · Azure OpenAI');
  expect(screen.getByText('已加密保存')).toBeInTheDocument();
  expect(screen.queryByLabelText('API Key', { selector: 'input' })).not.toBeInTheDocument();
  await waitFor(() => expect(client.listModels).toHaveBeenCalledWith('https://example.com/v1', null), { timeout: 2000 });

  fireEvent.click(screen.getByRole('button', { name: '更换' }));
  expect(screen.getByLabelText('API Key')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByText('已加密保存')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  expect(screen.getByText('保存后移除')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '清除 Key 并保存' })));
  expect(client.saveConfig).toHaveBeenLastCalledWith(config, null, true);

  client.listModels.mockClear();
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://other.example/v1' } });
  expect(screen.getByLabelText('API Key')).toHaveValue('');
  await new Promise(resolve => setTimeout(resolve, 800));
  expect(client.listModels).not.toHaveBeenCalled();
});

it('freezes inputs during detection, avoids duplicate submissions and shows one concise failure', async () => {
  const config: AssistantConfig = { endpoint: 'https://example.com/v1', model: 'claude-fixture', hasKey: false, permissions: { ...permissions, calendar: true } };
  let reject!: (error: unknown) => void;
  const saveConfig = vi.fn(() => new Promise<AssistantConfig>((_, fail) => { reject = fail; }));
  render(<AssistantSettingsPanel client={clientFixture(config, { saveConfig } as never)} />);
  await loaded();
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'fixture-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' }));
  expect(screen.getByRole('status')).toHaveTextContent('正在检测连接，最长约 2 分钟');
  expect(screen.getByLabelText('API 地址')).toBeDisabled();
  expect(model()).toBeDisabled();
  expect(screen.getByLabelText('API Key')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '正在检测接口…' }));
  expect(saveConfig).toHaveBeenCalledTimes(1);
  await act(async () => reject({ message: '自动检测失败；原设置未更改。\nAnthropic Messages：HTTP 401\nOpenAI Chat Completions：HTTP 404' }));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('连接失败，请检查地址、Model ID 和 Key 后重试。');
  expect(screen.getByText(/Anthropic Messages：HTTP 401/)).not.toBeVisible();
  const summaries = screen.getAllByText('查看错误详情', { selector: 'summary' });
  fireEvent.click(summaries[summaries.length - 1]);
  expect(screen.getByText(/Anthropic Messages：HTTP 401/)).toBeVisible();
  expect(screen.getByLabelText('API 地址')).toHaveValue(config.endpoint);
  expect(model()).toHaveValue(config.model);
  expect(screen.getByLabelText('API Key')).toHaveValue('fixture-secret');
});

it('keeps calendar writing nested under and dependent on calendar reading', async () => {
  render(<AssistantSettingsPanel client={clientFixture(empty)} />);
  await loaded();
  const write = screen.getByRole('checkbox', { name: /新建和修改外部日历日程/ });
  expect(write).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '外部日历（只读）' }));
  expect(write).toBeEnabled();
  fireEvent.click(write);
  fireEvent.click(screen.getByRole('checkbox', { name: '外部日历（只读）' }));
  expect(write).not.toBeChecked();
  expect(write).toBeDisabled();
});
