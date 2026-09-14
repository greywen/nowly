import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as icons from './icons';
import { IconStyleProvider, Settings } from './icons';
import { ICON_STYLES } from './icon-style';

const iconComponents = Object.entries(icons)
  .filter(([name]) => name !== 'IconStyleProvider')
  .map(([, value]) => value)
  .filter((value): value is icons.AppIcon => typeof value === 'function');

describe('icons', () => {
  it('defaults to the duotone style', () => {
    const { container } = render(<Settings aria-label="设置" />);
    const icon = container.querySelector('svg');

    expect(icon).toHaveAttribute('data-icon-style', 'duotone');
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(icon).toHaveAttribute('role', 'img');
  });

  it('renders a real two-tone glyph in duotone', () => {
    const { container } = render(<Settings />);
    const shapes = container.querySelectorAll('svg [opacity]');

    expect(shapes.length).toBeGreaterThan(0);
  });

  it.each(ICON_STYLES)('renders every icon in the %s style', (style) => {
    expect(iconComponents.length).toBe(45);

    for (const Icon of iconComponents) {
      const { container, unmount } = render(
        <IconStyleProvider style={style}>
          <Icon />
        </IconStyleProvider>
      );
      const icon = container.querySelector(`svg[data-icon-style="${style}"]`);
      expect(icon).not.toBeNull();
      expect(icon?.innerHTML.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('draws the outline style with strokes and no fill', () => {
    const { container } = render(
      <IconStyleProvider style="outline">
        <Settings />
      </IconStyleProvider>
    );
    const icon = container.querySelector('svg');

    expect(icon?.innerHTML).toContain('stroke="currentColor"');
    expect(icon?.querySelector('[fill]:not([fill="none"])')).toBeNull();
  });
});
