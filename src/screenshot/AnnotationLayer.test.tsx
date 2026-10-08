import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnnotationLayer } from './AnnotationLayer';
import type { Annotation } from './annotation-document';
import type { FrameBox } from './frame-geometry';

const box: FrameBox = {
  frameWidth: 2240,
  frameHeight: 1400,
  renderedWidth: 1493.3333333333333,
  renderedHeight: 933.3333333333334,
  offsetX: 0,
  offsetY: 0
};

/// A selection offset from the frame origin, so a coordinate bug shows up.
const selection = { x: 200, y: 100, width: 800, height: 600 };

function renderLayer(objects: readonly Annotation[]) {
  const { container } = render(
    <AnnotationLayer
      objects={objects}
      selection={selection}
      box={box}
    />
  );
  return container.querySelector('svg') as SVGSVGElement;
}

describe('the annotation layer', () => {
  it('uses a physical pixel viewBox so stored coordinates are unchanged', () => {
    // The browser does the scaling, so the preview and the exporter work from the
    // same numbers.
    const svg = renderLayer([]);

    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });

  it('is positioned and sized in CSS pixels', () => {
    const svg = renderLayer([]);

    // 200/1.5 = 133.33, 800/1.5 = 533.33.
    expect(Number.parseFloat(svg.style.left)).toBeCloseTo(133.333, 2);
    expect(Number.parseFloat(svg.style.top)).toBeCloseTo(66.667, 2);
    expect(Number.parseFloat(svg.style.width)).toBeCloseTo(533.333, 2);
  });

  it('draws a rectangle relative to the selection origin', () => {
    // Stored at 250,150; the selection starts at 200,100, so it draws at 50,50.
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'rect',
        x: 250,
        y: 150,
        width: 100,
        height: 80,
        color: '#F06445',
        strokeWidth: 4
      }
    ]);

    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('50');
    expect(rect.getAttribute('y')).toBe('50');
    expect(rect.getAttribute('width')).toBe('100');
    expect(rect.getAttribute('stroke')).toBe('#F06445');
    expect(rect.getAttribute('stroke-width')).toBe('4');
    expect(rect.getAttribute('fill')).toBe('none');
  });

  it('centres an ellipse in its box', () => {
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'ellipse',
        x: 200,
        y: 100,
        width: 100,
        height: 60,
        color: '#4FC9DA',
        strokeWidth: 2
      }
    ]);

    const ellipse = svg.querySelector('ellipse')!;
    expect(ellipse.getAttribute('cx')).toBe('50');
    expect(ellipse.getAttribute('cy')).toBe('30');
    expect(ellipse.getAttribute('rx')).toBe('50');
    expect(ellipse.getAttribute('ry')).toBe('30');
  });

  it('draws a pen stroke through every sampled point', () => {
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'pen',
        x: 200,
        y: 100,
        width: 40,
        height: 20,
        color: '#000000',
        strokeWidth: 4,
        points: [
          { x: 200, y: 100 },
          { x: 220, y: 110 },
          { x: 240, y: 120 }
        ]
      }
    ]);

    const line = svg.querySelector('polyline')!;
    expect(line.getAttribute('points')).toBe('0,0 20,10 40,20');
    // Round caps, so a stroke shows no corner at each sample.
    expect(line.getAttribute('stroke-linecap')).toBe('round');
  });

  it('gives an arrow a head at the far end', () => {
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'arrow',
        x: 200,
        y: 100,
        width: 100,
        height: 0,
        color: '#F06445',
        strokeWidth: 4
      }
    ]);

    const line = svg.querySelector('line')!;
    expect(line.getAttribute('x1')).toBe('0');
    expect(line.getAttribute('x2')).toBe('100');
    // A filled head, not just a line.
    expect(svg.querySelector('polygon')).not.toBeNull();
  });

  it('lays out multi-line text from the baseline down', () => {
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'text',
        x: 200,
        y: 100,
        width: 200,
        height: 60,
        color: '#211F1C',
        fontSize: 24,
        content: 'first\nsecond'
      }
    ]);

    const text = svg.querySelector('text')!;
    // The first line sits one font size below the stored top.
    expect(text.getAttribute('y')).toBe('24');
    expect(text.getAttribute('font-weight')).toBe('500');

    const spans = svg.querySelectorAll('tspan');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('first');
    expect(spans[0].getAttribute('dy')).toBe('0');
    expect(spans[1].textContent).toBe('second');
  });

  it('draws a mosaic as an outline only', () => {
    // §5.3: the pixels come from Rust, so nothing drawn here can disagree with
    // the exported file.
    const svg = renderLayer([
      {
        id: 'a',
        kind: 'mosaic',
        x: 200,
        y: 100,
        width: 100,
        height: 100,
        color: '#000000',
        blockSize: 16,
        blocks: [{ x: 200, y: 100, width: 16, height: 16 }]
      }
    ]);

    const rect = svg.querySelector('[data-kind="mosaic"]')!;
    expect(rect.getAttribute('fill')).toBe('none');
    expect(rect.classList.contains('screenshot-annotation--mosaic')).toBe(true);
  });

  it('paints in creation order', () => {
    const svg = renderLayer([
      { id: 'first', kind: 'rect', x: 200, y: 100, width: 10, height: 10, color: '#000000', strokeWidth: 2 },
      { id: 'second', kind: 'rect', x: 200, y: 100, width: 10, height: 10, color: '#FFFFFF', strokeWidth: 2 }
    ]);

    const ids = Array.from(svg.querySelectorAll('[data-id]')).map((node) =>
      node.getAttribute('data-id')
    );
    expect(ids).toEqual(['first', 'second']);
  });


});

