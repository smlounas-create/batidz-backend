const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');   // ⭐ AJOUTER
const router = express.Router();
// ============================================================
// RATE LIMITING (protection anti-brute force)
// ============================================================

// ⭐ 5 tentatives de connexion par 15 minutes
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutes
    max: 5,                           // 5 tentatives max
    message: {
        message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
    },
    skipSuccessfulRequests: true,     // ⭐ seules les tentatives ratées comptent
    standardHeaders: true,
    legacyHeaders: false
});

// ⭐ 3 inscriptions par heure
const inscriptionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,        // 1 heure
    max: 3,                           // 3 inscriptions max
    message: {
        message: 'Trop d\'inscriptions depuis cette adresse. Réessayez plus tard.'
    },
    standardHeaders: true,
    legacyHeaders: false
});
// ============================================================
// MIDDLEWARE D'AUTHENTIFICATION
// ⭐ Le même que pour toutes les autres routes (avant : une copie ici, avec une autre clé de secours)
// ============================================================
const authenticateToken = require('../middleware/auth');
const { cleJWT } = require('../middleware/auth');
const { abonnementActif } = require('../middleware/abonnement');

// ============================================================
// EMAIL FACULTATIF ET NUMÉRO DE TÉLÉPHONE
// ============================================================
// ⭐ L'email est facultatif pour tous les profils (beaucoup d'ouvriers n'en ont pas) :
//    on s'inscrit et on se connecte avec son numéro de téléphone.
const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailOuNull(valeur) {
    const e = valeur === undefined || valeur === null ? '' : String(valeur).trim();
    return e === '' ? null : e;
}

// « 0667 78 89 90 », « 0667-78-89-90 », « +213 667 78 89 90 » → « 0667788990 »
function normaliserTelephone(valeur) {
    const brut = String(valeur ?? '').trim();
    let chiffres = brut.replace(/\D/g, '');
    if (chiffres.startsWith('00213')) chiffres = chiffres.slice(2);
    if (chiffres.startsWith('213') && chiffres.length === 12) chiffres = '0' + chiffres.slice(3);
    if (chiffres.length === 9 && /^[5-7]/.test(chiffres)) chiffres = '0' + chiffres;
    return /^0\d{8,9}$/.test(chiffres) ? chiffres : brut;
}

// Les numéros déjà enregistrés peuvent contenir des espaces, points, tirets ou « +213 » :
// on les compare sans ces signes, sous la forme 0XXXXXXXXX, 213XXXXXXXXX ou 00213XXXXXXXXX.
const TELEPHONE_SQL = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(telephone, ' ', ''), '.', ''), '-', ''), '+', ''), '/', '')";
function conditionTelephone(valeur) {
    const tel = normaliserTelephone(valeur);
    if (!/^0\d{8,9}$/.test(tel)) return { sql: 'telephone = ?', params: [tel] };
    const sans0 = tel.slice(1);
    return { sql: `(telephone = ? OR ${TELEPHONE_SQL} IN (?, ?, ?))`, params: [String(valeur ?? '').trim(), tel, '213' + sans0, '00213' + sans0] };
}

