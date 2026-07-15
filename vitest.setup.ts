import '@testing-library/jest-dom/vitest';

if (typeof localStorage === 'undefined') {
  class MockStorage {
    private data: Record<string, string> = {};
    getItem(key: string) { return this.data[key] ?? null; }
    setItem(key: string, value: string) { this.data[key] = String(value); }
    removeItem(key: string) { delete this.data[key]; }
    clear() { this.data = {}; }
    get length() { return Object.keys(this.data).length; }
    key(index: number) { return Object.keys(this.data)[index] ?? null; }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: new MockStorage() });
}

