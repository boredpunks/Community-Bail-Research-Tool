import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Research from '@/pages/research';
import NewRecord from '@/pages/new-record';
import Review from '@/pages/review';
import Discovery from '@/pages/discovery';
import { ThemeToggle } from '@/components/shell';
import { applyStoredTheme } from '@/lib/theme';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

applyStoredTheme();

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing managed Clerk configuration. Check the workspace environment settings.');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(var(--primary))',
    colorForeground: 'hsl(var(--foreground))',
    colorMutedForeground: 'hsl(var(--muted-foreground))',
    colorDanger: 'hsl(var(--destructive))',
    colorBackground: 'hsl(var(--card))',
    colorInput: 'hsl(var(--background))',
    colorInputForeground: 'hsl(var(--foreground))',
    colorNeutral: 'hsl(var(--foreground))',
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    borderRadius: '0.25rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-card border border-border rounded w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-foreground font-mono font-bold',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground',
    formFieldLabel: 'text-foreground font-mono',
    footerActionLink: 'text-primary underline',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary',
    formFieldSuccessText: 'text-primary',
    alertText: 'text-foreground',
    logoBox: 'justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border border-border bg-background',
    formButtonPrimary: 'bg-primary text-primary-foreground font-mono hover:opacity-90',
    formFieldInput: 'bg-background text-foreground border border-border',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-border',
    alert: 'border border-border bg-background',
    otpCodeFieldInput: 'bg-background text-foreground border border-border',
    formFieldRow: '',
    main: '',
  },
};

const clerkLocalization = {
  signIn: {
    start: {
      title: 'Sign in to Bail Research Search',
      subtitle: 'Research workspace for saved, source-backed records',
    },
  },
  signUp: {
    start: {
      title: 'Create a research account',
      subtitle: 'Saved records are stored per signed-in user for now',
    },
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid-bg flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 py-8">
      <div className="mono text-2xl font-bold text-primary title-glow bg-background px-3">
        BAIL RESEARCH SEARCH<span className="cursor-block" aria-hidden="true" />
      </div>
      {children}
      <ThemeToggle />
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/research" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

function protect(Page: () => ReactNode) {
  return function Protected() {
    return (
      <>
        <Show when="signed-in"><Page /></Show>
        <Show when="signed-out"><Redirect to="/" /></Show>
      </>
    );
  };
}

const ResearchRoute = protect(Research);
const NewRecordRoute = protect(NewRecord);
const ReviewRoute = protect(Review);
const DiscoveryRoute = protect(Discovery);

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => {
    const page = location.startsWith('/sign-in') ? 'Sign in'
      : location.startsWith('/sign-up') ? 'Create an account'
      : location === '/research' ? 'Search saved observations'
      : location === '/records/new' ? 'Enter source evidence'
      : location === '/review' ? 'Review source evidence'
      : location === '/discovery' ? 'Live court discovery'
      : location === '/' ? 'Source-backed bail research'
      : 'Page not found';
    const title = `${page} | Community Bail Research`;
    const description = location === '/research' ? 'Search saved source-backed docket observations and inspect explicitly filtered descriptive financial ranges.'
      : location === '/records/new' ? 'Enter a real docket observation with source evidence and consultation time. Unknown details remain unknown.'
      : location === '/discovery' ? 'Start bounded live court discovery jobs and inspect docket and bail results before saving any observation.'
      : location === '/review' ? 'Review source evidence and decide order interpretation separately before observations enter a descriptive range.'
      : location.startsWith('/sign-in') ? 'Sign in to your private source-backed bail research workspace.'
      : location.startsWith('/sign-up') ? 'Create a private research account. Shared team permissions are not enabled in this initial version.'
      : 'A private research workspace for real docket evidence, explicit human review, and descriptive bail ranges.';
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }, [location]);
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={clerkLocalization}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/research" component={ResearchRoute} />
              <Route path="/records/new" component={NewRecordRoute} />
              <Route path="/review" component={ReviewRoute} />
              <Route path="/discovery" component={DiscoveryRoute} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
