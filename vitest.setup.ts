import '@testing-library/jest-dom/vitest';

// Some Node/jsdom/vitest version combinations leave `window.localStorage` undefined (Node's own
// experimental global `localStorage` shadows jsdom's before it can install its implementation).
// The mock services all guard their storage access with `typeof window !== 'undefined'` and
// then read/write `window.localStorage` directly, so tests need a real Storage-shaped object
// here regardless of which side of that version quirk the local Node install falls on.
if (typeof window !== 'undefined' && !window.localStorage) {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number) {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    setItem(key: string, value: string) {
      this.store.set(key, String(value));
    }
  }
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });
}
