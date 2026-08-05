import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleGridItem } from './ModuleGrid';
import { ModuleGrid } from './ModuleGrid';

// Free-form sparse layout with room to move/resize.
const items: ModuleGridItem[] = [
  { id: 'calendar', rect: { x: 0, y: 0, w: 5, h: 4 }, content: <div>calendar region</div> },
  { id: 'matrix', rect: { x: 5, y: 0, w: 4, h: 4 }, content: <div>matrix region</div> },
  { id: 'notes', rect: { x: 0, y: 4, w: 4, h: 3 }, content: <div>notes region</div> }
];

// jsdom has no layout engine; give the grid a known 1200x800 box so a cell
// stride is 100px in both axes (12 cols, 8 rows).
function sizeGrid() {
  const grid = screen.getByTestId('module-grid');
  grid.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} }) as DOMRect;
  return grid;
}

function frameOf(text: string) {
  return screen.getByText(text).closest('.module-frame') as HTMLElement;
}

describe('ModuleGrid', () => {
  it('places each module at its grid rect', () => {
    render(<ModuleGrid items={items} editing={false} onMove={vi.fn()} onResize={vi.fn()} />);

    const calendar = frameOf('calendar region');
    expect(calendar.style.gridColumn).toBe('1 / span 5');
    expect(calendar.style.gridRow).toBe('1 / span 4');

    const notes = frameOf('notes region');
    expect(notes.style.gridColumn).toBe('1 / span 4');
    expect(notes.style.gridRow).toBe('5 / span 3');
  });

  it('commits a move to free space snapped to the grid', () => {
    const onMove = vi.fn();
    render(<ModuleGrid items={items} editing onMove={onMove} onResize={vi.fn()} />);
    const grid = sizeGrid();

    const handle = within(frameOf('notes region')).getByTestId('module-frame-handle');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 500, clientY: 0 });
    fireEvent.pointerUp(grid);

    expect(onMove).toHaveBeenCalledWith('notes', { x: 5, y: 4 });
  });

  it('does not commit a move that would overlap another module', () => {
    const onMove = vi.fn();
    render(<ModuleGrid items={items} editing onMove={onMove} onResize={vi.fn()} />);
    const grid = sizeGrid();

    const handle = within(frameOf('notes region')).getByTestId('module-frame-handle');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 0, clientY: -400 });
    fireEvent.pointerUp(grid);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('commits a resize into free space snapped to the grid', () => {
    const onResize = vi.fn();
    render(<ModuleGrid items={items} editing onMove={vi.fn()} onResize={onResize} />);
    const grid = sizeGrid();

    const handle = within(frameOf('matrix region')).getByTestId('module-frame-resize');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 200, clientY: 0 });
    fireEvent.pointerUp(grid);

    expect(onResize).toHaveBeenCalledWith('matrix', { w: 6, h: 4 });
  });

  it('does not commit a resize that would overlap another module', () => {
    const onResize = vi.fn();
    render(<ModuleGrid items={items} editing onMove={vi.fn()} onResize={onResize} />);
    const grid = sizeGrid();

    const handle = within(frameOf('calendar region')).getByTestId('module-frame-resize');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(grid, { clientX: 0, clientY: 400 });
    fireEvent.pointerUp(grid);

    expect(onResize).not.toHaveBeenCalled();
  });
});
