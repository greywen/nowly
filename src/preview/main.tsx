import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewApp } from './PreviewApp';
import '../app/styles.css';
import './preview.css';

// Entry for the standalone module preview workbench (preview.html). It does not
// boot the desktop app, the repository, or Tauri — only the sandbox + in-memory
// host — so it runs in a plain browser tab via `npm run module:preview`.
const container = document.getElementById('preview-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PreviewApp />
    </StrictMode>
  );
}
