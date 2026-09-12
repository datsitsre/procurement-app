import { Package } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function OrdersPage() {
  return (
    <PhasePlaceholder
      icon={Package}
      title="Orders"
      description="Your company's orders, with delivery tracking and status, will appear here once the orders module is built (Phase 4)."
      phase="Phase 4"
    />
  );
}
