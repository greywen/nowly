import { DESIGN_COLORS } from '../lib/color';

// Task completion feedback (design.md §12.8). Motion runs through the Web
// Animations API, which the global `animation/transition: none` rule does not
// reach, and only animates transform and opacity. Nothing here blocks input.

export const DONE_TARGET_SELECTOR = '[data-done-target]';
export const DONE_HOLD_EVENT = 'nowly:task-done-hold';
export const DONE_LAND_EVENT = 'nowly:task-done-land';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

type Point = { x: number; y: number };

export type CelebrationRequest = {
  title: string;
  // Quadrant colour used for half of the burst dots.
  color: string;
  // Where a board card was dropped on the done zone.
  dropPoint?: Point | null;
  // The matrix checkbox that was just ticked.
  checkbox?: HTMLElement | null;
  // A board card for the same task, measured before it leaves its lane.
  card?: HTMLElement | null;
  announcement: string;
};

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

let liveRegion: HTMLElement | null = null;

function announce(message: string) {
  if (!liveRegion || !liveRegion.isConnected) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'visually-hidden';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('data-testid', 'task-done-announcer');
    document.body.append(liveRegion);
  }
  // Clearing first makes a repeated message announce again.
  liveRegion.textContent = '';
  const region = liveRegion;
  window.setTimeout(() => { region.textContent = message; }, 0);
}

function center(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function layer(className: string, at: Point): HTMLElement {
  const element = document.createElement('div');
  element.className = `task-done-fx ${className}`;
  element.setAttribute('aria-hidden', 'true');
  element.style.left = `${at.x}px`;
  element.style.top = `${at.y}px`;
  document.body.append(element);
  return element;
}

function play(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  const animation = element.animate(frames, { easing: EASE_OUT, ...options });
  return animation.finished.then(() => undefined, () => undefined);
}

function burst(at: Point, colors: string[], count: number, radius: number) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.PI / count;
    const distance = radius * (index % 2 ? 0.75 : 1);
    const dot = layer('task-done-fx__dot', at);
    dot.style.background = colors[index % colors.length];
    void play(dot, [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px) scale(.3)`, opacity: 0 }
    ], { duration: 420 }).then(() => dot.remove());
  }
}

function doneTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DONE_TARGET_SELECTOR);
}

function land() {
  window.dispatchEvent(new CustomEvent(DONE_LAND_EVENT));
}

async function stampAndFly(origin: Point, colors: string[], withBurst: boolean) {
  const stamp = layer('task-done-fx__stamp', origin);
  if (withBurst) burst(origin, colors, 8, 28);
  await play(stamp, [
    { transform: 'scale(.6)', opacity: 0 },
    { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
    { transform: 'scale(1)', opacity: 1 }
  ], { duration: withBurst ? 260 : 160 });
  const target = doneTarget();
  if (!target) {
    stamp.remove();
    land();
    return;
  }
  const to = center(target.getBoundingClientRect());
  await play(stamp, [
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${to.x - origin.x}px, ${to.y - origin.y}px) scale(.5)` }
  ], { duration: 380, easing: EASE_IN_OUT, fill: 'forwards' });
  stamp.remove();
  land();
}

// Plays the completion feedback. Call it before writing the completion so the
// board's done count can hold its old value until the stamp lands.
export function celebrateTaskCompletion(request: CelebrationRequest) {
  announce(request.announcement);
  const colors = [request.color, DESIGN_COLORS.success];
  const cardRect = request.card?.getBoundingClientRect() ?? null;
  const towardsBoard = Boolean(request.dropPoint || cardRect) && doneTarget() !== null;
  if (towardsBoard) window.dispatchEvent(new CustomEvent(DONE_HOLD_EVENT));

  if (prefersReducedMotion() || !canAnimate()) {
    if (towardsBoard) land();
    return;
  }

  if (request.checkbox) {
    void play(request.checkbox, [
      { transform: 'scale(.8)' },
      { transform: 'scale(1.15)', offset: 0.5 },
      { transform: 'scale(1)' }
    ], { duration: 220 });
    burst(center(request.checkbox.getBoundingClientRect()), colors, 6, 18);
  }
  if (!towardsBoard) return;
  const origin = request.dropPoint ?? center(cardRect!);
  void stampAndFly(origin, colors, Boolean(request.dropPoint));
}

// The done button's landing pop: icon bounce and the count rolling in.
export function playDoneLanding(icon: HTMLElement | null, count: HTMLElement | null) {
  if (prefersReducedMotion() || !canAnimate()) return false;
  if (icon) {
    void play(icon, [
      { transform: 'scale(1)' },
      { transform: 'scale(1.3)', offset: 0.4 },
      { transform: 'scale(1)' }
    ], { duration: 280 });
  }
  if (count) {
    void play(count, [
      { transform: 'translateY(60%)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 }
    ], { duration: 200 });
  }
  return true;
}
