import { useEffect, useState } from 'react';

/**
 * URL d'aperçu d'une photo, créée ICI à partir du `File` reçu : le composant qui affiche l'image
 * est la seule source de cette URL d'objet (`URL.createObjectURL`), elle est révoquée à la sortie
 * du composant et recréée si le fichier change. Jamais une chaîne transmise depuis l'extérieur.
 *
 * `useState` + effet (et non `useMemo`) : la création et la révocation sont appariées par le cycle
 * de l'effet, y compris sous StrictMode (montage/démontage/remontage) où une URL mémoïsée serait
 * révoquée puis réutilisée.
 */
export function useApercuFichier(fichier: File): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const nouvelleUrl = URL.createObjectURL(fichier);
    setUrl(nouvelleUrl);
    return () => URL.revokeObjectURL(nouvelleUrl);
  }, [fichier]);

  return url;
}
