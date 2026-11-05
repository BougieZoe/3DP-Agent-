import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

/**
 * Single manifold-3d WASM loader.
 *
 * The package's default factory resolves `manifold.wasm` relative to its own
 * module URL, which Vite's dep pre-bundling breaks — the promise rejects and
 * every caller silently fell back to the +normal path. Passing the
 * Vite-emitted asset URL via `locateFile` is the supported way, and the
 * toplevel requires setup() before its constructors exist.
 */
let ready: Promise<any> | null = null;

export function getManifold(): Promise<any> {
  if (!ready) {
    // `Mesh` / `Manifold` are attached to the toplevel by setup(), not by the
    // factory itself — without this call every constructor is undefined.
    ready = Promise.resolve((Module as any)({ locateFile: () => wasmUrl }))
      .then((m: any) => { m.setup?.(); return m; });
  }
  return ready as Promise<any>;
}
