/**
 * Table action -> capacité(s) interne(s). Elle REMPLACE les listes d'actions par rôle de l'ancienne
 * matrice : une personne détient une action si sa grille (`@dfa/shared` `capacitesDeLaGrille`) lui
 * accorde AU MOINS UNE des capacités listées ("ou"). Les capacités multiples servent aux gestes
 * partagés entre l'accueil et l'atelier (saisir un kilométrage, ajouter une photo) ou entre le
 * comptoir pièces et l'accueil (créer un client) : sans elles, il faudrait donner tout un domaine
 * pour un seul geste.
 *
 * `Record<Action, …>` : une action ajoutée à `TOUTES_ACTIONS` sans être classée ici ne COMPILE pas.
 * `import type` : ce fichier est lu par `matrice-droits.ts`, qui exporte `Action` (pas de cycle
 * d'exécution).
 *
 * Le profil de la borne (`ACTIONS_PROFIL_BORNE`) est hors grille et figé.
 */
import type { Capacite } from '@dfa/shared';

import type { Action } from './matrice-droits';

type Classement = Capacite | readonly Capacite[];

export const CAPACITE_DE_L_ACTION: Readonly<Record<Action, Classement>> = {
  // ---- Socle / lecture commune ----------------------------------------------------------------
  'socle.tenant.lire': 'base',
  'socle.site.lire': 'base',
  'recherche.executer': 'base',
  'parametrage.atelier.lire': 'base',
  'parametrage.referentiel.lire': 'base',
  'tableau_bord.activite.lire': 'base',
  'atelier.ligne.photo.lire': 'base',
  // ---- Employés & réglages (patron) -----------------------------------------------------------
  'socle.utilisateur.lire': 'employes',
  'socle.utilisateur.creer': 'employes',
  'socle.utilisateur.modifier': 'employes',
  'socle.utilisateur.desactiver': 'employes',
  'socle.utilisateur.reinitialiser_acces': 'employes',
  'socle.borne.lire': 'employes',
  'socle.borne.creer': 'employes',
  'socle.borne.desactiver': 'employes',
  'socle.borne.reinitialiser_acces': 'employes',
  'client.condition.modifier': 'employes',
  'client.anonymiser': 'employes',
  'reprise.dossier.lire': 'employes',
  'reprise.dossier.deposer': 'employes',
  'reprise.dossier.annuler': 'employes',
  'reprise.analyse.lire': 'employes',
  'reprise.analyse.lancer': 'employes',
  'reprise.plan.lire': 'employes',
  'reprise.plan.modifier': 'employes',
  'reprise.import.lire': 'employes',
  // Gestes irréversibles ou engageant le garage : patron seul (jamais `admin`).
  'reprise.plan.valider': 'patron',
  'reprise.import.lancer': 'patron',
  'facturation.parametrage.creancier.modifier': 'patron',
  // Tableau « Démarrer votre garage » : outil de la direction ; `admin` (intégrateur) le voit aussi.
  'accueil.demarrage.lire': 'employes',
  // ---- Encadrer --------------------------------------------------------------------------------
  'parametrage.atelier.modifier': 'encadrer',
  'parametrage.referentiel.modifier': 'encadrer',
  'vehicule.detention.corriger': 'encadrer',
  'vehicule.kilometrage.corriger_regression': 'encadrer',
  'atelier.or.rouvrir': 'encadrer',
  'atelier.confirmation.client_bloque': 'encadrer',
  'atelier.confirmation.or_sans_rdv': 'encadrer',
  'atelier.pointage.corriger_autrui': 'encadrer',
  'atelier.pointage.pointer_autrui': 'encadrer',
  'atelier.pointage.verrouiller_periode': 'encadrer',
  'atelier.pointage.deverrouiller_periode': 'encadrer',
  'atelier.pointage.gerer_pin': 'encadrer',
  'courtoisie.parc.gerer': 'encadrer',
  // ---- Accueil & clients -----------------------------------------------------------------------
  'client.lire': 'accueil.voir',
  'vehicule.lire': 'accueil.voir',
  'rendez_vous.lire': 'atelier.voir',
  'courtoisie.lire': 'atelier.voir',
  'pneus.depot.lire': 'accueil.voir',
  'atelier.journal.lire': 'atelier.voir',
  'client.creer': ['accueil.faire', 'pieces.faire'],
  'client.modifier': ['accueil.faire', 'pieces.faire'],
  'vehicule.creer': ['accueil.faire', 'pieces.faire'],
  'vehicule.modifier': ['accueil.faire', 'pieces.faire'],
  'client.desactiver': 'accueil.faire',
  'client.consentement.enregistrer': 'accueil.faire',
  'client.note.ecrire': 'accueil.faire',
  'client.export.generer': 'accueil.faire',
  'vehicule.archiver': 'accueil.faire',
  'vehicule.plaque.gerer': 'accueil.faire',
  'vehicule.detention.changer': 'accueil.faire',
  'vehicule.expertise.saisir': 'accueil.faire',
  'vehicule.travail_reporte.gerer': 'accueil.faire',
  'rendez_vous.creer': 'accueil.faire',
  'rendez_vous.modifier': 'accueil.faire',
  'rendez_vous.arrivee': 'accueil.faire',
  'rendez_vous.absence': 'accueil.faire',
  'rendez_vous.annuler': 'accueil.faire',
  'courtoisie.preter': 'accueil.faire',
  'pneus.depot.sortir': 'accueil.faire',
  // Réception de l'OR et son suivi commercial : le comptoir.
  'atelier.or.creer': 'accueil.faire',
  'atelier.or.modifier': 'accueil.faire',
  'atelier.or.plafond_modifier': 'accueil.faire',
  'atelier.or.receptionner': 'accueil.faire',
  'atelier.or.terminer': 'accueil.faire',
  'atelier.or.restituer': 'accueil.faire',
  'atelier.or.cloturer': 'accueil.faire',
  'atelier.or.annuler': 'accueil.faire',
  'atelier.ligne.modifier': 'accueil.faire',
  'atelier.ligne.valider': 'accueil.faire',
  'atelier.ligne.refuser': 'accueil.faire',
  'atelier.ligne.annuler': 'accueil.faire',
  'atelier.devis.creer': 'accueil.faire',
  'atelier.devis.repondre': 'accueil.faire',
  'atelier.confirmation.deux_or_ouverts': 'accueil.faire',
  // ---- Atelier ---------------------------------------------------------------------------------
  'atelier.or.lire': 'atelier.voir',
  'atelier.or.demarrer': 'atelier.faire',
  'atelier.or.passer_en_controle': 'atelier.faire',
  // Séparation des tâches (capacités dérivées, `capacitesDeLaGrille`) : un poste de stock ne
  // contrôle pas, n'émet pas, ne valide pas d'achat ; voir @dfa/shared `capacites.ts`.
  // Séparation des tâches (capacités dérivées, voir `capacitesDeLaGrille` dans @dfa/shared) :
  // un poste de stock ne contrôle pas, n'émet ni facture ni avoir, ne valide pas d'achat.
  'atelier.or.controler': 'atelier.controle',
  'atelier.ligne.marquer_realisee': 'atelier.faire',
  'atelier.pointage.demarrer': 'atelier.faire',
  'atelier.pointage.arreter': 'atelier.faire',
  'atelier.pointage.lire': 'atelier.faire',
  // Gestes partagés atelier / comptoir.
  'atelier.ligne.creer': ['atelier.faire', 'accueil.faire'],
  'atelier.ligne.photo.ajouter': ['atelier.faire', 'accueil.faire'],
  'atelier.ligne.photo.supprimer': ['atelier.faire', 'accueil.faire'],
  'vehicule.kilometrage.saisir': ['atelier.faire', 'accueil.faire'],
  'vehicule.travail_reporte.signaler': ['atelier.faire', 'accueil.faire'],
  'pneus.depot.creer': ['atelier.faire', 'accueil.faire'],
  'pneus.depot.changer_saison': ['atelier.faire', 'accueil.faire'],
  // Réservé au profil d'appareil.
  'atelier.pointage.identifier': 'borne',
  // ---- Facturation & caisse --------------------------------------------------------------------
  // `encadrer` en plus : le compte technique `admin` (RF-115) lit la liste des documents sans
  // aucun droit financier ; ses montants restent masqués (pas de niveau Facturation).
  'facturation.document.lire': ['facturation.voir', 'encadrer'],
  'facturation.paiement.lire': 'facturation.montants',
  // RF-116 : imprimer expose le montant (QR) -> exige de voir les montants.
  'facturation.document.imprimer': 'facturation.montants',
  'facturation.paiement.creer': 'facturation.encaisser',
  'facturation.paiement.imputer': 'facturation.encaisser',
  'facturation.document.creer': 'facturation.faire',
  'facturation.document.modifier': 'facturation.faire',
  'facturation.document.transitionner': 'facturation.faire',
  'facturation.document.emettre': 'facturation.emettre_devis',
  'facturation.document.emettre_devis_bc': 'facturation.emettre_devis',
  'facturation.document.emettre_facture': 'facturation.emettre_facture',
  'facturation.document.emettre_avoir': 'facturation.emettre_facture',
  'facturation.avoir.creer': 'facturation.faire',
  // Contrainte (option « avoirs plafonnés »), pas un pouvoir.
  'facturation.avoir.plafonne': 'contrainte.avoir_plafonne',
  // ---- Finances --------------------------------------------------------------------------------
  'tableau_bord.financier.lire': 'finances.voir',
  'facturation.parametrage.creancier.lire': 'finances.voir',
  'facturation.export.lire': 'finances.voir',
  'relances.facturation.regle.lire': 'finances.voir',
  'facturation.paiement.rembourser': 'finances.faire',
  'facturation.paiement.abandonner': 'finances.faire',
  'facturation.document.corriger': 'finances.faire',
  'facturation.export.creer': 'finances.faire',
  'relances.facturation.regle.ecrire': 'finances.faire',
  'relances.facturation.planifier': 'finances.faire',
  'relances.facturation.envoyer': 'finances.faire',
  'parametrage.atelier.plafond_avoir.modifier': 'finances.faire',
  'ventes.financement.confirmer': ['finances.faire', 'ventes.faire'],
  'ventes.financement.refuser': ['finances.faire', 'ventes.faire'],
  // ---- Pièces & stock --------------------------------------------------------------------------
  'pieces.article.lire': 'pieces.voir',
  'pieces.stock.lire': 'pieces.voir',
  'pieces.reservation.lire': 'pieces.voir',
  // Achats : visibles avec « Faire » (les factures fournisseur et consignes aussi via Finances).
  'pieces.fournisseur.lire': 'pieces.faire',
  'pieces.commande_fournisseur.lire': 'pieces.faire',
  'pieces.parametrage.lire': 'pieces.faire',
  'pieces.consigne.lire': ['pieces.faire', 'finances.voir'],
  'pieces.facture_fournisseur.lire': ['pieces.faire', 'finances.voir'],
  'pieces.article.creer': 'pieces.faire',
  'pieces.article.modifier': 'pieces.faire',
  'pieces.stock.modifier': 'pieces.faire',
  // Les 8 actions historiquement réservées au seul magasinier (mouvements de stock, réception,
  // consignes, factures fournisseur) : « tenue du magasin ». Refusées au chef d'atelier qui
  // encadre (il commande, il ne réceptionne ni ne valide), accordées à direction par phase 0.
  'pieces.mouvement.creer': 'pieces.magasin',
  'pieces.mouvement.forcer': 'pieces.magasin',
  'pieces.reservation.satisfaire': 'pieces.magasin',
  'pieces.reservation.liberer': 'pieces.faire',
  'pieces.fournisseur.creer': 'pieces.faire',
  'pieces.fournisseur.modifier': 'pieces.faire',
  'pieces.commande_fournisseur.creer': 'pieces.faire',
  'pieces.commande_fournisseur.reception': 'pieces.magasin',
  'pieces.consigne.retourner': 'pieces.magasin',
  'pieces.parametrage.modifier': 'pieces.faire',
  'pieces.facture_fournisseur.deposer': 'pieces.magasin',
  'pieces.facture_fournisseur.valider': 'pieces.magasin',
  'pieces.facture_fournisseur.rejeter': 'pieces.magasin',
  // ---- Ventes VN/VO ----------------------------------------------------------------------------
  // Lecture des véhicules en stock et des dossiers : aussi pour qui gère les pièces (chef
  // d'atelier, magasinier) — le chef d'atelier les lit aujourd'hui SANS voir reprises ni
  // financements (faille corrigée, `ventes/mappers.spec.ts`), ce que « Ventes : Voir » ne
  // permettrait pas de préserver.
  'ventes.vehicule_stock.lire': ['ventes.voir', 'pieces.faire'],
  'ventes.dossier.lire': ['ventes.voir', 'pieces.faire'],
  'ventes.reprise.lire': 'ventes.voir',
  'ventes.financement.lire': 'ventes.voir',
  'ventes.vehicule_stock.creer': 'ventes.faire',
  'ventes.vehicule_stock.modifier': 'ventes.faire',
  // Corriger un véhicule en stock / confirmer une reprise : décisions de patron aujourd'hui.
  'ventes.vehicule_stock.corriger': 'patron',
  'ventes.dossier.creer': 'ventes.faire',
  'ventes.dossier.modifier': 'ventes.faire',
  'ventes.dossier.engager': 'ventes.faire',
  'ventes.dossier.preparer': 'ventes.faire',
  'ventes.dossier.marquer_pret_a_livrer': 'ventes.faire',
  'ventes.dossier.livrer': 'ventes.faire',
  'ventes.dossier.cloturer': 'ventes.faire',
  'ventes.dossier.annuler': 'ventes.faire',
  'ventes.dossier.abandonner': 'ventes.faire',
  'ventes.reprise.creer': 'ventes.faire',
  'ventes.reprise.modifier': 'ventes.faire',
  'ventes.reprise.negocier': 'ventes.faire',
  'ventes.reprise.confirmer': 'patron',
  'ventes.reprise.refuser': 'ventes.faire',
  'ventes.financement.creer': 'ventes.faire',
};
