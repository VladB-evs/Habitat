export const existsSync = (_path: string) => true;
export const statSync = (_path: string) => ({ size: 0, isDirectory: () => false });
export const mkdirSync = (_path: string, _opts?: any) => {};
export const copyFileSync = (_src: string, _dest: string) => {};
export const readFileSync = (_path: string) => null;
export const writeFileSync = (_path: string, _data: any) => {};
export const rmSync = (_path: string, _opts?: any) => {};
export const readdirSync = (_path: string) => [];
export const rmdirSync = (_path: string) => {};

export default {
  existsSync,
  statSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  rmdirSync,
};
