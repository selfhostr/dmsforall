import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface Props {
  /** URL RÉELLE du PDF (jamais un blob/une donnée en mémoire) — voir le raisonnement complet
   *  ci-dessous. */
  readonly url: string;
  /** Déjà traduit par l'appelant (même doctrine que `EtatVide`/`EtatErreur`) — ce composant est
   *  générique, il ne connaît pas le type de document (OR, facture, bon de commande…). */
  readonly libelle: string;
}

/**
 * « Imprimer » un document généré côté serveur (OR, facture, bon de commande…) — extrait de
 * `ecrans/atelier/BoutonImprimerOr.tsx` (chantier d'unification inter-écrans, 25.08.2026) : AVANT
 * ce composant, la même logique existait en triple, réimplémentée séparément en atelier, en
 * facturation et en pièces — trois divergences de forme (icône ou non, taille de bouton, variante)
 * pour un seul et même mécanisme.
 *
 * ISSUE #155 (rapport terrain, reproduit en navigateur réel) — pourquoi un simple `<a>`, jamais
 * `window.open()` + fetch/blob : deux tentatives fetch+blob ont échoué, pour deux raisons
 * DIFFÉRENTES mais de la même famille. Une URL D'OBJET (`URL.createObjectURL`) n'est résoluble QUE
 * dans le contexte de navigation qui l'a créée — Safari refuse de la charger depuis l'onglet séparé
 * qui la reçoit (même same-origin), l'onglet reste bloqué sur `about:blank` sans erreur JS
 * observable. En remplacement, une URL DE DONNÉES (`data:application/pdf;base64,...`) se heurte à
 * une règle différente mais tout aussi bloquante : Chrome (depuis la version 60) et Firefox
 * refusent purement et simplement une navigation de premier niveau vers une URL `data:` (« Not
 * allowed to navigate top frame to data URL »). Un lien `<a href target="_blank">` vers l'URL
 * RÉELLE évite les deux : navigation native, cookie de session comme toute autre requête
 * (`credentials` implicite d'une navigation, jamais un `fetch`), donc aucun blob, aucune URL
 * d'objet, aucune URL de données, donc aucune limite de taille ni gonflement ~33% du base64.
 * Contrepartie ACCEPTÉE (déjà acceptée pour chacun des trois points de branchement d'origine) :
 * une éventuelle réponse d'erreur `problem+json` du serveur s'afficherait telle quelle (JSON brut)
 * dans le nouvel onglet plutôt qu'un message traduit inline — l'alternative mesurée (onglet qui ne
 * s'ouvre JAMAIS, quel que soit le navigateur) était strictement pire pour un garagiste qui a
 * besoin du papier tout de suite.
 *
 * `asChild` délègue le rendu à l'unique enfant `<a>` — Slot fusionne le style du bouton, mais AUCUN
 * indicateur de chargement/erreur maison ne s'y ajoute (contrat `asChild` du composant) : une
 * navigation `<a target="_blank">` n'a rien à attendre côté client, le navigateur gère l'ouverture
 * et l'affichage lui-même.
 */
export function BoutonImprimerDocument({ url, libelle }: Props) {
  return (
    <Button variant="outline" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Printer aria-hidden className="h-4 w-4" />
        {libelle}
      </a>
    </Button>
  );
}
