import { annotationBounds, type Annotation } from './annotation-document';
import { handlePosition, handlesFor } from './annotation-resize';
import { framePixelToCss, type FrameBox } from './frame-geometry';

// Drawing the committed annotations over the frozen frame.
//
// §5.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: painted in
// creation order, and the preview must match the export. The geometry is stored in
// physical pixels, so the layer uses a viewBox in physical pixels and lets the
// browser scale it: one transform instead of converting every coordinate, which
// keeps the preview and the exporter working from identical numbers.
//
// Mosaics are not drawn here. They are computed in Rust
// (src-tauri/src/screen_capture/mosaic.rs) so the preview and the file cannot
// disagree; this layer shows the outline of each painted block only.

export type AnnotationLayerProps = {
  objects: readonly Annotation[];
  /// The committed object the user has selected, drawn with a handle box.
  selectedId?: string | null;
  /// The selection rectangle, which is the annotation coordinate origin.
  selection: { x: number; y: number; width: number; height: number };
  box: FrameBox;
  /// Exposed so the export can rasterise this exact element rather than rebuilding
  /// it: §5.3 line 394 warns against assuming two renderers agree.
  svgRef?: React.Ref<SVGSVGElement>;
};

/// Arrowhead length as a multiple of the stroke width.
const ARROWHEAD = 4;

/// How far the selection outline sits outside the object, in physical pixels, so it
/// frames the shape instead of tracing over its own stroke.
const SELECTION_INSET = 4;

/// The painted size of a grip, in physical pixels. Smaller than its grab area in
/// `annotation-resize.ts`: §5.3 wants the frame unobtrusive, and a grip that is
/// easy to hit does not have to be large enough to hide the shape behind it.
const HANDLE_SIZE = 7;

export function AnnotationLayer({
  objects,
  selectedId = null,
  selection,
  box,
  svgRef
}: AnnotationLayerProps) {
  const css = framePixelToCss(selection, box);
  const selected = objects.find((object) => object.id === selectedId) ?? null;

  return (
    <svg
      ref={svgRef}
      className="screenshot-annotations"
      style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
      // Physical pixels, so every stored coordinate is used unchanged.
      viewBox={`0 0 ${selection.width} ${selection.height}`}
      // Decorative: the annotations are image content, described by the region's
      // own label rather than announced individually.
      aria-hidden="true"
    >
      {objects.map((object) => (
        <AnnotationShape
          key={object.id}
          object={object}
          origin={selection}
        />
      ))}
      {/* Drawn last, so it is never hidden by a shape painted after the selected
          one. `rasterize.ts` strips it, so it cannot reach the exported file. */}
      {selected ? <SelectionOutline object={selected} origin={selection} /> : null}
    </svg>
  );
}

