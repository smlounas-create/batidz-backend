-- ============================================================
-- BatiDZ — Mot de passe oublié
-- À lancer une fois dans phpMyAdmin (onglet SQL), AVANT de pousser routes/auth.js et routes/admin.js.
-- ============================================================

-- 1. Les demandes « mot de passe oublié », traitées par un administrateur
CREATE TABLE IF NOT EXISTS demandes_mot_de_passe (
    id INT AUTO_INCREMENT PRIMARY KEY,
    utilisateur_id INT NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'en_attente',      -- en_attente / traitee / annulee
    date_creation TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    traitee_par INT NULL,
    date_traitement DATETIME NULL,
    INDEX idx_dmdp_utilisateur (utilisateur_id),
    INDEX idx_dmdp_statut (statut)
);

-- 2. Date limite du mot de passe provisoire (vide = mot de passe normal)
--    Si phpMyAdmin répond « Duplicate column name », la colonne existe déjà : c'est normal.
ALTER TABLE utilisateurs ADD COLUMN mdp_provisoire_expire DATETIME NULL;

-- Vérification : doit afficher la colonne mdp_provisoire_expire
SHOW COLUMNS FROM utilisateurs LIKE 'mdp_provisoire_expire';
