import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { WelcomeSticker } from './WelcomeSticker';

afterEach(() => setLanguage('zh'));

describe('WelcomeSticker', () => {
  it('uses a noninteractive sticker canvas without persisting user data', () => {
    const before = { ...localStorage };
    const { container } = render(<WelcomeSticker />);
    const canvas = screen.getByTestId('sticker-canvas');
    expect(canvas.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '欢迎使用 Nowly' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载你的工作区…');
    expect(container.querySelector('[data-object-id="welcome-logo"] img')).toHaveAttribute('src', '/logo.png');
    expect(container.querySelectorAll('.sticker-object')).toHaveLength(25);
    fireEvent.click(canvas);
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('[tabindex], .sticker-object__handle')).toBeNull();
    expect({ ...localStorage }).toEqual(before);
  });

  it.each([
    ['zh', '点击编辑布局，添加你的第一个模块'],
    ['en', 'Click Edit layout to add your first module']
  ] as const)('shows an empty workspace guide instead of loading feedback in %s', (language, hint) => {
    setLanguage(language);
    render(<WelcomeSticker loading={false} />);
    expect(screen.getByRole('status')).toHaveTextContent(hint);
    expect(screen.queryByText('Loading your workspace…')).not.toBeInTheDocument();
    expect(screen.queryByText('正在加载你的工作区…')).not.toBeInTheDocument();
    expect(screen.getByTestId('sticker-canvas')).toBeInTheDocument();
  });

  it('localizes loading feedback without changing the multilingual artwork', () => {
    setLanguage('en');
    render(<WelcomeSticker />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your workspace…');
    expect(screen.getByRole('heading', { name: 'Welcome to Nowly' })).toBeInTheDocument();
    expect(screen.getByTestId('sticker-canvas')).toHaveTextContent('欢迎使用 Nowly');
  });
});
