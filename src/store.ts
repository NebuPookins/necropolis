const K = (key: string) => `necropolis:${key}`;

export const Store = {
  async get<T>(key: string, def: T): Promise<T> {
    try {
      const raw = localStorage.getItem(K(key));
      return raw ? (JSON.parse(raw) as T) : def;
    } catch {
      return def;
    }
  },
  async set(key: string, val: unknown): Promise<boolean> {
    try {
      localStorage.setItem(K(key), JSON.stringify(val));
      return true;
    } catch (e) {
      console.error('storage.set failed', e);
      return false;
    }
  },
  async del(key: string): Promise<void> {
    try { localStorage.removeItem(K(key)); } catch {}
  },
};
