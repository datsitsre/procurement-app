'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * The single Dialog implementation for the whole app - built on the native `<dialog>` element
 * rather than a hand-rolled portal + focus-trap, so ESC-to-close, backdrop click, and focus
 * containment are the browser's own correct, accessible behavior rather than reimplemented
 * (and rather than a third-party dialog library, per the redesign brief's "don't introduce
 * another component framework" rule). No inline `<script>`/`onclick` string is ever used - the
 * native element's `close`/`cancel` events are wired through React's normal event system, so
 * this stays compatible with the app's enforced CSP.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // A unique id per instance (Phase 19 accessibility audit) - a hardcoded "dialog-title" would
  // collide if two Dialogs (or a Dialog and a ConfirmationDialog, which wraps this) ever mounted
  // at once, breaking `aria-labelledby` for whichever one isn't first in the DOM.
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Fires on ESC and on a real close() call alike - keeps parent state in sync regardless of
  // how the dialog was dismissed.
  function handleClose() {
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={handleClose}
      onCancel={handleClose}
      onClick={handleBackdropClick}
      aria-labelledby={titleId}
      className={cn(
        'w-full rounded-lg border border-border bg-surface p-0 text-text-primary shadow-lg backdrop:bg-slate-900/50',
        'open:animate-none',
        SIZE_CLASS[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 id={titleId} className="text-h3">
            {title}
          </h2>
          {description && <p className="mt-1 text-caption">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-text-tertiary hover:bg-neutral-bg hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </dialog>
  );
}
