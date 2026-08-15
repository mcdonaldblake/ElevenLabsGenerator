import {
  CheckCircle2,
  CircleAlert,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
} from "react";
import type { ToastMessage } from "../types";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx("button", `button--${variant}`, `button--${size}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : null}
      {children}
    </button>
  );
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "orange";
};

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cx("card", className)} {...props}>
      {children}
    </section>
  );
}

type ProgressBarProps = {
  value: number;
  label?: string;
  tone?: "navy" | "orange" | "green";
};

export function ProgressBar({ value, label = "Progress", tone = "orange" }: ProgressBarProps) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("progress", `progress--${tone}`)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
    >
      <span style={{ width: `${safeValue}%` }} />
    </div>
  );
}

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cx("field", className)}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
};

export function SearchInput({ icon, className, ...props }: SearchInputProps) {
  return (
    <label className={cx("search-input", className)}>
      <span aria-hidden="true">{icon}</span>
      <input type="search" {...props} />
    </label>
  );
}

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("skeleton", className)} aria-hidden="true" />;
}

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, description, children, onClose }: ModalProps) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToastIcon({ tone }: { tone: ToastMessage["tone"] }) {
  if (tone === "success") return <CheckCircle2 aria-hidden="true" />;
  if (tone === "error") return <CircleAlert aria-hidden="true" />;
  return <Info aria-hidden="true" />;
}

export function ToastViewport({ messages, dismiss }: { messages: ToastMessage[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {messages.map((message) => (
        <div className={cx("toast", `toast--${message.tone}`)} key={message.id} role="status">
          <ToastIcon tone={message.tone} />
          <div>
            <strong>{message.title}</strong>
            <p>{message.detail}</p>
          </div>
          <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(message.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span className="toggle" aria-hidden="true"><span /></span>
    </label>
  );
}
