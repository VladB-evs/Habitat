export const join = (...parts: string[]) => {
  return parts
    .map((p, i) => {
      let str = String(p || '');
      if (i > 0) str = str.replace(/^\/+/, '');
      if (i < parts.length - 1) str = str.replace(/\/+$/, '');
      return str;
    })
    .filter(Boolean)
    .join('/');
};

export const dirname = (p: string) => {
  const str = String(p || '').replace(/\/+$/, '');
  const parts = str.split('/');
  parts.pop();
  return parts.join('/') || '/';
};

export const basename = (p: string, ext?: string) => {
  const str = String(p || '');
  const base = str.split('/').pop() || '';
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
};

export const extname = (p: string) => {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
};

export const resolve = (...parts: string[]) => join(...parts);

export default {
  join,
  dirname,
  basename,
  extname,
  resolve,
};
