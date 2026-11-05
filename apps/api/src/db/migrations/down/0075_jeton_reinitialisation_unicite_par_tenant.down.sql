-- Inverse de 0075 : retour à l'unicité globale de l'empreinte posée par 0074. Échoue fort si deux
-- tenants portent entre-temps la même empreinte (collision SHA-256 : pratiquement impossible).

alter table public.jeton_reinitialisation_mot_de_passe
  drop constraint jeton_reinitialisation_mot_de_passe_empreinte_uk;

alter table public.jeton_reinitialisation_mot_de_passe
  add constraint jeton_reinitialisation_mot_de_passe_empreinte_uk
  unique (empreinte_jeton);
