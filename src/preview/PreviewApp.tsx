import { useMemo, useState } from 'react';
import { loadDrafts, type Draft } from './drafts';
import { PreviewSandbox } from './PreviewSandbox';
import { createPreviewHost } from './preview-host';
import { SIZE_PRESETS, DEFAULT_PRESET_ID, findPreset } from './size-presets';
import { lintModuleSource, type LintIssue } from '../../registry/lint.mjs';

// The module preview workbench (channel B). A standalone page — no Tauri, no
// desktop shell — that renders whichever draft under dev-modules/ is selected,
// inside the real sandbox iframe, at real pixel sizes, with the checklist lint
// shown alongside. An AI tool writes a draft, this page shows it immediately,
// and Playwright can screenshot it for self-review. See docs/custom-modules/
// preview.md.

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function PreviewApp() {
  const drafts = useMemo(() => loadDrafts(), []);
  const [selectedPath, setSelectedPath] = useState<string | null>(drafts[0]?.path ?? null);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);

  const selected: Draft | undefined = drafts.find((d) => d.path === selectedPath) ?? drafts[0];
  const preset = findPreset(presetId);

  // A fresh host per selected module id, seeded with today's date and the
  // module's declared allow-list. Recreated when the selection changes.
  const host = useMemo(() => {
    if (!selected?.manifest) return null;
    return createPreviewHost({
      moduleId: selected.manifest.id,
      todayIso: todayIso(),
      allowedHosts: selected.manifest.network
    });
  }, [selected?.manifest?.id, selected?.source]);

  const lint: LintIssue[] = useMemo(
    () => (selected ? lintModuleSource(selected.source) : []),
    [selected?.source]
  );

  return (
    <div className="preview-root">
      <aside className="preview-sidebar">
        <h1 className="preview-sidebar__title">模块预览</h1>
        {drafts.length === 0 ? (
          <p className="preview-sidebar__empty">
            dev-modules/ 下没有模块。写一个 <code>.js</code> 文件到该目录即可预览。
          </p>
        ) : (
          <ul className="preview-draft-list" aria-label="草稿模块">
            {drafts.map((draft) => (
              <li key={draft.path}>
                <button
                  type="button"
                  className={
                    draft.path === selected?.path
                      ? 'preview-draft preview-draft--active'
                      : 'preview-draft'
                  }
                  aria-current={draft.path === selected?.path}
                  onClick={() => setSelectedPath(draft.path)}
                >
                  <span className="preview-draft__name">
                    {draft.manifest?.name ?? draft.name}
                  </span>
                  <span className="preview-draft__file">{draft.name}</span>
                  {draft.error ? (
                    <span className="preview-draft__badge preview-draft__badge--error">
                      清单错误
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="preview-main">
        <div className="preview-toolbar">
          <div className="preview-size-switch" role="group" aria-label="预览尺寸">
            {SIZE_PRESETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={
                  entry.id === preset.id
                    ? 'preview-size-btn preview-size-btn--active'
                    : 'preview-size-btn'
                }
                aria-pressed={entry.id === preset.id}
                onClick={() => setPresetId(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {!selected ? (
          <p className="preview-empty">选择一个草稿模块开始预览。</p>
        ) : selected.error || !selected.manifest || !host ? (
          <div className="preview-error" role="alert">
            <strong>无法解析清单头</strong>
            <p>{selected.error ?? '清单头缺失或非法'}</p>
          </div>
        ) : (
          <PreviewSandbox
            key={`${selected.path}:${preset.id}`}
            host={host}
            source={selected.source}
            permissions={selected.manifest.permissions}
            allowedHosts={selected.manifest.network}
            width={preset.width}
            height={preset.height}
          />
        )}

        <section className="preview-lint" aria-label="校验结果">
          <h2 className="preview-lint__title">
            校验{lint.length === 0 ? '：通过' : `：${lint.length} 项问题`}
          </h2>
          {lint.length === 0 ? (
            <p className="preview-lint__ok">颜色 / 循环 / 远程资源三条硬约束均通过。</p>
          ) : (
            <ul className="preview-lint__list">
              {lint.map((issue, index) => (
                <li key={index} className="preview-lint__item">
                  <code>{issue.rule}</code> 第 {issue.line} 行：{issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
