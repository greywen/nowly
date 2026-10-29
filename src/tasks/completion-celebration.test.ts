import { afterEach, describe, expect, it, vi } from 'vitest';
import { celebrateTaskCompletion, DONE_HOLD_EVENT, DONE_LAND_EVENT, playDoneLanding } from './completion-celebration';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function listen() {
  const events: string[] = [];
  const hold = () => events.push('hold');
  const land = () => events.push('land');
  window.addEventListener(DONE_HOLD_EVENT, hold);
  window.addEventListener(DONE_LAND_EVENT, land);
  return {
    events,
    stop() {
      window.removeEventListener(DONE_HOLD_EVENT, hold);
      window.removeEventListener(DONE_LAND_EVENT, land);
    }
  };
}

describe('completion celebration', () => {
  it('holds and lands the board count at once when it cannot animate', () => {
    vi.useFakeTimers();
    const target = document.createElement('span');
    target.setAttribute('data-done-target', '');
    document.body.append(target);
    const spy = listen();
    celebrateTaskCompletion({ title: '写文档', color: '#F06445', dropPoint: { x: 10, y: 10 }, announcement: '已完成：写文档' });
    spy.stop();
    expect(spy.events).toEqual(['hold', 'land']);
    expect(document.querySelector('.task-done-fx')).toBeNull();
    vi.runAllTimers();
    expect(document.querySelector('[data-testid="task-done-announcer"]')).toHaveTextContent('已完成：写文档');
  });

  it('leaves the board count alone when the task is not headed for the board', () => {
    const spy = listen();
    celebrateTaskCompletion({ title: '写文档', color: '#F06445', checkbox: document.createElement('input'), announcement: '已完成：写文档' });
    spy.stop();
    expect(spy.events).toEqual([]);
  });

  it('reports that the landing pop did not play without animation support', () => {
    expect(playDoneLanding(document.createElement('span'), document.createElement('span'))).toBe(false);
  });
});
