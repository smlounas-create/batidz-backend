const express = require('express');
const authenticateToken = require('../middleware/auth');
const { creerNotification } = require('./notifications');
const router = express.Router();

// ⭐ Entrepreneur sans abonnement (ni essai en cours) : accès refusé à ces routes
const { exigerAbonnement } = require('../middleware/abonnement');
router.use(exigerAbonnement);

// ⭐ Vérifie que le besoin appartient à un chantier de l'utilisateur connecté
async function besoinDeLUtilisateur(db, besoinId, userId) {
    const [rows] = await db.query(
        `SELECT b.id FROM besoins_chantier b JOIN chantiers c ON b.chantier_id = c.id
         WHERE b.id = ? AND c.entrepreneur_id = ?`,
        [besoinId, userId]
    );
    return rows.length > 0;
}

// ============================================================
// AJOUTER UN BESOIN (POST)
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const { chantier_id, categorie, titre, description, quantite, unite, budget_estime } = req.body;
    const db = req.app.get('db');

    // Vérifier que l'utilisateur est un entrepreneur
    if (req.user.profil !== 'entrepreneur') {
        return res.status(403).json({ message: 'Seul un entrepreneur peut ajouter un besoin' });
    }

    // Validation des champs obligatoires
    if (!chantier_id || !categorie || !titre) {
        return res.status(400).json({ message: 'Champs obligatoires manquants' });
    }
    // ⭐ Catégorie connue et quantité entière d'au moins 1 (les missions comptent en nombres entiers)
    if (!['main_oeuvre', 'materiel', 'materiaux'].includes(categorie)) {
        return res.status(400).json({ message: 'Catégorie invalide' });
    }
    if (quantite !== undefined && quantite !== null && quantite !== '' && (!Number.isInteger(Number(quantite)) || Number(quantite) < 1)) {
        return res.status(400).json({ message: 'La quantité doit être un nombre entier d\'au moins 1' });
    }

    try {
        // Vérifier que le chantier appartient à l'entrepreneur
        const [chantier] = await db.query(
            `SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?`,
            [chantier_id, req.user.id]
        );
        if (chantier.length === 0) {
            return res.status(404).json({ message: 'Chantier non trouvé ou non autorisé' });
        }

        // ⭐ SUPPRESSION DE date_besoins
        const [result] = await db.query(
            `INSERT INTO besoins_chantier 
            (chantier_id, categorie, titre, description, quantite, unite, budget_estime, statut) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'en_attente')`,
            [chantier_id, categorie, titre, description, quantite || 1, unite || null, budget_estime || null]
        );

        const [newBesoin] = await db.query(
            'SELECT * FROM besoins_chantier WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Besoin ajouté avec succès',
            besoin: newBesoin[0]
        });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER LES BESOINS D'UN CHANTIER (GET)
