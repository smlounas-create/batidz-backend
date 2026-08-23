// ============================================================
// FICHIER: routes/missions.js
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

// ============================================================
// GET /api/missions/ouvrier - Récupérer les missions d'un ouvrier
// ============================================================
router.get('/ouvrier', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const ouvrierId = req.user.id;

    try {
        const [missions] = await db.query(
            `SELECT m.*, 
                    c.nom as chantier_nom, 
                    c.wilaya,
                    u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.ouvrier_id = ?
             ORDER BY m.date_debut DESC`,
            [ouvrierId]
        );

        res.json(missions);
    } catch (error) {
        console.error('Erreur GET /missions/ouvrier:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/missions - Créer une mission
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const entrepreneurId = req.user.id;
    const { ouvrier_id, chantier_id, besoin_id, date_debut, date_fin } = req.body;

    if (!ouvrier_id || !chantier_id || !besoin_id || !date_debut) {
        return res.status(400).json({ message: 'Champs obligatoires manquants' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO missions 
             (ouvrier_id, chantier_id, entrepreneur_id, besoin_id, date_debut, date_fin, statut) 
             VALUES (?, ?, ?, ?, ?, ?, 'en_cours')`,
            [ouvrier_id, chantier_id, entrepreneurId, besoin_id, date_debut, date_fin || null]
        );

        const [newMission] = await db.query(
            `SELECT m.*, 
                    c.nom as chantier_nom, 
                    u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.id = ?`,
            [result.insertId]
        );

        res.status(201).json(newMission[0]);
    } catch (error) {
        console.error('Erreur POST /missions:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/note - Noter une mission
// ============================================================
router.put('/:id/note', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const { note } = req.body;

    if (!note || note < 1 || note > 5) {
        return res.status(400).json({
            message: 'La note doit être comprise entre 1 et 5'
        });
    }

    try {
        const [result] = await db.query(
            'UPDATE missions SET note = ? WHERE id = ?',
            [note, missionId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Mission non trouvée' });
        }

        const [mission] = await db.query(
            'SELECT * FROM missions WHERE id = ?',
            [missionId]
        );

        res.json({
            message: 'Mission notée avec succès',
            note: mission[0].note
        });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/note:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/statut - Changer le statut
// ============================================================
router.put('/:id/statut', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const { statut } = req.body;

    const statutsValides = ['en_cours', 'terminee', 'annulee'];
    if (!statut || !statutsValides.includes(statut)) {
        return res.status(400).json({ message: 'Statut invalide' });
    }

    try {
        const [result] = await db.query(
            'UPDATE missions SET statut = ? WHERE id = ?',
            [statut, missionId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Mission non trouvée' });
        }

        res.json({ message: 'Statut mis à jour', statut });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/statut:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
