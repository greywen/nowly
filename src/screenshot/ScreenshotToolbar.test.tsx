import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenshotToolbar } from './ScreenshotToolbar';
import { IconStyleProvider } from '../components/icons';
import { type IconStyle } from '../components/icon-style';
import { iconBodies } from '../components/icon-data';
import { type ToolbarState, type ToolId } from './toolbar-model';

function state(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    selectionCrossesDisplays: false,
    annotationCount: 0,
    baseImageIsLong: false,
    captureTargetUnavailable: false,
    canUndo: false,
    canRedo: false,
    exporting: false,
    ...overrides
  };
}

function renderToolbar(overrides: Partial<ToolbarState> = {}, activeTool: ToolId = 'select') {
  const onSelectTool = vi.fn();
  const onAction = vi.fn();
  render(
    <ScreenshotToolbar
      activeTool={activeTool}
      onSelectTool={onSelectTool}
      onAction={onAction}
      state={state(overrides)}
    />
  );
  return { onSelectTool, onAction };
}

describe('the toolbar', () => {
  it.each<IconStyle>(['outline', 'solid', 'duotone'])('uses consistent SVG geometry in %s style', (style) => {
    render(
      <IconStyleProvider style={style}>
        <ScreenshotToolbar activeTool="select" onSelectTool={vi.fn()} onAction={vi.fn()} state={state()} />
      </IconStyleProvider>
    );

    for (const button of screen.getAllByRole('button')) {
      const icon = button.querySelector('svg');
      expect(icon, button.getAttribute('aria-label') ?? '').not.toBeNull();
      expect(icon).toHaveAttribute('width', '18');
      expect(icon).toHaveAttribute('height', '18');
      expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      expect(icon).toHaveAttribute('data-icon-style', style);
    }

    const glyphs = { 椭圆: iconBodies.Circle, 马赛克: iconBodies.Mosaic, 文字: iconBodies.Text, 滚动截图: iconBodies.ScrollVertical };
    for (const [label, bodies] of Object.entries(glyphs)) {
      const expected = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expected.innerHTML = bodies[style];
      expect(screen.getByRole('button', { name: label }).querySelector('svg')?.innerHTML).toBe(expected.innerHTML);
    }
    const mosaic = screen.getByRole('button', { name: '马赛克' }).querySelector('svg');
    expect(mosaic?.querySelectorAll('rect')).toHaveLength(16);
    expect(mosaic?.querySelectorAll('rect[opacity="0.35"]')).not.toHaveLength(0);
    if (style === 'outline') {
      expect(mosaic?.querySelectorAll('rect[fill="none"][stroke="currentColor"]')).toHaveLength(16);
    } else {
      expect(mosaic?.querySelectorAll('rect[fill="currentColor"]')).toHaveLength(16);
      expect(mosaic?.querySelectorAll('rect[opacity="0.65"]')).toHaveLength(style === 'solid' ? 0 : 5);
    }
    expect(mosaic?.querySelectorAll('rect[rx]')).toHaveLength(0);
    if (style === 'outline') {
      expect(screen.getByRole('button', { name: '椭圆' }).querySelector('svg')?.children).toHaveLength(1);
      expect(screen.getByRole('button', { name: '椭圆' }).querySelector('circle')).toHaveAttribute('r', '10');
      expect(screen.getByRole('button', { name: '马赛克' }).querySelector('circle')).toBeNull();
    }
  });
  it('updates mosaic geometry when the global icon style changes', () => {
    const toolbar = (style: IconStyle) => (
      <IconStyleProvider style={style}>
        <ScreenshotToolbar activeTool="mosaic" onSelectTool={vi.fn()} onAction={vi.fn()} state={state()} />
      </IconStyleProvider>
    );
    const { rerender } = render(toolbar('duotone'));
    const glyph = () => screen.getByRole('button', { name: '马赛克' }).querySelector('svg')!.innerHTML;
    const duotone = glyph();
    rerender(toolbar('solid'));
    const solid = glyph();
    expect(solid).not.toBe(duotone);
    rerender(toolbar('outline'));
    expect(glyph()).not.toBe(solid);
    expect(glyph()).not.toBe(duotone);
    rerender(toolbar('duotone'));
    expect(glyph()).toBe(duotone);
  });

  it('is announced as one labelled toolbar', () => {
    renderToolbar();

    expect(screen.getByRole('toolbar', { name: '截图编辑工具' })).toBeInTheDocument();
  });

  it('renders all thirteen controls in the documented order', () => {
    renderToolbar();

    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

    expect(names).toEqual([
      '选择',
      '矩形',
      '椭圆',
      '箭头',
      '画笔',
      '文字',
      '马赛克',
      '撤销',
      '重做',
      '滚动截图',
      '另存为 PNG',
      '取消截图',
      '复制图片并完成'
    ]);
  });

  it('marks only the active tool as pressed', () => {
    renderToolbar({}, 'rect');

    expect(screen.getByRole('button', { name: '矩形' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '选择' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('gives actions no pressed state, since they are not toggles', () => {
    renderToolbar();

    for (const name of ['撤销', '另存为 PNG', '取消截图']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-pressed');
    }
  });

  it('reports a tool choice and an action separately', async () => {
    const user = userEvent.setup();
    const { onSelectTool, onAction } = renderToolbar({ canUndo: true });

    await user.click(screen.getByRole('button', { name: '画笔' }));
    await user.click(screen.getByRole('button', { name: '撤销' }));

    expect(onSelectTool).toHaveBeenCalledWith('pen');
    expect(onAction).toHaveBeenCalledWith('undo');
  });

  it('explains a blocked scrolling capture on the control itself', async () => {
    // §2.3 rules out a toast or banner, so the reason has to be reachable from
    // the button: visible on hover and available to a screen reader.
    renderToolbar({ annotationCount: 2 });

    const button = screen.getByRole('button', { name: '滚动截图' });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('长截图需在标注前开始，可先撤销标注。');
    expect(button.getAttribute('title')).toContain('长截图需在标注前开始');
  });

  it('gives no reason when scrolling capture is available', () => {
    renderToolbar();

    const button = screen.getByRole('button', { name: '滚动截图' });

    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('disables undo and redo until there is history', async () => {
    const user = userEvent.setup();
    const { onAction } = renderToolbar();

    const undo = screen.getByRole('button', { name: '撤销' });
    expect(undo).toBeDisabled();

    await user.click(undo);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('freezes the document during an export but never cancel', () => {
    renderToolbar({ canUndo: true, canRedo: true, exporting: true });

    for (const name of ['矩形', '画笔', '撤销', '重做', '另存为 PNG', '复制图片并完成']) {
      expect(screen.getByRole('button', { name }), `${name} should be frozen`).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: '取消截图' })).toBeEnabled();
  });

  it('keeps the glyphs out of the accessibility tree', () => {
    // The glyph is decorative; the label carries the meaning. If a glyph leaked
    // into the accessible name, a screen reader would announce "T" for the text
    // tool.
    renderToolbar();

    const glyphs = ['⬚', '▭', '◯', '↗', '✎', 'T', '▩', '↶', '↷', '↕', '⬳', '✕', '✓'];
    for (const glyph of glyphs) {
      expect(
        screen.queryByRole('button', { name: glyph }),
        `${glyph} leaked into an accessible name`
      ).not.toBeInTheDocument();
    }
  });
});
