import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  ACTIVITES_INDIRECTES,
  type ActiviteIndirecte,
  type EntreeDemarragePointage,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useOrdreReparation } from '@/hooks/atelier/useOrdreReparation';
import { compterLignesAssigneesPointables } from '@/hooks/pointage/lignes-assignees';
import { useArreterPointage } from '@/hooks/pointage/useArreterPointage';
import { useDemarrerPointage } from '@/hooks/pointage/useDemarrerPointage';
import { useMesOrdresAssignes } from '@/hooks/pointage/useMesOrdresAssignes';
import { usePointageOuvertTechnicien } from '@/hooks/pointage/usePointageOuvertTechnicien';
import { useSession } from '@/hooks/useSession';
import { genererUuid } from '@/lib/uuid';

import { CartePointageEnCours } from './CartePointageEnCours';
import { DialogueChoixCiblePointage } from './DialogueChoixCiblePointage';
import { peutDemarrerPointage } from './droits';
import { libelleActiviteIndirecte, libelleCiblePointageTechnicien } from './libelles';
import { SelecteurSitePointage } from './SelecteurSitePointage';

/** Cible productive mémorisée pour permettre une « reprise » directe après une pause (RM-116 : la
 *  pause est un arrêt + un nouveau départ ordinaire sur l'activité `pause`, PAS un troisième état —
 *  ce module retrouve la cible d'origine en la gardant côté client, le temps de l'onglet ouvert).
 *  Perdue au rechargement de la page : après un F5 pendant une pause, « Reprendre » n'est plus
 *  proposé et le technicien repasse par « Mes OR du jour », dégradation honnête plutôt qu'un état
 *  reconstruit à tort. */
type CibleMemorisee =
  | {
      readonly type: 'ligne';
      readonly ordreReparationId: string;
      readonly ligneOrId: string;
      readonly siteId: string;
      readonly libelle: string;
    }
  | {
      readonly type: 'or';
      readonly ordreReparationId: string;
      readonly siteId: string;
      readonly libelle: string;
    };

function construireEntreeDemarrage(
  base: { readonly technicienId: string; readonly debutLe: string },
  cible:
    | {
        readonly nature: 'productif_ligne';
        readonly ordreReparationId: string;
        readonly ligneOrId: string;
        readonly siteId: string;
      }
    | {
        readonly nature: 'productif_or';
        readonly ordreReparationId: string;
        readonly siteId: string;
      }
    | {
        readonly nature: 'indirect';
        readonly activiteIndirecte: ActiviteIndirecte;
        readonly siteId: string;
      },
): EntreeDemarragePointage {
  const id = genererUuid();
  if (cible.nature === 'productif_ligne') {
    return {
      id,
      siteId: cible.siteId,
      technicienId: base.technicienId,
      debutLe: base.debutLe,
      source: 'ecran_atelier',
      nature: 'productif_ligne',
      ordreReparationId: cible.ordreReparationId,
      ligneOrId: cible.ligneOrId,
    };
  }
  if (cible.nature === 'productif_or') {
    return {
      id,
      siteId: cible.siteId,
      technicienId: base.technicienId,
      debutLe: base.debutLe,
      source: 'ecran_atelier',
      nature: 'productif_or',
      ordreReparationId: cible.ordreReparationId,
    };
  }
  return {
    id,
    siteId: cible.siteId,
    technicienId: base.technicienId,
    debutLe: base.debutLe,
    source: 'ecran_atelier',
    nature: 'indirect',
    activiteIndirecte: cible.activiteIndirecte,
  };
}

/**
 * Écran de pointage du technicien — le plus important du module (voir le brief de livraison) :
 * voir ses OR du jour, démarrer/mettre en pause/reprendre/arrêter un pointage, chrono qui défile.
 * Pensé tablette d'atelier : peu de texte, cibles tactiles généreuses, un seul état affiché à la
 * fois (soit « en train de pointer », soit « à choisir quoi pointer », jamais les deux mélangés).
 *
 * `technicienId` = l'utilisateur SESSION courant, jamais un paramètre de route ni de requête :
 * chaque technicien pointe pour lui-même (voir l'en-tête de `pointage.api.ts` — le PIN décrit par
 * le contrat n'est PAS implémenté côté serveur à ce jour, ce module s'appuie donc entièrement sur
 * la session applicative normale, même mécanisme que tout autre écran protégé).
 */
