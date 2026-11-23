/** A single portable path component, never a path supplied by content. */
export function safeFileName(name: string): string {
  let safe = name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '');
  safe = Array.from(safe).slice(0, 80).join('').replace(/[. ]+$/g, '') || 'Note';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe;
}

export function attachmentFileName(name: string): string {
  const extension = /\.([a-z0-9]{1,16})$/i.exec(name)?.[0] ?? '';
  return safeFileName(extension ? name.slice(0, -extension.length) : name) + extension;
}

export function portableUrl(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join('/');
}
