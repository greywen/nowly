import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropertyPanel } from './PropertyPanel';
import { defaultProperties } from './tool-properties';
import { annotationWithProperty } from './useAnnotationEditing';
import type { Annotation } from './annotation-document';

const base = {
  id: 'a',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: '#f06445',
  strokeWidth: 4
};

describe('PropertyPanel', () => {
  it('offers three stroke widths, a fill toggle and the palette for a rectangle', () => {
    render(<PropertyPanel kind="rect" properties={defaultProperties()} onChange={() => {}} />);
    expect(screen.getAllByRole('radio', { name: /线宽|Stroke width/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: /填充|Fill/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('radio', { name: /颜色|Colour/ })).toHaveLength(8);
  });

  it('gives the arrow no fill toggle', () => {
    render(<PropertyPanel kind="arrow" properties={defaultProperties()} onChange={() => {}} />);
    expect(screen.getAllByRole('radio', { name: /线宽|Stroke width/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /填充|Fill/ })).toBeNull();
  });

  it('labels text sizes as small, medium and large', () => {
    render(<PropertyPanel kind="text" properties={defaultProperties()} onChange={() => {}} />);
    const sizes = screen.getAllByRole('radio', { name: /字号|Font size/ });
    expect(sizes.map((node) => node.getAttribute('data-value'))).toEqual(['18', '24', '32']);
    expect(sizes[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles fill', () => {
    const onChange = vi.fn();
    render(<PropertyPanel kind="ellipse" properties={defaultProperties()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /填充|Fill/ }));
    expect(onChange).toHaveBeenCalledWith('fill', true);
  });
});

describe('restyling fill', () => {
  it('fills a rectangle and an ellipse', () => {
    const rect = { ...base, kind: 'rect' } as Annotation;
    expect(annotationWithProperty(rect, 'fill', true)).toMatchObject({ filled: true });
    const ellipse = { ...base, kind: 'ellipse' } as Annotation;
    expect(annotationWithProperty(ellipse, 'fill', true)).toMatchObject({ filled: true });
  });

  it('refuses to fill an arrow', () => {
    const arrow = { ...base, kind: 'arrow' } as Annotation;
    expect(annotationWithProperty(arrow, 'fill', true)).toBeNull();
  });
});
