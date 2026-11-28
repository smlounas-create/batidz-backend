-- ============================================================
-- BatiDZ — Parrainage et « Comment avez-vous connu BatiDZ ? »
-- À lancer une fois dans phpMyAdmin (onglet SQL).
-- Si phpMyAdmin répond « Duplicate column name » ou « Duplicate key name » sur une ligne,
-- c'est que cette partie existe déjà : c'est normal, lancez les lignes suivantes une par une.
-- ============================================================

-- Qui a invité ce membre (vide = personne)
ALTER TABLE utilisateurs ADD COLUMN parrain_id INT NULL;

-- Réponse à « Comment avez-vous connu BatiDZ ? »
ALTER TABLE utilisateurs ADD COLUMN source_inscription VARCHAR(30) NULL;

-- Date à laquelle le parrain a été récompensé pour ce membre (vide = pas encore)
ALTER TABLE utilisateurs ADD COLUMN parrainage_recompense_le DATETIME NULL;

-- Pour retrouver vite les invités d'un membre
CREATE INDEX idx_utilisateurs_parrain ON utilisateurs (parrain_id);

-- Vérification : doit afficher les 3 colonnes
SHOW COLUMNS FROM utilisateurs WHERE Field IN ('parrain_id', 'source_inscription', 'parrainage_recompense_le');
