-- =============================================================================================
-- 0005_parametrage.down.sql — annulation de 0005_parametrage.sql
--
-- Ordre inverse : tables d'abord (dans l'ordre inverse de leurs dépendances FK), puis TOUS les
-- enums créés par 0005. Aucun `cascade` : si 0006→0008 est encore appliquée, une table métier y
-- référence `prestation`/`site` ou un des enums ci-dessous et ce script échoue — c'est voulu.
-- =============================================================================================

drop table if exists public.activite_indirecte;
drop table if exists public.poste_travail;
drop table if exists public.motif_rendez_vous;
drop table if exists public.prestation_prix;
drop table if exists public.prestation;
drop table if exists public.taux_horaire;
drop table if exists public.compteur_document;
drop table if exists public.parametre_site;
drop table if exists public.parametre_atelier;

drop type if exists public.politique_deux_or_meme_vehicule;
drop type if exists public.politique_mention_securite;
drop type if exists public.visibilite_historique_vehicule;
drop type if exists public.politique_demontage_refuse;
drop type if exists public.politique_langue_document;
drop type if exists public.arrondi_pointage;
drop type if exists public.politique_signature_reception;
drop type if exists public.politique_controle_qualite;
drop type if exists public.unite_temps;
drop type if exists public.portee_numerotation;

drop type if exists public.statut_pret_courtoisie;
drop type if exists public.etat_vehicule_courtoisie;

drop type if exists public.statut_periode_pointage;
drop type if exists public.nature_activite_pointage;
drop type if exists public.source_pointage;
drop type if exists public.statut_pointage;

drop type if exists public.type_ressource_planning;
drop type if exists public.origine_rendez_vous;
drop type if exists public.mode_attente_rdv;
drop type if exists public.statut_rendez_vous;

drop type if exists public.decision_devis;
drop type if exists public.canal_devis;

drop type if exists public.blocage_ligne_or;
drop type if exists public.payeur_ligne_or;
drop type if exists public.origine_ligne_or;
drop type if exists public.type_ligne_or;

drop type if exists public.motif_lien_or;
drop type if exists public.localisation_vehicule;
drop type if exists public.type_ordre_reparation;

drop type if exists public.statut_travail_reporte;
drop type if exists public.urgence_travail;
drop type if exists public.motif_archivage_vehicule;
drop type if exists public.statut_vehicule;
drop type if exists public.statut_campagne;
drop type if exists public.source_echeance_expertise;
drop type if exists public.resultat_expertise;
drop type if exists public.motif_fin_detention;
drop type if exists public.motif_kilometrage_regressif;
drop type if exists public.source_kilometrage;
drop type if exists public.unite_distance;

drop type if exists public.nature_note;
drop type if exists public.type_consentement;
drop type if exists public.role_contact;
drop type if exists public.type_adresse;
drop type if exists public.statut_client;
drop type if exists public.type_client;
