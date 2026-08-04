import { PackageCheck, ShieldAlert, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, StatutLigneOr, TypeLigneOr } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterMontant, formaterPourmille } from '@/lib/formats';

const FORMATEUR_QUANTITE = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

/** Millièmes (contrat `quantiteMillieme`, `2500` = 2,5) -> "2.5". Formateur local : la quantité
 *  n'est ni un montant ni un kilométrage, aucun helper partagé (`lib/formats.ts`) ne la couvre. */
function formaterQuantite(quantiteMillieme: number): string {
  return FORMATEUR_QUANTITE.format(quantiteMillieme / 1000);
}

/** Centièmes d'heure (`tempsBaremeCentiemes`/`tempsReelCentiemes`, P-03) -> "1.50 h". */
function formaterTempsHeures(centiemes: number): string {
  return `${(centiemes / 100).toFixed(2)} h`;
}

// `TypeLigneOr` -> suffixe de `or:lignes.types` : mapping NON trivial (ex. `taxe` -> `taxeElimination`,
// `main_oeuvre_bareme` -> `mainOeuvreBaremee`), donc explicite plutôt que dérivé par manipulation
// de chaîne — même précaution que `BadgeStatutOr`.
const CLES_TYPE: Record<TypeLigneOr, string> = {
  main_oeuvre_bareme: 'mainOeuvreBaremee',
  main_oeuvre_temps_reel: 'mainOeuvreTempsReel',
  forfait: 'forfait',
  piece: 'piece',
  fourniture: 'fourniture',
  sous_traitance: 'sousTraitance',
  produit_atelier: 'produitAtelier',
  taxe: 'taxeElimination',
  remise: 'remise',
  texte: 'texte',
};

const CLES_STATUT: Record<StatutLigneOr, string> = {
  proposee: 'proposee',
  a_valider: 'aValider',
  validee: 'validee',
  en_cours: 'enCours',
  realisee: 'realisee',
  facturee: 'facturee',
  refusee: 'refusee',
  annulee: 'annulee',
};

interface Props {
  readonly lignes: readonly ReponseLigneOr[];
  readonly lignesTronquees: boolean;
}

/**
 * Lignes de l'OR (travaux/pièces/forfaits…) — table LECTURE SEULE en v1 : aucune action de ligne
 * (`valider-lignes`/`refuser-lignes`/…) n'est câblée ici faute de sélection multi-lignes dans cet
 * écran (voir le commentaire d'en-tête de `useTransitionsOrdreReparation.ts`). Le montant total
 * n'est JAMAIS recalculé côté client (§ contrat) — uniquement affiché depuis `ligne.montants`, ou
 * laissé vide (jamais « 0.00 ») pour un rôle sans droit aux montants.
 *
 * Pas de composant `BadgeStatutLigne` dédié à ce jour (seul `BadgeStatutOr` existe dans
 * `composants/identite/` — voir le commentaire de `components/ui/badge.tsx`) : le statut de ligne
 * utilise donc le `Badge` générique, à remplacer par un composant dédié quand il existera.
 */
export function ListeLignesOrdreReparation({ lignes, lignesTronquees }: Props) {
  const { t } = useTranslation('or');

  const colonnes: ColonneComptoir<ReponseLigneOr>[] = [
    {
      id: 'designation',
      libelle: t('or:lignes.colonnes.designation'),
      rendu: (ligne) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="texte-corps font-medium text-foreground">{ligne.designation}</span>
            {ligne.securite ? (
              <ShieldAlert
                aria-label={t('or:lignes.marqueurs.securite')}
                className="h-3.5 w-3.5 shrink-0 text-statut-danger"
              />
            ) : null}
            {ligne.fournieParClient ? (
              <UserRound
                aria-label={t('or:lignes.marqueurs.fournieParClient')}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
            {ligne.aRestituer ? (
              <PackageCheck
                aria-label={t('or:lignes.marqueurs.pieceARestituer')}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
          </div>
          <span className="texte-libelle text-muted-foreground">
            {t(`or:lignes.origines.${ligne.origine}`)}
            {ligne.referenceTexte ? ` · ${ligne.referenceTexte}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'type',
      libelle: t('or:lignes.colonnes.type'),
      rendu: (ligne) => (
        <span className="texte-libelle text-muted-foreground">
          {t(`or:lignes.types.${CLES_TYPE[ligne.type]}`)}
        </span>
      ),
    },
    {
      id: 'quantite',
      libelle: t('or:lignes.colonnes.quantite'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">{formaterQuantite(ligne.quantiteMillieme)}</span>
      ),
    },
    {
      id: 'tempsBareme',
      libelle: t('or:lignes.colonnes.tempsBareme'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-muted-foreground">
          {ligne.tempsBaremeCentiemes !== null
            ? formaterTempsHeures(ligne.tempsBaremeCentiemes)
            : ''}
        </span>
      ),
    },
    {
      id: 'tempsPointe',
      libelle: t('or:lignes.colonnes.tempsPointe'),
      alignement: 'droite',
      // Toujours vide au lot 1 (module pointage absent) : `tempsReelCentiemes` est réellement
      // `null`, ce n'est jamais un droit manquant — rien à masquer ni à inventer.
      rendu: (ligne) => (
        <span className="tabular-nums">
          {ligne.tempsReelCentiemes !== null ? formaterTempsHeures(ligne.tempsReelCentiemes) : ''}
        </span>
      ),
    },
    {
      id: 'rabais',
      libelle: t('or:lignes.colonnes.rabais'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-muted-foreground">
          {ligne.rabaisPourmille !== 0 ? formaterPourmille(ligne.rabaisPourmille) : ''}
        </span>
      ),
    },
    {
      id: 'payeur',
      libelle: t('or:lignes.colonnes.payeur'),
      rendu: (ligne) => (
        <span className="texte-libelle">{t(`or:lignes.payeurs.${ligne.payeur}`)}</span>
      ),
    },
    {
      id: 'total',
      libelle: t('or:lignes.colonnes.totalTtc'),
      alignement: 'droite',
      // Absent (pas 0) pour un rôle sans droit aux montants : `ligne.montants` est alors omis en
      // bloc par le serveur (§ contrat MontantsLigneOr), jamais substitué à « 0.00 ».
      rendu: (ligne) => (
        <span className="tabular-nums font-medium">
          {ligne.montants ? formaterMontant(ligne.montants.montantTtcCentimes) : ''}
        </span>
      ),
    },
    {
      id: 'statut',
      libelle: t('or:lignes.colonnes.statut'),
      rendu: (ligne) => (
        <Badge variant="secondary">{t(`or:lignes.statuts.${CLES_STATUT[ligne.statut]}`)}</Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <TableComptoir
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => ligne.id}
        contenuVide={<EtatVide titre={t('or:lignes.titre')} description={t('or:lignes.vide')} />}
      />
      {lignesTronquees ? (
        <p className="texte-libelle text-muted-foreground">{t('or:lignes.tronquees')}</p>
      ) : null}
    </div>
  );
}
