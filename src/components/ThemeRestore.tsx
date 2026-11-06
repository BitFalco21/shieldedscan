"use client";

import { useEffect } from "react";
import { restoreStoredTheme } from "@/lib/theme";

/**
 * Re-applies the reader's theme when the head script could not: on a page the browser rendered
 * itself after the server answered 500 (the error boundary), the script element exists but never
 * ran. A no-op wherever the script already stamped the theme.
 */
export function ThemeRestore(): null {
  useEffect(() => {
    restoreStoredTheme();
  }, []);
  return null;
}
