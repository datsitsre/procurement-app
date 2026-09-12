import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export interface PhasePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
}

/** Honest placeholder for a nav destination whose module hasn't been built yet - the sidebar
 *  link works and takes you somewhere real, it just says what's coming and when, rather than
 *  faking data or 404ing. Every Phase 1 stub route below uses this. */
export function PhasePlaceholder({ icon, title, description, phase }: PhasePlaceholderProps) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1">{title}</h1>
      <EmptyState icon={icon} title={`${title} coming in ${phase}`} description={description} />
    </div>
  );
}
