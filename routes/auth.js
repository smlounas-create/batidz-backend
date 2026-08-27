const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ============================================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Token manquant' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'secret_development', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token invalide' });
        }
        req.user = user;
        next();
    });
};

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

    const { 
        nom_complet, email, telephone, mot_de_passe, profil, wilaya,
        // Champs spécifiques
        specialite, experience, tranche_horaire, salaire_souhaite, 
        type_remuneration, securite_sociale,
         registre_commerce, qualification,
        marque_materiel, annee_materiel,
        conditionnement_materiaux
    } = req.body;
    
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
            `INSERT INTO utilisateurs (
                nom_complet, email, telephone, mot_de_passe, profil, wilaya,
                specialite, experience, tranche_horaire, salaire_souhaite, 
                type_remuneration, securite_sociale,
                registre_commerce, qualification,
               marque_materiel, annee_materiel,
                conditionnement_materiaux,
                disponible, credits
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nom_complet, email, telephone, mot_de_passe_hash, profil, wilaya,
                specialite || null, experience || null, tranche_horaire || null, salaire_souhaite || null,
                type_remuneration || null, securite_sociale || null,
                 registre_commerce || null, qualification || null,
                marque_materiel || null, annee_materiel || null,
                 conditionnement_materiaux || null,
                'oui' , 5  // ⭐ 5 crédits offert
            ]
        );

        const token = jwt.sign(
            { id: result.insertId, email, profil },
            process.env.JWT_SECRET || 'secret_development',
            { expiresIn: '7d' }
        );

        // Récupérer l'utilisateur créé
        const [newUser] = await db.query(
            'SELECT id, nom_complet, email, profil, wilaya, metier, experience, tranche_horaire, salaire_souhaite, type_remuneration, securite_sociale, disponible FROM utilisateurs WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Inscription réussie',
            token,
            utilisateur: newUser[0]
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
            `SELECT * FROM utilisateurs WHERE email = ? OR telephone = ?`,
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

        // ⭐ Renvoyer TOUTES les données utilisateur
        res.json({
            message: 'Connexion réussie',
            token,
            utilisateur: {
                id: user.id,
                nom_complet: user.nom_complet,
                email: user.email,
                telephone: user.telephone,
                profil: user.profil,
                wilaya: user.wilaya,
                specialite: user.specialite,
                experience: user.experience,
                tranche_horaire: user.tranche_horaire,
                salaire_souhaite: user.salaire_souhaite,
                type_remuneration: user.type_remuneration,
                securite_sociale: user.securite_sociale,
                disponible: user.disponible || 'oui',
              
                registre_commerce: user.registre_commerce,
                qualification: user.qualification,
               
                marque_materiel: user.marque_materiel,
                annee_materiel: user.annee_materiel,
                conditionnement_materiaux: user.conditionnement_materiaux
            credits: user.credits || 0
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// ⭐⭐⭐ NOUVEAUX ENDPOINTS À AJOUTER ⭐⭐⭐
// ============================================================

// ============================================================
// 1. GET /api/auth/me - Récupérer le profil
// ============================================================
router.get('/me', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    
    try {
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                   specialite,  experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale, disponible,
                    registre_commerce, qualification, credits,
                     marque_materiel, annee_materiel,
                     conditionnement_materiaux
             FROM utilisateurs 
             WHERE id = ?`,
            [req.user.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Erreur GET /me:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// 2. PUT /api/auth/me - Mettre à jour le profil
// ============================================================
router.put('/me', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const updates = req.body;
    
    // Champs autorisés à être modifiés
    const allowedFields = [
        'nom_complet', 'email', 'telephone', 'wilaya',
        'specialite',  'experience', 'tranche_horaire',
        'salaire_souhaite', 'type_remuneration',
        'securite_sociale', 'disponible',credits,
        'registre_commerce', 'qualification',
         'marque_materiel', 'annee_materiel',
         'conditionnement_materiaux'
    ];
    
    // Construire la requête UPDATE dynamique
    const setClauses = [];
    const values = [];
    
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            setClauses.push(`${field} = ?`);
            values.push(updates[field]);
        }
    }
    
    if (setClauses.length === 0) {
        return res.status(400).json({ message: 'Aucun champ à mettre à jour' });
    }
    
    values.push(userId);
    const query = `UPDATE utilisateurs SET ${setClauses.join(', ')} WHERE id = ?`;
    
    try {
        await db.query(query, values);
        
        // Récupérer l'utilisateur mis à jour
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                    metier, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale, disponible,
                    domaine, registre_commerce, qualification,
                    type_materiel, marque_materiel, annee_materiel,
                    type_materiaux, conditionnement_materiaux
             FROM utilisateurs 
             WHERE id = ?`,
            [userId]
        );
        
        res.json({
            message: 'Profil mis à jour avec succès',
            utilisateur: users[0]
        });
    } catch (error) {
        console.error('Erreur PUT /me:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// 3. PUT /api/auth/disponibilite - Mettre à jour la disponibilité
// ============================================================
router.put('/disponibilite', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const { disponible } = req.body;
    
    if (!disponible || !['oui', 'non'].includes(disponible)) {
        return res.status(400).json({
            message: 'La disponibilité doit être "oui" ou "non"'
        });
    }
    
    try {
        await db.query(
            'UPDATE utilisateurs SET disponible = ? WHERE id = ?',
            [disponible, userId]
        );
        
        const [users] = await db.query(
            'SELECT id, disponible FROM utilisateurs WHERE id = ?',
            [userId]
        );
        
        res.json({
            message: 'Disponibilité mise à jour',
            disponible: users[0].disponible
        });
    } catch (error) {
        console.error('Erreur PUT /disponibilite:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;
