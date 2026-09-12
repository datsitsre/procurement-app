import { Building2 } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function SuppliersPage() {
  return (
    <PhasePlaceholder
      icon={Building2}
      title="Suppliers"
      description="Discover and manage verified suppliers once the supplier directory is built (Phase 5)."
      phase="Phase 5"
    />
  );
}
