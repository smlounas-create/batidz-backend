const express = require('express');
const authenticateToken = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ============================================================
// CRÉER UNE ANNONCE (POST)
// ============================================================
// ============================================================
router.post('/', authenticateToken, [
   
    body('categorie').isIn(['main_oeuvre', 'materiel', 'materiaux']),
    body('titre').notEmpty().withMessage('Titre requis'),
    body('description').notEmpty().withMessage('Description requise'),
    body('wilaya').notEmpty().withMessage('Wilaya requise')
], async (req, res) => {
    console.log('🔍 ===== DEBUT CREATION ANNONCE =====');
    console.log('📦 Body reçu:', req.body);
    console.log('👤 Utilisateur (req.user):', req.user);
   const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ erreurs: errors.array() });
    }

    if (!req.user) {
        return res.status(401).json({ message: 'Utilisateur non authentifié' });
    }

    const { type_annonce, categorie, titre, description, wilaya, budget } = req.body;
    const db = req.app.get('db');

    try {
 console.log('🔍 1. Récupération de l\'utilisateur ID:', req.user.id);
       // ⭐ 1. Récupérer les informations de l'utilisateur
        const [user] = await db.query(
            `SELECT id, profil, credits, solde, abonnement_statut, abonnement_date_fin 
             FROM utilisateurs 
             WHERE id = ?`,
            [req.user.id]
        );

        if (user.length === 0) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
 console.log('👤 Utilisateur trouvé:', user[0]);
        // ⭐ 2. VÉRIFICATION DES CRÉDITS (ouvrier / fournisseur)
        if (user[0].profil === 'ouvrier' || user[0].profil === 'fournisseur_materiel' || user[0].profil === 'fournisseur_materiaux') {
            console.log('🔍 2. Vérification des crédits:', user[0].credits);  
            // Vérifier si l'utilisateur a des crédits
            if (user[0].credits < 1) {
                return res.status(402).json({ 
                    message: 'Crédits insuffisants pour publier une annonce',
                    credits: user[0].credits,
                    solde: user[0].solde,
                    cout: user[0].profil === 'ouvrier' ? 500 : 1000
                });
            }
        }
  console.log('🔍 3. Insertion de l\'annonce...');
        // ⭐ 3. VÉRIFICATION DE L'ABONNEMENT (entrepreneur)
        if (user[0].profil === 'entrepreneur') {
            // Vérifier si l'abonnement est actif et non expiré
            const dateFin = new Date(user[0].abonnement_date_fin);
            const now = new Date();
            
            if (user[0].abonnement_statut !== 'actif' || dateFin < now) {
                return res.status(402).json({ 
                    message: 'Abonnement actif requis pour créer une annonce',
                    abonnement_statut: user[0].abonnement_statut,
                    date_fin: user[0].abonnement_date_fin
                });
            }
        }

        // ⭐ 4. Insérer l'annonce
        const [result] = await db.query(
            `INSERT INTO annonces 
            (utilisateur_id, categorie, titre, description, wilaya, statut) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, categorie, titre, description, wilaya, 'active' ]
        );
 console.log('✅ Annonce insérée, ID:', result.insertId);
        const [newAnnonce] = await db.query(
            'SELECT * FROM annonces WHERE id = ?',
            [result.insertId]
        );

        // ⭐ 5. Déduire 1 crédit pour ouvrier/fournisseur
        let creditsRestants = null;
        if (user[0].profil === 'ouvrier' || user[0].profil === 'fournisseur_materiel' || user[0].profil === 'fournisseur_materiaux') {
            console.log('🔍 4. Déduction d\'un crédit'); 
           await db.query(
                'UPDATE utilisateurs SET credits = credits - 1 WHERE id = ?',
                [req.user.id]
            );
            
            // Récupérer les crédits restants
            const [updatedUser] = await db.query(
                'SELECT credits FROM utilisateurs WHERE id = ?',
                [req.user.id]
            );
            creditsRestants = updatedUser[0].credits;

            // ⭐ 6. Enregistrer le paiement
            const cout = user[0].profil === 'ouvrier' ? 500 : 1000;
            await db.query(
                `INSERT INTO paiements_annonces 
                 (annonce_id, utilisateur_id, montant, statut, date_paiement) 
                 VALUES (?, ?, ?, 'paye', NOW())`,
                [result.insertId, req.user.id, cout]
            );
        }
  console.log('✅ Annonce créée avec succès !');
        res.status(201).json({
            message: 'Annonce créée avec succès',
            annonce: newAnnonce[0],
            credits_restants: creditsRestants
        });

    } catch (error) {
        console.error('Erreur SQL:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});


// ============================================================
// RECHERCHER DES ANNONCES (GET)
// ============================================================
router.get('/', async (req, res) => {
    const { wilaya, categorie, disponible } = req.query;
    const db = req.app.get('db');

    try {
        let query = `
            SELECT a.*, u.nom_complet, u.profil, u.disponible
            FROM annonces a
            JOIN utilisateurs u ON a.utilisateur_id = u.id
            WHERE a.statut = 'active'
        `;
        const params = [];

        if (wilaya && wilaya !== '') {
            query += ' AND a.wilaya = ?';
            params.push(wilaya);
        }
        if (categorie && categorie !== '') {
            query += ' AND a.categorie = ?';
            params.push(categorie);
        }
       
        if (disponible && disponible !== '') {
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
// ⭐ NOUVEAU : RÉCUPÉRER MES ANNONCES
// ============================================================
router.get('/mes-annonces', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const [annonces] = await db.query(
            `SELECT a.*, u.nom_complet, u.profil, u.disponible
             FROM annonces a
             JOIN utilisateurs u ON a.utilisateur_id = u.id
             WHERE a.utilisateur_id = ?
             ORDER BY a.date_creation DESC`,
            [userId]
        );

        res.json(annonces);
    } catch (error) {
        console.error('Erreur GET /annonces/mes-annonces:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// OBTENIR UNE ANNONCE SPÉCIFIQUE (GET)
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
// SUPPRIMER UNE ANNONCE (DELETE)
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const db = req.app.get('db');
 console.log('🔍 DELETE /annonces/', id);
    console.log('👤 Utilisateur:', req.user);
   
    try {
          await db.query(
            'DELETE FROM paiements_annonces WHERE annonce_id = ?',
            [id]
        );

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
// METTRE À JOUR LE STATUT D'UNE ANNONCE (PUT)
// ============================================================
router.put('/:id/statut', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { statut } = req.body;
    const db = req.app.get('db');
 console.log('🔍 PUT statut - ID:', id, 'Statut:', statut);
    console.log('👤 Utilisateur:', req.user);

    const statutsValides = ['active', 'inactive', 'terminee'];
    if (!statut || !statutsValides.includes(statut)) {
        return res.status(400).json({ message: 'Statut invalide' });
    }

    try {
        const [result] = await db.query(
            'UPDATE annonces SET statut = ? WHERE id = ? AND utilisateur_id = ?',
            [statut, id, req.user.id]
        );
 console.log('📊 Rows affected:', result.affectedRows);
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
