import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { obtenirEnv } from '@/config/env';

interface Props {
  readonly orId: string;
}

/**
 * Imprimer la feuille d'atelier (`GET /ordres-reparation/{orId}/pdf`) — geste de CONSULTATION,
 * même droit que la lecture de l'OR (`atelier.or.lire`, arbitrage figé pour ce lot). Contrairement
 * aux transitions de `PanneauActionsOr`, ce bouton ne dépend JAMAIS de `or.actionsDisponibles` ni
 * d'un droit supplémentaire : si l'utilisateur voit la fiche, il peut imprimer, quel que soit le
 * statut de l'OR — d'où un composant séparé, rendu à côté de `PanneauActionsOr` sans emprunter sa
 * logique de disponibilité.
 *
 * CORRECTIF issue #155 (rapport terrain, reproduit en navigateur réel) : ce bouton pilotait
 * auparavant un mécanisme fetch+blob — `window.open()` synchrone puis, une fois le PDF reçu,
 * assignation d'une URL À `location.href` de l'onglet ouvert. Deux tentatives, deux échecs
 * DIFFÉRENTS mais de même famille : une URL D'OBJET (`URL.createObjectURL`) n'est résoluble QUE
 * dans le contexte de navigation qui l'a créée — Safari refuse de la charger depuis l'onglet
 * séparé qui la reçoit, même same-origin (onglet resté bloqué sur `about:blank`, sans erreur JS
 * observable) ; en remplacement, une URL DE DONNÉES (`data:application/pdf;base64,...`) se heurte
 * à une règle DIFFÉRENTE mais tout aussi bloquante : Chrome (depuis la version 60) et Firefox
 * refusent PUREMENT ET SIMPLEMENT une navigation de premier niveau vers une URL `data:`
 * (« Not allowed to navigate top frame to data URL ») — onglet bloqué cette fois sur le
 * navigateur majoritaire chez les garagistes.
 *
 * Repris sur le MÊME motif, déjà éprouvé dans ce dépôt, que `EcranFicheFacture.tsx`
 * (`GET /documents-vente/{id}/pdf`) : un lien `<a>` SIMPLE vers l'URL RÉELLE du PDF. Le navigateur
 * télécharge et affiche lui-même le document — navigation native, cookie de session comme
 * n'importe quelle autre requête (`credentials` implicite d'une navigation, jamais un `fetch`) —
 * donc aucun blob, aucune URL d'objet, aucune URL de données, donc aucune limite de taille ni
 * gonflement ~33% du base64. Contrepartie ACCEPTÉE, la même que pour la facture (jamais contournée
 * là-bas non plus) : une éventuelle réponse d'erreur `problem+json` du serveur s'afficherait telle
 * quelle (JSON brut) dans le nouvel onglet plutôt qu'un message traduit inline — accepté parce que
 * l'alternative mesurée (onglet qui ne s'ouvre JAMAIS, quel que soit le navigateur) était
 * strictement pire pour un garagiste qui a besoin du papier tout de suite.
 *
 * `asChild` (voir `components/ui/button.tsx`) délègue le rendu à l'unique enfant `<a>` — Slot lui
 * fusionne le style du bouton, mais AUCUN indicateur de chargement/erreur maison ne s'y ajoute
 * (contrat `asChild` du composant) : une navigation `<a target="_blank">` n'a rien à attendre
 * côté client, le navigateur gère l'ouverture et l'affichage lui-même.
 */
export function BoutonImprimerOr({ orId }: Props) {
  const { t } = useTranslation('or');
  const urlPdf = `${obtenirEnv().VITE_API_URL}/ordres-reparation/${orId}/pdf`;

  return (
    <Button variant="outline" asChild>
      <a href={urlPdf} target="_blank" rel="noopener noreferrer">
        <Printer aria-hidden className="h-4 w-4" />
        {t('or:actions.imprimer')}
      </a>
    </Button>
  );
}
