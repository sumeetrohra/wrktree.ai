import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves Tailwind conflicts (used by the design-system components). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
