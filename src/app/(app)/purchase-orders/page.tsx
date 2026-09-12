import { ClipboardList } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function PurchaseOrdersPage() {
  return (
    <PhasePlaceholder
      icon={ClipboardList}
      title="Purchase orders"
      description="Purchase orders generated from approved purchase requests will appear here once the procurement module is built (Phase 3)."
      phase="Phase 3"
    />
  );
}
