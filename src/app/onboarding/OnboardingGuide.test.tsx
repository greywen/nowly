import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingGuide, type GuideStep } from './OnboardingGuide';

const steps: GuideStep[] = [
  { title: 'Welcome', body: 'Intro' },
  { target: 'edit-layout', title: 'Edit layout', body: 'Rearrange modules' },
  { title: 'Done', body: 'All set' }
];

function renderGuide(onClose = vi.fn()) {
  render(<OnboardingGuide open steps={steps} onClose={onClose} />);
  return onClose;
}

describe('OnboardingGuide', () => {
  it('renders nothing when closed', () => {
    render(<OnboardingGuide open={false} steps={steps} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the first step and shows the step count', () => {
    renderGuide();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 3 步')).toBeInTheDocument();
  });

  it('advances and steps back through the tour', () => {
    renderGuide();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('Edit layout')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 3 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('shows the start action on the last step and closes on click', () => {
    const onClose = renderGuide();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('Done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('skips the tour from the skip link', () => {
    const onClose = renderGuide();
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('skips the tour from the close button', () => {
    const onClose = renderGuide();
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and steps with arrow keys', () => {
    const onClose = renderGuide();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Edit layout')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Welcome')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
