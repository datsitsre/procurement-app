export interface ChartPoint {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: ChartPoint[];
  valueFormatter?: (value: number) => string;
  height?: number;
}

/**
 * A plain, dependency-free vertical bar chart (section 45/63's analytics). Deliberately not
 * built on a charting library - a handful of proportional divs cover every chart this app
 * needs (a monthly trend, a status breakdown) without adding a dependency for it. Each bar
 * carries its value as a title tooltip and the label underneath, so the data is legible even
 * without color.
 */
export function BarChart({ data, valueFormatter = String, height = 160 }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${valueFormatter(d.value)}`}>
          <span className="text-caption">{d.value > 0 ? valueFormatter(d.value) : ''}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-sm bg-accent"
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-caption whitespace-nowrap">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface HorizontalBarListProps {
  items: ChartPoint[];
  valueFormatter?: (value: number) => string;
}

/** A ranked "top N" breakdown (top suppliers by spend, top buyers by revenue) - a label, a
 *  proportional bar, and the value, in one row per item. */
export function HorizontalBarList({ items, valueFormatter = String }: HorizontalBarListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (items.length === 0) {
    return <p className="text-caption">Not enough data yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{item.label}</span>
            <span className="text-text-secondary">{valueFormatter(item.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-bg">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
