import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { translations } from '../i18n/translations';
import { assistantTranslations } from '../i18n/assistant-translations';
import { AssistantDock } from './AssistantDock';
import { AssistantSettingsPanel } from './AssistantSettingsPanel';
import { AssistantHistory } from './AssistantHistory';
import { displayField } from './PlanCard';
import { assistantError } from './client';
import type { AssistantClient, Plan } from './types';
Object.assign(translations.zh, assistantTranslations.zh);
Object.assign(translations.en, assistantTranslations.en);
const config = { endpoint: 'https://example.com/v1', model: '用户模型', hasKey: true, permissions: { calendar: true, tasks: true, external: false } };
const client = { getConfig: vi.fn(async () => config), saveConfig: vi.fn(async () => config) } as unknown as AssistantClient;
afterEach(() => setLanguage('zh'));
it('switches mounted composer and existing speech errors without changing user input', async () => {
  setLanguage('zh'); render(<AssistantDock client={client} onRefresh={() => {}} />);
  const input = screen.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await waitFor(() => expect(client.getConfig).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  fireEvent.change(input, { target: { value: '用户数据不翻译' } });
  act(() => setLanguage('en'));
  expect(screen.getByRole('textbox', { name: 'Tell Nowly what you want to do' })).toHaveValue('用户数据不翻译');
  expect(screen.getByRole('alert')).toHaveTextContent('Voice input is not supported');
  act(() => setLanguage('zh'));
  expect(screen.getByRole('alert')).toHaveTextContent('当前环境不支持语音输入');
});
it('switches saved feedback and permission labels in place', async () => {
  setLanguage('zh'); render(<AssistantSettingsPanel client={client} />);
  await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '检测并保存连接' })));
  act(() => setLanguage('en'));
  expect(screen.getByRole('status')).toHaveTextContent('Connection and permissions saved.');
  expect(screen.getByRole('checkbox', { name: 'Local events' })).toBeChecked();
  expect(screen.getByLabelText('Model ID')).toHaveValue('用户模型');
});
it('switches history groups, summaries, diff labels and date locale', () => {
  setLanguage('zh'); const date = new Date(); date.setDate(date.getDate() - 2);
  const plan: Plan = { id: 'p', status: 'committed', createdAt: date.getTime(), expiresAt: Date.now() + 30000, revision: 1,
    actions: [{ kind: 'createTask', draft: {} }], changes: [{ key: 'k', kind: 'createTask', title: '用户任务', before: null, after: { title: '用户任务', priority: 'important_urgent', completed: false } }], warnings: [], options: {} };
  render(<AssistantHistory plans={[plan]} range="7" openChange="p:k" busy={false} uncertain={false} onRangeChange={() => {}} onOpenChange={() => {}} onUndo={() => {}} />);
  act(() => setLanguage('en'));
  expect(screen.getByRole('tab', { name: 'Last 7 days' })).toBeInTheDocument();
  expect(screen.getByText('Create task · 1 item')).toBeInTheDocument();
  expect(screen.getByText(date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' }))).toBeInTheDocument();
  expect(screen.getByText('Important and urgent')).toBeInTheDocument();
  expect(screen.getAllByText('用户任务').length).toBeGreaterThan(0);
});
it('resolves field and fallback error strings at call time', () => {
  setLanguage('zh'); expect(displayField('reminders', [0, 5])).toBe('开始时、提前 5 分钟');
  setLanguage('en'); expect(displayField('reminders', [0, 5])).toBe('At start, 5 minutes before');
  expect(assistantError(null)).toBe('Unable to complete the operation. Check the connection and try again.');
  expect(assistantError(new Error('原始服务错误'))).toBe('原始服务错误');
});
