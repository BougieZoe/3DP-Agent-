/**
 * Responsive Design Utilities
 * 
 * Provides hooks and utilities for responsive design:
 * - Breakpoint detection
 * - Mobile-first responsive classes
 * - Touch-friendly interactions
 * - Viewport utilities
 */

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide';

export interface ResponsiveState {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isWide: boolean;
  width: number;
  height: number;
  isPortrait: boolean;
  isLandscape: boolean;
  isTouchDevice: boolean;
}

export interface ResponsiveOptions {
  /** Custom breakpoints */
  breakpoints?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BREAKPOINTS = {
  mobile: 640,
  tablet: 1024,
  desktop: 1280,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Hook for responsive breakpoint detection
 */
export function useResponsive(options: ResponsiveOptions = {}): ResponsiveState {
  const breakpoints = {
    ...DEFAULT_BREAKPOINTS,
    ...options.breakpoints,
  };

  const [state, setState] = useState<ResponsiveState>(() => {
    if (typeof window === 'undefined') {
      return {
        breakpoint: 'desktop',
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isWide: false,
        width: 1024,
        height: 768,
        isPortrait: false,
        isLandscape: true,
        isTouchDevice: false,
      };
    }

    return getStateFromWindow(breakpoints);
  });

  useEffect(() => {
    const handleResize = () => {
      setState(getStateFromWindow(breakpoints));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoints.mobile, breakpoints.tablet, breakpoints.desktop]);

  return state;
}

function getStateFromWindow(breakpoints: typeof DEFAULT_BREAKPOINTS): ResponsiveState {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isPortrait = height > width;

  let breakpoint: Breakpoint = 'desktop';
  if (width < breakpoints.mobile) {
    breakpoint = 'mobile';
  } else if (width < breakpoints.tablet) {
    breakpoint = 'tablet';
  } else if (width >= breakpoints.desktop) {
    breakpoint = 'wide';
  }

  return {
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop' || breakpoint === 'wide',
    isWide: breakpoint === 'wide',
    width,
    height,
    isPortrait,
    isLandscape: !isPortrait,
    isTouchDevice: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  };
}

/**
 * Hook for detecting touch device
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  return isTouch;
}

/**
 * Hook for viewport size
 */
export function useViewport(): { width: number; height: number } {
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewport;
}

/**
 * Hook for media query
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get responsive class names based on breakpoint
 */
export function responsiveClasses(
  mobile: string,
  tablet?: string,
  desktop?: string,
  wide?: string
): string {
  return [
    mobile,
    tablet && `sm:${tablet}`,
    desktop && `md:${desktop}`,
    wide && `lg:${wide}`,
  ].filter(Boolean).join(' ');
}

/**
 * Get responsive value based on breakpoint
 */
export function responsiveValue<T>(
  breakpoint: Breakpoint,
  values: {
    mobile: T;
    tablet?: T;
    desktop?: T;
    wide?: T;
  }
): T {
  switch (breakpoint) {
    case 'mobile':
      return values.mobile;
    case 'tablet':
      return values.tablet ?? values.mobile;
    case 'desktop':
      return values.desktop ?? values.tablet ?? values.mobile;
    case 'wide':
      return values.wide ?? values.desktop ?? values.tablet ?? values.mobile;
    default:
      return values.mobile;
  }
}

/**
 * Check if element is in viewport
 */
export function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Scroll to element smoothly
 */
export function scrollToElement(element: HTMLElement, offset: number = 0): void {
  const elementPosition = element.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - offset;

  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth',
  });
}
