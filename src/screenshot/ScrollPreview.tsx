import { useEffect, useRef } from 'react';

type Place = { left: number; top: number; width: number; height: number };

/// The growing long image beside the selection, scaled to the panel's width and
/// kept scrolled to the newest rows. The user can still scroll it back to check.
export function ScrollPreview({ src, place, label, grewUpward = false }: { src: string | null; place: Place; label: string; grewUpward?: boolean }) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);

  useEffect(() => {
    const node = viewport.current;
    if (node && follow.current) node.scrollTop = grewUpward ? 0 : node.scrollHeight;
  }, [src, grewUpward]);

  return (
    <div
      ref={viewport}
      className="screenshot-scroll-preview"
      role="img"
      aria-label={label}
      style={{ left: place.left, top: place.top, width: place.width, height: place.height }}
      onPointerDown={(event) => event.stopPropagation()}
      onScroll={(event) => {
        const node = event.currentTarget;
        follow.current = grewUpward ? node.scrollTop <= 4
          : node.scrollTop + node.clientHeight >= node.scrollHeight - 4;
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => {
            const node = viewport.current;
            if (node && follow.current) node.scrollTop = grewUpward ? 0 : node.scrollHeight;
          }}
        />
      ) : null}
    </div>
  );
}
