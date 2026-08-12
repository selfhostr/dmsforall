import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useBlocCreancier } from '@/hooks/parametrage/useBlocCreancier';

import { FormulaireBlocCreancier } from './FormulaireBlocCreancier';

/**
 * Écran de paramétrage du bloc créancier (RF-54/PF-03) — adresse structurée du garage + comptes
 * IBAN/QR-IBAN, seule source du bulletin QR imprimé sur chaque facture. Bloquant pour le garage
 * pilote : sans cet écran, la saisie de ces coordonnées n'était possible qu'en `curl` direct sur
 * `GET|PATCH /parametres-facturation/creancier`.
 *
 * `GET` sans donnée saisie rend `200` avec tous les champs `null` (jamais un `404`, voir
 * `hooks/parametrage/bloc-creancier.api.ts`) : ce n'est donc jamais un état « vide » au sens
 * `EtatVide` (rien à créer, personne à qui demander) — c'est un formulaire à remplir, que
 * `FormulaireBlocCreancier` affiche directement avec un bandeau nommant ce qui manque encore
 * (§ complétude), plutôt qu'un écran vide suivi d'un bouton « créer ».
 *
 * Réservé à `direction`/`comptable` (`RF-115` : `admin` est un rôle technique sans droit
 * financier, précisément parce que qui crée les comptes ne doit pas pouvoir détourner les
 * encaissements). Le `403 DROIT_INSUFFISANT` qu'un `admin` rencontre en se connectant ici est
 * ATTENDU et CORRECT — il reçoit donc un état dédié qui l'explique en ces termes, pas le message
 * générique d'erreur (`erreurs:codes.DROIT_INSUFFISANT`, trop laconique pour ce cas précis, que
 * @laupernoe rencontrera en premier s'il se connecte avec le compte `admin`).
 */
export function EcranParametresFacturation() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useBlocCreancier();

  const estRefusDroit =
    requete.error instanceof ErreurApi && requete.error.probleme.code === 'DROIT_INSUFFISANT';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="texte-titre-page">{t('parametrage:titre')}</h1>

      {requete.isPending ? (
        <EtatChargement lignes={8} />
      ) : requete.isError && estRefusDroit ? (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center"
          role="alert"
        >
          <ShieldAlert className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="texte-titre-section">{t('parametrage:creancier.refus.titre')}</h2>
          <p className="max-w-md text-muted-foreground">
            {t('parametrage:creancier.refus.description')}
          </p>
          <Button asChild variant="outline">
            <Link to="/">{t('parametrage:creancier.refus.retourAccueil')}</Link>
          </Button>
        </div>
      ) : requete.isError ? (
        <EtatErreur
          titre={t('parametrage:creancier.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <FormulaireBlocCreancier blocCreancier={requete.data} />
      )}
    </div>
  );
}