// ============================================================
router.get('/chantier/:chantier_id', authenticateToken, async (req, res) => {
    const { chantier_id } = req.params;
    const db = req.app.get('db');

    try {
        // ⭐ 1. Vérifier que le chantier appartient à l'utilisateur
        const [chantier] = await db.query(
            'SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?',
            [chantier_id, req.user.id]
        );

        if (chantier.length === 0) {
            console.log('🚫 Accès refusé : chantier', chantier_id, 'appartient à un autre');
            return res.status(403).json({ 
                message: 'Vous n\'êtes pas autorisé à voir ce chantier' 
            });
        }

        // ⭐ 2. Récupérer les besoins
        const [besoins] = await db.query(
            `SELECT * FROM besoins_chantier
             WHERE chantier_id = ?
             ORDER BY id DESC`,
            [chantier_id]
        );
        res.json(besoins);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// RÉCUPÉRER UN BESOIN PAR ID (GET)
// ============================================================
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        // ⭐ Vérifier que le besoin appartient à un chantier de l'utilisateur
        const [besoin] = await db.query(
            `SELECT b.* 
             FROM besoins_chantier b
             JOIN chantiers c ON b.chantier_id = c.id
             WHERE b.id = ? AND c.entrepreneur_id = ?`,
            [id, req.user.id]
        );
        
        if (besoin.length === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }
        res.json(besoin[0]);
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
// ============================================================
// MODIFIER UN BESOIN (PUT)
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { quantite_trouvee, statut } = req.body;
    const db = req.app.get('db');

    console.log('🔍 PUT /besoins/', id);
    console.log('📦 Body reçu:', req.body);

    try {
        // ⭐ SÉCURITÉ : seul l'entrepreneur propriétaire du chantier peut toucher à ce besoin
        if (!(await besoinDeLUtilisateur(db, id, req.user.id))) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        if (statut !== undefined && !['en_attente', 'en_cours', 'satisfait'].includes(statut)) {
            return res.status(400).json({ message: 'Statut invalide' });
        }

        let updates = [];
        let values = [];

        if (quantite_trouvee !== undefined) {
            updates.push('quantite_trouvee = ?');
            values.push(quantite_trouvee);
        }
        if (statut !== undefined) {
            updates.push('statut = ?');
            values.push(statut);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
        }

        values.push(id);
        const query = `UPDATE besoins_chantier  SET ${updates.join(', ')} WHERE id = ?`;
        const [result] = await db.query(query, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        const [updated] = await db.query('SELECT * FROM besoins_chantier WHERE id = ?', [id]);
        res.json({
            message: 'Besoin mis à jour avec succès',
            besoin: updated[0]
        });

    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});// ============================================================
// SUPPRIMER UN BESOIN (DELETE)
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        // ⭐ SÉCURITÉ : seul l'entrepreneur propriétaire du chantier peut toucher à ce besoin
        if (!(await besoinDeLUtilisateur(db, id, req.user.id))) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        // ⭐ Un besoin entamé (mission en cours ou terminée) ne se supprime pas :
        // on garderait sinon un chantier sans historique et des professionnels sans leurs notes.
        const [entamees] = await db.query(
            `SELECT COUNT(*) AS nb FROM missions WHERE besoin_id = ? AND statut IN ('en_cours', 'terminee')`,
            [id]
        );
        if (entamees[0].nb > 0) {
            return res.status(409).json({ message: 'Ce besoin a déjà des missions en cours ou terminées : il ne peut pas être supprimé' });
        }

        // ⭐ Prévenir les professionnels dont la mission en attente va disparaître
        const [enAttente] = await db.query(
            `SELECT id, ouvrier_id FROM missions WHERE besoin_id = ? AND statut = 'en_attente_acceptation'`,
            [id]
        );
        for (const m of enAttente) {
            try {
                await creerNotification(db, m.ouvrier_id, 'mission_annulee', '❌ Mission annulée', 'L\'entrepreneur a retiré ce besoin.', 'page-ouvrier', m.id);
            } catch (e) {
                console.error('Erreur notification suppression besoin:', e);
            }
        }

        // ⭐ 1. Supprimer les missions restantes (en attente ou annulées)
        await db.query('DELETE FROM missions WHERE besoin_id = ?', [id]);
        
        // ⭐ 2. Supprimer le besoin
        const [result] = await db.query(
            `DELETE FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }
        
        res.json({ message: 'Besoin et missions liées supprimés avec succès' });

    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// METTRE À JOUR LA PROGRESSION
// ============================================================
router.put('/:id/progression', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { quantite_trouvee } = req.body;
    const db = req.app.get('db');

    try {
        // ⭐ SÉCURITÉ : seul l'entrepreneur propriétaire du chantier peut toucher à ce besoin
        if (!(await besoinDeLUtilisateur(db, id, req.user.id))) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        await db.query(
            `UPDATE besoins_chantier SET quantite_trouvee = ? WHERE id = ?`,
            [quantite_trouvee, id]
        );

        const [besoin] = await db.query(
            `SELECT quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (besoin.length > 0 && besoin[0].quantite_trouvee >= besoin[0].quantite) {
            await db.query(
                `UPDATE besoins_chantier SET statut = 'satisfait' WHERE id = ?`,
                [id]
            );
        } else if (besoin.length > 0 && besoin[0].quantite_trouvee > 0) {
            await db.query(
                `UPDATE besoins_chantier SET statut = 'en_cours' WHERE id = ?`,
                [id]
            );
        }

        res.json({ message: 'Progression mise à jour' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// VALIDER UN BESOIN COMME SATISFAIT
// ============================================================
router.put('/:id/valider', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');

    try {
        // ⭐ SÉCURITÉ : seul l'entrepreneur propriétaire du chantier peut toucher à ce besoin
        if (!(await besoinDeLUtilisateur(db, id, req.user.id))) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        const [besoin] = await db.query(
            `SELECT quantite FROM besoins_chantier WHERE id = ?`,
            [id]
        );

        if (besoin.length === 0) {
            return res.status(404).json({ message: 'Besoin non trouvé' });
        }

        await db.query(
            `UPDATE besoins_chantier SET statut = 'satisfait', quantite_trouvee = quantite WHERE id = ?`,
            [id]
        );

        res.json({ message: 'Besoin validé comme satisfait' });
    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// EXPORTER LE ROUTER
// ============================================================
module.exports = router;
