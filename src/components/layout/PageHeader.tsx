import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/Breadcrumb';

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

/** The consistent page-header pattern (section 7's app-shell requirement) - breadcrumb, title,
 *  optional description, optional right-aligned actions slot. Not force-adopted on every one of
 *  the app's 38 pages in this pass (a purely mechanical, high-diff, low-risk-but-nonzero-risk
 *  change for pages this redesign didn't otherwise touch) - applied to the pages actually
 *  redesigned this phase; see PHASE18_REPORT.md. */
export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1">{title}</h1>
          {description && <p className="text-body text-text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
