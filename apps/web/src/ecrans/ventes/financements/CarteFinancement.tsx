import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FinancementResume, RoleUtilisateur, StatutDossierVente } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatVide } from '@/composants/commun/EtatVide';

import { BadgeStatutFinancement } from './BadgeStatutFinancement';
import { DialogueCreationFinancement } from './DialogueCreationFinancement';
import { peutCreerFinancement, peutLireFinancement } from './droits';
import { PanneauActionsFinancement } from './PanneauActionsFinancement';

/** `STATUTS_DOSSIER_VENTE` terminaux (`contrats/ventes/enums.ts`, gelé) — un dossier clos/annulé/
 *  abandonné n'attend plus de financement. Dupliqué ici en littéral plutôt qu'importé en valeur :
 *  seule cette sous-liste compte pour ce composant (même doctrine que `TriClients` côté clients). */
const STATUTS_DOSSIER_TERMINAUX: ReadonlySet<StatutDossierVente> = new Set([
  'clos',
  'annule',
  'abandonne',
]);

interface Props {
  readonly dossierVenteId: string;
  /** Le financement COURANT (`ReponseDossierVente.financement`) — `null` uniquement en
   *  `prospection` avant toute proposition (RV-32/RV-33). */
  readonly financement: FinancementResume | null;
  /** Historique complet (`ReponseDossierVente.financements`), append-only (CV-03). */
  readonly financements: readonly FinancementResume[];
  readonly financementsTronques: boolean;
  readonly statutDossierVente: StatutDossierVente;
  readonly role: RoleUtilisateur | undefined;
  /** Appelé après toute mutation réussie (création/confirmation/refus) — AUCUN cache propre à ce
   *  module (pas de `GET` dédié, voir `hooks/ventes/financements/financement.api.ts`) : c'est
   *  l'intégrateur (fiche dossier) qui doit invalider/recharger sa requête dossier ici. */
  readonly onMutationReussie?: () => void;
}

/**
 * Carte financement (§9 du design) — panneau INTÉGRABLE dans la fiche dossier de vente, PAS un
 * écran routé séparément. Collection embarquée, jamais paginée séparément (`financements`,
 * borné à `SEUIL_FINANCEMENTS_EMBARQUES = 20`).
 *
 * ÉCART SIGNALÉ (contrat `contrats/ventes/financement.ts`) : `FinancementResume` (la forme
 * embarquée dans `financements`/`financement`) ne porte NI dates (`creeLe`/`confirmeLe`/
 * `refuseLe`) NI `motifRefus` — seuls `type`/`organisme`/`statutConfirmation`. Le design (§9.2)
 * demande d'afficher ces dates et ce motif dans l'historique ; ce module ne peut donc les montrer
 * QUE pour le financement qui vient d'être créé/confirmé/refusé DANS CETTE SESSION (le
 * `ReponseFinancement` complet renvoyé par la mutation), jamais pour une entrée relue depuis
 * `ReponseDossierVente` après un rechargement — signalé au propriétaire du contrat, pas comblé
 * par un type maison.
 */
export function CarteFinancement({
  dossierVenteId,
  financement,
  financements,
  financementsTronques,
  statutDossierVente,
  role,
  onMutationReussie,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [dernierMotifRefus, setDernierMotifRefus] = useState<{
    readonly financementId: string;
    readonly motif: string;
  } | null>(null);

  if (!peutLireFinancement(role)) {
    return null;
  }

  const dossierTerminal = STATUTS_DOSSIER_TERMINAUX.has(statutDossierVente);
  const peutProposer = !dossierTerminal && peutCreerFinancement(role);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('ventes:financement.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {financements.length === 0 ? (
          <EtatVide
            titre={t('ventes:financement.titre')}
            description={t('ventes:financement.historique.vide')}
            action={
              peutProposer ? (
                <Button type="button" onClick={() => setCreationOuverte(true)}>
                  {t('ventes:commun.actions.proposerFinancement')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {financement ? (
              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t('ventes:commun.actuel')}</Badge>
                  <span className="texte-corps font-medium">
                    {t(`ventes:financement.types.${financement.type}`)}
                  </span>
                  <BadgeStatutFinancement statut={financement.statutConfirmation} />
                </div>
                {financement.organisme ? (
                  // `FinancementResume.organisme` n'est qu'un `Pick<ClientResume, 'id' |
                  // 'nomAffiche'>` (pas un `ClientResume` complet) — `IdentiteClient` exigerait
                  // `statut`/`numeroClient` réels, qu'on ne possède pas ici : nom simple, jamais
                  // de valeurs devinées (`statut: 'actif'` en dur serait un mensonge d'affichage).
                  <p className="mt-2 texte-corps text-muted-foreground">
                    {financement.organisme.nomAffiche}
                  </p>
                ) : null}
                {dernierMotifRefus?.financementId === financement.id ? (
                  <p className="mt-2 texte-corps text-muted-foreground">
                    {t('ventes:financement.motifRefus', {
                      motif: dernierMotifRefus.motif,
                    })}
                  </p>
                ) : null}
                <div className="mt-3">
                  <PanneauActionsFinancement
                    dossierVenteId={dossierVenteId}
                    financement={financement}
                    role={role}
                    onMutationReussie={onMutationReussie}
                    onSucces={(reponse) => {
                      if (reponse.statutConfirmation === 'refuse' && reponse.motifRefus) {
                        setDernierMotifRefus({
                          financementId: reponse.id,
                          motif: reponse.motifRefus,
                        });
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}

            {financements.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="texte-libelle text-muted-foreground">
                  {t('ventes:financement.historique.titre')}
                </p>
                <ul className="flex flex-col gap-2">
                  {financements.map((entree) => (
                    <li
                      key={entree.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-2 texte-corps"
                    >
                      <span>{t(`ventes:financement.types.${entree.type}`)}</span>
                      {entree.organisme ? (
                        <span className="text-muted-foreground">{entree.organisme.nomAffiche}</span>
                      ) : null}
                      <BadgeStatutFinancement statut={entree.statutConfirmation} />
                      {entree.id === financement?.id ? (
                        <Badge variant="secondary">{t('ventes:commun.actuel')}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {financementsTronques ? (
                  <p className="texte-libelle text-muted-foreground">
                    {t('ventes:financement.tronque')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {peutProposer ? (
              <div>
                <Button type="button" variant="outline" onClick={() => setCreationOuverte(true)}>
                  {t('ventes:commun.actions.proposerFinancement')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>

      <DialogueCreationFinancement
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