export function EcranPointageTechnicien() {
  const { t } = useTranslation(['pointage', 'commun']);
  const { data: session } = useSession();
  const technicien = session?.utilisateur;
  const role = technicien?.role;

  const [searchParams, setSearchParams] = useSearchParams();
  const siteParam = searchParams.get('site') ?? undefined;
  const sitesActifs = (session?.sites ?? []).filter((site) => site.actif);
  const siteId = siteParam ?? (sitesActifs.length === 1 ? sitesActifs[0]?.id : undefined);

  const [orSelectionneId, setOrSelectionneId] = useState<string | undefined>(undefined);
  const [dernierCible, setDernierCible] = useState<CibleMemorisee | undefined>(undefined);
  const [erreurAction, setErreurAction] = useState<string | undefined>(undefined);
  const [enChainage, setEnChainage] = useState(false);

  const pointageOuvert = usePointageOuvertTechnicien(technicien?.id);
  const mesOrdres = useMesOrdresAssignes(technicien?.id);
  const requeteOrSelectionne = useOrdreReparation(orSelectionneId);
  // Défaut 2 (repli après F5) : le document OR de la cible du pointage OUVERT, dérivé du
  // `ordreReparationId` renvoyé par l'API elle-même (`pointageOuvert.data`), jamais de la mémoire
  // locale `dernierCible` — voir `libelleCiblePointageTechnicien` (`./libelles.ts`) pour le détail.
  // `undefined` désactive la requête (activité indirecte, ou pointage pas encore chargé).
  const requeteOrPointageActuel = useOrdreReparation(
    pointageOuvert.data?.ordreReparationId ?? undefined,
  );

  const demarrer = useDemarrerPointage();
  const arreter = useArreterPointage();

  if (!technicien) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('pointage:technicien.titreEcran')}</h1>
        <EtatChargement lignes={4} />
      </div>
    );
  }

  // Capturé en `const` APRÈS la garde ci-dessus : TypeScript ne propage pas le rétrécissement de
  // `technicien` (non-`undefined`) dans les fonctions imbriquées définies plus bas (`function foo()
  // {…}`), même si `technicien` lui-même n'est jamais réassigné — une simple limitation du contrôle
  // de flux du compilateur sur les frontières de fonction, pas une incertitude réelle à l'exécution.
  const technicienId = technicien.id;

  async function demarrerEtMemoriser(
    cible:
      | {
          readonly nature: 'productif_ligne';
          readonly ordreReparationId: string;
          readonly ligneOrId: string;
          readonly siteId: string;
          readonly libelle: string;
        }
      | {
          readonly nature: 'productif_or';
          readonly ordreReparationId: string;
          readonly siteId: string;
          readonly libelle: string;
        }
      | {
          readonly nature: 'indirect';
          readonly activiteIndirecte: ActiviteIndirecte;
          readonly siteId: string;
        },
  ) {
    setErreurAction(undefined);
    try {
      // `construireEntreeDemarrage` DOIT rester à l'intérieur de ce `try` : c'est une fonction
      // synchrone qui peut lever (ex. génération d'identifiant, voir `@/lib/uuid`), et rien ne
      // distingue à l'appel une erreur de construction d'une erreur réseau/API — les deux doivent
      // remonter à l'utilisateur via `setErreurAction`, jamais disparaître en promesse rejetée
      // non observée (les appelants invoquent cette fonction via `void demarrerEtMemoriser(...)`).
      const entree = construireEntreeDemarrage(
        { technicienId, debutLe: new Date().toISOString() },
        cible,
      );
      await demarrer.mutateAsync({ entree, idempotencyKey: genererCleIdempotence() });
      if (cible.nature === 'productif_ligne') {
        setDernierCible({
          type: 'ligne',
          ordreReparationId: cible.ordreReparationId,
          ligneOrId: cible.ligneOrId,
          siteId: cible.siteId,
          libelle: cible.libelle,
        });
      } else if (cible.nature === 'productif_or') {
        setDernierCible({
          type: 'or',
          ordreReparationId: cible.ordreReparationId,
          siteId: cible.siteId,
          libelle: cible.libelle,
        });
      }
      // Une activité indirecte (y compris la pause) ne remplace JAMAIS `dernierCible` : c'est
      // exactement la mémoire qui permet à « Reprendre » de retrouver la cible productive
      // d'avant la pause.
    } catch (erreur) {
      setErreurAction(messageErreur(erreur, t));
      throw erreur;
    }
  }

  function handleChoisirLigne(or: ReponseOrdreReparation, ligne: ReponseLigneOr) {
    setOrSelectionneId(undefined);
    void demarrerEtMemoriser({
      nature: 'productif_ligne',
      ordreReparationId: or.id,
      ligneOrId: ligne.id,
      siteId: or.siteId,
      libelle: t('pointage:technicien.cible.ligne', {
        numero: or.numero,
        designation: ligne.designation,
      }),
    });
  }

  function handleChoisirOrEntier(or: ReponseOrdreReparation) {
    setOrSelectionneId(undefined);
    void demarrerEtMemoriser({
      nature: 'productif_or',
      ordreReparationId: or.id,
      siteId: or.siteId,
      libelle: t('pointage:technicien.cible.or', { numero: or.numero }),
    });
  }

  function handleDemarrerActiviteIndirecte(activite: ActiviteIndirecte) {
    if (!siteId) return;
    void demarrerEtMemoriser({ nature: 'indirect', activiteIndirecte: activite, siteId });
  }

  async function handleArreter() {
    if (!pointageOuvert.data) return;
    setErreurAction(undefined);
    const p = pointageOuvert.data;
    try {
      await arreter.mutateAsync({
        id: p.id,
        technicienId,
        siteId: p.siteId,
        entree: { finLe: new Date().toISOString() },
        idempotencyKey: genererCleIdempotence(),
      });
      setDernierCible(undefined);
    } catch (erreur) {
      setErreurAction(messageErreur(erreur, t));
    }
  }

  async function handlePause() {
    if (!pointageOuvert.data) return;
    setErreurAction(undefined);
    setEnChainage(true);
    const p = pointageOuvert.data;
    try {
      await arreter.mutateAsync({
        id: p.id,
        technicienId,
        siteId: p.siteId,
        entree: { finLe: new Date().toISOString() },
        idempotencyKey: genererCleIdempotence(),
      });
      await demarrerEtMemoriser({
        nature: 'indirect',
        activiteIndirecte: 'pause',
        siteId: p.siteId,
      });
    } catch (erreur) {
      setErreurAction(messageErreur(erreur, t));
    } finally {
      setEnChainage(false);
    }
  }

  async function handleReprendre() {
    if (!pointageOuvert.data || !dernierCible) return;
    setErreurAction(undefined);
    setEnChainage(true);
    const p = pointageOuvert.data;
    try {
      await arreter.mutateAsync({
        id: p.id,
        technicienId,
        siteId: p.siteId,
        entree: { finLe: new Date().toISOString() },
        idempotencyKey: genererCleIdempotence(),
      });
      if (dernierCible.type === 'ligne') {
        await demarrerEtMemoriser({
          nature: 'productif_ligne',
          ordreReparationId: dernierCible.ordreReparationId,
          ligneOrId: dernierCible.ligneOrId,
          siteId: dernierCible.siteId,
          libelle: dernierCible.libelle,
        });
      } else {
        await demarrerEtMemoriser({
          nature: 'productif_or',
          ordreReparationId: dernierCible.ordreReparationId,
          siteId: dernierCible.siteId,
          libelle: dernierCible.libelle,
        });
      }
    } catch (erreur) {
      setErreurAction(messageErreur(erreur, t));
    } finally {
      setEnChainage(false);
    }
  }

  const enTraitement = demarrer.isPending || arreter.isPending || enChainage;

  if (pointageOuvert.isPending || mesOrdres.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('pointage:technicien.titreEcran')}
        </h1>
        <EtatChargement lignes={5} />
      </div>
    );
  }

  if (pointageOuvert.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('pointage:technicien.titreEcran')}
        </h1>
        <EtatErreur
          titre={t('pointage:technicien.erreur.titre')}
          description={messageErreur(pointageOuvert.error, t)}
          onReessayer={() => void pointageOuvert.refetch()}
        />
      </div>
    );
  }

  const pointageActuel = pointageOuvert.data;

  // Libellé de la cible EN COURS : la mémoire (`dernierCible`) si elle correspond exactement au
  // pointage productif actuellement ouvert (le cas normal, démarré depuis CET écran — évite
  // d'attendre l'aller-retour réseau de `requeteOrPointageActuel` alors que l'écran connaît déjà
  // le numéro d'OR et la désignation de ligne) ; sinon dérivé de la RÉPONSE API du document OR
  // (`requeteOrPointageActuel`, voir sa déclaration plus haut) — jamais un état local qui ne
  // survivrait pas à un F5 (défaut 2 : avant ce correctif, un rechargement pendant un pointage en
  // cours perdait la cible et retombait sur le texte générique « OR (sans ligne précise) » alors
  // que le serveur la connaît parfaitement).
  let libelleCibleActuelle = pointageActuel
    ? libelleCiblePointageTechnicien(pointageActuel, requeteOrPointageActuel.data, t)
    : '';
  if (pointageActuel && dernierCible) {
    const memeCible =
      (dernierCible.type === 'ligne' &&
        pointageActuel.ordreReparationId === dernierCible.ordreReparationId &&
        pointageActuel.ligneOrId === dernierCible.ligneOrId) ||
      (dernierCible.type === 'or' &&
        pointageActuel.nature === 'productif_or' &&
        pointageActuel.ordreReparationId === dernierCible.ordreReparationId);
    if (memeCible) libelleCibleActuelle = dernierCible.libelle;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('pointage:technicien.titreEcran')}
      </h1>

      {pointageActuel ? (
        <CartePointageEnCours
          pointage={pointageActuel}
          libelleCible={libelleCibleActuelle}
          onArreter={() => void handleArreter()}
          onPause={
            pointageActuel.nature === 'productif_ligne' || pointageActuel.nature === 'productif_or'
              ? () => void handlePause()
              : undefined
          }
          onReprendre={
            pointageActuel.nature === 'indirect' &&
            pointageActuel.activiteIndirecte === 'pause' &&
            dernierCible
              ? () => void handleReprendre()
              : undefined
          }
          enTraitement={enTraitement}
          messageErreur={erreurAction}
        />
      ) : (
        <>
          {erreurAction ? (
            <EtatErreur titre={t('pointage:technicien.erreur.titre')} description={erreurAction} />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">
                {t('pointage:technicien.mesOrs.titre')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mesOrdres.isError ? (
                <EtatErreur
                  titre={t('pointage:technicien.erreur.titre')}
                  description={messageErreur(mesOrdres.error, t)}
                  onReessayer={() => void mesOrdres.refetch()}
                />
              ) : (mesOrdres.data ?? []).length === 0 ? (
                <EtatVide titre={t('pointage:vide.aucunOr')} description="" />
              ) : (
                <div className="flex flex-col gap-3">
                  {(mesOrdres.data ?? []).map((or) => (
                    <button
                      key={or.id}
                      type="button"
                      disabled={!peutDemarrerPointage(role) || enTraitement}
                      onClick={() => setOrSelectionneId(or.id)}
                      className="flex min-h-[64px] flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{or.numero}</span>
                        <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
                        <IdentiteClient client={or.client} />
                      </div>
                      <span className="texte-libelle text-muted-foreground">
                        {t('pointage:technicien.mesOrs.lignesAssignees', {
                          // `or.nombreLignes` compte TOUTES les lignes de l'OR côté serveur, sans
                          // distinction de technicien (voir `mes-ordres-assignes.api.ts`) — jamais
                          // ce qu'il faut afficher ici. `compterLignesAssigneesPointables` applique
                          // le même critère que `DialogueChoixCiblePointage` (technicien courant +
                          // ligne pointable), pour que la carte et le détail montrent toujours le
                          // même nombre.
                          count: compterLignesAssigneesPointables(or, technicienId),
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="texte-titre-section">{t('pointage:activites.titre')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!siteId ? (
                <SelecteurSitePointage
                  onChoisir={(valeur) => {
                    const parametres = new URLSearchParams(searchParams);
                    parametres.set('site', valeur);
                    setSearchParams(parametres);
                  }}
                />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {ACTIVITES_INDIRECTES.map((activite) => (
                    <Button
                      key={activite}
                      size="lg"
                      variant="outline"
                      className="h-16 text-base"
                      disabled={!peutDemarrerPointage(role) || enTraitement}
                      onClick={() => handleDemarrerActiviteIndirecte(activite)}
                    >
                      {libelleActiviteIndirecte(activite, t)}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <DialogueChoixCiblePointage
        ouvert={Boolean(orSelectionneId)}
        onFermer={() => setOrSelectionneId(undefined)}
        technicienId={technicien.id}
        requeteOr={requeteOrSelectionne}
        onChoisirLigne={handleChoisirLigne}
        onChoisirOrEntier={handleChoisirOrEntier}
        enDemarrage={demarrer.isPending}
      />
    </div>
  );
}
