import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { telegram } from '../core/telegram';

type ToastType = 'success' | 'warning' | 'error';
type ToastContextValue = (message: string, type?: ToastType) => void;
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const show = useCallback((value: string, type: ToastType = 'success') => {
    setMessage(value);
    telegram?.HapticFeedback?.notificationOccurred(type);
    window.setTimeout(() => setMessage(''), 3300);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="assertive">
        {message && <div className="toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
