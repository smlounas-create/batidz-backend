// ============================================================
// FICHIER: routes/utilisateurs.js
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
// ============================================================
// ⭐ NOUVEAU : COMPTER LES FOURNISSEURS (pour le badge header)
// ============================================================
router.get('/count', async (req, res) => {
    const db = req.app.get('db');
    try {
        const [result] = await db.query(
            `SELECT COUNT(*) as total FROM utilisateurs 
             WHERE profil IN ('fournisseur_materiel', 'fournisseur_materiaux')`
        );
        res.json({ total: result[0].total });
    } catch (error) {
        console.error('Erreur GET /utilisateurs/count:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
// ============================================================
// ⭐ NOUVEAU : LISTER LES FOURNISSEURS (Annuaire)
// ============================================================
router.get('/', async (req, res) => {
    const { profil, wilaya, search, limit } = req.query;
    const db = req.app.get('db');
    const maxResults = parseInt(limit) || 50;

    try {
        // ⭐ 1. Construire la requête des fournisseurs
        let query = `
            SELECT id, nom_complet, profil, specialite, wilaya, photo
            FROM utilisateurs
            WHERE profil IN ('fournisseur_materiel', 'fournisseur_materiaux')
        `;
        const params = [];

        if (profil) {
            query += ' AND profil = ?';
            params.push(profil);
        }
        if (wilaya) {
            query += ' AND wilaya = ?';
            params.push(wilaya);
        }
        if (search) {
            query += ' AND nom_complet LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY nom_complet ASC LIMIT ?';
        params.push(maxResults);

        const [fournisseurs] = await db.query(query, params);

        if (fournisseurs.length === 0) {
            return res.json([]);
        }

        // ⭐ 2. Récupérer toutes les annonces de ces fournisseurs
        const ids = fournisseurs.map(f => f.id);
        const placeholders = ids.map(() => '?').join(',');
        const [annonces] = await db.query(
            `SELECT utilisateur_id, titre FROM annonces WHERE utilisateur_id IN (${placeholders})`,
            ids
        );

        // ⭐ 3. Grouper les annonces par fournisseur
        const annoncesParUser = {};
        annonces.forEach(a => {
            if (!annoncesParUser[a.utilisateur_id]) annoncesParUser[a.utilisateur_id] = [];
            annoncesParUser[a.utilisateur_id].push({ titre: a.titre });
        });

        // ⭐ 4. Construire la réponse : spécialité + annonces
        const resultats = fournisseurs.map(f => ({
            ...f,
            produits: [
                { titre: f.specialite },  // ⭐ La spécialité est toujours le 1er produit
                ...(annoncesParUser[f.id] || [])
            ]
        }));

        res.json(resultats);

    } catch (error) {
        console.error('Erreur GET /utilisateurs:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
// ============================================================
// GET /api/utilisateurs/profil - Récupérer le profil
// ============================================================
router.get('/profil', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                    metier, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale,
                    domaine, registre_commerce, qualification,
                    type_materiel, marque_materiel, annee_materiel,
                    type_materiaux, conditionnement_materiaux
             FROM utilisateurs 
             WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

        res.json(users[0]);
    } catch (error) {
        console.error('Erreur GET /utilisateurs/profil:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/utilisateurs/profil - Mettre à jour le profil
// ============================================================
router.put('/profil', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const updates = req.body;

    // Champs autorisés
    const allowedFields = [
        'nom_complet', 'email', 'telephone', 'wilaya',
        'metier', 'experience', 'tranche_horaire',
        'salaire_souhaite', 'type_remuneration',
        'securite_sociale',
        'domaine', 'registre_commerce', 'qualification',
        'type_materiel', 'marque_materiel', 'annee_materiel',
        'type_materiaux', 'conditionnement_materiaux'
    ];

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

        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                    metier, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale,
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
        console.error('Erreur PUT /utilisateurs/profil:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/utilisateurs/:id - Récupérer un utilisateur par ID
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.params.id;

    try {
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                     specialite, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale
             FROM utilisateurs 
             WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

        res.json(users[0]);
    } catch (error) {
        console.error('Erreur GET /utilisateurs/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
// ============================================================
// UPLOADER UNE PHOTO DE PROFIL (POST)
// ============================================================
router.post('/:id/photo', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { photo } = req.body;
    const db = req.app.get('db');

    console.log('📸 POST /utilisateurs/' + id + '/photo');

    try {
        // 1️⃣ Vérifier que l'utilisateur modifie bien son propre profil
        if (parseInt(id) !== req.user.id) {
            return res.status(403).json({ 
                message: 'Vous ne pouvez modifier que votre propre photo' 
            });
        }

        // 2️⃣ Vérifier que la photo est fournie
        if (!photo) {
            return res.status(400).json({ message: 'Photo manquante' });
        }

        // 3️⃣ Sauvegarder la photo (base64) dans la colonne 'photo'
        await db.query(
            'UPDATE utilisateurs SET photo = ? WHERE id = ?',
            [photo, id]
        );

        // 4️⃣ Récupérer l'utilisateur mis à jour
        const [updated] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya, photo
             FROM utilisateurs WHERE id = ?`,
            [id]
        );

        console.log('✅ Photo sauvegardée pour utilisateur:', id);
        res.json({
            message: 'Photo mise à jour avec succès',
            utilisateur: updated[0]
        });

    } catch (error) {
        console.error('Erreur upload photo utilisateur:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});




module.exports = router;
