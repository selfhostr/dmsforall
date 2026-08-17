import { useEffect, useState } from 'react';

import type { RoleUtilisateur } from '@dfa/shared';

import { ROLES_SCAN } from '@/routes/droits-routes';

/**
 * RESTRICTION MOBILE AU SCAN SEUL — décision de @laupernoe (chantier scanner de permis de circulation) :
 * « sur mobile, l'application se limite au scan. Strictement : pas d'atelier, pas de facturation,
 * pas de liste de clients. » Ce fichier porte le MÉCANISME de détection et son échappatoire ;
 * `AppShell.tsx` (seul appelant) l'applique en masquant la navigation et en redirigeant toute
 * route hors `/scan` vers `/scan`.
 *
 * DÉTECTION — DEUX signaux exigés ENSEMBLE, pas un seul :
 *
 *  1. `(max-width: 767px)` — le seuil `md` de Tailwind (768 px), sous celui déjà utilisé par
 *     `AppShell`/`BarreLaterale` pour le repli en tiroir (`lg`, 1024 px). Volontairement PLUS
 *     ÉTROIT que ce seuil-là : une tablette au comptoir (iPad, iPad mini compris — 768 px exact,
 *     donc côté « pas restreint ») doit garder l'application complète, seul un TÉLÉPHONE doit
 *     tomber sur le scan seul.
 *  2. `(pointer: coarse)` — exclut un poste fixe dont la fenêtre du navigateur a été rétrécie
 *     (souris = `pointer: fine`, quelle que soit la largeur de la fenêtre) : cas cité par @laupernoe
 *     lui-même (« un poste fixe avec une fenêtre étroite ») et probablement le faux positif le
 *     plus fréquent en pratique — un développeur qui redimensionne sa fenêtre, un poste de
 *     comptoir avec deux applications côte à côte.
 *
 * Les deux signaux RÉDUISENT les faux positifs (poste fixe étroit) mais n'éliminent jamais les
 * faux négatifs (téléphone en paysage, ~900 px de large sur les grands modèles — reste au-dessus
 * du seuil, donc PAS restreint) : un faux négatif laisse simplement l'application complète
 * visible, jamais un piège. Le seul risque qui compte est le faux POSITIF — un utilisateur qui
 * aurait besoin de l'application complète et se retrouve enfermé sur l'écran de scan — d'où
 * l'échappatoire ci-dessous, qui existe précisément pour ce cas-là plutôt que d'affiner encore la
 * détection (aucune heuristique CSS ne peut être parfaite, voir les limites documentées ci-dessus
 * — une petite tablette Android ~700 px de large tombera par exemple du mauvais côté).
 *
 * ÉCHAPPATOIRE — un lien explicite, monté par `EcranScan` (« Ouvrir l'application complète »),
 * appelle `quitter()` : pose un drapeau en `sessionStorage` (portée : cet onglet, jusqu'à sa
 * fermeture — un correctif PERMANENT en `localStorage` désactiverait la restriction pour de bon au
 * premier faux positif rencontré, ce qui n'est pas ce que @laupernoe a demandé ; `sessionStorage` la
 * réapplique proprement à la prochaine ouverture de l'app sur ce même téléphone). Un utilisateur
 * qui se retrouve mal classé n'est donc JAMAIS bloqué plus d'un geste.
 */

const REQUETE_MEDIA_MOBILE = '(max-width: 767px) and (pointer: coarse)';
const CLE_ECHAPPEMENT = 'dfa.scanMobile.echappement';

function detecterMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REQUETE_MEDIA_MOBILE).matches;
}

function lireEchappement(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(CLE_ECHAPPEMENT) === '1';
  } catch {
    // `sessionStorage` peut lever (navigation privée stricte, quota) — dégrade vers « pas
    // d'échappement posé », jamais vers un plantage de l'écran.
    return false;
  }
}

export interface ModeScanMobile {
  /** `true` = restreindre à `/scan` seul (navigation masquée, toute autre route redirigée). */
  readonly actif: boolean;
  /** Échappatoire explicite — voir la doc de tête. Idempotent, sans effet si déjà quitté. */
  readonly quitter: () => void;
}

/**
 * `role` = celui de la session en cours (`undefined` tant qu'elle n'est pas résolue). La
 * restriction ne s'applique QUE si le rôle fait partie de `ROLES_SCAN` : les rôles qui ont déjà
 * leur propre atterrissage dédié pour un usage tactile (`poste_atelier` -> borne, `technicien` ->
 * pointage, `magasinier` -> comptoir pièces, `routes/atterrissage.ts`) gardent leur écran habituel
 * sur téléphone — leur imposer le scan casserait un usage établi sans aucun rapport avec le
 * comptoir de réception.
 */
export function useModeScanMobile(role: RoleUtilisateur | undefined): ModeScanMobile {
  const [mobile, setMobile] = useState(detecterMobile);
  const [echappe, setEchappe] = useState(lireEchappement);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const requete = window.matchMedia(REQUETE_MEDIA_MOBILE);
    const surChangement = (evenement: MediaQueryListEvent) => setMobile(evenement.matches);
    requete.addEventListener('change', surChangement);
    return () => requete.removeEventListener('change', surChangement);
  }, []);

  function quitter(): void {
    try {
      window.sessionStorage.setItem(CLE_ECHAPPEMENT, '1');
    } catch {
      // Voir `lireEchappement` — un échec de stockage ne doit pas empêcher le geste de fonctionner
      // pour la session React en cours, seulement sa persistance au prochain chargement.
    }
    setEchappe(true);
  }

  const roleConcerne = role !== undefined && ROLES_SCAN.includes(role);

  return { actif: mobile && roleConcerne && !echappe, quitter };
}
