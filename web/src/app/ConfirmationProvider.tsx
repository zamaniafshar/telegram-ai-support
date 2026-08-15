import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Dialog } from '../components/ui';

interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}

type ConfirmationInput = string | ConfirmationOptions;
type Confirm = (input: ConfirmationInput) => Promise<boolean>;

const ConfirmationContext = createContext<Confirm | null>(null);

const normalizeOptions = (input: ConfirmationInput): Required<ConfirmationOptions> =>
  typeof input === 'string'
    ? {
        title: 'تأیید عملیات',
        message: input,
        confirmLabel: 'تأیید',
        cancelLabel: 'انصراف',
        tone: 'primary',
      }
    : {
        title: input.title ?? 'تأیید عملیات',
        message: input.message,
        confirmLabel: input.confirmLabel ?? 'تأیید',
        cancelLabel: input.cancelLabel ?? 'انصراف',
        tone: input.tone ?? 'primary',
      };

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Required<ConfirmationOptions> | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((input) => {
    if (resolver.current) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(normalizeOptions(input));
    });
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmationContext.Provider value={value}>
      {children}
      {options && (
        <Dialog
          title={options.title}
          description={options.message}
          placement="top"
          onClose={() => finish(false)}
        >
          <div className="button-row confirmation-actions">
            <Button type="button" onClick={() => finish(false)}>
              {options.cancelLabel}
            </Button>
            <Button type="button" variant={options.tone} onClick={() => finish(true)} autoFocus>
              {options.confirmLabel}
            </Button>
          </div>
        </Dialog>
      )}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): Confirm {
  const context = useContext(ConfirmationContext);
  if (!context) throw new Error('useConfirmation must be used within ConfirmationProvider');
  return context;
}
