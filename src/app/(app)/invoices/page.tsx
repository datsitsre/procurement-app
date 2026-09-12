import { Receipt } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function InvoicesPage() {
  return (
    <PhasePlaceholder
      icon={Receipt}
      title="Invoices"
      description="Supplier invoices, due dates, and payment status will appear here once the invoicing module is built (Phase 4)."
      phase="Phase 4"
    />
  );
}
