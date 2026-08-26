import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatePickerDialog } from './TemplatePickerDialog';
import type { WidgetId } from './widget-registry';

function renderPicker(overrides: Partial<Parameters<typeof TemplatePickerDialog>[0]> = {}) {
  return render(
    <TemplatePickerDialog
      presentIds={new Set<WidgetId>()}
      sandboxExtensions={[]}
      onClose={vi.fn()}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onInstallExtension={vi.fn().mockResolvedValue(undefined)}
      onUninstallExtension={vi.fn()}
      {...overrides}
    />
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('TemplatePickerDialog', () => {
  it('lists the always-on built-in modules', () => {
    renderPicker();
    expect(screen.getByText('日历')).toBeInTheDocument();
    expect(screen.getByText('看板')).toBeInTheDocument();
  });

  it('offers the developer module in the built-in group in dev builds', () => {
    // The developer module is a dev-only preview tool; it must be placeable
    // from the picker, not just wired into the layout. `import.meta.env.DEV`
    // is true under vitest, matching a `tauri dev` build.
    vi.stubEnv('DEV', true);
    renderPicker();
    expect(screen.getByText('开发者模块')).toBeInTheDocument();
  });

  it('hides the developer module in production builds', () => {
    vi.stubEnv('DEV', false);
    renderPicker();
    expect(screen.queryByText('开发者模块')).not.toBeInTheDocument();
  });
});
