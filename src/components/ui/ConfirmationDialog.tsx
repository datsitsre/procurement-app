'use client';

import { useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button as `variant="danger"` - for destructive actions (removing a
   *  member, cancelling a schedule, rejecting a request). */
  destructive?: boolean;
}

/** The single confirm-before-you-act pattern for the whole app - every "are you sure?" moment
 *  (destructive or not) goes through this rather than a one-off `window.confirm()` (which can't
 *  be styled, isn't keyboard/screen-reader consistent with the rest of the app, and reads as an
 *  unstyled browser dialog inside an otherwise polished product). */
export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmationDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} size="sm" onClick={handleConfirm} loading={submitting}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
