/**
 * Mobile Navigation Component
 * 
 * Provides mobile-friendly navigation:
 * - Hamburger menu
 * - Bottom navigation bar
 * - Touch-friendly interactions
 * - Swipe gestures
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { 
  Menu, 
  X, 
  Home, 
  Upload, 
  Settings, 
  HelpCircle,
  ChevronRight
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  badge?: number;
}

interface MobileNavProps {
  items: NavItem[];
  activeItem?: string;
  onNavigate?: (item: NavItem) => void;
  className?: string;
}

export function MobileNav({ 
  items, 
  activeItem, 
  onNavigate,
  className 
}: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div className={cn("md:hidden", className)}>
      {/* Hamburger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 bg-background/80 backdrop-blur-sm rounded-lg border shadow-sm"
        aria-label={isOpen ? "Close menu" : "Open menu"}
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />
      )}

      {/* Menu */}
      <div
        ref={menuRef}
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-64 bg-background border-r transform transition-transform duration-200 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="pt-16 px-4">
          <nav className="space-y-1">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate?.(item);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                  activeItem === item.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge && item.badge > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                    {item.badge}
                  </span>
                )}
                <ChevronRight size={16} className="opacity-50" />
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

interface BottomNavProps {
  items: NavItem[];
  activeItem?: string;
  onNavigate?: (item: NavItem) => void;
  className?: string;
}

export function BottomNav({ 
  items, 
  activeItem, 
  onNavigate,
  className 
}: BottomNavProps) {
  return (
    <nav className={cn(
      "fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/95 backdrop-blur-sm border-t",
      className
    )}>
      <div className="flex items-center justify-around h-16 px-2">
        {items.slice(0, 5).map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate?.(item)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 min-w-[64px] py-2 rounded-lg transition-colors",
              activeItem === item.id
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <span className="relative">
              {item.icon}
              {item.badge && item.badge > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] bg-primary text-primary-foreground rounded-full">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
