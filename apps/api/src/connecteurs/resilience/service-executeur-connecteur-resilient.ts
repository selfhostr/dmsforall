import { Injectable } from '@nestjs/common';

import { Horloge } from '../../common/horloge';
import { ServiceJournal } from '../../common/journal';
import type { ContexteTenant } from '../../db';
import type {
  AdaptateurConnecteur,
  RequeteOperationConnecteur,
  ResultatOperationConnecteur,
} from '../adaptateur-connecteur';

import { ErreurDelaiDepasseConnecteur } from './erreurs-resilience';
import {
  POLITIQUE_RESILIENCE_CONNECTEUR_DEFAUT,
  type PolitiqueResilienceConnecteur,
} from './politique-resilience';
import { ServiceAttente } from './service-attente';

/**
 * Garde-fous d'un appel sortant vers un adaptateur — item C du socle (étape 5), LE vrai sujet
 * d'un connecteur : « un partenaire lent ou muet ne doit jamais bloquer une requête d'un
 * garagiste ». Trois mécanismes empilés, dans cet ordre :
 *
 *  1. DISJONCTEUR — si `(tenant, typeConnecteurCode)` a atteint
 *     `seuilCoupureEchecsConsecutifs` échecs COMPLETS d'affilée, l'appel échoue immédiatement
 *     (`raisonEchec: 'circuit_ouvert'`), sans tenter le réseau, tant que `dureeCoupureMs` n'est
 *     pas écoulée. État EN MÉMOIRE PROCESSUS (limite connue, voir le rapport d'accompagnement :
 *     ne survit pas à un redémarrage, n'est pas partagé entre répliques — acceptable tant
 *     qu'aucun trafic réel ne passe par ce socle ; `common/limitation/redis.provider.ts`
 *     (`JETON_REDIS`) est le candidat naturel le jour où ça devient nécessaire, même patron que
 *     `pointage/service-verrouillage-pin.ts`).
 *  2. DÉLAI MAXIMAL — chaque tentative individuelle est bornée par `delaiMaxMs` (filet de
 *     sécurité sur `setTimeout` réel, PAS `ServiceAttente` — voir son en-tête).
 *  3. RÉESSAIS À ESPACEMENT CROISSANT — jusqu'à `nombreMaxTentatives`, pause
 *     `espacementInitialSecondes × facteurCroissance^(tentative-1)` entre deux tentatives
 *     (`RC-04`), via `ServiceAttente` (injectable, testable sans horloge réelle).
 *
 * JOURNALISATION SANS SECRET (item C, deuxième moitié) : seuls des champs NOMMÉMENT autorisés
 * (tenant, type de connecteur, interface, opération, nature, tentative, raison, nom/message
 * d'erreur) atteignent `ServiceJournal` — jamais `requete.donnees`, jamais l'objet erreur brut
 * (qui pourrait porter un en-tête ou un corps de réponse du tiers). `ServiceJournal` redige déjà
 * `motDePasse`/`cookie`/`authorization`/`tokenClair` en profondeur (`common/journal/service-
 * journal.ts`) — cette liste ne couvre PAS une clé arbitraire comme `donnees.cleApi` : ne
 * jamais compter dessus ici, c'est pourquoi ce service n'envoie JAMAIS `requete.donnees` au
 * journal, quelle que soit sa forme.
 */

export type RaisonEchecExecutionConnecteur =
  'circuit_ouvert' | 'delai_depasse' | 'tentatives_epuisees';

export interface ResultatExecutionConnecteurResilient {
  readonly reussite: boolean;
  readonly resultat: ResultatOperationConnecteur | null;
  readonly raisonEchec: RaisonEchecExecutionConnecteur | null;
  /** `0` uniquement pour `raisonEchec: 'circuit_ouvert'` — aucune tentative n'a été faite. */
  readonly tentatives: number;
}

interface EtatDisjoncteur {
  echecsConsecutifs: number;
  /** epoch ms, `null` = fermé. */
  ouvertJusquA: number | null;
}

@Injectable()
export class ServiceExecuteurConnecteurResilient {
  private readonly disjoncteurs = new Map<string, EtatDisjoncteur>();

  constructor(
    private readonly horloge: Horloge,
    private readonly attente: ServiceAttente,
    private readonly journal: ServiceJournal,
  ) {}

