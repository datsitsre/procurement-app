'use client';

import { cloneElement, useId, useState } from 'react';
import { cn } from '@/utils/cn';

export interface TooltipProps {
  content: string;
  children: React.ReactElement<{
    'aria-describedby'?: string;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
  }>;
  side?: 'top' | 'bottom';
}

/** A minimal, accessible tooltip - shows on hover and on keyboard focus alike (never only on
 *  hover, which would make it invisible to keyboard users), and is announced via
 *  `aria-describedby` rather than relying on the visual popup alone. No positioning library -
 *  `side` picks a fixed CSS position, which covers every real use in this app (a short label on
 *  a toolbar icon, a truncated-value hint) without the complexity a floating/auto-flip engine
 *  would add for cases this product doesn't have. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  const trigger = cloneElement(children, {
    'aria-describedby': id,
    onFocus: (e: React.FocusEvent) => {
      setVisible(true);
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      setVisible(false);
      children.props.onBlur?.(e);
    },
  });

  return (
    <span className="relative inline-flex" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md transition-opacity',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          visible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
