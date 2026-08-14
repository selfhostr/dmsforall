import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { CarteFinancement } from '@/ecrans/ventes/financements/CarteFinancement';
import { CarteReprise } from '@/ecrans/ventes/reprises/CarteReprise';
import { useSession } from '@/hooks/useSession';
import { useDossierVente } from '@/hooks/ventes/dossiers/useDossierVente';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { CarteDocumentsRequis } from './CarteDocumentsRequis';
import { CarteDocumentsVente } from './CarteDocumentsVente';
import { CarteGarantieDossier } from './CarteGarantieDossier';
import { DialogueModifierDossierVente } from './DialogueModifierDossierVente';
import { EnTeteDossierVente } from './EnTeteDossierVente';
import { PanneauActionsDossierVente } from './PanneauActionsDossierVente';

/**
 * Fiche dossier de vente (design §7) — le cœur du module. Une seule requête PRIMAIRE bloque
 * l'écran entier (`GET /dossiers-vente/{id}`, déjà le document COMPLET : reprise, financement
 * courant + historique, documents, documents requis — même doctrine que `GET /ordres-reparation/{id}`,
 * D-10), pas d'agrégation d'écran a posteriori.
 *
 * `dossier.actionsDisponibles` gouverne à la fois `PanneauActionsDossierVente` (transitions) ET
 * la disponibilité du geste `modifier` (PATCH) — `'modifier'` est un membre littéral de
 * `ACTIONS_DOSSIER_VENTE` (voir la note de `enums.ts`) et déjà calculé côté serveur en tenant
 * compte du rôle courant (`calculerActionsDisponiblesDossierVente(statut, role)`,
 * `apps/api/src/ventes/mappers.ts`) : ce composant lit ce signal directement plutôt que de
 * dupliquer une seconde matrice de droits pour ce seul geste (contrairement aux transitions
 * exposées par `PanneauActionsDossierVente`, qui ont chacune leur propre droit `ventes.dossier.*`
 * mais suivent la même logique serveur).
 *
 * `CarteReprise`/`CarteFinancement` (branchées ici, pas leurs anciennes variantes
 * `CarteRepriseResume`/`CarteFinancementResume` en lecture seule — supprimées, plus aucun
 * appelant) portent elles-mêmes le masquage par rôle (`peutLireReprise`/`peutLireFinancement`,
 * chacune dans son propre `droits.ts` sous `ecrans/ventes/{reprises,financements}/`) : un rôle
 * sans droit de lecture ne voit STRICTEMENT RIEN de la section, pas une carte vide ni un bouton
 * grisé. `onMutationReussie` recharge la requête PRIMAIRE de cette fiche (`requete.refetch()`) —
 * seule source de vérité de `dossier.reprise`/`dossier.financement` embarqués ; ni `CarteReprise`
 * ni `CarteFinancement` n'écrivent dans ce cache dossier elles-mêmes (voir l'en-tête de
 * `hooks/ventes/reprises/useCreerReprise.ts`).
 */
