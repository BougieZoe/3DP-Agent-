import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolves the directory of this source file under BOTH runtimes:
// - ESM / tsx dev: `__dirname` is undefined → falls back to import.meta.url
// - esbuild CJS bundle: `__dirname` is defined → used directly (in the CJS
//   bundle `import.meta` is an empty shim, so import.meta.url is undefined).
export const currentDir: string = (() => {
  if (typeof __dirname !== "undefined") return __dirname;
  return path.dirname(fileURLToPath(import.meta.url));
})();
