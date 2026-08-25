/**
 * Responsive Container Component
 * 
 * Provides responsive layout containers:
 * - Flexible grid system
 * - Responsive spacing
 * - Touch-friendly padding
 */

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useResponsive, type ResponsiveState } from '@/lib/responsive';

interface ResponsiveContainerProps {
  children: ReactNode;
  className?: string;
  /** Whether to add safe area padding for mobile devices */
  safeArea?: boolean;
  /** Whether to use full height */
  fullHeight?: boolean;
  /** Whether to center content */
  center?: boolean;
  /** Maximum width */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

export function ResponsiveContainer({
  children,
  className,
  safeArea = false,
  fullHeight = false,
  center = false,
  maxWidth = 'xl',
}: ResponsiveContainerProps) {
  const { isMobile, isTouchDevice } = useResponsive();

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    full: 'max-w-full',
  }[maxWidth];

  return (
    <div
      className={cn(
        "w-full mx-auto px-4",
        maxWidthClass,
        fullHeight && "min-h-screen",
        center && "flex flex-col items-center justify-center",
        safeArea && isTouchDevice && "pb-safe pt-safe",
        isMobile ? "px-4" : "px-6 lg:px-8",
        className
      )}
    >
      {children}
    </div>
  );
}

interface ResponsiveGridProps {
  children: ReactNode;
  className?: string;
  /** Number of columns on mobile */
  mobileColumns?: number;
  /** Number of columns on tablet */
  tabletColumns?: number;
  /** Number of columns on desktop */
  desktopColumns?: number;
  /** Gap size */
  gap?: 'sm' | 'md' | 'lg';
}

export function ResponsiveGrid({
  children,
  className,
  mobileColumns = 1,
  tabletColumns = 2,
  desktopColumns = 3,
  gap = 'md',
}: ResponsiveGridProps) {
  const gapClass = {
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6',
  }[gap];

  return (
    <div
      className={cn(
        "grid",
        gapClass,
        `grid-cols-${mobileColumns}`,
        `sm:grid-cols-${tabletColumns}`,
        `md:grid-cols-${desktopColumns}`,
        className
      )}
    >
      {children}
    </div>
  );
}

interface ResponsiveCardProps {
  children: ReactNode;
  className?: string;
  /** Whether to make the card full-width on mobile */
  fullWidthOnMobile?: boolean;
  /** Whether to add touch-friendly padding */
  touchPadding?: boolean;
}

export function ResponsiveCard({
  children,
  className,
  fullWidthOnMobile = true,
  touchPadding = true,
}: ResponsiveCardProps) {
  const { isMobile, isTouchDevice } = useResponsive();

  return (
    <div
      className={cn(
        "bg-card rounded-lg border shadow-sm",
        fullWidthOnMobile && isMobile && "-mx-4 rounded-none border-x-0",
        touchPadding && isTouchDevice && "p-4 sm:p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

interface ResponsiveTextProps {
  children: ReactNode;
  className?: string;
  /** Text size on mobile */
  mobileSize?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  /** Text size on desktop */
  desktopSize?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
}

export function ResponsiveText({
  children,
  className,
  mobileSize = 'base',
  desktopSize,
}: ResponsiveTextProps) {
  const sizeClass = desktopSize 
    ? `text-${mobileSize} md:text-${desktopSize}`
    : `text-${mobileSize}`;

  return (
    <span className={cn(sizeClass, className)}>
      {children}
    </span>
  );
}

interface TouchButtonProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  /** Whether to use full width on mobile */
  fullWidth?: boolean;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Whether button is disabled */
  disabled?: boolean;
}

export function TouchButton({
  children,
  onClick,
  className,
  fullWidth = false,
  variant = 'default',
  size = 'md',
  disabled = false,
}: TouchButtonProps) {
  const { isTouchDevice } = useResponsive();

  const variantClass = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border bg-background hover:bg-muted",
    ghost: "hover:bg-muted",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  }[variant];

  const sizeClass = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  }[size];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClass,
        sizeClass,
        isTouchDevice && "min-h-[44px] min-w-[44px]", // Touch target size
        fullWidth && "w-full",
        className
      )}
    >
      {children}
    </button>
  );
}
