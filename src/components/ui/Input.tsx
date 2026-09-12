import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
}

/** Text input with a built-in label/hint/error slot, so every form field in the app renders
 *  its validation message the same way instead of each feature inventing its own markup. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, leadingIcon, id, required, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
            {label}
            {required && <span className="text-danger"> *</span>}
          </label>
        )}
        <div className="relative">
          {leadingIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={!!error}
            aria-describedby={cn(hintId, errorId) || undefined}
            className={cn(
              'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent',
              'disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-text-tertiary',
              error && 'border-danger focus-visible:ring-danger',
              leadingIcon && 'pl-9',
              className,
            )}
            {...props}
          />
        </div>
        {error ? (
          <p id={errorId} className="text-xs text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-text-tertiary">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
