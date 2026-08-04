import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useReprise } from '@/hooks/ventes/reprises/useReprise';
import { formaterMontant } from '@/lib/formats';

import { BadgeStatutReprise } from './BadgeStatutReprise';
import { DialogueCreationReprise } from './DialogueCreationReprise';
import { DialogueModifierReprise } from './DialogueModifierReprise';
import { peutEcrireReprise, peutLireReprise } from './droits';
import { NomOrganismeDette } from './NomOrganismeDette';
import { PanneauActionsReprise } from './PanneauActionsReprise';

interface Props {
  readonly dossierVenteId: string;
  /** `dossier.reprise !== null` (`RepriseResume`, embarqué dans `ReponseDossierVente`) — déjà
   *  connu de l'appelant (fiche dossier), voir l'en-tête de `hooks/ventes/reprises/useReprise.ts`. */
  readonly possedeReprise: boolean;
  readonly role: RoleUtilisateur | undefined;
  /** Appelé après toute mutation réussie (création/modification/négociation/confirmation/refus) —
   *  à passer par l'intégrateur pour invalider/recharger sa propre requête dossier, dont
   *  `dossier.reprise` (embarqué, `RepriseResume`) reste sinon périmé. */
  readonly onMutationReussie?: () => void;
}

/**
 * Carte reprise (§8 du design) — panneau INTÉGRABLE dans la fiche dossier de vente, PAS un écran
 * routé séparément (0 ou 1 reprise par dossier, sous-ressource singulière). Exporté pour être posé
 * directement dans `ecrans/ventes/dossiers/EcranFicheDossierVente.tsx` (hors périmètre de cet
 * agent) au même titre que `PanneauStockArticle` l'est dans `EcranFicheArticle`.
 *
 * §11 point 1 du design (« deux valeurs toujours rendues ensemble ») : `valeurEstimeeCentimes` et
 * `valeurNegocieeCentimes` s'affichent CÔTE À CÔTE, jamais l'une sans l'autre. Aucune base TVA,
 * aucun montant de TVA lié à l'écart n'apparaît nulle part ici (§8.3, QV-05 non tranché).
 */
export function CarteReprise({ dossierVenteId, possedeReprise, role, onMutationReussie }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [modificationOuverte, setModificationOuverte] = useState(false);

  const requete = useReprise(dossierVenteId, possedeReprise);
  const peutEcrire = peutEcrireReprise(role);

  if (!peutLireReprise(role)) {
    return null;
  }

  if (!possedeReprise) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('ventes:reprise.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatVide
            titre={t('ventes:reprise.absente.titre')}
            description={t('ventes:reprise.creation.description')}
            action={
              peutEcrire ? (
                <Button type="button" onClick={() => setCreationOuverte(true)}>
                  {t('ventes:commun.actions.ajouterReprise')}
                </Button>
              ) : undefined
            }
          />
        </CardContent>

        <DialogueCreationReprise
          dossierVenteId={dossierVenteId}
          ouvert={creationOuverte}
          onOuvertChange={setCreationOuverte}
          onCree={() => {
            setCreationOuverte(false);
            onMutationReussie?.();
          }}
        />
      </Card>
    );
  }

  if (requete.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('ventes:reprise.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatChargement lignes={4} />
        </CardContent>
      </Card>
    );
  }

  if (requete.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('ventes:reprise.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EtatErreur
            titre={t('ventes:reprise.erreur.titre')}
            description={messageErreur(requete.error, t)}
            onReessayer={() => void requete.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const reprise = requete.data;
  const ecart = reprise.ecartRepriseVehiculeCentimes;
  const ecartTexte = ecart === null ? null : `${ecart > 0 ? '+' : ''}${formaterMontant(ecart)}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="texte-titre-section">{t('ventes:reprise.titre')}</CardTitle>
        <BadgeStatutReprise statut={reprise.statut} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Link to={`/vehicules/${reprise.vehiculeRepris.id}`}>
          <IdentiteVehicule vehicule={reprise.vehiculeRepris} />
        </Link>

        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:reprise.champs.valeurNegociee')}
            </p>
            <p className="texte-donnee-proeminente">
              {reprise.valeurNegocieeCentimes === null
                ? t('ventes:reprise.champs.enNegociation')
                : formaterMontant(reprise.valeurNegocieeCentimes)}
            </p>
          </div>
          <div>
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:reprise.champs.valeurEstimee')}
            </p>
            <p className="texte-corps text-muted-foreground">
              {formaterMontant(reprise.valeurEstimeeCentimes)}
            </p>
          </div>
          {ecartTexte !== null ? (
            <div>
              <p className="texte-libelle text-muted-foreground">
                {t('ventes:reprise.champs.ecart')}
              </p>
              <Badge variant="outline" className="tabular-nums">
                {ecartTexte}
              </Badge>
            </div>
          ) : null}
        </div>

        {reprise.detteFinancementResiduelleCentimes !== null ? (
          <div className="rounded-md border border-dashed p-3">
            <p className="texte-corps">
              {t('ventes:reprise.champs.detteResiduelle')}
              {': '}
              {formaterMontant(reprise.detteFinancementResiduelleCentimes)}
              {reprise.detteFinancementOrganismeId ? (
                <>
                  {' — '}
                  <NomOrganismeDette clientId={reprise.detteFinancementOrganismeId} />
                </>
              ) : reprise.detteFinancementOrganismeNom ? (
                <> — {reprise.detteFinancementOrganismeNom}</>
              ) : null}
            </p>
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:reprise.champs.detteAide')}
            </p>
          </div>
        ) : null}

        {reprise.statut === 'refusee' && reprise.motifRefus ? (
          <p className="texte-corps text-muted-foreground">
            {t('ventes:reprise.motifRefus', { motif: reprise.motifRefus })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {reprise.statut === 'estimee' && peutEcrire ? (
            <Button type="button" variant="outline" onClick={() => setModificationOuverte(true)}>
              {t('ventes:reprise.actions.modifier')}
            </Button>
          ) : null}
          <PanneauActionsReprise
            dossierVenteId={dossierVenteId}
            reprise={reprise}
            role={role}
            onModifier={() => setModificationOuverte(true)}
            onMutationReussie={onMutationReussie}
          />
        </div>
      </CardContent>

      <DialogueModifierReprise
        dossierVenteId={dossierVenteId}
        reprise={reprise}
        ouvert={modificationOuverte}
        onOuvertChange={setModificationOuverte}
        onMutationReussie={onMutationReussie}
      />
    </Card>
  );
}
