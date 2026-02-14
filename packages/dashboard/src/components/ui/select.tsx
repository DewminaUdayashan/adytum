import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  placement?: 'down' | 'up';
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  disabled = false,
  placement = 'down',
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ topDown: 0, topUp: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    const handleScroll = () => {
      if (isOpen && containerRef.current) {
        updatePosition();
      }
    };

    // Update position on scroll/resize
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const updatePosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        topDown: rect.bottom + window.scrollY + 4,
        topUp: rect.top + window.scrollY - 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  };

  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen) {
      updatePosition();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className={clsx('relative', className)} ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={clsx(
          'flex h-10 w-full items-center justify-between rounded-lg border bg-bg-secondary px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent-primary/20',
          isOpen
            ? 'border-accent-primary ring-2 ring-accent-primary/20'
            : 'border-border-primary hover:border-border-secondary',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={clsx('truncate flex items-center gap-2', !selectedOption && 'text-text-muted')}
        >
          {selectedOption ? (
            <>
              {selectedOption.icon}
              {selectedOption.label}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 text-text-tertiary transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              top: placement === 'down' ? position.topDown : position.topUp,
              left: position.left,
              width: position.width,
              transform: placement === 'up' ? 'translateY(-100%)' : undefined,
              zIndex: 9999,
            }}
            className={clsx(
              'fixed max-h-60 overflow-auto rounded-lg border border-border-primary bg-bg-secondary py-1 shadow-xl animate-in fade-in zoom-in-95 duration-100',
              placement === 'down' ? 'mt-1' : 'mb-1',
            )}
          >
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={clsx(
                  'relative flex w-full flex-col px-3 py-2 text-left text-sm transition-colors hover:bg-bg-tertiary',
                  option.value === value && 'bg-accent-primary/5 text-accent-primary',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                  {option.value === value && <Check className="h-3.5 w-3.5" />}
                </div>
                {option.description && (
                  <span className="text-xs text-text-muted mt-0.5">{option.description}</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
