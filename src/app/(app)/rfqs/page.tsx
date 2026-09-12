import { FileText } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function RfqsPage() {
  return (
    <PhasePlaceholder
      icon={FileText}
      title="RFQs"
      description="Request quotations from one or more suppliers, compare their responses, and negotiate once the RFQ module is built (Phase 3)."
      phase="Phase 3"
    />
  );
}
