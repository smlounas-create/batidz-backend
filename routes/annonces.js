const express = require('express');
const authenticateToken = require('../middleware/auth');
const { abonnementActif, exigerAbonnement } = require('../middleware/abonnement');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// ⭐ Entrepreneur sans abonnement (ni essai en cours) : accès refusé à ces routes
router.use(exigerAbonnement);

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

    const { type_annonce, categorie, titre, description, wilaya, budget,
            specialite, experience, tranche_horaire, salaire_souhaite, type_remuneration } = req.body;
    // ⭐ Chaque annonce garde SES informations (métier, expérience, salaire... ou type de matériel).
    //    Avant : elles étaient écrites dans le profil, et toutes les annonces de la personne
    //    prenaient le dernier métier saisi. Un ouvrier peut ainsi avoir une annonce par métier.
    const texte = v => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim().slice(0, 100);
    const salaireAnnonce = (salaire_souhaite === undefined || salaire_souhaite === null || salaire_souhaite === '') ? null : Number(salaire_souhaite);
    if (salaireAnnonce !== null && (!Number.isFinite(salaireAnnonce) || salaireAnnonce < 0)) {
        return res.status(400).json({ message: 'Salaire invalide' });
    }
    const db = req.app.get('db');
    let creditRetire = false, annonceCreee = false;

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
                    code: 'credits_insuffisants',
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
            // ⭐ Abonnement payé OU essai gratuit en cours (même règle que le reste de l'application)
            if (!(await abonnementActif(db, req.user.id))) {
                return res.status(402).json({ 
                    code: 'abonnement_requis',
                    message: 'Abonnement actif requis pour créer une annonce',
                    abonnement_statut: user[0].abonnement_statut,
                    date_fin: user[0].abonnement_date_fin
                });
            }
        }

        // ⭐ Le crédit est retiré AVANT de publier, en une seule opération qui échoue s'il n'en reste plus.
        //    (Avant : deux publications simultanées avec 1 crédit passaient toutes les deux → crédits négatifs.)
        const estPro = user[0].profil === 'ouvrier' || user[0].profil === 'fournisseur_materiel' || user[0].profil === 'fournisseur_materiaux';
        if (estPro) {
            const [retrait] = await db.query(
                'UPDATE utilisateurs SET credits = credits - 1 WHERE id = ? AND credits >= 1',
                [req.user.id]
            );
            if (retrait.affectedRows === 0) {
                return res.status(402).json({ code: 'credits_insuffisants', message: 'Crédits insuffisants pour publier une annonce' });
            }
            creditRetire = true;
        }

        // ⭐ 4. Insérer l'annonce
        const [result] = await db.query(
            `INSERT INTO annonces 
            (utilisateur_id, categorie, titre, description, wilaya, statut,
             specialite, experience, tranche_horaire, salaire_souhaite, type_remuneration) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, categorie, titre, description, wilaya, 'active',
             texte(specialite), texte(experience), texte(tranche_horaire), salaireAnnonce, texte(type_remuneration)]
        );
        annonceCreee = true;
 console.log('✅ Annonce insérée, ID:', result.insertId);
        const [newAnnonce] = await db.query(
            'SELECT * FROM annonces WHERE id = ?',
            [result.insertId]
        );

        // ⭐ 5. Déduire 1 crédit pour ouvrier/fournisseur
        let creditsRestants = null;
        if (user[0].profil === 'ouvrier' || user[0].profil === 'fournisseur_materiel' || user[0].profil === 'fournisseur_materiaux') {
            // (le crédit a déjà été retiré avant la publication)
            
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
        // ⭐ Crédit retiré mais annonce non publiée : on le rend
        if (creditRetire && !annonceCreee) {
            try { await db.query('UPDATE utilisateurs SET credits = credits + 1 WHERE id = ?', [req.user.id]); } catch (e) {}
        }
        res.status(500).json({ message: 'Erreur serveur' });
    }
});


// ============================================================
// RECHERCHER DES ANNONCES (GET)
// ============================================================
router.get('/', async (req, res) => {
    const { wilaya, categorie } = req.query;
    const db = req.app.get('db');

    try {
               let query = `
            SELECT a.*, 
                   u.nom_complet, 
                   u.profil, 
                   u.marque_materiel,
                   u.annee_materiel,
                   u.conditionnement_materiaux
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

        // ⭐ Seules les annonces « active » sont montrées : désactiver une annonce la retire des recherches.
        // (La colonne « disponible » n'est plus utilisée.)

        // ⭐ Un ouvrier qui a une mission en cours est « en mission » : son annonce n'apparaît plus
        //    jusqu'à ce que la mission soit terminée ou annulée. Les fournisseurs ne sont pas concernés.
        query += ` AND NOT (a.categorie = 'main_oeuvre' AND EXISTS (
                       SELECT 1 FROM missions m
                       WHERE m.ouvrier_id = a.utilisateur_id AND m.statut = 'en_cours' AND m.type = 'ouvrier'
                         AND (m.fin_signalee_le IS NULL OR m.fin_signalee_le > NOW() - INTERVAL 7 DAY)))`;

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
            `SELECT a.*, 
                    u.nom_complet, 
                    u.profil, 
                    u.marque_materiel,
                    u.annee_materiel,
                    u.conditionnement_materiaux
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
            `SELECT a.*, 
                    u.nom_complet, 
                    u.profil, 
                    u.marque_materiel,
                    u.annee_materiel,
                    u.conditionnement_materiaux
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
        // ⭐ On vérifie d'abord que l'annonce appartient à l'utilisateur.
        //    (Avant : les paiements de N'IMPORTE QUELLE annonce étaient effacés, même si elle
        //     appartenait à quelqu'un d'autre ; seule l'annonce elle-même était protégée.)
        const [miennes] = await db.query('SELECT id FROM annonces WHERE id = ? AND utilisateur_id = ?', [id, req.user.id]);
        if (miennes.length === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }

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
// ============================================================
// METTRE À JOUR UNE ANNONCE (PUT) - STATUT
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { statut } = req.body;
    const db = req.app.get('db');

    console.log('🔍 PUT /annonces/', id);
    console.log('📦 Body reçu:', req.body);
    console.log('👤 Utilisateur:', req.user);

    try {
        // 1️⃣ Vérifier que l'annonce existe
        const [check] = await db.query(
            'SELECT a.id, a.utilisateur_id, u.profil FROM annonces a JOIN utilisateurs u ON a.utilisateur_id = u.id WHERE a.id = ?',
            [id]
        );

        if (check.length === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }

        const annonce = check[0];

        // 2️⃣ ⭐ Seul le propriétaire modifie son annonce (avant : n'importe quel entrepreneur
        //    pouvait changer la disponibilité de n'importe quelle annonce).
        if (Number(annonce.utilisateur_id) !== Number(req.user.id)) {
            return res.status(403).json({ 
                message: 'Seul le propriétaire peut modifier le statut de l\'annonce' 
            });
        }
        if (statut === undefined) {
            return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
        }

        // 3️⃣ Construire la requête
        let updates = [];
        let values = [];

        if (statut !== undefined) {
            const statutsValides = ['active', 'inactive', 'terminee'];
            if (!statutsValides.includes(statut)) {
                return res.status(400).json({ message: 'Statut invalide' });
            }
            updates.push('statut = ?');
            values.push(statut);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Aucune donnée à mettre à jour' });
        }

        // 4️⃣ Exécuter la mise à jour
        values.push(id);
        const query = `UPDATE annonces SET ${updates.join(', ')} WHERE id = ?`;
        const [result] = await db.query(query, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Annonce non trouvée' });
        }

        // 5️⃣ Récupérer l'annonce mise à jour
        const [updated] = await db.query(
            'SELECT * FROM annonces WHERE id = ?',
            [id]
        );

        console.log('✅ Annonce mise à jour:', updated[0]);
        res.json({
            message: 'Annonce mise à jour avec succès',
            annonce: updated[0]
        });

    } catch (error) {
        console.error('Erreur PUT /annonces/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
module.exports = router;
