import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind en résolvant les conflits (dernier gagne). Utilisé par tous
 *  les composants `components/ui/*` générés dans le style shadcn. */
export function cn(...entrees: ClassValue[]): string {
  return twMerge(clsx(entrees));
}
