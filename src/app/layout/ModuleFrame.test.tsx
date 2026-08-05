import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getWidgetDefinition } from '../../widgets/widget-registry';
import { ModuleFrame } from './ModuleFrame';

const calendar = getWidgetDefinition('calendar')!;

describe('ModuleFrame', () => {
  it('renders module content and no edit affordances when not editing', () => {
    render(
      <ModuleFrame definition={calendar} editing={false}>
        <div>calendar region</div>
      </ModuleFrame>
    );

    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.queryByTestId('module-frame-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-frame-resize')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-frame-overlay')).not.toBeInTheDocument();
  });

  it('shows the drag handle, resize handle, and blocking overlay when editing', () => {
    render(
      <ModuleFrame definition={calendar} editing>
        <div>calendar region</div>
      </ModuleFrame>
    );

    expect(screen.getByTestId('module-frame-handle')).toBeInTheDocument();
    expect(screen.getByTestId('module-frame-resize')).toBeInTheDocument();
    expect(screen.getByTestId('module-frame-overlay')).toBeInTheDocument();
    expect(screen.getByText('日历')).toBeInTheDocument();
  });

  it('starts a move on pointer down over the frame while editing', () => {
    const onMovePointerDown = vi.fn();
    render(
      <ModuleFrame definition={calendar} editing onMovePointerDown={onMovePointerDown}>
        <div>calendar region</div>
      </ModuleFrame>
    );

    fireEvent.pointerDown(screen.getByTestId('module-frame-overlay'));
    expect(onMovePointerDown).toHaveBeenCalledOnce();
  });

  it('starts a resize on pointer down over the resize handle while editing', () => {
    const onMovePointerDown = vi.fn();
    const onResizePointerDown = vi.fn();
    render(
      <ModuleFrame
        definition={calendar}
        editing
        onMovePointerDown={onMovePointerDown}
        onResizePointerDown={onResizePointerDown}
      >
        <div>calendar region</div>
      </ModuleFrame>
    );

    fireEvent.pointerDown(screen.getByTestId('module-frame-resize'));
    expect(onResizePointerDown).toHaveBeenCalledOnce();
    expect(onMovePointerDown).not.toHaveBeenCalled();
  });

  it('marks the frame invalid while an in-progress drag would collide', () => {
    const { rerender } = render(
      <ModuleFrame definition={calendar} editing isInvalid={false}>
        <div>calendar region</div>
      </ModuleFrame>
    );
    expect(screen.getByTestId('module-frame')).not.toHaveClass('is-invalid');

    rerender(
      <ModuleFrame definition={calendar} editing isInvalid>
        <div>calendar region</div>
      </ModuleFrame>
    );
    expect(screen.getByTestId('module-frame')).toHaveClass('is-invalid');
  });
});
