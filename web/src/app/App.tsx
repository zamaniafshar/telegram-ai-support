import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { initializeTelegram } from '../core/telegram';
import { AppShell } from './AppShell';
import { SessionProvider, useSession } from './SessionProvider';
import { ToastProvider } from './ToastProvider';
import { ThemeProvider } from './ThemeProvider';
import { OverviewPage, ConnectionsPage, SystemPage } from '../features/overview/OverviewPages';
import { SettingsPage } from '../features/settings/AiSettingsPage';
import {
  ConversationDetailPage,
  ConversationsPage,
  HandoffDetailPage,
  HandoffsPage,
} from '../features/support/SupportPages';
import {
  DraftEditorPage,
  KnowledgeDetailPage,
  KnowledgePage,
} from '../features/knowledge/KnowledgePages';
import { AdminsPage, AuditPage, MorePage, NotificationsPage } from '../features/admin/AdminPages';
import { EmptyState } from '../components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
initializeTelegram();

function CapabilityRoute({
  capability,
  children,
}: {
  capability: string;
  children: React.ReactNode;
}) {
  const { hasCapability } = useSession();
  return hasCapability(capability) ? (
    <>{children}</>
  ) : (
    <EmptyState
      icon="!"
      title="دسترسی مجاز نیست"
      description="نقش شما اجازه مشاهده این بخش را ندارد."
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter basename="/mini-app">
          <ToastProvider>
            <SessionProvider>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<Navigate to="/overview" replace />} />
                  <Route path="overview" element={<OverviewPage />} />
                  <Route path="handoffs" element={<HandoffsPage />} />
                  <Route path="handoffs/:conversationId" element={<HandoffDetailPage />} />
                  <Route path="conversations" element={<ConversationsPage />} />
                  <Route path="conversations/:id" element={<ConversationDetailPage />} />
                  <Route
                    path="knowledge"
                    element={
                      <CapabilityRoute capability="knowledge:manage">
                        <KnowledgePage />
                      </CapabilityRoute>
                    }
                  />
                  <Route
                    path="knowledge/drafts/:id"
                    element={
                      <CapabilityRoute capability="knowledge:manage">
                        <DraftEditorPage />
                      </CapabilityRoute>
                    }
                  />
                  <Route
                    path="knowledge/:id"
                    element={
                      <CapabilityRoute capability="knowledge:manage">
                        <KnowledgeDetailPage />
                      </CapabilityRoute>
                    }
                  />
                  <Route path="connections" element={<ConnectionsPage />} />
                  <Route path="system" element={<SystemPage />} />
                  <Route
                    path="admins"
                    element={
                      <CapabilityRoute capability="admin:manage">
                        <AdminsPage />
                      </CapabilityRoute>
                    }
                  />
                  <Route
                    path="audit"
                    element={
                      <CapabilityRoute capability="audit:read">
                        <AuditPage />
                      </CapabilityRoute>
                    }
                  />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route
                    path="settings"
                    element={
                      <CapabilityRoute capability="settings:read">
                        <SettingsPage />
                      </CapabilityRoute>
                    }
                  />
                  <Route path="more" element={<MorePage />} />
                  <Route path="*" element={<Navigate to="/overview" replace />} />
                </Route>
              </Routes>
            </SessionProvider>
          </ToastProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
