import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  enterWorkspace,
  getGetWorkspaceSessionQueryKey,
  getWorkspaceSession,
  lockWorkspace,
} from '@workspace/api-client-react';

const ACCESS_QUERY_KEY = getGetWorkspaceSessionQueryKey();

interface WorkspaceAccess {
  authenticated: boolean;
  status: 'checking' | 'ready' | 'unavailable';
  errorMessage?: string;
  retrySession: () => Promise<void>;
  enterWorkspace: (password: string) => Promise<void>;
  lockWorkspace: () => Promise<void>;
  isEntering: boolean;
  isLocking: boolean;
}

const WorkspaceAccessContext = createContext<WorkspaceAccess | null>(null);

export function WorkspaceAccessProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ACCESS_QUERY_KEY,
    queryFn: () => getWorkspaceSession(),
    retry: false,
    refetchInterval: (query) => query.state.data?.authenticated ? 60_000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (session.data?.authenticated === false) {
      queryClient.removeQueries({
        predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(ACCESS_QUERY_KEY),
      });
    }
  }, [queryClient, session.data?.authenticated]);

  const enter = useMutation({
    mutationFn: (password: string) => enterWorkspace({ password }),
    onSuccess: (data) => queryClient.setQueryData(ACCESS_QUERY_KEY, data),
  });

  const lock = useMutation({
    mutationFn: () => lockWorkspace(),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ACCESS_QUERY_KEY, { authenticated: false });
    },
  });

  const value: WorkspaceAccess = {
    authenticated: session.data?.authenticated === true,
    status: session.isPending ? 'checking' : session.isError ? 'unavailable' : 'ready',
    errorMessage: session.error instanceof Error ? session.error.message : undefined,
    retrySession: async () => { await session.refetch(); },
    enterWorkspace: (password) => enter.mutateAsync(password).then(() => undefined),
    lockWorkspace: () => lock.mutateAsync(),
    isEntering: enter.isPending,
    isLocking: lock.isPending,
  };

  return <WorkspaceAccessContext.Provider value={value}>{children}</WorkspaceAccessContext.Provider>;
}

export function useWorkspaceAccess(): WorkspaceAccess {
  const value = useContext(WorkspaceAccessContext);
  if (!value) throw new Error('WorkspaceAccessProvider is missing.');
  return value;
}
