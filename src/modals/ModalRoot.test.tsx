import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalRoot } from './ModalRoot';
import { sampleEvents, sampleNotes, sampleTasks } from '../lib/sample-data';

describe('ModalRoot', () => {
  it('renders and updates event classification and linked task selects', async () => {
    const user = userEvent.setup();
    render(
      <ModalRoot
        modal={{ type: 'event', event: sampleEvents[0] }}
        events={sampleEvents}
        tasks={sampleTasks}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('日程编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('站会')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '分类' })).toHaveTextContent('工作');
    const linkedTask = screen.getByRole('combobox', { name: '关联任务' });
    await user.click(linkedTask);
    await user.type(screen.getByRole('searchbox', { name: '搜索关联任务' }), '发布');
    await user.click(screen.getByRole('option', { name: '发布 v0.1' }));
    expect(linkedTask).toHaveTextContent('发布 v0.1');
  });

  it('renders and updates task quadrant, priority, and linked event selects', async () => {
    const user = userEvent.setup();
    render(
      <ModalRoot
        modal={{ type: 'task', task: sampleTasks[0] }}
        events={sampleEvents}
        tasks={sampleTasks}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('任务编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('发布 v0.1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '所属象限' })).toHaveTextContent('重要且紧急');
    expect(screen.getByRole('combobox', { name: '优先级' })).toHaveTextContent('高');
    const linkedEvent = screen.getByRole('combobox', { name: '关联日程' });
    await user.click(linkedEvent);
    expect(screen.getByRole('option', { name: '无关联' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜索关联日程' }), '站会');
    await user.click(screen.getByRole('option', { name: '站会' }));
    expect(linkedEvent).toHaveTextContent('站会');
  });

  it('renders note modal when modal state is note', () => {
    render(
      <ModalRoot
        modal={{ type: 'note', note: sampleNotes[0] }}
        events={sampleEvents}
        tasks={sampleTasks}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('便签编辑')).toBeInTheDocument();
    expect(screen.getByDisplayValue('产品原则')).toBeInTheDocument();
  });
});