/// The selected object's frame and grips: editor chrome, not image content.
function SelectionOutline({
  object,
  origin
}: {
  object: Annotation;
  origin: { x: number; y: number };
}) {
  const bounds = annotationBounds(object);
  return (
    <g data-selected-for={object.id}>
      <rect
        className="screenshot-annotation--selected"
        x={bounds.x - origin.x - SELECTION_INSET}
        y={bounds.y - origin.y - SELECTION_INSET}
        width={bounds.width + SELECTION_INSET * 2}
        height={bounds.height + SELECTION_INSET * 2}
        fill="none"
      />
      {/* A box shape gets eight, an arrow gets one per end, text gets none — see
          `annotation-resize.ts` for why that is a property of the shape. The grips
          take no pointer events: the surface owns a single pointer stream and hit
          tests them geometrically, so they cannot swallow a press. */}
      {handlesFor(object).map((handle) => {
        const point = handlePosition(object, handle);
        const offset = handle === 'start' || handle === 'end' ? 0 : SELECTION_INSET;
        // Pushed outwards onto the frame, so a grip sits beside the shape's own
        // stroke rather than on top of it.
        const bias = {
          x: point.x + (handle.includes('w') ? -offset : handle.includes('e') ? offset : 0),
          y: point.y + (handle.includes('n') ? -offset : handle.includes('s') ? offset : 0)
        };
        return (
          <rect
            key={handle}
            className="screenshot-annotation__handle"
            data-handle={handle}
            x={bias.x - origin.x - HANDLE_SIZE / 2}
            y={bias.y - origin.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
          />
        );
      })}
    </g>
  );
}

function AnnotationShape({
  object,
  origin
}: {
  object: Annotation;
  origin: { x: number; y: number };
}) {
  // Stored in the frame's coordinates, drawn in the selection's.
  const x = object.x - origin.x;
  const y = object.y - origin.y;
  const common = {
    className: 'screenshot-annotation',
    'data-id': object.id,
    'data-kind': object.kind,
    // The stored box, which is what hit testing and move clamping use. For a rect
    // it duplicates the geometry, but an arrow is a `<g>` and an SVG `<text>` has no
    // width of its own, so without this neither object's hit area is inspectable at
    // all — and a wrong box is exactly what made committed text ungrabbable.
    'data-x': object.x,
    'data-y': object.y,
    'data-width': object.width,
    'data-height': object.height
  };

  switch (object.kind) {
    case 'rect':
      return (
        <rect
          {...common}
          x={x}
          y={y}
          width={object.width}
          height={object.height}
          fill={object.filled ? object.color : 'none'}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          strokeLinejoin="round"
        />
      );
    case 'ellipse':
      return (
        <ellipse
          {...common}
          cx={x + object.width / 2}
          cy={y + object.height / 2}
          rx={Math.max(0, object.width / 2)}
          ry={Math.max(0, object.height / 2)}
          fill={object.filled ? object.color : 'none'}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
        />
      );
    case 'arrow':
      return (
        <ArrowShape
          {...common}
          x={x}
          y={y}
          width={object.width}
          height={object.height}
          color={object.color}
          strokeWidth={object.strokeWidth}
        />
      );
    case 'pen':
      return (
        <polyline
          {...common}
          points={object.points.map((p) => `${p.x - origin.x},${p.y - origin.y}`).join(' ')}
          fill="none"
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          // Round joins, so a stroke does not show corners at every sample.
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'text':
      return (
        <text
          {...common}
          x={x}
          // SVG text sits on its baseline, so the first line drops by its size.
          y={y + object.fontSize}
          fill={object.color}
          fontSize={object.fontSize}
          fontWeight={500}
        >
          {object.content.split('\n').map((line, index) => (
            <tspan key={index} x={x} dy={index === 0 ? 0 : object.fontSize * 1.4}>
              {line}
            </tspan>
          ))}
        </text>
      );
    case 'mosaic':
      // Outline only, one per painted cell: the pixels come from Rust, so nothing
      // here can disagree with the exported file. The object's own bounding box is
      // not drawn, because the brush may have left parts of it untouched.
      return (
        <g {...common} className={`${common.className} screenshot-annotation--mosaic`} fill="none">
          {object.blocks.map((block, index) => (
            <rect
              key={index}
              x={block.x - origin.x}
              y={block.y - origin.y}
              width={block.width}
              height={block.height}
            />
          ))}
        </g>
      );
  }
}

/// A line with a solid head, drawn from the rectangle's start corner to its end.
function ArrowShape({
  x,
  y,
  width,
  height,
  color,
  strokeWidth,
  ...rest
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
} & Record<string, unknown>) {
  const toX = x + width;
  const toY = y + height;
  const angle = Math.atan2(height, width);
  const head = strokeWidth * ARROWHEAD;
  // Two barbs at ±30°, so the head reads as an arrow at every angle.
  const spread = Math.PI / 6;
  const barb = (sign: number) => ({
    x: toX - head * Math.cos(angle + sign * spread),
    y: toY - head * Math.sin(angle + sign * spread)
  });
  const left = barb(1);
  const right = barb(-1);

  return (
    <g {...rest} fill={color} stroke={color} strokeWidth={strokeWidth}>
      {/* The shaft stops short of the head, so the tip is not doubled. */}
      <line x1={x} y1={y} x2={toX} y2={toY} strokeLinecap="round" />
      <polygon points={`${toX},${toY} ${left.x},${left.y} ${right.x},${right.y}`} stroke="none" />
    </g>
  );
}
