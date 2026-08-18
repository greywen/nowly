import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, useTranslation } from '../../i18n';

// First-run coach-mark tour: highlights real elements on the page step by step
// and explains them. Target elements are tagged with `data-guide="<key>"`; this
// component looks them up by key to draw a dimmed cutout plus a caption card.
// Steps without a target (welcome / done) render centered over a dimmed screen.
//
// Per design.md there are no animations: the spotlight jumps between steps
// instantly and progress states switch without transitions.

export type GuideStep = {
  // The `data-guide` value of the target element; empty means centered display
  // (welcome / closing step).
  target?: string;
  title: string;
  body: string;
};

type Props = {
  open: boolean;
  steps: GuideStep[];
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

const PADDING = 8; // Spotlight inset around the target element.
const CARD_GAP = 14; // Gap between the card and the spotlight.
const VIEWPORT_MARGIN = 12; // Keep the card this far from the viewport edges.
const MAX_CARD_WIDTH = 320;

function readRect(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Pick where the card sits relative to the spotlight. We try each side in turn
// (below, above, right, left), keeping whichever first has room for the card,
// then clamp the result into the viewport. When no side fits — e.g. the target
// fills most of the screen — we center the card over the spotlight instead.
function placeCard(spot: Rect, card: Size, vw: number, vh: number): React.CSSProperties {
  const clampLeft = (value: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(value, vw - card.width - VIEWPORT_MARGIN));
  const clampTop = (value: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(value, vh - card.height - VIEWPORT_MARGIN));

  const centeredLeft = clampLeft(spot.left + spot.width / 2 - card.width / 2);
  const centeredTop = clampTop(spot.top + spot.height / 2 - card.height / 2);

  const spaceBelow = vh - (spot.top + spot.height) - CARD_GAP;
  const spaceAbove = spot.top - CARD_GAP;
  const spaceRight = vw - (spot.left + spot.width) - CARD_GAP;
  const spaceLeft = spot.left - CARD_GAP;

  if (spaceBelow >= card.height) {
    return { top: clampTop(spot.top + spot.height + CARD_GAP), left: centeredLeft, width: card.width };
  }
  if (spaceAbove >= card.height) {
    return { top: clampTop(spot.top - CARD_GAP - card.height), left: centeredLeft, width: card.width };
  }
  if (spaceRight >= card.width) {
    return { top: centeredTop, left: clampLeft(spot.left + spot.width + CARD_GAP), width: card.width };
  }
  if (spaceLeft >= card.width) {
    return { top: centeredTop, left: clampLeft(spot.left - CARD_GAP - card.width), width: card.width };
  }
  // No side fits: center the card over the spotlight so it stays readable.
  return { top: centeredTop, left: centeredLeft, width: card.width };
}

export function OnboardingGuide({ open, steps, onClose }: Props) {
  useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState<Size | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  // Reset to the first step whenever the tour opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const recompute = useCallback(() => {
    setRect(readRect(step?.target));
    const card = cardRef.current;
    if (card) {
      const r = card.getBoundingClientRect();
      setCardSize({ width: r.width, height: r.height });
    }
  }, [step?.target]);

  // Re-measure the target and the card when the step or the window changes. The
  // card content differs per step, so its height must be read after each render.
  useLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, index, step?.target, step?.title, step?.body, recompute]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => recompute();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, recompute]);

  // Keyboard: Esc skips, arrows step, Enter advances.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, steps.length]);

  if (!open || !step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Card width adapts to narrow viewports so it never overflows the screen.
  const cardWidth = Math.min(MAX_CARD_WIDTH, vw - VIEWPORT_MARGIN * 2);

  // Spotlight box (with padding, clamped to the viewport).
  const spot = rect
    ? {
        top: Math.max(rect.top - PADDING, 0),
        left: Math.max(rect.left - PADDING, 0),
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2
      }
    : null;

  // Card placement: adapt around the spotlight, or center over the screen when
  // there is no target (welcome / done). Until the card has been measured we
  // fall back to a centered position to avoid a first-frame jump.
  let cardStyle: React.CSSProperties;
  if (!spot) {
    cardStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: cardWidth
    };
  } else if (cardSize) {
    cardStyle = placeCard(spot, { width: cardWidth, height: cardSize.height }, vw, vh);
  } else {
    cardStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: cardWidth
    };
  }

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={t('onboarding.ariaLabel')}>
      {/* Click-catcher: blocks page interaction. The spotlight dims its
          surroundings via a large box-shadow; with no target the whole screen
          is dimmed. */}
      <div
        className="onboarding__scrim"
        style={{ backgroundColor: spot ? 'transparent' : 'rgba(0, 0, 0, 0.45)' }}
        onClick={onClose}
      />
      {spot ? (
        <div
          className="onboarding__spot"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height
          }}
        />
      ) : null}

      <div
        ref={cardRef}
        className="onboarding__card"
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="onboarding__card-head">
          <span className="onboarding__step-count">
            {t('onboarding.stepCount', { current: index + 1, total: steps.length })}
          </span>
          <button
            type="button"
            className="btn btn-icon onboarding__close"
            onClick={onClose}
            aria-label={t('onboarding.close')}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <h3 className="onboarding__title">{step.title}</h3>
        <p className="onboarding__body">{step.body}</p>

        <div className="onboarding__dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`onboarding__dot${i === index ? ' is-active' : ''}`} />
          ))}
        </div>

        <div className="onboarding__actions">
          <button type="button" className="onboarding__skip" onClick={onClose}>
            {t('onboarding.skip')}
          </button>
          <div className="onboarding__nav">
            {!isFirst ? (
              <button
                type="button"
                className="btn"
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              >
                {t('onboarding.back')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (isLast ? onClose() : setIndex((i) => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? t('onboarding.start') : t('onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