// ============================================================
// INSCRIPTION
// ============================================================
router.post('/inscription',  inscriptionLimiter,  [
    body('nom_complet').notEmpty().withMessage('Nom complet requis'),
    body('email').custom(v => emailOuNull(v) === null || EMAIL_VALIDE.test(emailOuNull(v))).withMessage('Email invalide'),
    body('telephone').notEmpty().withMessage('Téléphone requis'),
   body('mot_de_passe')
        .isLength({ min: 8 })
        .withMessage('Mot de passe minimum 8 caractères')
        .matches(/[A-Z]/)
        .withMessage('Le mot de passe doit contenir au moins 1 majuscule')
        .matches(/[0-9]/)
        .withMessage('Le mot de passe doit contenir au moins 1 chiffre'),
    // ⭐ « organisme_formation » : organismes qui publient des annonces de formation (routes/formations.js)
    body('profil').isIn(['entrepreneur', 'ouvrier', 'fournisseur_materiel', 'fournisseur_materiaux', 'organisme_formation'])
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
        // ⭐ Clé des jetons vérifiée AVANT de créer le compte : si JWT_SECRET manque sur Render,
        //    l'inscription échoue proprement au lieu de créer un compte sans pouvoir répondre
        const cle = cleJWT();

        const emailPropre = emailOuNull(email);
        const telephonePropre = normaliserTelephone(telephone);
        const condTel = conditionTelephone(telephonePropre);
        const [existing] = await db.query(
            `SELECT id FROM utilisateurs WHERE ${emailPropre ? 'email = ? OR ' : ''}${condTel.sql}`,
            [...(emailPropre ? [emailPropre] : []), ...condTel.params]
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
                credits, abonnement_statut, abonnement_date_fin
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nom_complet, emailPropre, telephonePropre, mot_de_passe_hash, profil, wilaya,
                specialite || null, experience || null, tranche_horaire || null, salaire_souhaite || null,
                type_remuneration || null, securite_sociale || null,
                 registre_commerce || null, qualification || null,
                marque_materiel || null, annee_materiel || null,
                 conditionnement_materiaux || null,
                5,  // ⭐ 5 crédits offert
                // ⭐ Entrepreneur : essai gratuit (30 jours par défaut, réglable avec ESSAI_JOURS sur Render)
                profil === 'entrepreneur' ? 'essai' : null,
                profil === 'entrepreneur' ? new Date(Date.now() + (parseInt(process.env.ESSAI_JOURS, 10) || 30) * 86400000) : null
            ]
        );

        const token = jwt.sign(
            { id: result.insertId, email: emailPropre, profil },
            cle,
            { expiresIn: '7d' }
        );

        // Récupérer l'utilisateur créé
        const [newUser] = await db.query(
            'SELECT id, nom_complet, email, profil, wilaya, specialite, experience, tranche_horaire, salaire_souhaite, type_remuneration, securite_sociale, credits, abonnement_statut, abonnement_date_fin FROM utilisateurs WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Inscription réussie',
            token,
            utilisateur: newUser[0]
        });
    } catch (error) {
        console.error('Erreur inscription:', error.code || '', error.message);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// CONNEXION
// ============================================================
router.post('/connexion', loginLimiter,  [
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
        const ident = String(identifiant).trim();
        let users;
        if (ident.includes('@')) {
            [users] = await db.query(`SELECT * FROM utilisateurs WHERE email = ?`, [ident]);
        } else {
            const condTel = conditionTelephone(ident);
            [users] = await db.query(`SELECT * FROM utilisateurs WHERE ${condTel.sql}`, condTel.params);
        }
        if (users.length === 0) {
            return res.status(401).json({ message: 'Identifiants incorrects' });
        }

        // ⭐ Si un ancien numéro existe en double (écrit de deux façons), on garde le compte dont le mot de passe correspond
        let user = null;
        for (const candidat of users) {
            if (await bcrypt.compare(mot_de_passe, candidat.mot_de_passe)) { user = candidat; break; }
        }
        if (!user) {
            return res.status(401).json({ message: 'Identifiants incorrects' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, profil: user.profil },
            cleJWT(),
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
              
                registre_commerce: user.registre_commerce,
                qualification: user.qualification,
               
                marque_materiel: user.marque_materiel,
                annee_materiel: user.annee_materiel,
                conditionnement_materiaux: user.conditionnement_materiaux,
            photo: user.photo,
                credits: user.credits || 0,
                abonnement_statut: user.abonnement_statut || null,
                abonnement_date_fin: user.abonnement_date_fin || null,
                est_admin: Number(user.est_admin) === 1,
                abonnement_actif: user.profil === 'entrepreneur' ? await abonnementActif(db, user.id) : null
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
                    type_remuneration, securite_sociale,
                    registre_commerce, qualification, credits, abonnement_statut, abonnement_date_fin, est_admin,
                     marque_materiel, annee_materiel, photo,
                     conditionnement_materiaux,
                     (abonnement_date_fin IS NOT NULL AND DATE(abonnement_date_fin) >= CURDATE()) AS abonnement_actif
             FROM utilisateurs 
             WHERE id = ?`,
            [req.user.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
        
        // ⭐ abonnement_actif (1/0) : abonnement payé ou essai gratuit en cours — utile aux entrepreneurs
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
    const updates = { ...(req.body || {}) };
    // ⭐ Email facultatif : vide = pas d'email. Téléphone : même écriture qu'à l'inscription.
    if (updates.email !== undefined) updates.email = emailOuNull(updates.email);
    if (updates.telephone !== undefined && updates.telephone !== null) updates.telephone = normaliserTelephone(updates.telephone);
    
    // Champs autorisés à être modifiés
    const allowedFields = [
        'nom_complet', 'email', 'telephone', 'wilaya',
        'specialite',  'experience', 'tranche_horaire',
        'salaire_souhaite', 'type_remuneration',
        'securite_sociale',
        'registre_commerce', 'qualification',
         'marque_materiel', 'annee_materiel',
         'conditionnement_materiaux'
        // ⭐ « credits » retiré : chacun pouvait s'attribuer autant de crédits qu'il voulait.
        //    Les crédits ne changent que par le serveur (publication d'une annonce, paiement).
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
        // ⭐ Email et téléphone : valides et pas déjà pris par un autre compte
        //    (avant : deux comptes pouvaient avoir le même email, et la connexion tombait sur le mauvais)
        if (updates.email && !EMAIL_VALIDE.test(updates.email)) {
            return res.status(400).json({ message: 'Email invalide' });
        }
        if (updates.telephone !== undefined && String(updates.telephone ?? '').trim() === '') {
            return res.status(400).json({ message: 'Téléphone requis' });
        }
        const conditions = [], params = [];
        if (updates.email) { conditions.push('email = ?'); params.push(updates.email); }
        if (updates.telephone) { const c = conditionTelephone(updates.telephone); conditions.push(c.sql); params.push(...c.params); }
        if (conditions.length) {
            const [pris] = await db.query(
                `SELECT id FROM utilisateurs WHERE (${conditions.join(' OR ')}) AND id <> ?`,
                [...params, userId]
            );
            if (pris.length > 0) {
                return res.status(409).json({ message: 'Email ou téléphone déjà utilisé' });
            }
        }

        await db.query(query, values);
        
        // Récupérer l'utilisateur mis à jour
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                    specialite, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale,
                    registre_commerce, qualification, credits, abonnement_statut, abonnement_date_fin, est_admin,
                    marque_materiel, annee_materiel, photo,
                     conditionnement_materiaux
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
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;
