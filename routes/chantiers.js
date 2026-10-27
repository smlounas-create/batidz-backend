const express = require('express');
const authenticateToken = require('../middleware/auth');  // ⭐ Renommé pour clarté
const router = express.Router();

// ============================================================
// CRÉER UN CHANTIER (POST)
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
       const { nom, description, wilaya, adresse } = req.body;
    // ⭐ Sécurité : transformer les dates vides en NULL
    const date_debut = req.body.date_debut || null;
    const date_fin_prevue = req.body.date_fin_prevue || null;
    const db = req.app.get('db');

    // ⭐ CORRECTION: req.user au lieu de req.utilisateur
    if (!req.user || req.user.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut créer un chantier' });
    }

    if (!nom || !wilaya) {
        return res.status(400).json({ message: 'Nom et wilaya requis' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO chantiers 
            (entrepreneur_id, nom, description, wilaya, adresse, date_debut, date_fin_prevue, statut) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'en_cours')`,
            [req.user.id, nom, description, wilaya, adresse || null, date_debut || null, date_fin_prevue || null]
        );

        const [newChantier] = await db.query(
            'SELECT * FROM chantiers WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Chantier créé avec succès',
            chantier: newChantier[0]
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES CHANTIERS (GET)
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');

    // ⭐ CORRECTION: req.user au lieu de req.utilisateur
    if (!req.user || req.user.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut voir ses chantiers' });
    }

    try {
        console.log('👤 Récupération des chantiers pour l\'entrepreneur ID:', req.user.id);
        
        const [chantiers] = await db.query(
            `SELECT c.*, 
                    COALESCE(
                        (SELECT SUM(b.quantite_trouvee) / NULLIF(SUM(b.quantite), 0) * 100 
                         FROM besoins_chantier b 
                         WHERE b.chantier_id = c.id), 
                        0
                    ) as avancement
             FROM chantiers c 
             WHERE c.entrepreneur_id = ? 
             ORDER BY c.date_creation DESC`,
            [req.user.id]
        );

        console.log('📦 Chantiers trouvés:', chantiers.length);
        res.json(chantiers);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER UN CHANTIER PAR ID (GET)
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [chantiers] = await db.query(
            `SELECT * FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [id, req.user.id]
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
router.put('/:id', authenticateToken, async (req, res) => {
   console.log('🔍 PUT /chantiers/:id');
    console.log('📦 Body reçu:', req.body);
    console.log('👤 Utilisateur:', req.user);
    const { id } = req.params;
       const { nom, description, wilaya, adresse, statut } = req.body;
    // ⭐ Sécurité : transformer les dates vides en NULL
    const date_debut = req.body.date_debut || null;
    const date_fin_prevue = req.body.date_fin_prevue || null;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `UPDATE chantiers 
             SET nom = ?, description = ?, wilaya = ?, adresse = ?, date_debut = ?, date_fin_prevue = ?, statut = ?
             WHERE id = ? AND entrepreneur_id = ?`,
            [nom, description, wilaya, adresse, date_debut, date_fin_prevue, statut, id, req.user.id]
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
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        const [result] = await db.query(
            `DELETE FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [id, req.user.id]
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
// ============================================================
// UPLOADER UNE PHOTO DE CHANTIER (POST)
// ============================================================
router.post('/:id/photo', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { photo } = req.body;
    const db = req.app.get('db');

    console.log('📸 POST /chantiers/' + id + '/photo');

    try {
        // 1️⃣ Vérifier que le chantier appartient à l'utilisateur
        const [chantier] = await db.query(
            'SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?',
            [id, req.user.id]
        );

        if (chantier.length === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé' });
        }

        // 2️⃣ Vérifier que la photo est fournie
        if (!photo) {
            return res.status(400).json({ message: 'Photo manquante' });
        }

        // 3️⃣ Sauvegarder la photo (base64) dans la colonne 'photo'
        await db.query(
            'UPDATE chantiers SET photo = ? WHERE id = ?',
            [photo, id]
        );

        // 4️⃣ Récupérer le chantier mis à jour
        const [updated] = await db.query(
            'SELECT * FROM chantiers WHERE id = ?',
            [id]
        );

        console.log('✅ Photo sauvegardée pour chantier:', id);
        res.json({
            message: 'Photo mise à jour avec succès',
            chantier: updated[0]
        });

    } catch (error) {
        console.error('Erreur upload photo chantier:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});


module.exports = router;
