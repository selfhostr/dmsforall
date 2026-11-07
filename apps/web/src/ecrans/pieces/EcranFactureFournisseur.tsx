import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useFactureFournisseur } from '@/hooks/pieces/useFactureFournisseur';
import { useRejeterFactureFournisseur } from '@/hooks/pieces/useRejeterFactureFournisseur';
import { useValiderRapprochementFactureFournisseur } from '@/hooks/pieces/useValiderRapprochementFactureFournisseur';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { peutDeciderFactureFournisseur, peutLireFactureFournisseur } from './droits';
import { PanneauRapprochementFacture } from './PanneauRapprochementFacture';

/**
 * Consultation d'une facture fournisseur déjà déposée (brief, point 3 : « la revoir, ouvrir le
 * document d'origine ») — réutilise `PanneauRapprochementFacture`, le même panneau que juste après
 * le dépôt (`EcranDepotFactureFournisseur`) : une facture encore `deposee`/`rapprochee` reste
 * décidable depuis ici (le magasinier n'a pas besoin de tout refaire s'il quitte l'écran de dépôt
 * avant de décider), une facture `validee`/`rejetee` (TERMINAL, `@dfa/shared`) s'affiche en lecture
 * seule.
 */
export function EcranFactureFournisseur() {
  const { t } = useTranslation(['pieces', 'commun']);
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const actions = session.data?.actions;
  const peutLire = peutLireFactureFournisseur(actions);

  // Gardé par le droit AVANT de partir — même correctif que `EcranFicheCommandeFournisseur`
  // (`peutLireCommandeFournisseur` posé avant le hook, jamais laissé partir puis rattrapé par un
  // `403` générique).
  const requeteFacture = useFactureFournisseur(session.isLoading || !peutLire ? undefined : id);
  const valider = useValiderRapprochementFactureFournisseur(id ?? '');
  const rejeter = useRejeterFactureFournisseur(id ?? '');

  if (session.isLoading) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (!peutLire) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <p className="text-muted-foreground">
          {t('pieces:facturesFournisseur.droitRequis.lecture')}
        </p>
      </GabaritEcran>
    );
  }

  if (requeteFacture.isPending) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requeteFacture.isError || !requeteFacture.data) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatErreur
          titre={t('pieces:facturesFournisseur.erreur.titre')}
          description={messageErreur(requeteFacture.error, t)}
          onReessayer={() => void requeteFacture.refetch()}
        />
      </GabaritEcran>
    );
  }

  const facture = requeteFacture.data;

  // Fil d'Ariane contextuel (même doctrine que `EnTeteFicheArticle`, Lot C) — un seul ancêtre
  // honnête : la liste des factures fournisseur dont cette fiche vient. Ressource par TENANT
  // (pas de `?site=`, voir `chemins.pieces.facturesFournisseur`).
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    {
      cle: 'facturesFournisseur',
      libelle: t('pieces:facturesFournisseur.titre'),
      href: chemins.pieces.facturesFournisseur.liste(),
    },
  ];

  return (
    <GabaritEcran
      titre={t('pieces:facturesFournisseur.titre')}
      sousTitre={facture.numeroFacture ?? t('pieces:facturesFournisseur.sansNumero')}
    >
      <FilAriane
        segments={segmentsFilAriane}
        pageCourante={facture.numeroFacture ?? t('pieces:facturesFournisseur.sansNumero')}
      />

      <PanneauRapprochementFacture
        facture={facture}
        peutDecider={peutDeciderFactureFournisseur(actions)}
        validationEnCours={valider.isPending}
        rejetEnCours={rejeter.isPending}
        erreurValidation={valider.error}
        erreurRejet={rejeter.error}
        onValider={() => valider.mutate()}
        onRejeter={(motif) => rejeter.mutate({ motif })}
      />
    </GabaritEcran>
  );
}
