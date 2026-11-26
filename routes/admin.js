// ============================================================
// FICHIER: routes/admin.js
// ⭐ Tableau de bord de l'administrateur : ce qui attend une action (reçus, formations),
//    les chiffres clés et les réglages qui manquent encore (coordonnées, variables Render).
//    Un administrateur est un compte avec est_admin = 1 ; le profil « administrateur »
//    se donne uniquement dans phpMyAdmin (fichier admin.sql), jamais à l'inscription.
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { tarifs, coordonneesSite } = require('./paiements');

async function exigerAdmin(req, res, next) {
    try {
        const [rows] = await req.app.get('db').query('SELECT est_admin FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!rows[0] || Number(rows[0].est_admin) !== 1) return res.status(403).json({ message: 'Réservé à l\'administrateur' });
        next();
    } catch (error) {
        console.error('Erreur contrôle administrateur:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
}

// Chaque chiffre est lu à part : une table pas encore créée ne fait pas tomber tout le tableau de bord
async function lire(db, sql, params = []) {
    try {
        const [rows] = await db.query(sql, params);
        return rows;
    } catch (e) {
        console.error('Tableau de bord :', e.message);
        return null;
    }
}
const nombre = (rows, champ = 'n') => (rows && rows[0] ? Number(rows[0][champ]) || 0 : null);

const VARIABLES_PRIX = ['PRIX_CREDIT_FOURNISSEUR', 'PRIX_CREDIT_OUVRIER', 'PRIX_ABONNEMENT_MENSUEL', 'PRIX_ABONNEMENT_ANNUEL',
    'PRIX_FORMATION_SEMAINE', 'PRIX_FORMATION_MOIS', 'REMISES_CREDITS_FOURNISSEUR'];

router.get('/tableau-de-bord', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const recus = await lire(db, "SELECT COUNT(*) AS n FROM paiements WHERE statut = 'en_attente' AND moyen IN ('ccp', 'baridimob', 'banque')");
        const formations = await lire(db, "SELECT COUNT(*) AS n FROM formations WHERE statut = 'a_valider'");
        const enLigne = await lire(db, "SELECT COUNT(*) AS n FROM formations WHERE statut = 'validee' AND date_fin_parution >= NOW()");
        const abonnes = await lire(db, "SELECT COUNT(*) AS n FROM utilisateurs WHERE profil = 'entrepreneur' AND abonnement_date_fin IS NOT NULL AND DATE(abonnement_date_fin) >= CURDATE()");
        const parProfil = await lire(db, 'SELECT profil, COUNT(*) AS n FROM utilisateurs GROUP BY profil');
        const mois = await lire(db, "SELECT COUNT(*) AS nombre, COALESCE(SUM(montant), 0) AS montant FROM paiements WHERE statut = 'valide' AND date_traitement >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");

        const inscrits = {};
        for (const r of parProfil || []) inscrits[r.profil] = Number(r.n) || 0;
        const t = tarifs(await coordonneesSite(db));

        res.json({
            a_traiter: { recus: nombre(recus), formations: nombre(formations) },
            chiffres: {
                inscrits,
                abonnements_actifs: nombre(abonnes),
                formations_en_ligne: nombre(enLigne),
                paiements_mois: mois && mois[0] ? { nombre: Number(mois[0].nombre) || 0, montant: Number(mois[0].montant) || 0 } : null
            },
            reglages: {
                virement: !!(t.comptes.ccp || t.comptes.baridimob),
                banque: !!t.comptes.banque_rib,
                carte: !!t.carte,
                variables_manquantes: VARIABLES_PRIX.filter(v => !process.env[v])
            }
        });
    } catch (error) {
        console.error('Erreur GET /admin/tableau-de-bord:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
