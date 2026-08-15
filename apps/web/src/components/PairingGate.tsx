import {
  AudioLines,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui";

type PairingGateProps = {
  checking: boolean;
  pairing: boolean;
  accessError: string | null;
  pairingError: string | null;
  onPair: (code: string) => Promise<void>;
  onRetry: () => void;
};

export function PairingGate({ checking, pairing, accessError, pairingError, onPair, onRetry }: PairingGateProps) {
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visiblePairingError = code === submittedCode ? pairingError : null;

  useEffect(() => {
    if (!checking && accessError) headingRef.current?.focus();
  }, [accessError, checking]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length === 6 && !pairing) {
      setSubmittedCode(code);
      void onPair(code);
    }
  };

  return (
    <main className="pairing-gate" id="main-content">
      <section className="pairing-card" aria-labelledby="pairing-title" aria-describedby="pairing-description">
        <div className="pairing-brand" aria-hidden="true">
          <span><AudioLines size={26} strokeWidth={2.2} /></span>
          <strong>Voice Foundry</strong>
        </div>

        {checking ? (
          <div className="pairing-check" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={34} aria-hidden="true" />
            <h1 id="pairing-title">Checking this device…</h1>
            <p id="pairing-description">Connecting to Voice Foundry on your Mac.</p>
          </div>
        ) : accessError ? (
          <div className="pairing-check pairing-check--error">
            <LockKeyhole size={34} aria-hidden="true" />
            <h1 id="pairing-title" ref={headingRef} tabIndex={-1}>Access check failed</h1>
            <p id="pairing-description">{accessError}</p>
            <Button type="button" variant="secondary" size="lg" onClick={onRetry}>
              <RefreshCw size={18} aria-hidden="true" /> Try again
            </Button>
          </div>
        ) : (
          <>
            <div className="pairing-heading">
              <span className="pairing-heading__icon" aria-hidden="true"><KeyRound size={25} /></span>
              <p className="eyebrow">Private phone access</p>
              <h1 id="pairing-title" ref={headingRef} tabIndex={-1}>Pair this iPhone</h1>
              <p id="pairing-description">Enter the six-digit code printed in the Voice Foundry terminal on your Mac.</p>
            </div>

            <form className="pairing-form" onSubmit={submit}>
              <label htmlFor="pairing-code">Pairing code</label>
              <input
                id="pairing-code"
                name="pairing-code"
                type="text"
                inputMode="numeric"
                enterKeyHint="go"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                aria-describedby={visiblePairingError ? "pairing-error pairing-code-hint" : "pairing-code-hint"}
                aria-invalid={Boolean(visiblePairingError)}
                autoFocus
              />
              <span id="pairing-code-hint" className="pairing-form__hint">Look in the terminal where the server is running. The code changes when it restarts.</span>
              {visiblePairingError ? <p id="pairing-error" className="pairing-error" role="alert">{visiblePairingError}</p> : null}
              <Button type="submit" size="lg" loading={pairing} disabled={code.length !== 6}>
                Pair iPhone
              </Button>
            </form>

            <aside className="pairing-trust" aria-label="Network safety">
              <Wifi size={21} aria-hidden="true" />
              <div>
                <strong>Use only on trusted Wi-Fi</strong>
                <p>This is a local HTTP connection. Use a private network you trust; anyone who sees the terminal code could pair.</p>
              </div>
            </aside>

            <p className="pairing-session-note"><ShieldCheck size={16} aria-hidden="true" /> The source database and audio remain on your Mac. This browser loads the content you open and stays paired until you disconnect or the session expires.</p>
          </>
        )}
      </section>
    </main>
  );
}
