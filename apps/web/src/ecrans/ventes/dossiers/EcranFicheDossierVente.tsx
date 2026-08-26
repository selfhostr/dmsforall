import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { CarteFinancement } from '@/ecrans/ventes/financements/CarteFinancement';
import { peutLireFinancement } from '@/ecrans/ventes/financements/droits';
import { CarteReprise } from '@/ecrans/ventes/reprises/CarteReprise';
import { peutLireOrdresReparation } from '@/ecrans/vehicules/droits';
import { useDoitReessayer } from '@/hooks/pagination-curseur';
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
  const session = useSession();
  const role = session.data?.utilisateur.role;
  const vehiculeId = requete.data?.vehicule?.id;

  // DÉFAUT CORRIGÉ (issue #162, 16.08.2026) : un rôle sans `atelier.or.lire` (ex. `vendeur`)
  // laissait ce bloc « OR de ce véhicule » en squelette de chargement indéfiniment — la requête
  // partait sans garde de droits ni politique de réessai, un 403 stable jamais transformé en état
  // affichable. Même doctrine que `EcranFicheVehicule.tsx` (`peutVoirOrdresReparation`) :
  // `peutLireOrdresReparation` DUPLIQUÉE dans `ecrans/vehicules/droits.ts` (matrice serveur), gate
  // via `enabled`, les trois états — chargement de la session, droit manquant, résultat — restent
  // chacun DISTINCTS.
  const peutVoirOrdresReparation = peutLireOrdresReparation(role);
  const reessayerOr = useDoitReessayer();

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
    enabled: vehiculeId !== undefined && peutVoirOrdresReparation,
    retry: reessayerOr,
  });

  if (requete.isPending) {
    return (
      <GabaritEcran titre={t('ventes:dossier.fiche.titre')}>
        <EtatChargement lignes={8} />
      </GabaritEcran>
    );
  }

  if (requete.isError) {
    return (
      <GabaritEcran titre={t('ventes:dossier.fiche.titre')}>
        <EtatErreur
          titre={t('ventes:dossier.fiche.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </GabaritEcran>
    );
  }

  const dossier = requete.data;
  const peutModifier = dossier.actionsDisponibles.includes('modifier');

  // Onglets « Financement » / « Garantie » (chantier « mise en page ventes », 19.08.2026 — « le
  // même menu que dans Clients ») — MÊME motif que `EcranFicheClient.tsx` (`Tabs`/`TabsList`/
  // `TabsTrigger`/`TabsContent` de `components/ui/tabs.tsx`, jamais `OngletsDomaine` : ce ne sont
  // pas des routes, exactement la même distinction que documentée en tête de ce fichier partagé),
  // remplace l'empilement vertical des deux cartes qui réservait chacune sa pleine largeur l'une
  // sous l'autre. Visibilité calculée AVANT le rendu plutôt que déléguée aux deux cartes (qui
  // continuent, elles, de s'auto-garder — `CarteFinancement` retourne `null` sans droit,
  // `CarteGarantieDossier` exige un `vehiculeStockId`) : c'est ce qui permet de choisir ENTRE
  // « les deux onglets » et « une seule carte, pas d'onglet à un seul choix » — un onglet unique
  // n'offre aucun choix, même doctrine que `OngletsDomaine` (« un onglet unique ne rend rien »).
  const afficheFinancement = peutLireFinancement(role);
  const afficheGarantie = vehiculeId !== undefined;

  // Titre VISIBLE — « Dossier de vente » (`ventes:dossier.fiche.titre`) ne fait AUCUNE inclusion
  // (au sens §3 du contrat du chantier « titres doublés », 17.08.2026) avec l'onglet actif
  // « Dossiers » : contre-exemple mesuré du contrat (« les titres de FICHE... doivent rester
  // VISIBLES »), même famille que « Nouvelle commande fournisseur » dans sa table. `GabaritEcran`
  // le laisse donc visible SANS qu'on pose `titreVisible` — la détection automatique fait le
  // travail, poser la prop ici serait justement ce que le contrat interdit (§5.2).
  return (
    <GabaritEcran
      titre={t('ventes:dossier.fiche.titre')}
      actions={
        peutModifier ? (
          <Button variant="outline" onClick={() => setModificationOuverte(true)}>
            {t('commun:actions.modifier')}
          </Button>
        ) : undefined
      }
    >
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

      {afficheFinancement && afficheGarantie ? (
        <Tabs defaultValue="financement">
          <TabsList>
            <TabsTrigger value="financement">{t('ventes:financement.titre')}</TabsTrigger>
            <TabsTrigger value="garantie">{t('ventes:dossier.fiche.garantie.titre')}</TabsTrigger>
          </TabsList>
          <TabsContent value="financement" className="pt-4">
            <CarteFinancement
              dossierVenteId={dossier.id}
              financement={dossier.financement ?? null}
              financements={dossier.financements ?? []}
              financementsTronques={dossier.financementsTronques ?? false}
              statutDossierVente={dossier.statut}
              role={role}
              onMutationReussie={() => void requete.refetch()}
            />
          </TabsContent>
          {/* Jamais rendu sans véhicule associé (`afficheGarantie`, calculé plus haut) —
           *  `dossier.garantie` vaudrait de toute façon `null` dans ce cas, voir le contrat. */}
          <TabsContent value="garantie" className="pt-4">
            <CarteGarantieDossier
              garantie={dossier.garantie}
              vehiculeStockId={vehiculeId as string}
              site={site}
            />
          </TabsContent>
        </Tabs>
      ) : afficheFinancement ? (
        <CarteFinancement
          dossierVenteId={dossier.id}
          financement={dossier.financement ?? null}
          financements={dossier.financements ?? []}
          financementsTronques={dossier.financementsTronques ?? false}
          statutDossierVente={dossier.statut}
          role={role}
          onMutationReussie={() => void requete.refetch()}
        />
      ) : afficheGarantie ? (
        <CarteGarantieDossier
          garantie={dossier.garantie}
          vehiculeStockId={vehiculeId as string}
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
            {session.isLoading ? (
              <EtatChargement lignes={2} />
            ) : !peutVoirOrdresReparation ? (
              <p className="texte-corps text-muted-foreground">
                {t('ventes:dossier.fiche.ordresVehicule.droitRequis')}
              </p>
            ) : requeteOr.isPending ? (
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
                      className="rounded-sm text-left texte-corps text-primary underline-offset-4 hover:underline anneau-focus"
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
    </GabaritEcran>
  );
}
