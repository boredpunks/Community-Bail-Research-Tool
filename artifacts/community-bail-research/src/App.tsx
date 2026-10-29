import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Research from '@/pages/research';
import NewRecord from '@/pages/new-record';
import Review from '@/pages/review';
import Discovery from '@/pages/discovery';
import Menu from '@/pages/menu';
import BailSearch from '@/pages/BailSearch';
import Feedback from '@/pages/feedback';
import { ThemeToggle } from '@/components/shell';
import { applyStoredTheme } from '@/lib/theme';
import { WorkspaceAccessProvider, useWorkspaceAccess } from '@/lib/workspace-access';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';

applyStoredTheme();

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function WorkspaceRequired({ children }: { children: ReactNode }) {
  const access = useWorkspaceAccess();
  const [location] = useLocation();

  if (access.status === 'checking') {
    return <main className="grid-bg flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4">
      <p className="hint" role="status">Checking workspace access…</p>
    </main>;
  }
  if (access.status === 'unavailable') {
    return <main className="grid-bg flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="hint" role="alert">{access.errorMessage || 'Workspace access is unavailable.'}</p>
      <Link className="btn btn-primary" href="/">Return to workspace entry</Link>
    </main>;
  }
  if (!access.authenticated) {
    return <Redirect to={`/?next=${encodeURIComponent(location)}`} />;
  }
  return children;
}

function protect(Page: () => ReactNode) {
  return function Protected() {
    return <WorkspaceRequired><Page /></WorkspaceRequired>;
  };
}

function CandidatesPage() {
  return <Research candidates={true} />;
}

const CandidatesRoute = protect(CandidatesPage);
const ResearchRoute = protect(Research);
const NewRecordRoute = protect(NewRecord);
const ReviewRoute = protect(Review);
const DiscoveryRoute = protect(Discovery);
const MenuRoute = protect(Menu);
const BailSearchRoute = protect(BailSearch);
const FeedbackRoute = protect(Feedback);

function LegacySignInRoute() {
  return <Redirect to="/" />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => {
    const page = location === '/menu' ? 'Menu'
      : location === '/search' ? 'Search Bail'
      : location === '/research' || location === '/candidates' ? (location === '/candidates' ? 'Saved dockets' : 'Search saved observations')
      : location === '/records/new' ? 'Enter source evidence'
      : location === '/review' ? 'Review source evidence'
      : location === '/discovery' ? 'Advanced court search'
      : location === '/feedback' ? 'Volunteer feedback'
      : location === '/' ? 'Workspace access'
      : 'Page not found';
    const title = `${page} | Community Bail Research`;
    const description = location === '/search' ? 'Search bail evidence within a hearing date window, retain partial results, and export source-backed records.'
      : location === '/research' ? 'Search shared source-backed docket observations and inspect explicitly filtered descriptive financial ranges.'
      : location === '/records/new' ? 'Enter a real docket observation with source evidence and consultation time. Unknown details remain unknown.'
      : location === '/discovery' ? 'Start bounded live court discovery jobs and inspect docket and bail results before saving any observation.'
      : location === '/review' ? 'Review source evidence and decide order interpretation separately before observations enter a descriptive range.'
      : 'A password-protected shared workspace for real docket evidence, explicit human review, and descriptive bail ranges.';
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }, [location]);
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/menu" component={MenuRoute} />
          <Route path="/candidates" component={CandidatesRoute} />
          <Route path="/sign-in/*?" component={LegacySignInRoute} />
          <Route path="/sign-up/*?" component={LegacySignInRoute} />
          <Route path="/research" component={ResearchRoute} />
          <Route path="/records/new" component={NewRecordRoute} />
          <Route path="/review" component={ReviewRoute} />
          <Route path="/discovery" component={DiscoveryRoute} />
          <Route path="/search" component={BailSearchRoute} />
          <Route path="/feedback" component={FeedbackRoute} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceAccessProvider>
          <AppRoutes />
        </WorkspaceAccessProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
