import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getWidgetDefinition } from '../../widgets/widget-registry';
import { ModuleFrame } from './ModuleFrame';

const calendar = getWidgetDefinition('calendar')!;

describe('ModuleFrame', () => {
  it('renders module content and no edit controls when not editing', () => {
    render(
      <ModuleFrame definition={calendar} presetId="large" editing={false} onCyclePreset={vi.fn()}>
        <div>calendar region</div>
      </ModuleFrame>
    );

    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /切换.*尺寸/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-frame-handle')).not.toBeInTheDocument();
  });

  it('shows the drag handle and a size switcher labeled with the current preset when editing', () => {
    render(
      <ModuleFrame definition={calendar} presetId="large" editing onCyclePreset={vi.fn()}>
        <div>calendar region</div>
      </ModuleFrame>
    );

    expect(screen.getByTestId('module-frame-handle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换日历尺寸' })).toHaveTextContent('大');
  });

  it('calls onCyclePreset with the widget id when the size switcher is clicked', () => {
    const onCyclePreset = vi.fn();
    render(
      <ModuleFrame definition={calendar} presetId="medium" editing onCyclePreset={onCyclePreset}>
        <div>calendar region</div>
      </ModuleFrame>
    );

    fireEvent.click(screen.getByRole('button', { name: '切换日历尺寸' }));
    expect(onCyclePreset).toHaveBeenCalledWith('calendar');
  });

  it('renders an interaction-blocking overlay only while editing', () => {
    const { rerender } = render(
      <ModuleFrame definition={calendar} presetId="large" editing={false} onCyclePreset={vi.fn()}>
        <div>calendar region</div>
      </ModuleFrame>
    );
    expect(screen.queryByTestId('module-frame-overlay')).not.toBeInTheDocument();

    rerender(
      <ModuleFrame definition={calendar} presetId="large" editing onCyclePreset={vi.fn()}>
        <div>calendar region</div>
      </ModuleFrame>
    );
    expect(screen.getByTestId('module-frame-overlay')).toBeInTheDocument();
  });
});
