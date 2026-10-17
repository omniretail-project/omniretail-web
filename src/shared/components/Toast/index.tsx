"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StatusTone } from "@/config/statuses";
export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: StatusTone;
  duration?: number;
}
interface ToastContextValue {
  toasts: ToastMessage[];
  showToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_TOAST_DURATION = 4000;
const toneClasses: Record<StatusTone, string> = {
  neutral: "border-[var(--color-border)] bg-white",
  info: "border-[var(--color-primary)]/60 bg-[var(--color-primary)]/10",
  success: "border-[var(--color-success)]/45 bg-white",
  warning: "border-[var(--color-warning)]/55 bg-[var(--color-warning)]/15",
  danger: "border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearToastTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearToastTimer(id);
      setToasts((items) => items.filter((toast) => toast.id !== id));
    },
    [clearToastTimer],
  );

  const showToast = useCallback(
    (toast: Omit<ToastMessage, "id">) => {
      const id = crypto.randomUUID();
      const duration = toast.duration ?? DEFAULT_TOAST_DURATION;
      setToasts((items) => {
        const nextToast = { ...toast, id, duration };
        // La confirmación de agregar productos es informativa: mantener una
        // sola evita cubrir la página si el usuario pulsa varias veces.
        return toast.tone === "success"
          ? [...items.filter((item) => item.tone !== "success"), nextToast]
          : [...items, nextToast];
      });

      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);
  const value = useMemo(
    () => ({ toasts, showToast, dismissToast }),
    [dismissToast, showToast, toasts],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-4 bottom-4 z-50 space-y-2 sm:left-auto sm:right-4 sm:w-80">
        {toasts.map((toast) => (
          <button
            className={`block w-full rounded-md border p-4 text-left shadow-lg transition hover:border-[var(--color-structure)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] ${toneClasses[toast.tone ?? "neutral"]}`}
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            type="button"
          >
            <strong className="block text-sm text-[var(--color-title)]">{toast.title}</strong>
            {toast.description ? (
              <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                {toast.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
