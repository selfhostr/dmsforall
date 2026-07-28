import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

/**
 * Écran de repli pour les chemins vers le module Atelier (`/ordres-reparation/:id`,
 * `/atelier/ordres-reparation/nouveau`) — AUCUN écran d'ordre de réparation n'existe encore
 * (module hors périmètre de ce routage), mais la fiche client (« Ouvrir un OR », liste des
 * derniers OR) et la recherche globale (résultat de type `ordre_reparation`) y naviguent déjà.
 *
 * Volontairement PAS un 404 : le lien n'est pas cassé, la fonctionnalité n'est simplement pas
 * encore construite — un garagiste qui clique ne doit jamais confondre les deux. On réutilise le
 * code d'erreur métier déjà traduit dans les trois langues (`erreurs:codes.FONCTION_NON_DISPONIBLE`,
 * déjà utilisé côté API pour le même cas) plutôt que d'inventer un nouveau texte.
 */
export function EcranFonctionAVenir() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('erreurs:codes.FONCTION_NON_DISPONIBLE')}</h1>
        <Button asChild variant="outline">
          <Link to="/">{t('commun:actions.retourAccueil')}</Link>
        </Button>
      </div>
    </div>
  );
}
