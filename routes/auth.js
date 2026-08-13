const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ============================================================
// INSCRIPTION
// ============================================================
router.post('/inscription', [
    body('nom_complet').notEmpty().withMessage('Nom complet requis'),
    body('email').isEmail().withMessage('Email invalide'),
    body('telephone').notEmpty().withMessage('Téléphone requis'),
    body('mot_de_passe').isLength({ min: 6 }).withMessage('Mot de passe minimum 6 caractères'),
    body('profil').isIn(['entrepreneur', 'ouvrier', 'fournisseur_materiel', 'fournisseur_materiaux'])
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ erreurs: errors.array() });
    }

    const { nom_complet, email, telephone, mot_de_passe, profil, wilaya } = req.body;
    const db = req.app.get('db');

    try {
        const [existing] = await db.query(
            'SELECT id FROM utilisateurs WHERE email = ? OR telephone = ?',
            [email, telephone]
        );
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Email ou téléphone déjà utilisé' });
        }

        const salt = await bcrypt.genSalt(10);
        const mot_de_passe_hash = await bcrypt.hash(mot_de_passe, salt);

        const [result] = await db.query(
            `INSERT INTO utilisateurs (nom_complet, email, telephone, mot_de_passe, profil, wilaya) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nom_complet, email, telephone, mot_de_passe_hash, profil, wilaya]
        );

        const token = jwt.sign(
            { id: result.insertId, email, profil },
            process.env.JWT_SECRET || 'secret_development',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Inscription réussie',
            token,
            utilisateur: { id: result.insertId, nom_complet, email, profil, wilaya }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// CONNEXION
// ============================================================
router.post('/connexion', [
    body('identifiant').notEmpty().withMessage('Email ou téléphone requis'),
    body('mot_de_passe').notEmpty().withMessage('Mot de passe requis')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ erreurs: errors.array() });
    }

    const { identifiant, mot_de_passe } = req.body;
    const db = req.app.get('db');

    try {
        const [users] = await db.query(
            'SELECT * FROM utilisateurs WHERE email = ? OR telephone = ?',
            [identifiant, identifiant]
        );
        if (users.length === 0) {
            return res.status(401).json({ message: 'Identifiants incorrects' });
        }

        const user = users[0];
        const match = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
        if (!match) {
            return res.status(401).json({ message: 'Identifiants incorrects' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, profil: user.profil },
            process.env.JWT_SECRET || 'secret_development',
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Connexion réussie',
            token,
            utilisateur: {
                id: user.id,
                nom_complet: user.nom_complet,
                email: user.email,
                profil: user.profil,
                wilaya: user.wilaya
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;  // ⚠️ VÉRIFIEZ BIEN CETTE LIGNE
