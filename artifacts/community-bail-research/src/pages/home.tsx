import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { CageRoom } from '@/components/cage-room';
import { SpinningA } from '@/components/spinning-a';
import { ThemeToggle } from '@/components/shell';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspaceAccess } from '@/lib/workspace-access';

export default function Home() {
  const access = useWorkspaceAccess();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const nextPath = new URLSearchParams(window.location.search).get('next');
  const destination = nextPath?.startsWith('/')
    && !nextPath.startsWith('//')
    && !nextPath.includes('\\')
    && !nextPath.startsWith('/sign-in')
    ? nextPath
    : '/menu';

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await access.enterWorkspace(password);
      setPassword('');
      setPasswordDialogOpen(false);
      setLocation(destination);
    } catch (cause) {
      setPassword('');
      setError(cause instanceof Error ? cause.message : 'The workspace could not be unlocked.');
    }
  }

  return (
    <CageRoom>
      <h1 className="sr-only">Community Bail Research</h1>
      <SpinningA className="w-[min(78vw,26rem)] h-auto" />
      {access.status === 'checking' ? (
        <p className="hint mt-8" role="status">Checking workspace access…</p>
      ) : access.status === 'unavailable' ? (
        <div className="mt-8 text-center" role="alert">
          <p className="hint">{access.errorMessage || 'Workspace access is unavailable.'}</p>
          <button type="button" className="btn mt-4" onClick={() => void access.retrySession()}>Try again</button>
        </div>
      ) : (
        <button
          type="button"
          className="btn mt-8 px-8"
          data-testid="button-empty-the-cages"
          onClick={() => {
            if (access.authenticated) setLocation(destination);
            else {
              setError('');
              setPasswordDialogOpen(true);
            }
          }}
        >
          Empty the cages <span aria-hidden="true" className="ml-3">&crarr;</span>
        </button>
      )}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="border-primary bg-background text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="mono text-primary">Workspace password</DialogTitle>
            <DialogDescription>Enter the shared password to continue.</DialogDescription>
          </DialogHeader>
          <form onSubmit={enter}>
            <label htmlFor="workspace-password" className="sr-only">Workspace password</label>
            <input
              id="workspace-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={error ? 'workspace-password-error' : undefined}
              className="w-full border border-primary bg-background px-3 py-3 text-foreground outline-none focus:ring-2 focus:ring-primary"
              data-testid="input-workspace-password"
            />
            {error ? <p id="workspace-password-error" className="hint mt-2 text-destructive" role="alert">{error}</p> : null}
            <button type="submit" className="btn mt-4 w-full px-8" disabled={access.isEntering} data-testid="button-password-continue">
              {access.isEntering ? 'Unlocking…' : <>Continue <span aria-hidden="true" className="ml-2">&crarr;</span></>}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <p className="hint mt-8 max-w-md text-center">
        One shared password opens all records; actions are not tied to individual accounts. A shared workspace for aggregating and analyzing 412 bail data.
      </p>
      <div className="mt-4"><ThemeToggle /></div>
    </CageRoom>
  );
}
