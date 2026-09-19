'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Award, Clock, MapPin, Package, ShieldCheck, Star } from 'lucide-react';
import { catalogService } from '@/services/catalog.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import type { SupplierProfile } from '@/types/catalog';

export default function SupplierDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  const { data: supplier, loading, error } = useAsyncData<SupplierProfile>(params.slug, () => catalogService.getSupplierBySlug(params.slug));

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-32" />
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (error || !supplier) {
    return (
      <ErrorState
        title="Supplier not found"
        description="This supplier may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to suppliers', onClick: () => router.push('/suppliers') }}
      />
    );
  }

  const isBuyable = supplier.verification === 'VERIFIED' || supplier.verification === 'PREMIUM_VERIFIED';

  return (
    <div className="flex flex-col gap-6">
      <Link href="/suppliers" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to suppliers
      </Link>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-h1">{supplier.name}</h1>
              {isBuyable && <ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />}
            </div>
            <p className="mt-1 flex items-center gap-1 text-body text-text-secondary">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {supplier.city}, {supplier.country}
            </p>
          </div>
          <StatusBadge domain="supplierVerification" status={supplier.verification} />
        </div>

        {!isBuyable && (
          <p className="mt-4 rounded-md border border-warning/30 bg-warning-bg p-3 text-sm text-warning">
            This supplier is not yet verified - their products and RFQ invitations aren&rsquo;t available until an admin verifies them.
          </p>
        )}

        <p className="mt-4 text-body text-text-secondary">{supplier.description}</p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="flex items-center gap-1 text-caption">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
              Rating
            </p>
            <p className="text-sm font-semibold">
              {supplier.rating.toFixed(1)} ({supplier.reviewCount})
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-caption">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              Orders completed
            </p>
            <p className="text-sm font-semibold">{supplier.completedOrders}</p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-caption">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Typical response time
            </p>
            <p className="text-sm font-semibold">{supplier.responseTimeHours}h</p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-caption">
              <Award className="h-3.5 w-3.5" aria-hidden="true" />
              Certifications
            </p>
            <p className="text-sm font-semibold">{supplier.certifications.length > 0 ? supplier.certifications.join(', ') : 'None listed'}</p>
          </div>
        </div>

        {supplier.categories.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {supplier.categories.map((c) => (
              <span key={c} className="rounded-md bg-neutral-bg px-3 py-1 text-sm">
                {c}
              </span>
            ))}
          </div>
        )}

        {isBuyable && (
          <Link href={`/catalog?supplier=${supplier.id}`} className="mt-6 inline-block">
            <Button>View products from {supplier.name}</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
