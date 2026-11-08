-- Inverse de 0098 : retire la table puis les deux types. Perte assumee : les reglages d'envoi
-- (le mot de passe chiffre n'est pas recuperable ailleurs).
drop table public.parametre_envoi_courriel;
drop type public.cause_echec_envoi_courriel;
drop type public.securite_smtp;
