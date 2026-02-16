import React, { forwardRef } from 'react';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Checkbox component
 * Uses Radix UI Primitive for accessibility if available, or custom implementation.
 * Since we might not have radix installed, I'll build a pure React one with similar styling to Select.
 */

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    return (
      <div className="flex items-center space-x-2">
        <div className="relative flex items-center">
          <input
            type="checkbox"
            ref={ref}
            id={id}
            className={clsx(
              "peer h-4 w-4 shrink-0 rounded border border-border-primary ring-offset-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent-primary data-[state=checked]:text-accent-primary-foreground appearance-none cursor-pointer checked:bg-accent-primary checked:border-accent-primary transition-all",
              className
            )}
            {...props}
          />
          <Check className="absolute top-0.5 left-0.5 h-3 w-3 text-bg-primary pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" strokeWidth={3} />
        </div>
        {label && (
          <label
            htmlFor={id}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-text-secondary cursor-pointer"
          >
            {label}
          </label>
        )}
      </div>
    );
  }
);
Checkbox.displayName = 'Checkbox';
