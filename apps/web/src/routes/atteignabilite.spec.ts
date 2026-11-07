import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { trouverCorrespondance } from '@/composants/layout/navigation-modele';

import { routesConfig } from './routeur';

/**
 * LE CONTRÔLE DU LOT D : aucun écran livré ne devient inatteignable.
 *
 * Le lot retire vingt-quatre entrées de menu. Le risque n'est pas théorique — ce dépôt a déjà
 * produit deux fois le même défaut (un écran d'OR routé sans lien de menu pendant tout un lot, la
 * borne de pointage atteignable seulement en tapant son URL), et une refonte de navigation est
 * exactement le moment où il se reproduit en série et en silence. Ce test parcourt la
 * configuration RÉELLE du routeur et exige, pour chaque route, l'une de deux choses :
 *
 *  - soit le modèle de navigation la rattache à une entrée/onglet/vue (`trouverCorrespondance`) —
 *    elle est donc atteignable en cliquant, depuis n'importe quel écran ;
 *  - soit elle figure ci-dessous avec la raison ÉCRITE de son absence du menu et le chemin
 *    d'interface qui la dessert à la place.
 *
 * Il n'y a pas de troisième cas. Ajouter une route sans faire l'un ni l'autre fait rougir ce test,
 * et le message de l'assertion dit quoi faire. Ce que ce test ne prouve PAS, et qu'il ne faut pas
 * lui faire dire : que le chemin d'interface décrit dans une exception existe vraiment (un lien
 * dans une fiche n'est vérifiable que par le test de la fiche) — il verrouille la DÉCISION, pas
 * son implémentation ailleurs.
 */

/** `:param` -> valeur concrète : le modèle raisonne sur des préfixes de segments, un gabarit brut
 *  ne matcherait rien. La valeur importe peu, seule la forme du chemin compte. */
function concretiser(gabarit: string): string {
  return gabarit
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'id-de-test' : segment))
    .join('/');
}

