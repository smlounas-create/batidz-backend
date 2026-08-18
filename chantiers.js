const express = require('express');
const auth = require('../middleware/auth');
const router = express.Router();

// ============================================================
// CRÉER UN CHANTIER (POST)
// ============================================================
router.post('/', auth, async (req, res) => {
    const { nom, description, wilaya, adresse, date_debut, date_fin_prevue } = req.body;
    const db = req.app.get('db');

    if (req.utilisateur.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut créer un chantier' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO chantiers 
            (entrepreneur_id, nom, description, wilaya, adresse, date_debut, date_fin_prevue) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.utilisateur.id, nom, description, wilaya, adresse, date_debut, date_fin_prevue]
        );

        res.status(201).json({
            message: 'Chantier créé avec succès',
            chantier: { id: result.insertId, nom, description, wilaya }
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES CHANTIERS (GET)
// ============================================================
router.get('/', auth, async (req, res) => {
    const db = req.app.get('db');

    if (req.utilisateur.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut voir ses chantiers' });
    }

    try {
        const [chantiers] = await db.query(
            `SELECT * FROM chantiers WHERE entrepreneur_id = ? ORDER BY date_creation DESC`,
            [req.utilisateur.id]
        );
        res.json(chantiers);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER UN CHANTIER PAR ID (GET)
// ============================================================
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [chantiers] = await db.query(
            `SELECT * FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [id, req.utilisateur.id]
        );
        if (chantiers.length === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé' });
        }
        res.json(chantiers[0]);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// MODIFIER UN CHANTIER (PUT)
// ============================================================
router.put('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { nom, description, wilaya, adresse, date_debut, date_fin_prevue, statut } = req.body;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `UPDATE chantiers 
             SET nom = ?, description = ?, wilaya = ?, adresse = ?, date_debut = ?, date_fin_prevue = ?, statut = ?
             WHERE id = ? AND entrepreneur_id = ?`,
            [nom, description, wilaya, adresse, date_debut, date_fin_prevue, statut, id, req.utilisateur.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé ou non modifié' });
        }

        res.json({ message: 'Chantier modifié avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// SUPPRIMER UN CHANTIER (DELETE)
// ============================================================
router.delete('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `DELETE FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [id, req.utilisateur.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé' });
        }

        res.json({ message: 'Chantier supprimé avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;