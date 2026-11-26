-- ============================================================
-- BatiDZ — Créer le compte administrateur
-- 1. Inscrivez-vous d'abord sur le site (n'importe quel profil, email facultatif)
--    avec le numéro de téléphone que vous voulez pour l'administration.
-- 2. Dans phpMyAdmin, onglet SQL : remplacez 0XXXXXXXXX par ce numéro, puis Exécuter.
-- Le profil « administrateur » ne peut pas se choisir à l'inscription : seul ce script le donne.
-- ============================================================

UPDATE utilisateurs SET profil = 'administrateur', est_admin = 1 WHERE telephone = '0XXXXXXXXX';

-- Vérification : doit afficher votre compte avec profil = administrateur et est_admin = 1
SELECT id, nom_complet, telephone, profil, est_admin FROM utilisateurs WHERE est_admin = 1;

-- Pour retirer les droits d'administrateur à un compte (remettre son profil d'origine) :
-- UPDATE utilisateurs SET profil = 'entrepreneur', est_admin = 0 WHERE telephone = '0XXXXXXXXX';
