'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'right' | 'left';
}

/** A side-sliding counterpart to Dialog, for content better suited to a panel than a centered
 *  modal (a detail preview, a filter panel on mobile, a long form). Same native `<dialog>`
 *  foundation as Dialog - ESC/backdrop/focus containment come from the browser, not
 *  reimplemented - just styled to dock against an edge instead of centering. */
export function Drawer({ open, onClose, title, children, footer, side = 'right' }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // A unique id per instance (Phase 19 accessibility audit) - see Dialog.tsx's own note; a
  // hardcoded "drawer-title" would collide if two Drawers ever mounted at once.
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

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
        'm-0 h-dvh max-h-dvh w-full max-w-sm border-0 bg-surface p-0 text-text-primary shadow-lg backdrop:bg-slate-900/50',
        side === 'right' ? 'ms-auto' : 'me-auto',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-h3">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-tertiary hover:bg-neutral-bg hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </dialog>
  );
}
