import { Button } from './Button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
  /** Singular noun for the count text, e.g. "order" -> "42 orders". Defaults to "item". */
  itemLabel?: string;
}

/**
 * The single offset-pagination control for the whole app - previously duplicated inline as a
 * near-identical `Pager` function in the orders, purchase-requests, catalog, and admin audit-log
 * pages (each written independently as pagination was added to that page's endpoint). Extracted
 * here so future paginated pages reuse it instead of copy-pasting another near-duplicate.
 * Existing inline copies were left as-is where migrating them was pure churn with no visible
 * change - adopted going forward on newly-touched pages.
 */
export function Pagination({ page, totalPages, total, onChange, itemLabel = 'item' }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <p className="text-caption text-text-secondary">
        Page {page} of {totalPages} &middot; {total} {total === 1 ? itemLabel : `${itemLabel}s`}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
