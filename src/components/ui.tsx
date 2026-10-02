import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return message ? (
    <p className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {message}
    </p>
  ) : null;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  const [trigger] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // React autoFocus runs before showModal; move focus after the dialog is visible.
    dialog
      ?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not(:disabled), textarea:not(:disabled)',
      )
      ?.focus();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [trigger]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={label}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled, [hidden]') &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-heading">
        <h2 id={label}>{title}</h2>
        <button type="button" className="quiet" aria-label={`Close ${title}`} onClick={onClose}>
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Confirmation({
  title,
  description,
  label,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  label: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>{description}</p>
      <Notice message={error} error />
      <div className="actions">
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'The change could not be saved. Please retry.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : label}
        </button>
      </div>
    </Dialog>
  );
}
