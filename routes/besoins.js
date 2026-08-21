const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

// ============================================================
// AJOUTER UN BESOIN (POST)
// ============================================================
router.post('/', auth, async (req, res) => {
    const { chantier_id, categorie, titre, description, quantite, unite, budget_estime, date_besoin } = req.body;
    const db = req.app.get('db');

    if (req.utilisateur.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut ajouter un besoin' });
    }

    try {
        const [chantier] = await db.query(
            `SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [chantier_id, req.utilisateur.id]
        );
        if (chantier.length === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé ou non autorisé' });
        }

        const [result] = await db.query(
            `INSERT INTO besoins_chantier 
            (chantier_id, categorie, titre, description, quantite, unite, budget_estime, date_besoin) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [chantier_id, categorie, titre, description, quantite, unite, budget_estime, date_besoin]
        );

        res.status(201).json({
            message: 'Besoin ajouté avec succès',
            besoin: { id: result.insertId, chantier_id, categorie, titre }
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES BESOINS D'UN CHANTIER (GET)
// ============================================================
router.get('/chantier/:chantier_id', auth, async (req, res) => {
    const { chantier_id } = req.params;
    const db = req.app.get('db');

    try {
        const [besoins] = await db.query(
            `SELECT *, 
                    quantite_trouvee, 
                    (quantite - quantite_trouvee) AS besoin_restant
             FROM besoins_chantier 
             WHERE chantier_id = ?
             ORDER BY date_besoin ASC`,
            [chantier_id]
        );
        res.json(besoins);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER UN BESOIN PAR ID (GET)
// ============================================================
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [besoin] = await db.query(
            `SELECT * FROM besoins_chantier WHERE id = ?`,
            [id]
        );
        if (besoin.length === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }
        res.json(besoin[0]);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// MODIFIER UN BESOIN (PUT)
// ============================================================
router.put('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { categorie, titre, description, quantite, unite, budget_estime, date_besoin, statut } = req.body;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `UPDATE besoins_chantier 
             SET categorie = ?, titre = ?, description = ?, quantite = ?, unite = ?, budget_estime = ?, date_besoin = ?, statut = ?
             WHERE id = ?`,
            [categorie, titre, description, quantite, unite, budget_estime, date_besoin, statut, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        res.json({ message: 'Besoin modifié avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// SUPPRIMER UN BESOIN (DELETE)
// ============================================================
router.delete('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `DELETE FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        res.json({ message: 'Besoin supprimé avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// METTRE À JOUR LA PROGRESSION
// ============================================================
router.put('/:id/progression', auth, async (req, res) => {
    const { id } = req.params;
    const { quantite_trouvee } = req.body;
    const db = req.app.get('db');

    try {
        await db.query(
            `UPDATE besoins_chantier SET quantite_trouvee = ? WHERE id = ?`,
            [quantite_trouvee, id]
        );

        const [besoin] = await db.query(
            `SELECT quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (besoin.length > 0 && besoin[0].quantite_trouvee >= besoin[0].quantite) {
            await db.query(
                `UPDATE besoins_chantier SET statut = 'satisfait' WHERE id = ?`,
                [id]
            );
        } else if (besoin[0].quantite_trouvee > 0) {
            await db.query(
                `UPDATE besoins_chantier SET statut = 'en_cours' WHERE id = ?`,
                [id]
            );
        }

        res.json({ message: 'Progression mise à jour' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// VALIDER UN BESOIN COMME SATISFAIT
// ============================================================
router.put('/:id/valider', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [besoin] = await db.query(
            `SELECT quantite FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (besoin.length === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        await db.query(
            `UPDATE besoins_chantier SET statut = 'satisfait', quantite_trouvee = quantite WHERE id = ?`,
            [id]
        );

        res.json({ message: 'Besoin validé comme satisfait' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;
