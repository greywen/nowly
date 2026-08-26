import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { DevModuleFile, NowlyRepository } from '../data/nowly-repository';
import { DevModuleWidget } from './DevModuleWidget';

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

function repositoryWith(files: DevModuleFile[], dir?: string): NowlyRepository {
  return {
    listDevModules: vi.fn().mockResolvedValue(files),
    devModulesDir: dir ? vi.fn().mockResolvedValue(dir) : undefined
  } as unknown as NowlyRepository;
}

function renderWidget(repository: NowlyRepository) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
  );
  return render(<DevModuleWidget />, { wrapper });
}

beforeEach(() => {
  // SandboxModule creates a Blob URL for its iframe; jsdom has no such API.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:dev'),
    revokeObjectURL: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DevModuleWidget', () => {
  it('shows the empty state with the backend-resolved dev-modules directory', async () => {
    const dir = 'C:\\Users\\me\\AppData\\Roaming\\com.nowly.app\\dev-modules';
    renderWidget(repositoryWith([], dir));
    expect(await screen.findByText(/dev-modules 目录下没有草稿/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp('com\\.nowly\\.app'))).toBeInTheDocument();
  });

  it('lists drafts in the selector by manifest name', async () => {
    renderWidget(repositoryWith([{ name: 'clock.js', source: clean }]));
    const select = await screen.findByRole('combobox', { name: '选择草稿模块' });
    expect(within(select).getByRole('option', { name: /时钟/ })).toBeInTheDocument();
  });

  it('renders the selected draft in a sandboxed iframe', async () => {
    renderWidget(repositoryWith([{ name: 'clock.js', source: clean }]));
    // The first draft auto-selects; its iframe is titled after the manifest name.
    const frame = (await screen.findByTitle('时钟')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('reports a clean draft as passing lint', async () => {
    renderWidget(repositoryWith([{ name: 'clock.js', source: clean }]));
    expect(await screen.findByText('校验：通过')).toBeInTheDocument();
  });

  it('surfaces a lint hit for a color literal', async () => {
    renderWidget(repositoryWith([{ name: 'bad.js', source: dirty }]));
    expect(await screen.findByText('校验：1 项问题')).toBeInTheDocument();
  });

  it('flags a draft whose manifest header is missing instead of rendering it', async () => {
    renderWidget(repositoryWith([{ name: 'raw.js', source: headerless }]));
    expect(await screen.findByText(/清单错误/)).toBeInTheDocument();
    // No iframe when the manifest cannot be parsed.
    expect(screen.queryByTitle('raw.js')).not.toBeInTheDocument();
  });

  it('switches the previewed draft when another is chosen', async () => {
    renderWidget(
      repositoryWith([
        { name: 'clock.js', source: clean },
        { name: 'bad.js', source: dirty }
      ])
    );
    // clock.js auto-selects first (sorted by name: bad.js < clock.js, so bad is
    // first). Pick clock explicitly and confirm its frame appears.
    const select = await screen.findByRole('combobox', { name: '选择草稿模块' });
    await userEvent.selectOptions(select, 'clock.js');
    expect(await screen.findByTitle('时钟')).toBeInTheDocument();
  });

  it('does not throw when the runtime cannot read drafts', async () => {
    renderWidget({} as unknown as NowlyRepository);
    expect(await screen.findByText(/dev-modules 目录下没有草稿/)).toBeInTheDocument();
  });
});