function collecterChemins(routes: readonly RouteObject[], prefixe = ''): string[] {
  const collectes: string[] = [];
  for (const route of routes) {
    if (route.path === '*') continue;
    const chemin =
      route.index === true
        ? prefixe === ''
          ? '/'
          : prefixe
        : `${prefixe}/${route.path ?? ''}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    if (route.children && route.children.length > 0) {
      collectes.push(...collecterChemins(route.children, chemin === '/' ? '' : chemin));
    } else {
      collectes.push(chemin);
    }
  }
  return collectes;
}

/**
 * LES SEULES ROUTES HORS MENU, et pourquoi. Trois familles, aucune improvisation :
 *
 *  1. LES OBJETS. §4.1 de l'arbitrage les exclut du menu par principe : un client, un véhicule, un
 *     OR, une facture, un article, un dossier ne s'atteignent pas par une destination mais par la
 *     recherche permanente (Lot A, `Ctrl+K` et loupe, depuis n'importe quel écran) et par les liens
 *     de fiche (Lot B). Mettre un objet dans le menu, c'est précisément ce qui avait fait grossir
 *     l'arborescence à trente entrées.
 *  2. LES FORMULAIRES DE CRÉATION. On y arrive par le bouton d'action primaire de la liste
 *     correspondante, jamais par le menu — un menu qui propose « créer » à froid propose de créer
 *     un doublon.
 *  3. LES ÉCRANS HORS COQUILLE. `/login` n'a pas de menu par construction.
 */
const HORS_MENU: Readonly<Record<string, string>> = {
  '/login': "Écran public, hors coquille applicative — aucun menu n'existe à ce moment-là.",
  '/console':
    "Console d'exploitation plateforme (palier 1) — HORS de l'arborescence métier par " +
    "construction (pas d'`AppShell`, pas de barre latérale, `docs/conception-console-exploitation-" +
    'ecrans.md` §2) : un poste DFA, pas un écran de garage, sans place dans le modèle de navigation ' +
    'tenant. Accès distinct (`session_exploitant`), voir `routeur.tsx` pour le détail de la ' +
    'protection encore à construire.',

  '/clients/id-de-test': 'Objet — recherche globale, liste Clients, liens de fiche (Lot B).',
  '/vehicules/id-de-test': 'Objet — recherche globale, liste Véhicules, fiche client.',
  '/ordres-reparation/id-de-test':
    'Objet — recherche globale, liste des OR, fiche véhicule et fiche client.',
  '/factures/id-de-test': 'Objet — liste Factures, fiche OR, fiche client.',
  '/pieces/articles/id-de-test': 'Objet — liste Articles, recherche comptoir, recherche globale.',
  '/pieces/commandes-fournisseur/id-de-test':
    'Objet — Pièces › Approvisionnement › Commandes, fiche fournisseur.',
  '/pieces/fournisseurs/id-de-test':
    'Objet — Pièces › Approvisionnement › Fournisseurs, fiche commande.',
  '/ventes/stock/id-de-test': 'Objet — Véhicules à vendre › Véhicules en stock, fiche dossier.',
  '/ventes/dossiers/id-de-test': 'Objet — Ventes › Dossiers, fiche client, fiche véhicule en parc.',

  '/vehicules/nouveau': 'Création — action primaire de la liste Véhicules et de la fiche client.',
  '/ventes/stock/nouveau': 'Création — action primaire de Véhicules à vendre › Véhicules en stock.',
  '/ventes/dossiers/nouveau':
    'Création — action primaire de Ventes › Dossiers, et de la fiche client.',
  '/pieces/commandes-fournisseur/nouvelle':
    'Création — action primaire de Pièces › Approvisionnement › Commandes.',
  '/factures/id-de-test/avoir':
    'Opération sur un objet — bouton « Corriger » de la fiche facture. Un avoir ne se crée jamais ' +
    "à froid : il corrige une facture précise, qu'il faut donc avoir ouverte.",
  '/ordres-reparation/id-de-test/facturer':
    'Opération sur un objet — bouton « Facturer » de la fiche OR.',

  /**
   * LA SEULE PERTE RÉELLE DU LOT, assumée et signalée. `EcranRecherche` est le MÊME panneau que
   * celui du Lot A (`PanneauResultatsRecherche`, même hook `useRechercheComptoir`), monté sur une
   * route au lieu d'une surimpression. §4.5 le retire du menu au profit du champ permanent d'en-tête
   * — décision juste : la surimpression ne fait pas perdre l'écran en cours, la route si.
   *
   * Il reste atteignable par la carte « Rechercher » de l'accueil et par l'état vide de la création
   * d'OR, mais l'accueil lui-même n'est plus rendu pour les cinq rôles qui ont un atterrissage
   * dédié (`atterrissage.ts`) : pour eux, cette route n'a plus de chemin d'interface. Ce n'est pas
   * une fonctionnalité perdue (la recherche est partout, en permanence, `Ctrl+K` compris) mais un
   * DOUBLON qui devrait être supprimé au Lot F, en même temps que `EcranAccueil` fusionne dans
   * « Aujourd'hui ». Signalé plutôt que masqué.
   */
  '/recherche':
    "Doublon de la recherche permanente d'en-tête (Lot A). Retiré du menu par §4.5. Reste " +
    "atteignable depuis l'accueil et l'état vide de la création d'OR ; à supprimer au Lot F.",

  '/reprise-donnees':
    "Reprise de données (dépôt de l'archive d'un ancien logiciel, `packages/shared/src/contrats/" +
    "reprise.ts`) — geste d'ONBOARDING EXCEPTIONNEL, pas un usage quotidien de garage : au plus " +
    "une poignée de fois dans la vie d'un tenant (la mise en route). Une entrée de menu permanente " +
    "pour un écran qu'un garage ne rouvre normalement plus une fois la reprise terminée serait " +
    "exactement le bruit que §4.1/§4.5 de l'arbitrage de navigation retirent ailleurs. Reste " +
    'routée sous la coquille métier normale (`RouteProtegee` + `AppShell`, contrairement à ' +
    '`/console` ci-dessus) : atteinte par un lien direct communiqué pendant la mise en route du ' +
    'garage — pas par le menu.',
};

describe('atteignabilité — aucun écran livré ne devient inatteignable', () => {
  const chemins = collecterChemins(routesConfig).map(concretiser);

  it('le routeur expose bien toutes ses routes à ce contrôle (garde-fou du collecteur lui-même)', () => {
    // Si le collecteur cassait (changement de forme de `routesConfig`), tous les tests ci-dessous
    // passeraient sur une liste vide — le pire mode de défaillance possible pour ce fichier.
    expect(chemins.length).toBeGreaterThan(30);
    expect(chemins).toContain('/factures');
    expect(chemins).toContain('/pointage/borne');
    expect(chemins).toContain('/');
  });

  it.each(chemins)(
    '%s est atteignable par le menu, ou déclarée hors menu avec sa raison',
    (chemin) => {
      const correspondance = trouverCorrespondance(chemin);
      const raisonHorsMenu = HORS_MENU[chemin];

      expect(
        correspondance !== undefined || raisonHorsMenu !== undefined,
        `La route « ${chemin} » n'est rattachée à aucune entrée du menu et ne figure pas dans ` +
          `HORS_MENU. Soit lui donner un motif dans navigation-modele.ts, soit l'ajouter à ` +
          `HORS_MENU en écrivant par quel chemin d'interface on y arrive.`,
      ).toBe(true);
    },
  );

  it('aucune exception HORS_MENU n’est périmée (une route supprimée doit sortir de la liste)', () => {
    for (const chemin of Object.keys(HORS_MENU)) {
      expect(
        chemins,
        `« ${chemin} » n'existe plus dans le routeur : retirer l'exception.`,
      ).toContain(chemin);
    }
  });

  /**
   * Les deux écrans que le lot devait le plus sûrement raccrocher, parce qu'ils étaient les plus
   * exposés : la borne (jusqu'ici sans aucun lien de menu, atteignable par URL seule) et la clôture
   * de période (que l'arbitrage rangeait en simple action, ce qui l'aurait fait disparaître).
   */
  it('la borne de pointage et la clôture de période sont bien rattachées au menu', () => {
    const borne = trouverCorrespondance('/pointage/borne');
    expect(borne?.entree.id).toBe('atelier');
    expect(borne?.onglet.id).toBe('pointage');
    expect(borne?.vue?.id).toBe('borne');

    const cloture = trouverCorrespondance('/pointage/cloture');
    expect(cloture?.vue?.id).toBe('cloture');
  });

  /** Une fiche doit surligner l'entrée de son domaine : c'est ce qui répond à « où suis-je ». */
  it('une fiche est rattachée au domaine de son objet, pas laissée sans repère', () => {
    expect(trouverCorrespondance('/clients/42')?.entree.id).toBe('clientsVehicules');
    expect(trouverCorrespondance('/ordres-reparation/42')?.entree.id).toBe('atelier');
    expect(trouverCorrespondance('/factures/42/avoir')?.entree.id).toBe('facturation');
    expect(trouverCorrespondance('/pieces/articles/42')?.onglet.id).toBe('articles');
    expect(trouverCorrespondance('/atelier/ordres-reparation/nouveau')?.onglet.id).toBe(
      'ordresReparation',
    );
  });

  /** Correspondance par SEGMENT, pas par préfixe de chaîne — sinon `/pneus` capturerait n'importe
   *  quelle URL commençant par ces cinq lettres. */
  it('ne capture pas une URL qui partage seulement le début d’un motif', () => {
    expect(trouverCorrespondance('/pneusomatic')).toBeUndefined();
    expect(trouverCorrespondance('/facturesxyz')).toBeUndefined();
    // `/` ne capture rien d'autre que lui-même, bien qu'il soit préfixe de tout.
    expect(trouverCorrespondance('/une-route-inconnue')).toBeUndefined();
  });
});
