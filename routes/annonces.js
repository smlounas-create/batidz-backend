const express = require('express');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ============================================================
// CRÉER UNE ANNONCE
// ============================================================
router.post('/', auth, [
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

    const { type_annonce, categorie, titre, description, wilaya, budget } = req.body;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `INSERT INTO annonces 
            (utilisateur_id, type_annonce, categorie, titre, description, wilaya, budget) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.utilisateur.id, type_annonce, categorie, titre, description, wilaya, budget || null]
        );

        res.status(201).json({
            message: 'Annonce créée avec succès',
            annonce: { id: result.insertId, ...req.body }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RECHERCHER DES ANNONCES
// ============================================================
router.get('/', async (req, res) => {
    const { wilaya, categorie, type_annonce } = req.query;
    const db = req.app.get('db');

    try {
        let query = `
            SELECT a.*, u.nom_complet, u.profil
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

        query += ' ORDER BY a.date_creation DESC LIMIT 50';
        const [annonces] = await db.query(query, params);
        res.json(annonces);
    } catch (error) {
        console.error(error);
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
            `SELECT a.*, u.nom_complet, u.profil
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
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;  // ⚠️ VÉRIFIEZ BIEN CETTE LIGNE