describe('the selected object frame', () => {
  const box = { scale: 1, left: 0, top: 0, width: 400, height: 300, origin: { x: 0, y: 0 } };
  const selection = { x: 0, y: 0, width: 400, height: 300 };

  function handlesOf(objects: Annotation[], selectedId: string) {
    const { container } = render(
      <AnnotationLayer
        objects={objects}
        selectedId={selectedId}
        selection={selection}
        box={box as never}
      />
    );
    return Array.from(container.querySelectorAll('[data-handle]')).map(node =>
      node.getAttribute('data-handle')
    );
  }

  it('gives a box shape eight grips', () => {
    const rect: Annotation = {
      id: 'r1',
      kind: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      color: '#f06445',
      strokeWidth: 4
    };

    expect(handlesOf([rect], 'r1')).toEqual(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']);
  });

  it('gives an arrow one grip per end', () => {
    // A box cannot express direction, so eight grips would reverse some arrows.
    const arrow: Annotation = {
      id: 'a1',
      kind: 'arrow',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      color: '#f06445',
      strokeWidth: 4
    };

    expect(handlesOf([arrow], 'a1')).toEqual(['start', 'end']);
  });

  it('gives text none, and still frames it', () => {
    const text: Annotation = {
      id: 't1',
      kind: 'text',
      x: 20,
      y: 20,
      width: 80,
      height: 24,
      color: '#f06445',
      fontSize: 24,
      content: 'hi'
    };
    const { container } = render(
      <AnnotationLayer
        objects={[text]}
        selectedId="t1"
        selection={selection}
        box={box as never}
      />
    );

    expect(container.querySelectorAll('[data-handle]')).toHaveLength(0);
    // The frame is still there, because the object can still be moved and deleted.
    expect(container.querySelector('[data-selected-for="t1"]')).not.toBeNull();
  });

  it('keeps the grips inside the frame group, so the export strips them', () => {
    const rect: Annotation = {
      id: 'r1',
      kind: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      color: '#f06445',
      strokeWidth: 4
    };
    const { container } = render(
      <AnnotationLayer
        objects={[rect]}
        selectedId="r1"
        selection={selection}
        box={box as never}
      />
    );

    const frame = container.querySelector('[data-selected-for="r1"]')!;
    expect(frame.querySelectorAll('[data-handle]')).toHaveLength(8);
  });
});
