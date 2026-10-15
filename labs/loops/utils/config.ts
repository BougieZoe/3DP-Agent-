export const config = {
  timeouts: {
    typecheck: 30000, // 30 seconds
    tests: 60000,     // 60 seconds
  },
  maxRounds: 5,
  excludeDirs: ["dist", "node_modules", "patches", ".git"],
};
