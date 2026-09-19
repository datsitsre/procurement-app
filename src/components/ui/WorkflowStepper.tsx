import { Check, X } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface WorkflowStep {
  key: string;
  label: string;
  status: 'done' | 'rejected' | 'current' | 'upcoming';
  meta?: string;
}

/**
 * A visual sequential-workflow indicator (section 14) - approval chains, fulfillment stages,
 * any process the product models as an ordered list of steps with one "current" position.
 * Renders as a horizontal chain that wraps naturally at narrow widths (rather than a separate
 * mobile-only vertical layout, which for a typically 2-4-step chain like an approval band would
 * be extra implementation complexity for no real legibility gain over wrapping), e.g.:
 *
 *   ✓ Manager  →  ● Finance  →  ○ Procurement
 *
 * Distinguishes four states, not just "done vs not": `done` (check), `rejected` (x, ends the
 * chain visually), `current` (filled circle, the one step actually awaiting action), and
 * `upcoming` (hollow circle, not yet reachable) - collapsing "current" and "upcoming" into one
 * "pending" bucket is exactly what made the previous version of this indicator less useful than
 * it could be, since "who does this need to move to next" wasn't visually distinct from "who's
 * three steps away."
 */
export function WorkflowStepper({ steps }: { steps: WorkflowStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-4">
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                step.status === 'done' && 'bg-success text-white',
                step.status === 'rejected' && 'bg-danger text-white',
                step.status === 'current' && 'bg-accent text-accent-foreground',
                step.status === 'upcoming' && 'border-2 border-border bg-surface text-text-tertiary',
              )}
              aria-hidden="true"
            >
              {step.status === 'done' ? (
                <Check className="h-4 w-4" />
              ) : step.status === 'rejected' ? (
                <X className="h-4 w-4" />
              ) : (
                <span className={cn('h-2 w-2 rounded-full', step.status === 'current' ? 'bg-accent-foreground' : 'bg-transparent')} />
              )}
            </span>
            <div className="flex w-24 flex-col">
              <span className={cn('text-sm font-medium', step.status === 'upcoming' ? 'text-text-tertiary' : 'text-text-primary')}>
                {step.label}
              </span>
              {step.meta && <span className="text-metadata">{step.meta}</span>}
            </div>
          </div>
          {index < steps.length - 1 && <div aria-hidden="true" className="mx-1 mb-6 h-px w-6 shrink-0 bg-border sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}
