import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import type { StickerObject } from './sticker-model';
import { StickerProperties } from './StickerProperties';

it('retains the image aspect ratio through empty and zero dimension inputs', () => {
  setLanguage('zh');
  function Harness() {
    const [object, setObject] = useState<StickerObject>({
      id: 'image', kind: 'image', assetId: 'a'.repeat(32), style: 'original', locked: false,
      x: 200, y: 200, width: 200, height: 100, rotation: 0, opacity: 100
    });
    return <StickerProperties object={object} imageAspectRatio={2} disabled={false} onChange={setObject} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '300' } });
  expect(screen.getByLabelText('宽度')).toHaveValue(300);
  expect(screen.getByLabelText('高度')).toHaveValue(150);
  fireEvent.change(screen.getByLabelText('高度'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('高度'), { target: { value: '100' } });
  expect(screen.getByLabelText('宽度')).toHaveValue(200);
  expect(screen.getByLabelText('高度')).toHaveValue(100);
});
