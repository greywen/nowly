import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleGrid, type ModuleGridItem } from './ModuleGrid';

const items: ModuleGridItem[] = [
  { id: 'calendar', presetId: 'large', content: <div>calendar region</div> },
  { id: 'matrix', presetId: 'medium', content: <div>matrix region</div> },
  { id: 'notes', presetId: 'small', content: <div>notes region</div> }
];

describe('ModuleGrid', () => {
  it('renders modules in order with grid spans from each preset', () => {
    render(<ModuleGrid items={items} editing={false} onReorder={vi.fn()} onCyclePreset={vi.fn()} />);

    const grid = screen.getByTestId('module-grid');
    const frames = grid.querySelectorAll('.module-frame');
    expect(frames).toHaveLength(3);

    const calendarFrame = screen.getByText('calendar region').closest('.module-frame') as HTMLElement;
    expect(calendarFrame.style.gridColumn).toBe('span 8');
    expect(calendarFrame.style.gridRow).toBe('span 6');

    const notesFrame = screen.getByText('notes region').closest('.module-frame') as HTMLElement;
    expect(notesFrame.style.gridColumn).toBe('span 3');
    expect(notesFrame.style.gridRow).toBe('span 3');
  });

  it('calls onReorder with the dragged and target ids on drop while editing', () => {
    const onReorder = vi.fn();
    render(<ModuleGrid items={items} editing onReorder={onReorder} onCyclePreset={vi.fn()} />);

    const calendarFrame = screen.getByText('calendar region').closest('.module-frame') as HTMLElement;
    const notesFrame = screen.getByText('notes region').closest('.module-frame') as HTMLElement;

    fireEvent.dragStart(calendarFrame);
    fireEvent.dragOver(notesFrame);
    fireEvent.drop(notesFrame);

    expect(onReorder).toHaveBeenCalledWith('calendar', 'notes');
  });

  it('does not report a reorder when dropping onto the same module', () => {
    const onReorder = vi.fn();
    render(<ModuleGrid items={items} editing onReorder={onReorder} onCyclePreset={vi.fn()} />);

    const calendarFrame = screen.getByText('calendar region').closest('.module-frame') as HTMLElement;
    fireEvent.dragStart(calendarFrame);
    fireEvent.dragOver(calendarFrame);
    fireEvent.drop(calendarFrame);

    expect(onReorder).not.toHaveBeenCalled();
  });
});
