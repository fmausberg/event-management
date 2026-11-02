"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname } from "next/navigation";

export type PageBreadcrumbValue = { pathname: string; label: string };
export const PageBreadcrumbContext = createContext<((value: PageBreadcrumbValue | null) => void) | null>(null);

export function PageBreadcrumb({ label }: { label: string }) {
  const pathname = usePathname();
  const setBreadcrumb = useContext(PageBreadcrumbContext);
  useEffect(() => {
    setBreadcrumb?.({ pathname, label });
    return () => setBreadcrumb?.(null);
  }, [label, pathname, setBreadcrumb]);
  return null;
}
