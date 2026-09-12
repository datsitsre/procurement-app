import { ShoppingCart } from 'lucide-react';
import { PhasePlaceholder } from '@/components/layout/PhasePlaceholder';

export default function CatalogPage() {
  return (
    <PhasePlaceholder
      icon={ShoppingCart}
      title="Catalog"
      description="Browse products from verified suppliers, compare pricing, and request quotes once the catalog module is built (Phase 2)."
      phase="Phase 2"
    />
  );
}
