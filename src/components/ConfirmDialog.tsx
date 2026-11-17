import { useEffect, useRef, useState } from 'react';
import type { ConfirmOptions } from '../lib/safety';

interface Props {
  options: ConfirmOptions;
  onAnswer: (ok: boolean) => void;
}

/** Fenêtre de confirmation ; pour les actions graves, il faut recopier un mot */
export default function ConfirmDialog({ options, onAnswer }: Props) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const word = options.typeToConfirm;
  const ok = !word || typed.trim().toUpperCase() === word.toUpperCase();

  useEffect(() => {
    if (word) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onAnswer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [word, onAnswer]);

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={() => onAnswer(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon" aria-hidden>
          !
        </div>
        <h2>{options.title}</h2>
        <p className="confirm-msg">{options.message}</p>
        {word && (
          <label className="confirm-type">
            <span>
              Pour confirmer, tapez <b>{word}</b>
            </span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ok && onAnswer(true)}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="confirm-actions">
          <button className="btn" onClick={() => onAnswer(false)}>
            Annuler
          </button>
          <button className="btn danger-solid" disabled={!ok} onClick={() => onAnswer(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
