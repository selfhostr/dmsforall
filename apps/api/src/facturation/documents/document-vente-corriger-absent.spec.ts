/**
 * Verrouille l'état RÉEL, mesuré, de `POST /documents-vente/{id}/corriger` — PAS supposé.
 *
 * Contexte (audit de sécurité auth, 14.08.2026) : un testeur a signalé que « Corriger cette
 * facture » (menu ⋯) et le lien « Corriger par un avoir → » sous les lignes restaient cliquables
 * pour `chef_atelier`/`admin` dans `EcranFicheFacture` (voir le correctif dans ce même écran et
 * `peutCorrigerFacture`, `apps/web/src/ecrans/facturation/droits.ts`). Avant de corriger le miroir
 * front, ce fichier mesure ce que fait RÉELLEMENT le serveur si la requête part quand même —
 * recherche exhaustive (grep + `codegraph_explore`) sur `apps/api/src/facturation/` :
 *
 *  - AUCUN `@Post(':id/corriger')` (ni sous aucun autre chemin) dans `DocumentVenteController` ni
 *    `DocumentVenteTransitionsController` — les deux SEULS contrôleurs du module
 *    (`facturation.module.ts`, `controllers: [DocumentVenteController,
 *    DocumentVenteTransitionsController]`).
 *  - AUCUNE méthode `corriger`/`corrigerFacture` sur l'un ou l'autre.
 *  - AUCUN service (`service-documents.ts`, `service-avoir.ts`, `service-emission.ts`) n'implémente
 *    la transaction « avoir total + facture de remplacement » décrite par
 *    `schemaCorrectionFacture`/`ReponseCorrectionFacture` (`packages/shared/src/contrats/
 *    facturation/document.ts`).
 *  - ZÉRO test existant ne couvre ce geste côté serveur.
 *
 * Conséquence : le contrat (schémas zod, types) et le hook front (`useCorrigerFacture`,
 * `documents-vente.api.ts`) sont posés, mais AUCUNE route ne les sert. Une requête `POST
 * /documents-vente/{id}/corriger`, de N'IMPORTE QUEL rôle — y compris `direction`/`comptable`,
 * les deux seuls qui DEVRAIENT pouvoir l'exécuter — reçoit aujourd'hui le `404` générique de Nest
 * pour une route non montée, jamais un `403 DROIT_INSUFFISANT` ni un succès. Ce n'est PAS un refus
 * par rôle (`GardeDroit` n'est même jamais atteint : aucun handler ne matche l'URL), c'est une
 * fonctionnalité totalement absente — un « miroir sans rien à refléter », pas un « miroir mal
 * câblé ». Le défaut signalé au test manuel était donc bien un défaut d'ÉCRAN (le bouton ouvrait un
 * dialogue qui, soumis, aurait échoué en 404 pour tout le monde, direction/comptable compris) —
 * corrigé côté écran, voir `EcranFicheFacture.spec.tsx`.
 *
 * CE TEST DOIT ÊTRE REMPLACÉ, pas seulement mis à jour, le jour où l'endpoint est implémenté : à ce
 * moment-là il faut une vraie matrice rôle × action HTTP (`direction`/`comptable` → 200 ou l'erreur
 * métier attendue ; les sept autres rôles → `403 DROIT_INSUFFISANT`), sur une action de droit
 * DÉDIÉE — `facturation.document.corriger`, accordée à `direction`/`comptable` SEULS. Aucune action
 * déjà présente dans `MATRICE_DROITS` n'a ce périmètre exact : `facturation.document.emettre_avoir`/
 * `facturation.avoir.creer` incluent à tort `receptionnaire` pour CE geste-ci (annuler ET recréer
 * une facture en une transaction est structurellement plus engageant qu'émettre un avoir simple —
 * voir le commentaire de tête de `peutCorrigerFacture`, `apps/web/src/ecrans/facturation/
 * droits.ts`, pour le détail complet de l'arbitrage). Cette action ne peut pas être ajoutée par cet
 * agent — `apps/api/src/auth/matrice-droits.ts` est hors de son périmètre d'écriture pour cette
 * passe.
 *
 * PUREMENT STATIQUE (même technique que `common/droits/toutes-les-routes-decorees.spec.ts`, mais
 * sans marcher tout le graphe `AppModule` — inutile ici, les deux contrôleurs candidats sont connus
 * et importés directement) : lit les décorateurs Nest via `Reflect.getMetadata`, n'instancie ni
 * contrôleur ni service, n'ouvre aucune connexion Postgres/Redis.
 */
import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { DocumentVenteController } from './document-vente.controller';
import { DocumentVenteTransitionsController } from './document-vente-transitions.controller';

interface RouteDeclaree {
  readonly controleur: string;
  readonly methode: string;
  readonly chemin: string;
  readonly verbeHttp: unknown;
}

function listerRoutes(classe: new (...args: never[]) => unknown): RouteDeclaree[] {
  const routes: RouteDeclaree[] = [];
  const prototype = classe.prototype as unknown as Record<string, unknown>;
  for (const nomMethode of Object.getOwnPropertyNames(prototype)) {
    if (nomMethode === 'constructor') continue;
    const handler = prototype[nomMethode];
    if (typeof handler !== 'function') continue;
    const chemin = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (chemin === undefined) continue; // pas un handler de route HTTP
    routes.push({
      controleur: classe.name,
      methode: nomMethode,
      chemin,
      verbeHttp: Reflect.getMetadata(METHOD_METADATA, handler),
    });
  }
  return routes;
}

const CONTROLEURS_DOCUMENTS = [DocumentVenteController, DocumentVenteTransitionsController];

describe('POST /documents-vente/{id}/corriger — état réel du serveur (mesuré, pas supposé)', () => {
  it(
    'les deux seuls contrôleurs du module facturation/documents portent bien au moins une route ' +
      '(garde-fou : ce test ne doit jamais tourner à vide, sinon il passerait trivialement sans ' +
      "avoir rien vérifié — même raison d'être que le garde-fou de toutes-les-routes-decorees.spec.ts)",
    () => {
      const total = CONTROLEURS_DOCUMENTS.flatMap((classe) => listerRoutes(classe)).length;
      expect(total).toBeGreaterThan(0);
    },
  );

  it(
    "AUCUNE route ':id/corriger' (ni aucun alias) n'existe sur DocumentVenteController ni " +
      'DocumentVenteTransitionsController — confirme que la requête ne matche AUCUN handler : Nest ' +
      'répond son 404 générique de routeur, avant même que GardeDroit ne soit atteint, pour TOUT ' +
      'rôle sans exception (y compris direction/comptable)',
    () => {
      const cheminsCorriger = CONTROLEURS_DOCUMENTS.flatMap((classe) =>
        listerRoutes(classe),
      ).filter((route) => /corriger/i.test(route.chemin));
      expect(cheminsCorriger).toEqual([]);
    },
  );

  it(
    "AUCUNE méthode 'corriger'/'corrigerFacture' n'existe sur ces deux contrôleurs — au cas où un " +
      'futur handler porterait un chemin différent tout en réutilisant ce nom, ce test échouerait ' +
      'et forcerait la mise à jour de ce fichier plutôt que de laisser passer une route non couverte ' +
      'par la matrice décrite en tête de fichier',
    () => {
      for (const classe of CONTROLEURS_DOCUMENTS) {
        const prototype = classe.prototype as unknown as Record<string, unknown>;
        expect(prototype['corriger']).toBeUndefined();
        expect(prototype['corrigerFacture']).toBeUndefined();
      }
    },
  );
});
