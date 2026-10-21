import { invoke } from '@tauri-apps/api/core';

// The public repository used as a fallback for opening available updates.
export const FEEDBACK_REPO_URL = 'https://github.com/greywen/nowly';

// The maintainer's contact email for feedback.
export const FEEDBACK_EMAIL = 'grey.wen@outlook.com';

// Open an external https or mailto link in the OS default handler (browser or
// mail client). The backend validates the scheme before opening.
export async function openExternal(target: string): Promise<void> {
  await invoke('open_external', { target });
}
