import { describe, expect, it } from 'vitest';
import { exportMarkup } from './rasterize';

// What ends up in the exported file, asserted on the markup rather than on pixels:
// jsdom has no SVG rasteriser, and the thing worth protecting here is structural.

function svgWith(inner: string): SVGSVGElement {
  const container = document.createElement('div');
  container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" style="left: 10px">${inner}</svg>`;
  return container.firstElementChild as SVGSVGElement;
}

describe('exportMarkup', () => {
  it('keeps the drawn annotations', () => {
    const svg = svgWith(
      '<rect data-kind="rect" x="1" y="2" width="3" height="4" stroke="#F06445" stroke-width="4" fill="none"></rect>'
    );

    const markup = exportMarkup(svg, 100, 50);

    // Colour and stroke are presentation attributes, so they survive serialisation.
    // If they were CSS classes the export would come out unstyled.
    expect(markup).toContain('stroke="#F06445"');
    expect(markup).toContain('stroke-width="4"');
  });

  it('removes the mosaic placeholder', () => {
    // §8.1: mosaic pixels are applied by mosaic.rs after this layer is blended, so a
    // placeholder outline in the overlay would draw a dashed box over the mosaic in
    // the exported file.
    const svg = svgWith(
      '<rect data-kind="mosaic" class="screenshot-annotation screenshot-annotation--mosaic" x="0" y="0" width="8" height="8"></rect>'
    );

    const markup = exportMarkup(svg, 100, 50);

    expect(markup).not.toContain('mosaic');
  });

  it('removes the mosaic even when other annotations stay', () => {
    const svg = svgWith(
      '<rect data-kind="rect" stroke="#F06445"></rect>' +
        '<rect data-kind="mosaic" class="screenshot-annotation--mosaic"></rect>' +
        '<ellipse data-kind="ellipse" stroke="#F06445"></ellipse>'
    );

    const markup = exportMarkup(svg, 100, 50);

    expect(markup).not.toContain('mosaic');
    expect(markup).toContain('data-kind="rect"');
    expect(markup).toContain('data-kind="ellipse"');
  });

  it('drops the selection mark', () => {
    // Selection chrome is editor state, not part of the picture.
    const svg = svgWith(
      '<rect data-kind="rect" class="screenshot-annotation screenshot-annotation--selected" stroke="#F06445"></rect>'
    );

    const markup = exportMarkup(svg, 100, 50);

    expect(markup).not.toContain('--selected');
    // The annotation itself stays.
    expect(markup).toContain('data-kind="rect"');
    expect(markup).toContain('stroke="#F06445"');
  });

  it('drops the resize grips along with the frame that holds them', () => {
    // The grips are children of the frame group, so they are removed structurally
    // rather than by matching each one. A grip baked into a saved PNG is the kind
    // of defect nobody notices until a file is already shared.
    const svg = svgWith(
      '<g data-selected-for="r1">' +
        '<rect class="screenshot-annotation--selected"></rect>' +
        '<rect class="screenshot-annotation__handle" data-handle="se"></rect>' +
        '</g>' +
        '<rect data-kind="rect" stroke="#F06445"></rect>'
    );

    const markup = exportMarkup(svg, 100, 50);

    expect(markup).not.toContain('data-handle');
    expect(markup).not.toContain('__handle');
    expect(markup).not.toContain('data-selected-for');
    // The annotation itself stays.
    expect(markup).toContain('stroke="#F06445"');
  });

  it('does not disturb the live layer', () => {
    // The user is still looking at this element, so the mosaic outline and the
    // selection mark have to survive in the original.
    const svg = svgWith(
      '<rect data-kind="mosaic" class="screenshot-annotation--mosaic"></rect>' +
        '<rect data-kind="rect" class="screenshot-annotation--selected"></rect>'
    );

    exportMarkup(svg, 100, 50);

    expect(svg.querySelectorAll('[data-kind="mosaic"]').length).toBe(1);
    expect(svg.querySelectorAll('.screenshot-annotation--selected').length).toBe(1);
  });

  it('exports at the selection size with the preview positioning removed', () => {
    // The preview positions this layer over the selection; the exported image *is* the
    // selection, so a leftover offset would shift every annotation.
    const svg = svgWith('<rect data-kind="rect"></rect>');

    const markup = exportMarkup(svg, 750, 600);

    expect(markup).toContain('width="750"');
    expect(markup).toContain('height="600"');
    expect(markup).not.toContain('style=');
  });

  it('keeps the viewBox so coordinates stay in physical pixels', () => {
    // The annotations are stored in physical pixels; without the viewBox the export
    // would scale them.
    const svg = svgWith('<rect data-kind="rect"></rect>');

    expect(exportMarkup(svg, 100, 50)).toContain('viewBox="0 0 100 50"');
  });

  it('declares the SVG namespace so the markup can be decoded standalone', () => {
    const svg = svgWith('<rect data-kind="rect"></rect>');

    expect(exportMarkup(svg, 100, 50)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});
