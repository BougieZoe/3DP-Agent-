import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { PANEL } from '@/lib/visualLanguage';

interface AuthModalProps {
  onClose: () => void;
}

export function AuthModal({ onClose }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error: err } = await fn(email, password);
    setBusy(false);
    if (err) {
      setError(err.message);
    } else if (mode === 'signin') {
      onClose();
    } else {
      setError('Check your email for the confirmation link.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.paddingCard} w-full max-w-sm`}>
        <h2 className={`${PANEL.fontLabel} mb-4`}>
          {mode === 'signin' ? '// SIGN IN' : '// SIGN UP'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className={`w-full bg-background ${PANEL.borderSubtle} ${PANEL.roundedInner} px-3 py-2 ${PANEL.fontSmall} text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary/50`}
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className={`w-full bg-background ${PANEL.borderSubtle} ${PANEL.roundedInner} px-3 py-2 ${PANEL.fontSmall} text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary/50`}
            />
          </div>
          {error && (
            <p className={`${PANEL.fontTiny} text-red-400`}>{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className={`flex-1 ${PANEL.fontButton} border border-primary/40 text-primary hover:bg-primary/10 ${PANEL.roundedInner} py-2 transition-all disabled:opacity-50`}
            >
              {busy
                ? mode === 'signin' ? 'SIGNING IN...' : 'SIGNING UP...'
                : mode === 'signin' ? 'SIGN IN' : 'SIGN UP'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`${PANEL.fontButton} ${PANEL.borderSubtle} text-muted-foreground hover:text-foreground ${PANEL.roundedInner} px-3 py-2 transition-all`}
            >
              CANCEL
            </button>
          </div>
        </form>
        <p className={`${PANEL.fontTiny} text-muted-foreground/40 mt-3 text-center`}>
          {mode === 'signin' ? (
            <>No account?{' '}<button onClick={() => { setMode('signup'); setError(''); }} className="text-primary hover:underline">Sign up</button></>
          ) : (
            <>Already have an account?{' '}<button onClick={() => { setMode('signin'); setError(''); }} className="text-primary hover:underline">Sign in</button></>
          )}
        </p>
      </div>
    </div>
  );
}
