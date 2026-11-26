-- ============================================================
-- BatiDZ — Annonces de formation (organismes de formation) + email facultatif
-- À lancer dans phpMyAdmin (Clever Cloud) AVANT de pousser le serveur.
-- Peut être relancé : les tables déjà créées ne sont pas touchées.
-- ============================================================

-- 0. Email facultatif pour tous les profils (on se connecte aussi avec son téléphone)
ALTER TABLE utilisateurs MODIFY email VARCHAR(255) NULL;

-- 1. Nouveau profil « organisme_formation » : la colonne profil accepte désormais ce nom
--    (les profils existants ne changent pas)
ALTER TABLE utilisateurs MODIFY profil VARCHAR(30) NOT NULL;

-- 2. Les annonces de formation
CREATE TABLE IF NOT EXISTS formations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id INT NULL,                         -- organisme qui l'a publiée (vide si saisie par l'administrateur)
  cree_par INT NULL,                               -- compte qui l'a saisie
  titre VARCHAR(150) NOT NULL,
  domaine VARCHAR(30) NOT NULL,                    -- batiment / travaux_publics / hydraulique / securite / logiciels / gestion / engins / autre
  public_vise VARCHAR(20) NOT NULL DEFAULT 'tous', -- tous / entrepreneur / ouvrier / fournisseur
  mode VARCHAR(20) NOT NULL DEFAULT 'presentiel',  -- presentiel / en_ligne
  wilaya VARCHAR(10) NULL,
  lieu VARCHAR(150) NULL,
  date_debut DATE NULL,
  duree VARCHAR(60) NULL,
  prix INT NULL,                                   -- en DA ; 0 = gratuite
  description TEXT NOT NULL,
  organisme_nom VARCHAR(150) NOT NULL,
  telephone VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  site_web VARCHAR(200) NULL,
  agrement VARCHAR(60) NULL,                       -- n° d'agrément déclaré par l'organisme
  affiche MEDIUMTEXT NULL,                         -- image de l'annonce
  statut VARCHAR(20) NOT NULL DEFAULT 'a_valider', -- a_valider / validee / refusee
  motif_refus VARCHAR(255) NULL,
  date_fin_parution DATETIME NULL,                 -- visible jusqu'à cette date (durée payée)
  notifie TINYINT(1) NOT NULL DEFAULT 0,           -- notifications « nouvelle formation » déjà envoyées
  date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_modification DATETIME NULL,
  INDEX idx_formations_visibles (statut, date_fin_parution),
  INDEX idx_formations_utilisateur (utilisateur_id)
);

-- 3. Les personnes intéressées (« Je suis intéressé »), une seule fois par personne et par formation
CREATE TABLE IF NOT EXISTS formation_interets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  formation_id INT NOT NULL,
  utilisateur_id INT NOT NULL,
  date_creation DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_formation_interet (formation_id, utilisateur_id),
  INDEX idx_interets_formation (formation_id)
);

-- 4. Un paiement peut régler la parution d'une formation
--    (si phpMyAdmin répond « Duplicate column name 'formation_id' », cette étape était déjà faite : tout est prêt)
ALTER TABLE paiements
  ADD COLUMN formation_id INT NULL,
  ADD INDEX idx_paiements_formation (formation_id);

-- Vérification : doit afficher les deux nouvelles tables
SHOW TABLES LIKE 'formation%';
