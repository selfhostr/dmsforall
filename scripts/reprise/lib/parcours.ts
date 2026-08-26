/**
 * Parcours complet d'UN dossier de reprise, de bout en bout : dépôt en tranches -> finalisation ->
 * analyse -> plan -> validation -> import -> rapport. Rejoue exactement la séquence mesurée à la
 * main le 25.08.2026 (`analyse/parcours-complet/parcours.md`), par script.
 *
 * Ne crée PAS le tenant ni la session — reçus en paramètre, pour que l'appelant (campagne un
 * tenant, ou campagne multi-garages) puisse driver PLUSIEURS dossiers sur le même tenant (preuve
 * d'idempotence : un rejeu complet, pas seulement `POST .../import/rejouer`, qui n'est autorisé
 * que depuis `import_echoue` — jamais depuis `import_termine`, mesuré en exécution le 26.08.2026).
 */
import { randomUUID } from 'node:crypto';

import {
  attendreSortieStatuts,
  creerDossier,
  deposerTranche,
  finaliserDossier,
  lancerAnalyse,
  lireAnalyse,
  lireImport,
  lirePlan,
  lireRapport,
  validerPlan,
  ErreurApiReprise,
  type SessionHttp,
} from './client-http';
import { lireTranche, sha256Fichier, tailleFichier } from './fichier';

export interface ProgresParcours {
  (etape: string, detail?: Record<string, unknown>): void;
}

export interface ResultatParcoursDossier {
  readonly dossierId: string;
  readonly statutFinal: string;
  readonly empreinteSha256: string;
  readonly tailleOctets: number;
  readonly analyse: unknown;
  readonly plan: unknown;
  readonly planElementsInclus: number;
  readonly planElementsExclus: number;
  readonly rapport: unknown | null;
}

interface ElementPlanMinimal {
  readonly inclus: boolean;
}
interface PlanMinimal {
  readonly elements?: readonly ElementPlanMinimal[];
}

/**
 * Mène un dossier de reprise de l'archive locale jusqu'au rapport final (ou jusqu'au plan, si le
 * plan ne contient aucun élément inclus — validation refusée par construction depuis le correctif
 * du 26.08.2026, `409 REPRISE_PLAN_NON_VALIDABLE` : ce n'est PAS un échec du parcours, c'est un
 * résultat à rapporter tel quel, voir `progres('plan_vide', ...)`).
 */
export async function executerUnDossierComplet(
  session: SessionHttp,
  cheminArchive: string,
  progres: ProgresParcours = () => undefined,
): Promise<ResultatParcoursDossier> {
  const tailleOctets = await tailleFichier(cheminArchive);
  const empreinteSha256 = await sha256Fichier(cheminArchive);
  progres('empreinte_calculee', { tailleOctets, sha256: empreinteSha256 });

  const { dossier, tailleTrancheRecommandeeOctets } = await creerDossier(session, {
    tailleOctetsAnnoncee: tailleOctets,
    empreinteSha256Annoncee: empreinteSha256,
    nomArchiveOriginal: cheminArchive.split('/').pop(),
  });
  progres('dossier_cree', { dossierId: dossier.id, statut: dossier.statut });

  const tailleTranche = tailleTrancheRecommandeeOctets;
  const nbTranches = Math.max(1, Math.ceil(tailleOctets / tailleTranche));
  for (let n = 0; n < nbTranches; n += 1) {
    const offset = n * tailleTranche;
    const longueur = Math.min(tailleTranche, tailleOctets - offset);
    const donnees = await lireTranche(cheminArchive, offset, longueur);
    await deposerTranche(session, dossier.id, n, donnees);
  }
  progres('tranches_deposees', { nbTranches });

  await finaliserDossier(session, dossier.id, empreinteSha256);
  progres('depot_finalise');

  // L'analyse démarre automatiquement à la finalisation (contrat) — l'appel explicite ci-dessous
  // est un filet, pas une hypothèse : `409 REPRISE_DOSSIER_TRANSITION_INTERDITE` si elle a déjà
  // démarré toute seule est attendu et ignoré, tout autre statut HTTP remonte normalement.
  try {
    await lancerAnalyse(session, dossier.id);
  } catch (erreur) {
    if (!(erreur instanceof ErreurApiReprise) || erreur.statut !== 409) throw erreur;
  }
  // Sortie de [depot_receptionne, analyse_en_cours] — PAS une attente de `analyse_terminee`
  // précisément : voir l'en-tête de `attendreSortieStatuts` (le plan peut être généré si vite après
  // l'analyse que ce statut intermédiaire n'est jamais observé entre deux polls).
  const statutApresAnalyse = await attendreSortieStatuts(
    session,
    dossier.id,
    ['depot_receptionne', 'analyse_en_cours'],
    { surProgres: (s) => progres('statut', { statut: s }) },
  );
  const analyse = await lireAnalyse(session, dossier.id);
  if (statutApresAnalyse === 'analyse_echouee') {
    progres('analyse_echouee', { analyse });
    return {
      dossierId: dossier.id,
      statutFinal: statutApresAnalyse,
      empreinteSha256,
      tailleOctets,
      analyse,
      plan: null,
      planElementsInclus: 0,
      planElementsExclus: 0,
      rapport: null,
    };
  }

  const plan = (await lirePlan(session, dossier.id)) as PlanMinimal;
  const elements = plan.elements ?? [];
  const inclus = elements.filter((e) => e.inclus).length;
  const exclus = elements.length - inclus;
  progres('plan_recu', { elementsInclus: inclus, elementsExclus: exclus });

  if (inclus === 0) {
    progres('plan_vide');
    return {
      dossierId: dossier.id,
      statutFinal: 'plan_propose',
      empreinteSha256,
      tailleOctets,
      analyse,
      plan,
      planElementsInclus: 0,
      planElementsExclus: exclus,
      rapport: null,
    };
  }

  await validerPlan(session, dossier.id, randomUUID());
  progres('plan_valide');

  // Sortie de [plan_valide, import_en_cours] — même doctrine que ci-dessus, même si `import_termine`/
  // `import_echoue` sont déjà tous deux terminaux ici (aucun saut possible au-delà) : un seul
  // mécanisme d'attente dans tout ce fichier, plus simple à auditer qu'une attente « par cible »
  // réservée à ce seul appel.
  const statutApresImport = await attendreSortieStatuts(
    session,
    dossier.id,
    ['plan_valide', 'import_en_cours'],
    { surProgres: (s) => progres('statut', { statut: s }) },
  );
  const rapport = await lireRapport(session, dossier.id);
  if (statutApresImport === 'import_echoue') {
    const importDetail = await lireImport(session, dossier.id);
    // Le détail utile (message d'erreur réel) vit dans `rapport.anomalies`, PAS dans `importDetail`
    // (qui ne porte qu'une progression numérique) — bug de diagnostic vécu en écrivant ce harnais :
    // sans ceci, un échec d'import ne montrait qu'« echoue, 0/100 », jamais le POURQUOI, obligeant
    // à interroger `reprise_rapport` par SQL directe à la main pour comprendre quoi que ce soit.
    progres('import_echoue', {
      importDetail,
      anomalies: (rapport as { anomalies?: unknown })?.anomalies,
    });
  }

  return {
    dossierId: dossier.id,
    statutFinal: statutApresImport,
    empreinteSha256,
    tailleOctets,
    analyse,
    plan,
    planElementsInclus: inclus,
    planElementsExclus: exclus,
    rapport,
  };
}
