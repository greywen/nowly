import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from '../components/ColorPicker';
import { t } from '../i18n';
import { StickerFloatingTools, StickerObjectToolbar } from './StickerObjectToolbar';
import { newTextSticker, type StickerObject } from './sticker-model';

function setup(object: StickerObject = newTextSticker('text', 'Hello'), busy = false) {
  const onChange = vi.fn(), onAction = vi.fn(), onReplace = vi.fn();
  const result = render(<StickerObjectToolbar host={createRef<HTMLDivElement>()} object={object}
    onChange={onChange} onAction={onAction} onReplace={onReplace} onEditText={vi.fn()} busy={busy} />);
  return { ...result, object, onChange, onAction, onReplace };
}
function open(key: string) {
  fireEvent.click(screen.getByRole('combobox', { name: t(key) }));
  return screen.getByRole('listbox');
}

describe('single-row sticker toolbar', () => {
  it('renders one row without More, edit text or geometry inputs', () => {
    const { container } = setup();
    expect(container.querySelector('.sticker-object-tools__row')).toBeInTheDocument();
    expect(container.querySelector('details')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('stickers.editText') })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    for (const key of ['lock', 'copy']) expect(screen.getByRole('button', { name: t(`stickers.${key}`) }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('common.delete') }).querySelector('svg')).toBeInTheDocument();
  });
  it('keeps only the most recently clicked dropdown open', async () => {
    const user = userEvent.setup();
    setup();
    for (const key of ['textStyle', 'fontSize', 'align', 'opacity', 'layers']) {
      const trigger = screen.getByRole('combobox', { name: t(`stickers.${key}`) });
      await user.click(trigger);
      expect(screen.getAllByRole('listbox')).toHaveLength(1);
      expect(screen.getAllByRole('combobox').filter(item => item.getAttribute('aria-expanded') === 'true')).toEqual([trigger]);
    }
    await user.click(screen.getByRole('combobox', { name: t('stickers.layers') }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('switches exclusively between dropdowns and the color portal without losing color edits', async () => {
    const user = userEvent.setup();
    const { onChange, object } = setup();
    await user.click(screen.getByRole('combobox', { name: t('stickers.align') }));
    await user.click(screen.getByRole('button', { name: t('stickers.color') }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '#123456' } });
    await user.click(screen.getByRole('combobox', { name: t('stickers.layers') }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(onChange).toHaveBeenCalledWith({ ...object, color: '#123456' });
  });
  it('dismisses menus when another surface stops pointer propagation', async () => {
    const user = userEvent.setup();
    setup();
    render(<div onPointerDown={event => event.stopPropagation()}>Outside surface</div>);
    await user.click(screen.getByRole('combobox', { name: t('stickers.align') }));
    await user.click(screen.getByText('Outside surface'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('stickers.color') }));
    await user.click(screen.getByText('Outside surface'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('dismisses the previous menu when keyboard focus moves to another trigger', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('combobox', { name: t('stickers.align') }));
    await user.tab();
    expect(screen.getByRole('listbox')).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: t('stickers.lock') })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: t('stickers.layers') }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: t('stickers.layers') })).toHaveFocus();
  });
  it('supports all eight combinations of text style', () => {
    const { onChange, object } = setup();
    const list = open('stickers.textStyle');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(8);
    fireEvent.click(options[7]);
    expect(onChange).toHaveBeenLastCalledWith({ ...object, bold: true, italic: true, underline: true });
    fireEvent.click(within(open('stickers.textStyle')).getAllByRole('option')[0]);
    expect(onChange).toHaveBeenLastCalledWith({ ...object, bold: false, italic: false, underline: false });
  });
  it('offers every integer font size and supports search', () => {
    const { onChange, object } = setup();
    const list = open('stickers.fontSize');
    expect(within(list).getAllByRole('option').map(option => option.textContent)).toEqual(Array.from({ length: 149 }, (_, index) => String(index + 12)));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '137' } });
    fireEvent.click(screen.getByRole('option', { name: '137' }));
    expect(onChange).toHaveBeenCalledWith({ ...object, fontSize: 137 });
  });
  it('offers every opacity and emits layer reset/front/back commands', () => {
    const { onChange, onAction, object } = setup();
    const list = open('stickers.opacity');
    expect(within(list).getAllByRole('option')).toHaveLength(101);
    fireEvent.click(within(list).getByRole('option', { name: '0%' }));
    expect(onChange).toHaveBeenCalledWith({ ...object, opacity: 0 });
    for (const action of ['default', 'front', 'back']) {
      fireEvent.click(within(open('stickers.layers')).getByRole('option', { name: t(`stickers.${action}`) }));
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
  });
  it('keeps Select popups in its DOM and updates alignment', () => {
    const { onChange, object } = setup();
    const list = open('stickers.align');
    expect(screen.getByRole('toolbar')).toContainElement(list);
    fireEvent.click(within(list).getByRole('option', { name: t('stickers.right') }));
    expect(onChange).toHaveBeenCalledWith({ ...object, align: 'right' });
  });
  it('uses the compact color swatch and marks its portal for outside handlers', () => {
    const { onChange, object } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('stickers.color') }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-sticker-popup');
    expect(screen.getByRole('toolbar')).not.toContainElement(dialog);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '#123456' } });
    fireEvent.pointerDown(within(dialog).getByRole('textbox'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith({ ...object, color: '#123456' });
  });
  it('provides image replacement and style', () => {
    const object: StickerObject = { id: 'image', kind: 'image', assetId: 'asset', style: 'original', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, locked: false };
    const { onChange, onReplace } = setup(object);
    fireEvent.click(screen.getByRole('button', { name: t('stickers.replaceImage') }));
    expect(onReplace).toHaveBeenCalledOnce();
    fireEvent.click(within(open('stickers.style')).getByRole('option', { name: t('stickers.photo') }));
    expect(onChange).toHaveBeenCalledWith({ ...object, style: 'photo' });
  });
  it('disables editing while locked and leaves icon unlock available', () => {
    const { onAction } = setup({ ...newTextSticker('locked', 'Hello'), locked: true });
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect(screen.getByRole('button', { name: t('stickers.color') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('stickers.copy') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('common.delete') })).toBeDisabled();
    const unlock = screen.getByRole('button', { name: t('stickers.unlock') });
    expect(unlock.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(unlock);
    expect(onAction).toHaveBeenCalledWith('lock');
  });
  it('does not loop when its host exists and children are recreated', () => {
    const host = createRef<HTMLDivElement>();
    const { rerender } = render(<div ref={host}><StickerFloatingTools host={host} label="tools"><span>one</span></StickerFloatingTools></div>);
    expect(() => rerender(<div ref={host}><StickerFloatingTools host={host} label="tools"><span>two</span></StickerFloatingTools></div>)).not.toThrow();
    expect(screen.getByRole('toolbar')).toHaveTextContent('two');
  });
});

describe('ColorPicker compact variant', () => {
  it('shows only the current-color trigger, with accessible name and disabled behavior', () => {
    const { rerender } = render(<ColorPicker compact legend="Compact color" name="compact" value="#4FC9DA" presets={[{ value: '#4FC9DA', label: 'Teal' }]} recentColors={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Compact color' });
    expect(trigger).toHaveStyle({ background: '#4FC9DA' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<ColorPicker compact disabled legend="Compact color" name="compact" value="#4FC9DA" presets={[]} recentColors={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Compact color' })).toBeDisabled();
  });
});
