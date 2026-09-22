import { ShieldX, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

interface Props { email: string; }

export default function AccessDenied({ email }: Props) {
  const { logout, loginWithRedirect } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background">
      <ShieldX className="h-16 w-16 mb-4 text-destructive" />
      <h1 className="font-cinzel text-2xl text-primary mb-2">Access Denied</h1>
      <p className="mb-1 text-sm text-muted-foreground">
        Your account (<span className="font-mono text-foreground">{email}</span>) is not assigned to any role.
      </p>
      <p className="mb-8 text-xs text-muted-foreground">
        Contact your administrator to be added to the system, then sign in again.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          variant="outline"
          className="w-full gap-2 font-cinzel uppercase tracking-widest text-xs"
          onClick={() => loginWithRedirect({ redirectUrl: window.location.href })}
        >
          <RefreshCw className="h-4 w-4" />
          Try signing in again
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 text-xs text-muted-foreground"
          onClick={() => logout({ returnTo: window.location.origin })}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
