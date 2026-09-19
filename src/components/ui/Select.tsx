import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

/** A native `<select>`, styled to match Input's label/hint/error pattern - deliberately not a
 *  custom-rendered listbox. A native select gets keyboard/screen-reader/mobile-picker behavior
 *  for free and every option list in this app (sort order, status filter, role, country, ...) is
 *  short enough that a searchable combobox would be over-engineering, not a usability win. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, hint, error, id, required, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const hintId = hint ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-text-primary">
            {label}
            {required && <span className="text-danger"> *</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            required={required}
            aria-invalid={!!error}
            aria-describedby={cn(hintId, errorId) || undefined}
            className={cn(
              'h-9 w-full appearance-none rounded-md border border-border bg-surface px-3 pr-8 text-sm text-text-primary',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent',
              'disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-text-tertiary',
              error && 'border-danger focus-visible:ring-danger',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
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
Select.displayName = 'Select';
