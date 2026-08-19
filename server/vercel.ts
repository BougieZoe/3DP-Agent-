import { createApp } from "./index";

// Vercel @vercel/node entry — exports the Express app instance. Importing
// ./index also evaluates its `if (!process.env.VERCEL)` guard, which is false
// on Vercel, so startServer() does NOT auto-listen here; the platform runs the
// exported app instead.
export default createApp();
