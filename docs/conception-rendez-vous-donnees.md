# Conception données — rendez-vous d'atelier

Branche `feat/rendez-vous-atelier`. Angle données uniquement : schéma, contraintes, index, invariants. Parcours d'écran et workflow métier : hors périmètre, voir les propositions parallèles.

**Migration proposée : `0052`.** `0050` et `0051` sont pris par le second développeur (point de contact à négocier avant d'écrire le SQL réel — un nouveau `0051`/`0052` en parallèle du sien est le scénario de collision documenté dans CONTRIBUTING.md).

## 0. Ce que le dépôt a déjà anticipé

Avant de trancher, trois éléments existants contraignent la conception — ignorer l'un des trois produirait un doublon ou une incohérence avec du code déjà mergé :

1. **`ordre_reparation.rendez_vous_id`** (uuid, nullable, sans FK) existe depuis le lot 1 avec le commentaire `« Accroche lot 3 (planning) : sans FK, rendez_vous n'existe pas au lot 1 »`. La direction de la relation est donc déjà actée dans le schéma : **l'OR référence le rendez-vous, jamais l'inverse.**
2. **`ordre_reparation.statut` inclut déjà `'planifie'`**, premier état de `STATUTS_ORDRE_REPARATION`, avec transition `T-03 planifie -> ouvert` (réception, kilométrage d'entrée) et `T-20 {planifie,ouvert} -> annule`. Gatée par `parametre_atelier.etat_planifie_actif` (P-22, défaut `false`). Un OR peut donc déjà naître avant la réception physique du véhicule — exactement le besoin d'un rendez-vous confirmé par téléphone.
3. **`parametre_atelier` porte déjà deux drapeaux dédiés** : `or_sans_rdv_autorise` (bool, défaut `true` — un OR peut naître sans rendez-vous, walk-in) et `rdv_retroactif_auto` (bool, défaut `false` — un walk-in peut générer rétroactivement un rendez-vous). Ces deux colonnes n'ont aujourd'hui aucune table `rendez_vous` à gouverner ; elles fixent la politique que ce modèle doit rendre exécutable.
4. **`ordre_reparation.restitution_promise_le` / `restitution_initiale_le`** existent déjà (timestamptz, nullables) sur l'OR. Aucune nouvelle colonne de restitution n'est proposée ici — voir §5.

Le modèle ci-dessous complète ces accroches, il ne les recrée pas.

## 1. Forme du rendez-vous : jour + moment, pas un intervalle

**Décision : pas de `tsrange` + `EXCLUDE`.** Un `EXCLUDE USING gist` empêche le chevauchement de deux intervalles sur une **ressource nommée** — c'est l'outil pour « ce pont est occupé de 9h à 10h ». Ici, rien n'est réservé nommément (§2) : sans ressource, un intervalle exact n'a rien à ne-pas-chevaucher, et il mentirait par excès de précision (un client dit « demain matin », pas « 9h14–9h58 »).

Colonnes :

- `date` (`date`, NOT NULL) — jour du rendez-vous.
- `moment` (enum `moment_rendez_vous` : `matin` / `apres_midi` / `toute_journee`, NOT NULL) — granularité réelle de ce qui se négocie au téléphone.
- `heure_souhaitee` (`time`, nullable) — heure précise **si le client ou le garage la fixe**, en plus du moment. Absence ≠ valeur : `NULL` signifie « moment respecté, heure non fixée », jamais « pas de rendez-vous » ni « rendez-vous toute la journée » (qui a sa propre valeur `moment = 'toute_journee'`). Les trois états que le prompt distingue (pas d'heure fixée / toute la journée / annulé) ont donc chacun leur propre représentation, jamais partagée : `heure_souhaitee IS NULL`, `moment = 'toute_journee'`, `statut = 'annule'` — trois colonnes différentes, aucune ne se substitue à une autre.
- `duree_estimee_minutes` (`integer`, nullable, `CHECK > 0`) — estimation du garagiste au téléphone (« on bloque 45 minutes »). **Unité : minutes**, pas les centièmes d'heure du pointage (`temps_bareme_centiemes`, `duree_arrondie_centiemes`) : ce nombre n'entre dans aucun calcul de paie ou de facturation, il sert uniquement à dimensionner un créneau et, une fois l'OR ouvert, à amorcer `restitution_promise_le` (§5). Lui donner l'unité du pointage laisserait croire à une précision de facturation qu'il n'a pas.

Pas de contrainte DB reliant `date`/`moment` au « futur » : un rendez-vous rétroactif (`origine = 'retroactif'`, §4) peut légitimement porter une date passée.

## 2. Ce qui est réservé : capacité agrégée, pas de ressource nommée

**Décision : capacité agrégée, calculée à la volée, pas de ressource nommée au rendez-vous.** Aucune colonne `technicien_id` ni `pont_id` sur `rendez_vous`. Rationnel :

- Au moment de l'appel, le garage ne sait généralement pas quel technicien fera le travail — cette affectation se décide à l'ouverture de l'OR (`ligne_or.technicien_id` existe déjà, alimenté plus tard).
- `parametre_site.capacite_heures_jour_centiemes` existe déjà mais mesure autre chose : un objectif de productivité pointage (heures facturables visées par jour), pas un nombre de créneaux d'accueil. Le réutiliser pour plafonner les rendez-vous confondrait deux métriques sans rapport (un jour à 3 techniciens malades a une capacité pointage réduite sans que le nombre de ponts d'accueil ait changé) — pas de couplage entre les deux.
- **Pas de plafond fait tenir par la base dans cette proposition.** Le compte de rendez-vous actifs par site/jour/moment est une lecture directe et bon marché (`COUNT(*) ... WHERE tenant_id=… AND site_id=… AND date=… AND moment=… AND statut='confirme'`), servie par l'index partiel `rendez_vous_actifs_idx` (§6) — pas besoin de compteur maintenu qui dérive. Si le métier veut un **refus dur** au-delà d'un seuil (pas seulement un avertissement), c'est un point d'arbitrage : un tel plafond demanderait soit une colonne de capacité par site/moment (absente aujourd'hui, à ajouter) plus un verrou applicatif (`SELECT ... FOR UPDATE` sur la fenêtre avant insertion, seule façon fiable d'empêcher une course sans ressource nommée à exclure), soit l'acceptation d'un dépassement occasionnel corrigé a posteriori. **Signalé pour ton arbitrage — l'agent métier tranche le blocage/avertissement, ce document ne pose que le seam de données (l'index qui rend le comptage bon marché).**

## 3. Table `rendez_vous`

| Colonne                  | Type                                                      | Contrainte                                                               | Rôle                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | uuid                                                      | PK, `default gen_random_uuid()`                                          | `colonneId()` standard.                                                                                                                                                                                                                                                                                                                                                            |
| `tenant_id`              | uuid                                                      | NOT NULL                                                                 | Isolation tenant (RLS + scoping applicatif).                                                                                                                                                                                                                                                                                                                                       |
| `site_id`                | uuid                                                      | NOT NULL, FK composite `(tenant_id, site_id) -> site`                    | Martigny/Sion — chaque rendez-vous est rattaché à un site, pas au tenant seul.                                                                                                                                                                                                                                                                                                     |
| `client_id`              | uuid                                                      | NOT NULL, FK composite `-> client`                                       | Qui appelle. Toujours connu au moment de la prise de RDV.                                                                                                                                                                                                                                                                                                                          |
| `vehicule_id`            | uuid                                                      | **nullable**, FK composite `-> vehicule`                                 | Souvent connu, pas toujours (client qui n'a pas la plaque sous la main, ou nouveau client sans fiche véhicule). Doit être renseigné avant que le rendez-vous devienne un OR (garde applicative — `ordre_reparation.vehicule_id` est NOT NULL) ; la base ne force pas le remplissage plus tôt, ce serait refuser une réservation légitime pour une donnée qui arrivera à l'accueil. |
| `type`                   | enum `type_ordre_reparation` (réutilisé, pas dupliqué)    | NOT NULL                                                                 | Même enum que `ordre_reparation.type` (`service`, `reparation`, `diagnostic`, `expertise`, `pneus`, `carrosserie`, `retouche`, `interne`) : le garagiste classe au téléphone ce qu'il reclasserait de toute façon à l'ouverture de l'OR. Un seul enum à faire évoluer, jamais deux taxonomies à resynchroniser.                                                                    |
| `motif`                  | text                                                      | NOT NULL, `CHECK length(btrim(motif)) > 0`                               | Verbatim du garagiste (« bruit au freinage avant droit »). Même doctrine que `ordre_reparation_demande.verbatim` : texte libre, pas d'enum — les motifs réels ne se laissent pas clore dans une liste.                                                                                                                                                                             |
| `date`                   | date                                                      | NOT NULL                                                                 | §1.                                                                                                                                                                                                                                                                                                                                                                                |
| `moment`                 | enum `moment_rendez_vous`                                 | NOT NULL                                                                 | §1.                                                                                                                                                                                                                                                                                                                                                                                |
| `heure_souhaitee`        | time                                                      | nullable                                                                 | §1.                                                                                                                                                                                                                                                                                                                                                                                |
| `duree_estimee_minutes`  | integer                                                   | nullable, `CHECK > 0`                                                    | §1.                                                                                                                                                                                                                                                                                                                                                                                |
| `statut`                 | enum `statut_rendez_vous`                                 | NOT NULL, défaut `'confirme'`                                            | §4.                                                                                                                                                                                                                                                                                                                                                                                |
| `motif_annulation`       | text                                                      | nullable, `CHECK (statut <> 'annule') OR (motif_annulation IS NOT NULL)` | Obligatoire seulement à l'annulation — même patron que `ordre_reparation_annulation_coherente_chk`.                                                                                                                                                                                                                                                                                |
| `origine`                | enum `origine_rendez_vous` (`reservation` / `retroactif`) | NOT NULL, défaut `'reservation'`                                         | Distingue une vraie prise de rendez-vous d'une ligne créée après coup pour un walk-in (`parametre_atelier.rdv_retroactif_auto`). Sans cette colonne, toute statistique « % du travail passé par le planning » compterait les deux identiquement et mentirait.                                                                                                                      |
| `confirme_le`            | timestamptz                                               | NOT NULL, `default now()`                                                | Instant de la prise (= `cree_le` en pratique pour `origine='reservation'`, mais nommé sémantiquement pour rester correct si un jour un RDV naît `'provisoire'` avant confirmation — hors périmètre v1, voir §7).                                                                                                                                                                   |
| `honore_le`              | timestamptz                                               | nullable                                                                 | Instant de la transition vers `'honore'`.                                                                                                                                                                                                                                                                                                                                          |
| `no_show_constate_le`    | timestamptz                                               | nullable                                                                 | Instant de la transition vers `'no_show'`.                                                                                                                                                                                                                                                                                                                                         |
| `annule_le`              | timestamptz                                               | nullable                                                                 | Instant de la transition vers `'annule'`.                                                                                                                                                                                                                                                                                                                                          |
| `cree_par_id`            | uuid                                                      | nullable, FK composite `-> utilisateur`                                  | Qui a pris l'appel (réceptionniste). Nullable : une reprise de données historique n'aura pas toujours cette information.                                                                                                                                                                                                                                                           |
| `cree_le` / `modifie_le` | timestamptz                                               | `colonnesHorodatage()`                                                   | Standard. `modifie_le` bouge à chaque déplacement de créneau — **ne sert donc jamais** à dater « quand est-il devenu honoré » : c'est le rôle des trois colonnes `*_le` ci-dessus, même raisonnement que les multiples `*_le` de `ordre_reparation` plutôt qu'un unique `modifie_le` surchargé.                                                                                    |

**Déplacer un rendez-vous** = `UPDATE` de `date`/`moment`/`heure_souhaitee` sur la même ligne, `statut` inchangé (`'confirme'` reste `'confirme'`). Pas de colonne dédiée « ancien créneau » : l'entité est auditée (§8, `auditer_atelier('rendez_vous')`), l'avant/après du déplacement vit dans `audit_atelier` comme pour toute autre entité sensible — pas de mécanisme bespoke à la `pointage.derniere_correction_*` (celui-ci existe pour gérer un cas hors-ligne/horodatage-client que le rendez-vous n'a pas).

**Pas de `numero`.** Contrairement à l'OR ou à la facture, le rendez-vous n'est pas un document légal numéroté séquentiellement — il se retrouve par client + date, jamais cité tel quel sur un document imprimé. Lui donner un compteur (`compteur_document`) ajouterait une séquence sans consommateur.

## 4. États : `statut_rendez_vous`

```
confirme ──> honore
         ├─> no_show
         └─> annule
```

Quatre valeurs, un seul état source, trois états terminaux — pas de graphe à faire tenir par une fonction `transition_autorisee` façon OR (`0003_prealables_etape1.sql §5.1`, 9 états, machinerie justifiée par leur nombre). Ici, la base tient l'invariant **le plus important et le moins cher à garantir : un état terminal ne redevient jamais actif**, via un trigger `BEFORE UPDATE` :

```
rendez_vous_empecher_reouverture() :
  si OLD.statut in ('honore','no_show','annule')
     et NEW.statut est distinct de OLD.statut
  -> exception
```

Ce trigger n'interdit pas de corriger un autre champ (ex. `motif_annulation`) après coup — seule la résurrection du statut est bloquée. La logique **qui** peut déclencher `honore`/`no_show`/`annule`, et depuis quel geste métier (arrivée du client, ouverture d'OR, appel de désistement), reste au service applicatif — trop dépendante du parcours pour être une règle de base, et c'est l'objet du chantier métier parallèle. **Avis motivé** : la base tient l'irréversibilité (peu coûteux, jamais négociable), le service tient l'orchestration (dépend du contexte d'appel, change plus souvent que la structure).

## 5. Restitution promise : un seul champ, celui qui existe déjà

**Décision : `ordre_reparation.restitution_promise_le` reste l'unique source de vérité.** Aucun champ de restitution n'est ajouté à `rendez_vous`. Deux écrans qui liraient chacun un champ différent (l'un le RDV, l'autre l'OR) sont exactement le bug que le prompt signale — quatre défauts déjà produits par cette confusion cette semaine sur un mécanisme voisin (`IndicateurRetard`/`enRetard` de la facturation, qui a dû être corrigé pour la même raison : deux notions proches fusionnées dans un seul champ produisaient un mauvais calcul, `apps/web/src/ecrans/facturation/IndicateurRetard.tsx`).

Le rendez-vous ne **promet** rien formellement — au téléphone, le garagiste **estime** (`duree_estimee_minutes`, §1). Quand l'OR naît à partir du rendez-vous (`planifie` ou `ouvert`, avec `rendez_vous_id` renseigné), le service qui l'ouvre peut **initialiser une fois** `ordre_reparation.restitution_promise_le` à partir de `rendez_vous.date + heure_souhaitee (ou fin du moment) + duree_estimee_minutes` — un calcul applicatif hors du périmètre de ce document, mais le seam de données est clair : lecture depuis `rendez_vous`, écriture une seule fois sur `ordre_reparation`, jamais de second champ à tenir synchronisé ensuite. Le rendez-vous n'est jamais relu pour calculer un retard une fois l'OR ouvert.

Ceci répond aussi à la question du « retard de rendu, aujourd'hui impossible faute de date renseignée » : la colonne existe depuis le lot 1, elle n'est simplement jamais écrite par aucun service actuel (aucun appelant trouvé dans le code exploré). Le vrai manque n'est pas une colonne absente, c'est l'absence d'écrivain — et ce rendez-vous en devient le premier.

## 6. Contraintes et index — table par table

### `rendez_vous`

```
unique (tenant_id, id)
FK (tenant_id, site_id)        -> site(tenant_id, id)        ON DELETE RESTRICT
FK (tenant_id, client_id)      -> client(tenant_id, id)      ON DELETE RESTRICT
FK (tenant_id, vehicule_id)    -> vehicule(tenant_id, id)    ON DELETE RESTRICT   -- nullable
FK (tenant_id, cree_par_id)    -> utilisateur(tenant_id, id) ON DELETE RESTRICT  -- nullable
CHECK rendez_vous_motif_non_vide_chk        : length(btrim(motif)) > 0
CHECK rendez_vous_duree_positive_chk        : duree_estimee_minutes is null or duree_estimee_minutes > 0
CHECK rendez_vous_annulation_motif_chk      : statut <> 'annule' or motif_annulation is not null
CHECK rendez_vous_terminal_le_coherent_chk  : (statut = 'honore')  = (honore_le is not null)
                                           and (statut = 'no_show') = (no_show_constate_le is not null)
                                           and (statut = 'annule')  = (annule_le is not null)
```

Index :

| Index                        | Colonnes                                                            | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rendez_vous_agenda_idx`     | `(tenant_id, site_id, date, moment)`                                | Vue planning du jour par site — la requête la plus fréquente de l'écran (« les RDV de Martigny demain matin »).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `rendez_vous_actifs_idx`     | `(tenant_id, site_id, date, moment) WHERE statut = 'confirme'`      | Comptage de capacité (§2) et rappels J-1 — partiel : les RDV terminaux ne participent ni à l'un ni à l'autre, pas la peine de les scanner.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `rendez_vous_client_idx`     | `(tenant_id, client_id, date DESC)`                                 | Historique de RDV d'un client (fiche client).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rendez_vous_vehicule_idx`   | `(tenant_id, vehicule_id, date DESC) WHERE vehicule_id IS NOT NULL` | Historique de RDV d'un véhicule ; partiel car souvent nul (§3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `rendez_vous_pagination_idx` | `(tenant_id, cree_le DESC, id DESC)`                                | Liste globale paginée par curseur (`GET /rendez-vous`), même patron que `ordre_reparation_pagination_idx`. **Piège connu du dépôt** : `pg` réduit un `timestamptz` en `Date` JS et perd la microseconde, ce qui saute des lignes en silence sous forte cadence d'écriture — l'endpoint de liste doit lire `cree_le::text` et construire son curseur avec `valeurCurseurTimestamptz()`, jamais comparer des `Date` JS. Ce n'est pas un choix d'index, c'est une contrainte sur le code de lecture qui consomme cet index — signalé ici pour que l'agent d'implémentation ne le redécouvre pas à la dure. |

### `ordre_reparation` (modification, pas de nouvelle table)

```
ALTER TABLE ordre_reparation
  ADD CONSTRAINT ordre_reparation_fk_rendez_vous
  FOREIGN KEY (tenant_id, rendez_vous_id)
  REFERENCES rendez_vous (tenant_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE ordre_reparation
  VALIDATE CONSTRAINT ordre_reparation_fk_rendez_vous;

CREATE INDEX ordre_reparation_rendez_vous_idx
  ON ordre_reparation (tenant_id, rendez_vous_id)
  WHERE rendez_vous_id IS NOT NULL;
```

`NOT VALID` puis `VALIDATE CONSTRAINT` en deux temps même si, à ce jour, `rendez_vous_id` est toujours `NULL` sur toute ligne existante (colonne posée au lot 1 sans écrivain) — verrou plus léger que l'alternative, coûte rien, et c'est le geste par défaut sur une table aussi chaude que `ordre_reparation` (18 appelants recensés) : partir du principe qu'elle contient des lignes plutôt que de vérifier à la main avant chaque migration.

`ON DELETE RESTRICT`, comme toutes les FK de ce schéma (`ordre_reparation_fk_client`, `ordre_reparation_fk_vehicule`, etc.) : un rendez-vous honoré ne se supprime jamais tant qu'un OR le référence.

## 7. Ce qui reste hors périmètre (assumé, pas oublié)

- **Pas de rappel automatisé (SMS/e-mail J-1)** — c'est un job/notification, aucune colonne dédiée ici au-delà de ce que `rendez_vous_actifs_idx` rend déjà bon marché à interroger.
- **Pas d'état `'provisoire'`** (créneau retenu mais pas confirmé) — le besoin décrit est « oui/non au téléphone », donc binaire dès la création. Si le métier veut un entre-deux, `statut_rendez_vous` gagne une valeur (`ALTER TYPE ... ADD VALUE`, non réversible mais additif, même limite acceptée par `0010`/`0016`/`0025`/`0033`/`0043`).
- **Pas de plafond de capacité dur en base** — §2, arbitrage explicitement renvoyé.
- **Pas de champ `type` obligatoire si le métier préfère laisser le premier appel non classé** — actuellement NOT NULL par choix (§3) ; c'est le seul endroit où ce document empiète légèrement sur le parcours métier, à confirmer par l'agent métier.

## 8. Migration — plan expand/contract

Tout tient dans une seule migration additive (`0052_rendez_vous_atelier.sql`), rien à retirer :

1. `CREATE TYPE moment_rendez_vous`, `statut_rendez_vous`, `origine_rendez_vous`.
2. `CREATE TABLE rendez_vous` avec toutes les contraintes du §6.
3. `CREATE TRIGGER rendez_vous_touche_modifie_le` (fonction générique existante `public.touche_modifie_le()`).
4. `CREATE TRIGGER rendez_vous_empecher_reouverture` (§4, fonction nouvelle et dédiée).
5. `REVOKE ALL ... GRANT SELECT, INSERT, UPDATE` à `dfa_app` (pas de `DELETE` — cycle de vie réel mais jamais de suppression physique, même posture que `depot_pneus`/`ordre_reparation` : on annule, on ne supprime pas).
6. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + policy `rendez_vous_isolation_tenant` (`tenant_id = public.tenant_courant()`) + policy `rendez_vous_migrator` (`dfa_migrator`, `using (true)`) — copie exacte du patron `depot_pneus` (0043).
7. `ALTER TYPE entite_auditee ADD VALUE 'rendez_vous'` + `CREATE TRIGGER rendez_vous_audit ... EXECUTE FUNCTION public.auditer_atelier('rendez_vous')`.
8. `ALTER TABLE ordre_reparation ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` + index (§6).

**Down** : `DROP TABLE rendez_vous` (cascade sur contraintes/index/policies/triggers propres), `DROP TYPE` des trois enums, `DROP CONSTRAINT ordre_reparation_fk_rendez_vous` et `DROP INDEX ordre_reparation_rendez_vous_idx` sur `ordre_reparation`. **Ne peut pas défaire** : `entite_auditee ADD VALUE 'rendez_vous'` (aucun `DROP VALUE` en PostgreSQL) — même limite acceptée que `0010`/`0016`/`0025`/`0033`/`0043`, à déclarer dans `scripts/verifier-reversibilite-migrations.sh` (`obtenir_exception_down_partiel`, entrée `0052_rendez_vous_atelier.sql`) sinon la CI up→down→up échoue sur ce résidu attendu.

Aucune donnée existante à transformer (aucune ligne `ordre_reparation` n'a `rendez_vous_id` renseigné à ce jour) — pas de phase `expand` séparée d'un `contract` ultérieur, la FK s'ajoute directement.

## 9. Priorités

**Premier** (rien d'autre ne fonctionne sans) : la table `rendez_vous` elle-même (§3), ses trois enums, la FK `ordre_reparation -> rendez_vous`, `rendez_vous_agenda_idx`. C'est le socle qui permet « dire oui au téléphone, le retrouver, l'honorer ».

**Peut attendre** : `rendez_vous_actifs_idx` et le calcul de capacité (§2) — utile dès qu'un site sature, pas bloquant pour un premier premier garage à faible volume. Le déplacement de créneau (`UPDATE` + audit) fonctionne dès le socle, sans développement supplémentaire côté données. L'amorçage de `restitution_promise_le` depuis le rendez-vous (§5) peut suivre en deuxième vague : tant qu'il n'existe pas, `restitution_promise_le` reste simplement `NULL` comme aujourd'hui — dégradation neutre, pas une régression.
