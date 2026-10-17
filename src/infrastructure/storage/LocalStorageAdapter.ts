export class LocalStorageAdapter {
  get<T>(key: string): T | null {
    if (typeof window === "undefined") return null;
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue) as T;
    } catch {
      this.remove(key);
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  }
}
