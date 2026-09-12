import { Wallet } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function PaymentsPage() {
  return (
    <PhasePlaceholder
      icon={Wallet}
      title="Payments"
      description="Card, mobile money, bank transfer, and credit-term payments will appear here once the payment abstraction is built (Phase 4)."
      phase="Phase 4"
    />
  );
}
