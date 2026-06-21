import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { ThemeProvider } from "@/lib/ThemeContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider initialTheme="dark">
    <App />
    <Analytics />
  </ThemeProvider>
);
