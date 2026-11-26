import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { t } from '../i18n';
import { AssistantSetupSteps } from './AssistantSetupSteps';

it('lists the three steps in order with their state', () => {
  render(<AssistantSetupSteps status={{ model: true, data: false, voice: false }} />);
  const steps = screen.getAllByRole('button');
  expect(steps.map(step => step.textContent)).toEqual([
    `1${t('settings.aiSetupModel')}${t('settings.aiSetupDone')}`,
    `2${t('settings.aiSetupData')}${t('settings.aiSetupTodo')}`,
    `3${t('settings.aiSetupVoice')}${t('settings.aiSetupTodo')}`
  ]);
});

it('stays hidden while loading and once every step is done', () => {
  const { container, rerender } = render(<AssistantSetupSteps status={{ model: false, data: false, voice: null }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<AssistantSetupSteps status={{ model: true, data: true, voice: true }} />);
  expect(container).toBeEmptyDOMElement();
});

it('moves focus to the matching settings group', () => {
  render(<>
    <AssistantSetupSteps status={{ model: false, data: false, voice: false }} />
    <fieldset id="settings-ai-data" tabIndex={-1}><legend>data</legend></fieldset>
  </>);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t('settings.aiSetupData')) }));
  expect(screen.getByRole('group', { name: 'data' })).toHaveFocus();
});