  async executer(
    contexte: ContexteTenant,
    adaptateur: AdaptateurConnecteur,
    requete: RequeteOperationConnecteur,
    politique: PolitiqueResilienceConnecteur = POLITIQUE_RESILIENCE_CONNECTEUR_DEFAUT,
  ): Promise<ResultatExecutionConnecteurResilient> {
    const cleDisjoncteur = `${contexte.tenantId}:${adaptateur.typeConnecteurCode}`;
    const champsJournal = {
      tenantId: contexte.tenantId,
      typeConnecteurCode: adaptateur.typeConnecteurCode,
      nomInterface: adaptateur.nomInterface,
      operation: requete.operation,
      nature: requete.nature,
    };

    if (this.disjoncteurEstOuvert(cleDisjoncteur)) {
      this.journal.warn('connecteurs.resilience.circuit_ouvert', champsJournal);
      return { reussite: false, resultat: null, raisonEchec: 'circuit_ouvert', tentatives: 0 };
    }

    let derniereRaison: RaisonEchecExecutionConnecteur = 'tentatives_epuisees';
    let tentative = 0;

    while (tentative < politique.nombreMaxTentatives) {
      tentative += 1;
      try {
        const resultat = await this.avecDelaiMax(
          adaptateur.executer(requete),
          politique.delaiMaxMs,
        );
        this.reinitialiserDisjoncteur(cleDisjoncteur);
        this.journal.info('connecteurs.resilience.execution_reussie', {
          ...champsJournal,
          tentative,
        });
        return { reussite: true, resultat, raisonEchec: null, tentatives: tentative };
      } catch (erreur) {
        const delaiDepasse = erreur instanceof ErreurDelaiDepasseConnecteur;
        derniereRaison = delaiDepasse ? 'delai_depasse' : 'tentatives_epuisees';
        this.journal.warn('connecteurs.resilience.tentative_echouee', {
          ...champsJournal,
          tentative,
          raison: delaiDepasse ? 'delai_depasse' : 'erreur_adaptateur',
          erreurNom: erreur instanceof Error ? erreur.name : 'inconnue',
          erreurMessage: erreur instanceof Error ? erreur.message : String(erreur),
        });

        const dernierTour = tentative >= politique.nombreMaxTentatives;
        if (!dernierTour) {
          const attenteMs =
            politique.espacementInitialSecondes *
            1000 *
            politique.facteurCroissance ** (tentative - 1);
          await this.attente.attendre(attenteMs);
        }
      }
    }

    this.enregistrerEchecComplet(cleDisjoncteur, politique);
    this.journal.error('connecteurs.resilience.tentatives_epuisees', undefined, {
      ...champsJournal,
      tentatives: tentative,
    });
    return { reussite: false, resultat: null, raisonEchec: derniereRaison, tentatives: tentative };
  }

  private disjoncteurEstOuvert(cle: string): boolean {
    const etat = this.disjoncteurs.get(cle);
    if (!etat || etat.ouvertJusquA === null) {
      return false;
    }
    if (this.horloge.maintenant().getTime() >= etat.ouvertJusquA) {
      // Coupure écoulée : on retente au prochain appel (pas de sonde dédiée à demi-ouverture —
      // simplification assumée du socle, voir l'en-tête du fichier).
      etat.ouvertJusquA = null;
      etat.echecsConsecutifs = 0;
      return false;
    }
    return true;
  }

  private reinitialiserDisjoncteur(cle: string): void {
    this.disjoncteurs.delete(cle);
  }

  private enregistrerEchecComplet(cle: string, politique: PolitiqueResilienceConnecteur): void {
    const etat = this.disjoncteurs.get(cle) ?? { echecsConsecutifs: 0, ouvertJusquA: null };
    etat.echecsConsecutifs += 1;
    if (etat.echecsConsecutifs >= politique.seuilCoupureEchecsConsecutifs) {
      etat.ouvertJusquA = this.horloge.maintenant().getTime() + politique.dureeCoupureMs;
    }
    this.disjoncteurs.set(cle, etat);
  }

  /** Filet de sécurité RÉEL (`setTimeout`/`clearTimeout`), volontairement PAS sur
   *  `ServiceAttente` : c'est une garantie de wall-clock, pas une pause de politique — voir
   *  l'en-tête de `ServiceAttente`. `promesse.catch(() => {})` : si le délai gagne la course, la
   *  promesse abandonnée ne doit jamais produire un rejet non intercepté quand elle se dénoue
   *  plus tard. */
  private avecDelaiMax<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
    promesse.catch(() => {
      /* abandonnée si le délai gagne — voir commentaire ci-dessus */
    });

    let minuteur: ReturnType<typeof setTimeout>;
    const delaiPromesse = new Promise<never>((_resolve, reject) => {
      minuteur = setTimeout(() => reject(new ErreurDelaiDepasseConnecteur(delaiMs)), delaiMs);
    });

    return Promise.race([promesse, delaiPromesse]).finally(() => clearTimeout(minuteur));
  }
}
