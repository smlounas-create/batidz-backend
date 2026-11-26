-- ============================================================
-- BatiDZ — Coordonnées de paiement saisies dans l'espace administrateur
-- À lancer dans phpMyAdmin (Clever Cloud), onglet SQL. Peut être relancé sans risque.
-- Les valeurs saisies sur le site passent avant les variables PAIEMENT_* de Render.
-- ============================================================

CREATE TABLE IF NOT EXISTS parametres (
    cle VARCHAR(60) NOT NULL PRIMARY KEY,
    valeur VARCHAR(255) NULL,
    modifie_par INT NULL,
    date_modification TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
