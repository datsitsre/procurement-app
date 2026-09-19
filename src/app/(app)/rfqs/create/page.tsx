'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { catalogService } from '@/services/catalog.service';
import { demoCategories } from '@/lib/demo-data/catalog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Page } from '@/types/common';
import type { Product, SupplierProfile } from '@/types/catalog';

export default function CreateRfqPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  // Only published products and verified suppliers can go into an RFQ (section 46) - never the
  // static, unfiltered seed arrays, since a supplier awaiting verification or a product awaiting
  // moderation must not be reachable this way. This picker needs the whole catalog to choose
  // from (a single-select, not a paged table), so it requests the API's max pageSize (500 -
  // GET /api/products's own documented cap, higher than every other endpoint's 100 specifically
  // for this use case - Phase 17, section 11). A tenant with more than 500 published products
  // would not see the rest here - a real, documented limitation, not a silent one; a searchable
  // async product picker would be the real fix, out of this phase's scope.
  const { data: productsPage } = useAsyncData<Page<Product>>('rfq-create-products', () => catalogService.listProducts(undefined, 1, 500));
  const products = productsPage?.items ?? null;
  const { data: suppliers } = useAsyncData<SupplierProfile[]>('rfq-create-suppliers', () => catalogService.listSuppliers());

  const preselectedProductId = searchParams.get('product');
  const [productId, setProductId] = useState(preselectedProductId ?? '');
  const [quantity, setQuantity] = useState(10);
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('Accra');
  const [additionalRequirements, setAdditionalRequirements] = useState('');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const productList = products ?? [];
  const product = productList.find((p) => p.id === productId) ?? productList[0];

  const eligibleSuppliers = useMemo(() => {
    if (!suppliers) return [];
    if (!product) return suppliers;
    const categoryName = demoCategories.find((c) => c.id === product.categoryId)?.name;
    return suppliers.filter((s) => s.categories.includes(categoryName ?? '') || s.id === product.supplierId);
  }, [product, suppliers]);

  function toggleSupplier(id: string) {
    setSupplierIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!company || !session || !product || !membership) return;
    setError(null);

    if (!requiredDeliveryDate) {
      setError('Choose a required delivery date.');
      return;
    }
    if (supplierIds.length === 0) {
      setError('Invite at least one supplier.');
      return;
    }

    setSubmitting(true);
    const result = await procurementService.createRfq(
      {
        companyId: company.id,
        createdByUserId: session.user.id,
        items: [{ id: `rfqi-${product.id}`, productId: product.id, productName: product.name, quantity }],
        requiredDeliveryDate: new Date(requiredDeliveryDate).toISOString(),
        deliveryLocation,
        additionalRequirements: additionalRequirements || undefined,
        supplierIds,
      },
      membership.role,
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push(`/rfqs/${result.data.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/rfqs" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to RFQs
      </Link>

      <div>
        <h1 className="text-h1">Request for quotation</h1>
        <p className="text-body text-text-secondary">Send a quote request to one or more suppliers.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="max-w-2xl rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="product" className="text-sm font-medium">
              Product
            </label>
            <select
              id="product"
              value={product?.id ?? ''}
              onChange={(e) => {
                setProductId(e.target.value);
                setSupplierIds([]);
              }}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {productList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />

          <Input
            label="Required delivery date"
            type="date"
            value={requiredDeliveryDate}
            onChange={(e) => setRequiredDeliveryDate(e.target.value)}
            required
          />

          <Input
            label="Delivery location"
            value={deliveryLocation}
            onChange={(e) => setDeliveryLocation(e.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="requirements" className="text-sm font-medium">
              Additional requirements
            </label>
            <textarea
              id="requirements"
              rows={3}
              value={additionalRequirements}
              onChange={(e) => setAdditionalRequirements(e.target.value)}
              placeholder="e.g. Include installation, extended warranty…"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Send to suppliers</span>
            {eligibleSuppliers.length === 0 ? (
              <p className="text-caption">No suppliers found for this product&rsquo;s category.</p>
            ) : (
              eligibleSuppliers.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={supplierIds.includes(s.id)}
                    onChange={() => toggleSupplier(s.id)}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  {s.name}
                  <span className="text-caption">
                    ({s.city}, response &lt; {s.responseTimeHours}h)
                  </span>
                </label>
              ))
            )}
          </div>

          <Button onClick={handleSubmit} loading={submitting} className="mt-2 w-fit">
            Send RFQ
          </Button>
        </div>
      </div>
    </div>
  );
}
