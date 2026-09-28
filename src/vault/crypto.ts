import { sha256Hex } from './sha256';

export const randomUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  return {
    toString: (encoding?: string) => {
      if (encoding === 'hex') {
        return Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
      return new TextDecoder().decode(bytes);
    },
    length: size,
    [Symbol.iterator]: () => bytes[Symbol.iterator](),
  };
};

export const createHash = (_algo: string) => {
  const chunks: Uint8Array[] = [];
  return {
    update(chunk: any) {
      const bytes = typeof chunk === 'string'
        ? new TextEncoder().encode(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(chunk || 0);
      chunks.push(bytes);
      return this;
    },
    digest(_encoding = 'hex') {
      let total = 0;
      for (const b of chunks) total += b.length;
      const all = new Uint8Array(total);
      let offset = 0;
      for (const b of chunks) {
        all.set(b, offset);
        offset += b.length;
      }
      return sha256Hex(all);
    },
  };
};

export default {
  randomUUID,
  randomBytes,
  createHash,
};
