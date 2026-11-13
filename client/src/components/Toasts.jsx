import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Small success / error notifications in the corner. No library needed.
// Usage: const toast = useToast(); toast.success('Saved'); toast.error('Failed: …');

const ToastContext = createContext(null);
const DURATION_MS = { success: 4000, info: 4000, error: 8000 };

const STYLES = {
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-slate-200 bg-white text-slate-800',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (kind, message) => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]); // at most 4 on screen
      setTimeout(() => dismiss(id), DURATION_MS[kind]);
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({ success: (m) => show('success', m), error: (m) => show('error', m), info: (m) => show('info', m) }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-md ${STYLES[t.kind]}`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-xs opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
