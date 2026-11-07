/**
 * Garde d'une URL d'aperçu photo avant de l'affecter à `<img src>` : seules les URL locales
 * produites par `URL.createObjectURL(File)` (`blob:`) ou une image inline (`data:image/`) sont
 * acceptées. Toute autre valeur (http, javascript:, vide...) donne `undefined` : pas d'image.
 */
export function urlApercuSure(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('blob:') || url.startsWith('data:image/') ? url : undefined;
}
