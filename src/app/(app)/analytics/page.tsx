import { BarChart3 } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function AnalyticsPage() {
  return (
    <PhasePlaceholder
      icon={BarChart3}
      title="Analytics"
      description="Monthly spend trends, savings, and purchase-frequency metrics will appear here once the analytics module is built (Phase 7)."
      phase="Phase 7"
    />
  );
}
