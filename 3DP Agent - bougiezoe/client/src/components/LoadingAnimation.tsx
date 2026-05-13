import { motion } from 'framer-motion';

interface LoadingAnimationProps {
  message?: string;
}

export function LoadingAnimation({ message = 'Analyzing model...' }: LoadingAnimationProps) {
  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12">
      {/* Animated Circles */}
      <div className="relative w-16 h-16">
        <motion.div
          className="absolute inset-0 border-2 border-transparent border-t-accent border-r-accent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-2 border-2 border-transparent border-b-accent border-l-accent rounded-full"
          animate={{ rotate: -360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Message */}
      <div className="text-center space-y-2">
        <p className="font-serif text-lg font-bold text-foreground">{message}</p>
        <div className="flex justify-center gap-1">
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
            className="text-accent"
          >
            •
          </motion.span>
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
            className="text-accent"
          >
            •
          </motion.span>
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
            className="text-accent"
          >
            •
          </motion.span>
        </div>
      </div>
    </div>
  );
}
