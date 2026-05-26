import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "@/lib/ThemeContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider initialTheme="dark">
    <App />
  </ThemeProvider>
);
