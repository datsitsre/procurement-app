import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional Tailwind classes, resolving conflicts (e.g. `p-2` + `p-4` -> `p-4`)
 *  the way every component in this design system composes its class names. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
