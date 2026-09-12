import { CheckSquare } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function ApprovalsPage() {
  return (
    <PhasePlaceholder
      icon={CheckSquare}
      title="Approvals"
      description="Purchase requests waiting on your approval will appear here once the approval workflow is built (Phase 3)."
      phase="Phase 3"
    />
  );
}
