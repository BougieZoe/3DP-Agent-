import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface ResultsAnimationProps {
  children: ReactNode;
}

export function ResultsAnimation({ children }: ResultsAnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

interface StatusBadgeProps {
  status: 'good' | 'warning' | 'critical';
  label: string;
}

const statusConfig = {
  good: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  warning: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  critical: {
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className={`inline-block px-3 py-1 rounded-full border ${config.bgColor} ${config.borderColor}`}
    >
      <span className={`font-mono text-xs font-bold ${config.color}`}>{label}</span>
    </motion.div>
  );
}
