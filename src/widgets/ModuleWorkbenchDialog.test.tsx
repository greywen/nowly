import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { DevModuleFile, NowlyRepository } from '../data/nowly-repository';
import { ModuleWorkbenchDialog } from './ModuleWorkbenchDialog';

// A minimal, valid module: manifest header + a body. Colors come from tokens so
// it lints clean.
const clean = [
  '/**',
  ' * @nowly-module 1',
  ' * @id clock',
  ' * @name 时钟',
  ' * @version 1.0.0',
  ' * @permissions today',
  ' */',
  'Nowly.defineModule(({ root }) => { root.textContent = "hi"; });'
].join('\n');

// Same header, but the body uses a hex color literal — one lint hit.
const dirty = clean.replace(
  'root.textContent = "hi";',
  'root.style.color = "#ff0000";'
);

// No manifest header at all — parses to a manifest error.
const headerless = 'Nowly.defineModule(({ root }) => { root.textContent = "x"; });';

function repositoryWith(files: DevModuleFile[]): NowlyRepository {
  return {
    listDevModules: vi.fn().mockResolvedValue(files)
  } as unknown as NowlyRepository;
}

function renderWorkbench(repository: NowlyRepository) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
  );
  return render(<ModuleWorkbenchDialog onClose={vi.fn()} />, { wrapper });
}

beforeEach(() => {
  // PreviewSandbox creates a Blob URL for its iframe; jsdom has no such API.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ModuleWorkbenchDialog', () => {
  it('shows the empty state when no drafts exist', async () => {
    renderWorkbench(repositoryWith([]));
    expect(
      await screen.findByText(/dev-modules 目录下没有草稿/)
    ).toBeInTheDocument();
  });

  it('lists drafts by their manifest name and file name', async () => {
    renderWorkbench(repositoryWith([{ name: 'clock.js', source: clean }]));
    const list = await screen.findByRole('list', { name: '草稿模块' });
    expect(within(list).getByText('时钟')).toBeInTheDocument();
    expect(within(list).getByText('clock.js')).toBeInTheDocument();
  });

  it('reports a clean draft as passing lint', async () => {
    renderWorkbench(repositoryWith([{ name: 'clock.js', source: clean }]));
    expect(await screen.findByText('校验：通过')).toBeInTheDocument();
  });

  it('surfaces a lint hit for a color literal', async () => {
    renderWorkbench(repositoryWith([{ name: 'bad.js', source: dirty }]));
    expect(await screen.findByText('校验：1 项问题')).toBeInTheDocument();
    expect(screen.getByText('color-literal')).toBeInTheDocument();
  });

  it('flags a draft whose manifest header is missing', async () => {
    renderWorkbench(repositoryWith([{ name: 'raw.js', source: headerless }]));
    // The badge in the list and the error panel both use the same label.
    const badges = await screen.findAllByText('清单错误');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('switches the preview size preset', async () => {
    renderWorkbench(repositoryWith([{ name: 'clock.js', source: clean }]));
    const wide = await screen.findByRole('button', { name: '12×8', pressed: false });
    await userEvent.click(wide);
    expect(screen.getByRole('button', { name: '12×8', pressed: true })).toBeInTheDocument();
  });

  it('returns an empty list when the runtime cannot read drafts', async () => {
    // The browser shim omits listDevModules; the dialog must not throw.
    renderWorkbench({} as unknown as NowlyRepository);
    expect(
      await screen.findByText(/dev-modules 目录下没有草稿/)
    ).toBeInTheDocument();
  });
});
