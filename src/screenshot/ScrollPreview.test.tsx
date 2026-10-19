import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollPreview } from './ScrollPreview';

const place = { left: 0, top: 0, width: 160, height: 300 };

describe('ScrollPreview', () => {
  it('follows the new top when capture prepends rows', () => {
    const view = render(<ScrollPreview src="first" place={place} label="preview" />);
    const viewport = view.getByRole('img', { name: 'preview' });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 900 });
    fireEvent.load(view.container.querySelector('img')!);
    expect(viewport.scrollTop).toBe(900);
    view.rerender(<ScrollPreview src="second" place={place} label="preview" grewUpward />);
    expect(viewport.scrollTop).toBe(0);
    fireEvent.load(view.container.querySelector('img')!);
    expect(viewport.scrollTop).toBe(0);
  });

  it('does not force the preview away from content the user is reviewing', () => {
    const view = render(<ScrollPreview src="first" place={place} label="preview" />);
    const viewport = view.getByRole('img', { name: 'preview' });
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 }
    });
    viewport.scrollTop = 200;
    fireEvent.scroll(viewport);
    view.rerender(<ScrollPreview src="second" place={place} label="preview" grewUpward />);
    expect(viewport.scrollTop).toBe(200);
  });
});
