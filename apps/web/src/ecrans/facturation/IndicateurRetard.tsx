import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterDate } from '@/lib/formats';
import { cn } from '@/lib/utils';

interface Props {
  readonly dateEcheance: string | null | undefined;
  readonly enRetard: boolean | undefined;
  readonly joursRetard: number | null | undefined;
  readonly className?: string;
}

/**
 * Indicateur d'échéance / retard (§2.4) — texte + icône ACCOLÉ au badge de règlement, jamais une
 * variante de couleur du badge lui-même.
 *
 * Consomme désormais les VRAIS champs dérivés serveur (`ReponseDocumentVente.dateEcheance` /
 * `.enRetard` / `.joursRetard`, voir `document.ts`). ANCIEN CONTRAT RETIRÉ de ce composant :
 * `relanceNiveau`/`relanceLe` existent toujours sur `ReponseDocumentVente` (rythme des relances
 * envoyées), mais portent une notion ORTHOGONALE à l'échéance de paiement — un document peut être
 * relancé sans être en retard au sens de l'échéance (relance amiable avant terme), ou en retard
 * sans avoir encore été relancé une seule fois. Les mélanger dans un seul indicateur était
 * exactement ce qui empêchait l'ancien composant d'afficher un vrai nombre de jours de retard (son
 * commentaire d'origine expliquait ce contournement). Si un indicateur de suivi de relance est
 * demandé un jour, ce doit être un second composant, pas un repli de celui-ci.
 *
 * Trois états honnêtement différents, sans repli qui fabriquerait une assurance non prouvée par le
 * serveur (`dateEcheance` `null` est un état LÉGITIME et FRÉQUENT — factures antérieures à ce
 * champ, clients sans délai de paiement paramétré — jamais assimilé à « à jour ») :
 *  - `dateEcheance === undefined` (rôle sans droit financier, même masquage que `totalTtcCentimes`)
 *    → composant invisible, ne rend rien.
 *  - `dateEcheance === null` → état neutre explicite ("Échéance inconnue"), sans icône d'alarme.
 *  - `enRetard === true` → visible immédiatement, alarme (`--statut-danger`), nombre de jours,
 *    échéance en info-bulle (`title`).
 *  - `enRetard === false` avec `dateEcheance` non nul → échéance affichée SANS alarme (style
 *    neutre) : couvre aussi bien une facture « à venir » qu'une facture SOLDÉE dont l'échéance est
 *    dépassée — le serveur a déjà tranché `enRetard: false` dans ce second cas (`soldeCentimes`
 *    pris en compte côté serveur), rien à recalculer ici.
 */
export function IndicateurRetard({ dateEcheance, enRetard, joursRetard, className }: Props) {
  const { t } = useTranslation('facturation');

  if (dateEcheance === undefined) return null;

  if (dateEcheance === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 texte-libelle text-muted-foreground',
          className,
        )}
      >
        {t('facturation:retard.echeanceInconnue')}
      </span>
    );
  }

  if (enRetard === true) {
    // Défaut corrigé (issue #134, testeur — « je ne peux pas voir la date d'échéance sur la
    // facture, exactement la question qu'un client pose au téléphone ») : cette branche ne
    // portait la date QUE dans l'attribut `title` (info-bulle au survol) — invisible par
    // construction au clavier, au lecteur d'écran et sur tablette (aucun survol possible au
    // doigt). L'alarme « en retard de N jours » reste le repère principal, mais l'échéance
    // doit être un texte VISIBLE, pas un secret réservé à la souris. `title` conservé en plus
    // (bénin, cohérence avec les deux autres branches) mais n'est plus la seule source.
    return (
      <span
        className={cn(
          'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 texte-libelle text-statut-danger',
          className,
        )}
        title={t('facturation:retard.echeanceLe', { date: formaterDate(dateEcheance) })}
      >
        <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {t('facturation:retard.enRetard', { jours: joursRetard ?? 0 })}
        {/* Séparateur dans son propre nœud — le texte d'échéance reste isolé pour rester
            reconnaissable tel quel (« Échéance : jj.mm.aaaa »), identique au libellé rendu par
            les deux autres branches de ce composant, plutôt que noyé dans un « · Échéance… ». */}
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="text-muted-foreground">
          {t('facturation:retard.echeanceLe', { date: formaterDate(dateEcheance) })}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 texte-libelle text-muted-foreground',
        className,
      )}
    >
      {t('facturation:retard.echeanceLe', { date: formaterDate(dateEcheance) })}
    </span>
  );
}