export function EcranFicheDossierVente() {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const [modificationOuverte, setModificationOuverte] = useState(false);

  const requete = useDossierVente(id);
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const vehiculeId = requete.data?.vehicule?.id;

  // Lot B — « l'OR de préparation ». SIGNALÉ : `ReponseDossierVente` (contrat gelé,
  // `packages/shared/src/contrats/ventes/dossier-vente.ts`) ne porte AUCUN champ reliant un OR
  // précis à ce dossier (pas d'`ordrePreparationId`, vérifié dans le contrat) — un OR de
  // « préparation vente » n'existe pas comme concept distinct côté serveur aujourd'hui. Ce bloc
  // liste donc, pragmatiquement, TOUS les OR du véhicule assigné (même architecture que la fiche
  // véhicule : « le même enregistrement étendu », voir ARCHITECTURE.md) plutôt que d'inventer un
  // filtre qui n'existe pas. Même contournement transport que `EnTeteOrdreReparation.tsx`/
  // `EcranFicheVehicule.tsx` : `listerOrdresReparation` (hors périmètre) ne sérialise pas
  // `vehiculeId`.
  const requeteOr = useQuery({
    queryKey: ['dossier-vente-ordres-reparation', vehiculeId],
    queryFn: async () => {
      const parametres = new URLSearchParams({
        vehiculeId: vehiculeId as string,
        tri: 'ouvertLe:desc',
        limite: '10',
      });
      const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
        `/ordres-reparation?${parametres.toString()}`,
        { method: 'GET' },
      );
      return page?.donnees ?? [];
    },
    enabled: vehiculeId !== undefined,
  });

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.fiche.titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('ventes:dossier.fiche.titre')}</h1>
        <EtatErreur
          titre={t('ventes:dossier.fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const dossier = requete.data;
  const peutModifier = dossier.actionsDisponibles.includes('modifier');

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="texte-titre-section font-semibold text-foreground">
          {t('ventes:dossier.fiche.titre')}
        </h1>
        {peutModifier ? (
          <Button variant="outline" onClick={() => setModificationOuverte(true)}>
            {t('commun:actions.modifier')}
          </Button>
        ) : null}
      </div>

      <EnTeteDossierVente
        dossier={dossier}
        peutAssignerVehicule={peutModifier && dossier.statut === 'prospection'}
        onAssignerVehicule={() => setModificationOuverte(true)}
      />

      <PanneauActionsDossierVente dossier={dossier} />

      <CarteReprise
        dossierVenteId={dossier.id}
        possedeReprise={dossier.reprise !== null}
        role={role}
        onMutationReussie={() => void requete.refetch()}
      />

      <CarteFinancement
        dossierVenteId={dossier.id}
        financement={dossier.financement ?? null}
        financements={dossier.financements ?? []}
        financementsTronques={dossier.financementsTronques ?? false}
        statutDossierVente={dossier.statut}
        role={role}
        onMutationReussie={() => void requete.refetch()}
      />

      {/* Jamais rendue sans véhicule associé (`dossier.garantie` vaudrait de toute façon `null`
       *  dans ce cas, voir le contrat) — même garde que la carte « OR du véhicule » ci-dessous. */}
      {dossier.vehicule ? (
        <CarteGarantieDossier
          garantie={dossier.garantie}
          vehiculeStockId={dossier.vehicule.id}
          site={site}
        />
      ) : null}

      {/* Lot B — « l'OR de préparation ». Voir le commentaire de tête de `requeteOr` ci-dessus :
       *  faute de champ contractuel reliant un OR précis à ce dossier, ce bloc liste tous les OR
       *  du véhicule assigné plutôt que d'en désigner un seul à tort. N'apparaît pas du tout tant
       *  qu'aucun véhicule n'est assigné (`vehiculeId === undefined`, cas normal en `prospection`).*/}
      {vehiculeId !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('ventes:dossier.fiche.ordresVehicule.titre')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {requeteOr.isPending ? (
              <EtatChargement lignes={2} />
            ) : requeteOr.isError ? (
              <EtatErreur
                titre={t('ventes:dossier.fiche.erreur.titre')}
                description={messageErreur(requeteOr.error, t)}
                onReessayer={() => void requeteOr.refetch()}
              />
            ) : (requeteOr.data?.length ?? 0) === 0 ? (
              <EtatVide
                titre={t('ventes:dossier.fiche.ordresVehicule.titre')}
                description={t('ventes:dossier.fiche.ordresVehicule.vide')}
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {(requeteOr.data ?? []).map((or) => (
                  <li key={or.id} className="flex items-center justify-between gap-3 py-2">
                    <button
                      type="button"
                      className="text-left texte-corps text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => navigate(chemins.atelier.ordresReparation.detail(or.id, site))}
                    >
                      {or.numero}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="texte-libelle text-muted-foreground">
                        {or.ouvertLe ? formaterDate(or.ouvertLe) : ''}
                      </span>
                      <BadgeStatutOr etat={or.etatAffiche} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <CarteDocumentsVente
        documents={dossier.documents}
        documentsTronques={dossier.documentsTronques}
      />

      <CarteDocumentsRequis
        dossierVenteId={dossier.id}
        documentsRequis={dossier.documentsRequis}
        peutModifier={peutModifier}
      />

      {peutModifier ? (
        <DialogueModifierDossierVente
          dossier={dossier}
          ouvert={modificationOuverte}
          onOuvertChange={setModificationOuverte}
        />
      ) : null}
    </div>
  );
}
