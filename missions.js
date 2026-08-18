const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

// ============================================================
// ENGAGER UN OUVRIER (POST)
// ============================================================
router.post('/', auth, async (req, res) => {
    const { ouvrier_id, chantier_id, besoin_id, date_debut, date_fin } = req.body;
    const db = req.app.get('db');

    if (req.utilisateur.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut engager un ouvrier' });
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
            `INSERT INTO missions 
            (entrepreneur_id, ouvrier_id, chantier_id, besoin_id, date_debut, date_fin, statut) 
            VALUES (?, ?, ?, ?, ?, ?, 'en_cours')`,
            [req.utilisateur.id, ouvrier_id, chantier_id, besoin_id, date_debut, date_fin]
        );

        await db.query(
            `UPDATE besoins_chantier SET statut = 'en_cours' WHERE id = ?`,
            [besoin_id]
        );

        res.status(201).json({
            message: 'Ouvrier engagé avec succès',
            mission: { id: result.insertId, ouvrier_id, chantier_id, date_debut, date_fin }
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES MISSIONS D'UN ENTREPRENEUR (GET)
// ============================================================
router.get('/entrepreneur', auth, async (req, res) => {
    const db = req.app.get('db');

    try {
        const [missions] = await db.query(
            `SELECT m.*, u.nom_complet as ouvrier_nom, c.nom as chantier_nom 
             FROM missions m
             JOIN utilisateurs u ON m.ouvrier_id = u.id
             JOIN chantiers c ON m.chantier_id = c.id
             WHERE m.entrepreneur_id = ?
             ORDER BY m.date_creation DESC`,
            [req.utilisateur.id]
        );
        res.json(missions);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES MISSIONS D'UN OUVRIER (GET)
// ============================================================
router.get('/ouvrier', auth, async (req, res) => {
    const db = req.app.get('db');

    try {
        const [missions] = await db.query(
            `SELECT m.*, u.nom_complet as entrepreneur_nom, c.nom as chantier_nom 
             FROM missions m
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             JOIN chantiers c ON m.chantier_id = c.id
             WHERE m.ouvrier_id = ?
             ORDER BY m.date_creation DESC`,
            [req.utilisateur.id]
        );
        res.json(missions);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// TERMINER UNE MISSION (PUT)
// ============================================================
router.put('/:id/terminer', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [mission] = await db.query(
            `SELECT * FROM missions WHERE id = ? AND entrepreneur_id = ?`,
            [id, req.utilisateur.id]
        );
        if (mission.length === 0) {
            return res.status(404).json({ message: 'Mission non trouvée' });
        }

        await db.query(
            `UPDATE missions SET statut = 'terminee', date_fin = CURDATE() WHERE id = ?`,
            [id]
        );

        await db.query(
            `UPDATE besoins_chantier SET statut = 'satisfait' WHERE id = ?`,
            [mission[0].besoin_id]
        );

        res.json({ message: 'Mission terminée avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;