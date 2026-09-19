import { cn } from '@/utils/cn';

export interface AvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Falls back to initials-on-a-colored-circle when no image is set - every company, supplier,
 *  and team member in the app is guaranteed to render an identity, never a broken <img>. */
export function Avatar({ name, imageUrl, size = 'md', className }: AvatarProps) {
  // Avatars come from arbitrary, unoptimizable remote URLs in mock/demo data - swap to
  // next/image once real sources are known.
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={name} className={cn('rounded-full object-cover', sizeClasses[size], className)} />;
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-primary font-medium text-primary-foreground',
        sizeClasses[size],
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
