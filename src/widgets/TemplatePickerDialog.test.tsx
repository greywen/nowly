import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplatePickerDialog } from './TemplatePickerDialog';
import type { WidgetId } from './widget-registry';

function renderPicker(overrides: Partial<Parameters<typeof TemplatePickerDialog>[0]> = {}) {
  return render(
    <TemplatePickerDialog
      presentIds={new Set<WidgetId>()}
      onClose={vi.fn()}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      {...overrides}
    />
  );
}

describe('TemplatePickerDialog', () => {
  it('lists the always-on built-in modules', () => {
    renderPicker();
    expect(screen.getByText('日历')).toBeInTheDocument();
    expect(screen.getByText('看板')).toBeInTheDocument();
  });

  it('lists the optional extension modules alongside the built-ins', () => {
    renderPicker();
    expect(screen.getByText('专注计时')).toBeInTheDocument();
  });

  it('marks a module already on the canvas as added', () => {
    renderPicker({ presentIds: new Set<WidgetId>(['calendar']) });
    expect(screen.getByRole('button', { name: '移除日历' })).toHaveAttribute('aria-pressed', 'true');
  });
});
