const express = require('express');
const authenticateToken = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ============================================================
// CRÉER UNE ANNONCE
// ============================================================
router.post('/', authenticateToken, [
    body('type_annonce').isIn(['recherche', 'proposition']),
    body('categorie').isIn(['main_oeuvre', 'materiel', 'materiaux']),
    body('titre').notEmpty().withMessage('Titre requis'),
    body('description').notEmpty().withMessage('Description requise'),
    body('wilaya').notEmpty().withMessage('Wilaya requise')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ erreurs: errors.array() });
    }

    // ⭐ CORRECTION: req.user au lieu de req.utilisateur
    if (!req.user) {
        return res.status(401).json({ message: 'Utilisateur non authentifié' });
    }

    const { type_annonce, categorie, titre, description, wilaya, budget } = req.body;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `INSERT INTO annonces 
            (utilisateur_id, type_annonce, categorie, titre, description, wilaya, budget, statut) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
            [req.user.id, type_annonce, categorie, titre, description, wilaya, budget || null]
        );

        const [newAnnonce] = await db.query(
            'SELECT * FROM annonces WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Annonce créée avec succès',
            annonce: newAnnonce[0]
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RECHERCHER DES ANNONCES
// ============================================================
router.get('/', async (req, res) => {
    const { wilaya, categorie, type_annonce, disponible } = req.query;
    const db = req.app.get('db');

    try {
        let query = `
            SELECT a.*, u.nom_complet, u.profil, u.disponible
            FROM annonces a
            JOIN utilisateurs u ON a.utilisateur_id = u.id
            WHERE a.statut = 'active'
        `;
        const params = [];

        if (wilaya) {
            query += ' AND a.wilaya = ?';
            params.push(wilaya);
        }
        if (categorie) {
            query += ' AND a.categorie = ?';
            params.push(categorie);
        }
        if (type_annonce) {
            query += ' AND a.type_annonce = ?';
            params.push(type_annonce);
        }
        if (disponible) {
            query += ' AND u.disponible = ?';
            params.push(disponible);
        }

        query += ' ORDER BY a.date_creation DESC LIMIT 50';
        const [annonces] = await db.query(query, params);
        res.json(annonces);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// OBTENIR UNE ANNONCE SPÉCIFIQUE
// ============================================================
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [annonces] = await db.query(
            `SELECT a.*, u.nom_complet, u.profil, u.disponible
             FROM annonces a
             JOIN utilisateurs u ON a.utilisateur_id = u.id
             WHERE a.id = ?`,
            [id]
        );
        if (annonces.length === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }
        res.json(annonces[0]);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// SUPPRIMER UNE ANNONCE
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            'DELETE FROM annonces WHERE id = ? AND utilisateur_id = ?',
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }

        res.json({ message: 'Annonce supprimée avec succès' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// METTRE À JOUR LE STATUT D'UNE ANNONCE
// ============================================================
router.put('/:id/statut', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { statut } = req.body;
    const db = req.app.get('db');

    const statutsValides = ['active', 'inactive', 'terminee'];
    if (!statut || !statutsValides.includes(statut)) {
        return res.status(400).json({ message: 'Statut invalide' });
    }

    try {
        const [result] = await db.query(
            'UPDATE annonces SET statut = ? WHERE id = ? AND utilisateur_id = ?',
            [statut, id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }

        res.json({ message: 'Statut mis à jour', statut });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
