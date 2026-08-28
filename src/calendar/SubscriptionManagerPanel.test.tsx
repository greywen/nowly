import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionManagerPanel } from './SubscriptionManagerPanel';
import type { CalendarSubscription } from './subscription-model';

function sub(overrides: Partial<CalendarSubscription> = {}): CalendarSubscription {
  return {
    id: 's1', name: '家庭', url: 'https://example.com/a.ics', color: '#4FC9DA',
    refreshIntervalMinutes: 15, provider: 'ics', accountId: null, remoteCalendarId: null,
    lastSyncedAt: null, lastAttemptedAt: null, lastStatus: null, lastError: null,
    createdAt: '', updatedAt: '', ...overrides
  };
}

function props(overrides = {}) {
  return {
    subscriptions: [sub()], onChanged: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(sub()), onUpdate: vi.fn().mockResolvedValue(sub()),
    onDelete: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('SubscriptionManagerPanel', () => {
  it('lists existing subscriptions', () => {
    render(<SubscriptionManagerPanel {...props()} />);
    expect(screen.getByText('家庭')).toBeInTheDocument();
  });

  it('creates a subscription from the form', async () => {
    const p = props({ subscriptions: [] });
    render(<SubscriptionManagerPanel {...p} />);
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '工作' } });
    fireEvent.change(screen.getByLabelText(/链接|URL/), { target: { value: 'https://x.com/b.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /添加订阅/ }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalled());
    expect(p.onChanged).toHaveBeenCalled();
  });

  it('disables add once the source cap is reached', () => {
    const many = Array.from({ length: 50 }, (_, index) => sub({ id: `s${index}` }));
    render(<SubscriptionManagerPanel {...props({ subscriptions: many })} />);
    expect(screen.getByRole('button', { name: /添加订阅/ })).toBeDisabled();
  });

  it('refreshes a subscription', async () => {
    const p = props();
    render(<SubscriptionManagerPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledWith('s1'));
  });

  it('tells the host when the delete confirmation takes over the top layer', () => {
    const onOverlayOpenChange = vi.fn();
    render(<SubscriptionManagerPanel {...props({ onOverlayOpenChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '删除家庭' }));
    expect(onOverlayOpenChange).toHaveBeenCalledWith(true);
  });
});
