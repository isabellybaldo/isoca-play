import { useEffect, useRef } from 'react';

// An in-page question with two answers. Focus lands on the safe one, and goes
// back to where it was when the question closes. The caller marks what lies
// behind as inert while this is open.
export default function ConfirmDialog({
  title,
  line,
  keepLabel,
  confirmLabel,
  onKeep,
  onConfirm,
}: {
  title: string;
  line: string;
  keepLabel: string;
  confirmLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    keepButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div
      className="dialog-veil"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onKeep();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-ask" aria-describedby="dialog-ask-line">
        <h2 id="dialog-ask">{title}</h2>
        <p id="dialog-ask-line">{line}</p>
        <div className="dialog-actions">
          <button ref={keepButton} type="button" className="back" onClick={onKeep}>
            {keepLabel}
          </button>
          <button type="button" className="back dialog-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
