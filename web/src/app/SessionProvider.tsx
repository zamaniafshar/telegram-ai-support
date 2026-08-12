import { createContext, type ReactNode, useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { authenticate } from '../core/api';
import type { Session } from '../core/types';
import { FatalState, LoadingState } from '../components/ui';

interface SessionContextValue {
  session: Session;
  businessId: string;
  setBusinessId: (id: string) => void;
  hasCapability: (capability: string) => boolean;
  businessPath: (path: string) => string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState('');
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: authenticate,
    staleTime: Infinity,
    retry: false,
  });

  if (sessionQuery.isPending) return <LoadingState fullPage title="در حال برقراری ارتباط امن…" />;
  if (sessionQuery.isError) return <FatalState error={sessionQuery.error} />;

  const session = sessionQuery.data;
  const requested = searchParams.get('business');
  const businessId =
    session.businesses.find((business) => business.id === selected)?.id ??
    session.businesses.find((business) => business.id === requested)?.id ??
    session.businesses.at(0)?.id ??
    '';

  if (!businessId)
    return <FatalState error={new Error('هیچ کسب‌وکاری به حساب شما اختصاص داده نشده است.')} />;

  const setBusinessId = (id: string) => {
    setSelected(id);
    setSearchParams(
      (current) => {
        current.set('business', id);
        return current;
      },
      { replace: true },
    );
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        businessId,
        setBusinessId,
        hasCapability: (capability) => session.capabilities.includes(capability),
        businessPath: (path) => `/api/v1/businesses/${encodeURIComponent(businessId)}${path}`,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
