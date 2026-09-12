import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: { label: string; onClick: () => void };
}

/** Standard failure state (section 51) - "Unable to load X" with a retry action, used any
 *  time a mock/real service call rejects. Never silently swallow an error into a blank panel. */
export function ErrorState({
  title = 'Unable to load this page.',
  description,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-danger-border bg-danger-bg px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-h3">{title}</p>
        {description && <p className="text-body max-w-sm text-text-secondary">{description}</p>}
      </div>
      <div className="flex gap-2">
        {onRetry && (
          <Button variant="danger" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {secondaryAction && (
          <Button variant="outline" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
