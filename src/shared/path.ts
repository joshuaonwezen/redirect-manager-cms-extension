// The site path for the item open in the editor. ContentState.publicUrl is absolute
// (the CMS application host); the sidebar only needs its path.

/** "/" for the homepage, otherwise no trailing slash. Null when there is no URL (a block). */
export function pathFromPublicUrl(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(publicUrl, 'https://placeholder.invalid').pathname;
  } catch {
    return null;
  }
  return normalizePath(pathname);
}

export function normalizePath(path: string): string {
  const clean = `/${path.split(/[?#]/)[0]}`.replace(/\/{2,}/g, '/');
  return clean.length > 1 ? clean.replace(/\/+$/, '') : '/';
}
