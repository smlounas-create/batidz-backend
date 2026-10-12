// ============================================================
// FICHIER: routes/utilisateurs.js
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

// ============================================================
// PUT /api/utilisateurs/disponibilite - Mettre à jour la disponibilité
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
        // ⭐ Mettre à jour avec MySQL
        const [result] = await db.query(
            'UPDATE utilisateurs SET disponible = ? WHERE id = ?',
            [disponible, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

        // ⭐ Récupérer l'utilisateur mis à jour
        const [users] = await db.query(
            `SELECT id, nom_complet, email, telephone, profil, wilaya,
                    metier, experience, tranche_horaire, salaire_souhaite,
                    type_remuneration, securite_sociale, disponible
             FROM utilisateurs 
             WHERE id = ?`,
            [userId]
        );

        res.json({
            message: 'Disponibilité mise à jour',
            utilisateur: users[0]
        });
    } catch (error) {
        console.error('Erreur PUT /utilisateurs/disponibilite:', error);
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
                    type_remuneration, securite_sociale, disponible,
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
        'securite_sociale', 'disponible',
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
                    type_remuneration, securite_sociale, disponible
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
