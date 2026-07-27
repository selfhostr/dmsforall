import { type InputHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// text-base (16px) SANS réduction sur desktop : en dessous de 16px, iPad zoome au focus.
// h-11 (44px) : cible tactile minimale sur tablette d'atelier.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
