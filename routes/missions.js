// ============================================================
// FICHIER: routes/missions.js
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

// ============================================================
// GET /api/missions/ouvrier - Récupérer les missions d'un ouvrier
// ============================================================
router.get('/ouvrier', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const ouvrierId = req.user.id;

    try {
        const [missions] = await db.query(
            `SELECT m.*, 
                    c.nom as chantier_nom, 
                    c.wilaya,
                    u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.ouvrier_id = ?
             ORDER BY m.date_debut DESC`,
            [ouvrierId]
        );

        res.json(missions);
    } catch (error) {
        console.error('Erreur GET /missions/ouvrier:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/missions/chantier/:chantier_id - Missions d'un chantier
// ============================================================
router.get('/chantier/:chantier_id', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const { chantier_id } = req.params;
    const { statut } = req.query; // filtre optionnel

    try {
        let query = `
            SELECT m.*,
                   u.nom_complet AS ouvrier_nom,
                   u.telephone AS ouvrier_telephone,
                   u.email AS ouvrier_email,
                   u.profil AS ouvrier_profil,
                   c.nom AS chantier_nom,
                   b.titre AS besoin_titre,
                   b.categorie AS besoin_categorie
            FROM missions m
            JOIN utilisateurs u ON m.ouvrier_id = u.id
            JOIN chantiers c ON m.chantier_id = c.id
            LEFT JOIN besoins_chantier b ON m.besoin_id = b.id
            WHERE m.chantier_id = ?
        `;
        const params = [chantier_id];

        if (statut && statut !== '' && statut !== 'toutes') {
            query += ' AND m.statut = ?';
            params.push(statut);
        }

        query += ' ORDER BY m.date_creation DESC';

        const [missions] = await db.query(query, params);
        res.json(missions);
    } catch (error) {
        console.error('Erreur GET /missions/chantier/:chantier_id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/missions - Créer une mission
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const entrepreneurId = req.user.id;
    const { ouvrier_id, chantier_id, besoin_id, date_debut, date_fin, type } = req.body;

    if (!ouvrier_id || !chantier_id || !besoin_id || !date_debut) {
        return res.status(400).json({ message: 'Champs obligatoires manquants' });
    }

    try {
        // Déterminer le type en fonction de la catégorie du besoin si non fourni
        let typeMission = type || 'ouvrier';
        if (!type) {
            const [besoin] = await db.query(
                'SELECT categorie FROM besoins_chantier WHERE id = ?',
                [besoin_id]
            );
            if (besoin.length > 0) {
                const map = { 'main_oeuvre': 'ouvrier', 'materiel': 'materiel', 'materiaux': 'materiaux' };
                typeMission = map[besoin[0].categorie] || 'ouvrier';
            }
        }

        const [result] = await db.query(
            `INSERT INTO missions 
             (ouvrier_id, chantier_id, entrepreneur_id, besoin_id, type, date_debut, date_fin, statut) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'en_cours')`,
            [ouvrier_id, chantier_id, entrepreneurId, besoin_id, typeMission, date_debut, date_fin || null]
        );

        const [newMission] = await db.query(
            `SELECT m.*, 
                    c.nom as chantier_nom, 
                    u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.id = ?`,
            [result.insertId]
        );

        res.status(201).json(newMission[0]);
    } catch (error) {
        console.error('Erreur POST /missions:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/terminer - Marquer comme terminée
// ============================================================
router.put('/:id/terminer', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;

    console.log('🔍 PUT /missions/' + missionId + '/terminer');

    try {
        // 1️⃣ Récupérer la mission
        const [missions] = await db.query(
            'SELECT * FROM missions WHERE id = ? AND entrepreneur_id = ?',
            [missionId, entrepreneurId]
        );

        if (missions.length === 0) {
            return res.status(404).json({ message: 'Mission non trouvée ou non autorisée' });
        }

        const mission = missions[0];

        if (mission.statut === 'terminee') {
            return res.status(400).json({ message: 'Mission déjà terminée' });
        }

        if (mission.statut === 'annulee') {
            return res.status(400).json({ message: 'Impossible de terminer une mission annulée' });
        }

        // 2️⃣ Mettre à jour la mission
        const today = new Date().toISOString().split('T')[0];
        await db.query(
            `UPDATE missions SET statut = 'terminee', date_fin = ? WHERE id = ?`,
            [today, missionId]
        );
        console.log('✅ Mission passée en "terminee"');

        // 3️⃣ Rendre l'annonce de l'ouvrier disponible
        //    → chercher l'annonce liée au besoin (même catégorie et même utilisateur)
        const [besoin] = await db.query(
            'SELECT categorie, quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?',
            [mission.besoin_id]
        );

        if (besoin.length > 0) {
            const cat = besoin[0].categorie;

            // Rendre l'annonce disponible
            const [annonceResult] = await db.query(
                `UPDATE annonces 
                 SET disponible = 'oui', statut = 'active'
                 WHERE utilisateur_id = ? 
                   AND categorie = ? 
                   AND disponible = 'non'
                 ORDER BY date_creation DESC
                 LIMIT 1`,
                [mission.ouvrier_id, cat]
            );
            console.log('✅ Annonces réactivées:', annonceResult.affectedRows);

            // 4️⃣ Mettre à jour le statut du besoin
            if (besoin[0].quantite_trouvee < besoin[0].quantite) {
                await db.query(
                    `UPDATE besoins_chantier SET statut = 'en_attente' WHERE id = ?`,
                    [mission.besoin_id]
                );
                console.log('✅ Besoin repassé en "en_attente" (non satisfait)');
            } else {
                await db.query(
                    `UPDATE besoins_chantier SET statut = 'satisfait' WHERE id = ?`,
                    [mission.besoin_id]
                );
                console.log('✅ Besoin reste "satisfait"');
            }
        }

        res.json({ message: 'Mission terminée avec succès', mission_id: missionId });

    } catch (error) {
        console.error('Erreur PUT /missions/:id/terminer:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/annuler - Annuler une mission
// ============================================================
router.put('/:id/annuler', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;

    console.log('🔍 PUT /missions/' + missionId + '/annuler');

    try {
        const [missions] = await db.query(
            'SELECT * FROM missions WHERE id = ? AND entrepreneur_id = ?',
            [missionId, entrepreneurId]
        );

        if (missions.length === 0) {
            return res.status(404).json({ message: 'Mission non trouvée ou non autorisée' });
        }

        const mission = missions[0];

        if (mission.statut === 'terminee') {
            return res.status(400).json({ message: 'Impossible d\'annuler une mission terminée' });
        }

        // 1️⃣ Annuler la mission
        await db.query(
            `UPDATE missions SET statut = 'annulee' WHERE id = ?`,
            [missionId]
        );

        // 2️⃣ Décrémenter la quantité trouvée du besoin
        const [besoin] = await db.query(
            'SELECT quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?',
            [mission.besoin_id]
        );

        if (besoin.length > 0) {
            const nouvelleQte = Math.max(0, (besoin[0].quantite_trouvee || 0) - 1);
            const nouveauStatut = nouvelleQte >= besoin[0].quantite
                ? 'satisfait'
                : (nouvelleQte > 0 ? 'en_cours' : 'en_attente');

            await db.query(
                `UPDATE besoins_chantier SET quantite_trouvee = ?, statut = ? WHERE id = ?`,
                [nouvelleQte, nouveauStatut, mission.besoin_id]
            );

            // 3️⃣ Rendre l'annonce disponible
            const [besoinFull] = await db.query(
                'SELECT categorie FROM besoins_chantier WHERE id = ?',
                [mission.besoin_id]
            );
            if (besoinFull.length > 0) {
                await db.query(
                    `UPDATE annonces 
                     SET disponible = 'oui', statut = 'active'
                     WHERE utilisateur_id = ? 
                       AND categorie = ? 
                       AND disponible = 'non'
                     ORDER BY date_creation DESC
                     LIMIT 1`,
                    [mission.ouvrier_id, besoinFull[0].categorie]
                );
            }
        }

        res.json({ message: 'Mission annulée avec succès' });

    } catch (error) {
        console.error('Erreur PUT /missions/:id/annuler:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/noter - Noter une mission (note + commentaire)
// ============================================================
router.put('/:id/noter', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;
    const { note, commentaire } = req.body;

    if (!note || note < 1 || note > 5) {
        return res.status(400).json({ message: 'La note doit être comprise entre 1 et 5' });
    }

    try {
        // Vérifier que c'est bien l'entrepreneur de la mission
        const [missions] = await db.query(
            'SELECT id, statut FROM missions WHERE id = ? AND entrepreneur_id = ?',
            [missionId, entrepreneurId]
        );

        if (missions.length === 0) {
            return res.status(404).json({ message: 'Mission non trouvée ou non autorisée' });
        }

        await db.query(
            `UPDATE missions SET note = ?, commentaire = ? WHERE id = ?`,
            [note, commentaire || null, missionId]
        );

        res.json({ message: 'Mission notée avec succès', note, commentaire });

    } catch (error) {
        console.error('Erreur PUT /missions/:id/noter:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/paiement - Mettre à jour le % de paiement
// ============================================================
router.put('/:id/paiement', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;
    const { paiement_pourcentage } = req.body;

    if (paiement_pourcentage === undefined || paiement_pourcentage < 0 || paiement_pourcentage > 100) {
        return res.status(400).json({ message: 'Le pourcentage doit être entre 0 et 100' });
    }

    try {
        const [result] = await db.query(
            `UPDATE missions SET paiement_pourcentage = ? WHERE id = ? AND entrepreneur_id = ?`,
            [paiement_pourcentage, missionId, entrepreneurId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Mission non trouvée ou non autorisée' });
        }

        res.json({
            message: 'Pourcentage de paiement mis à jour',
            paiement_pourcentage
        });

    } catch (error) {
        console.error('Erreur PUT /missions/:id/paiement:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/statut - Changer le statut (legacy)
// ============================================================
router.put('/:id/statut', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const { statut } = req.body;

    const statutsValides = ['en_cours', 'terminee', 'annulee'];
    if (!statut || !statutsValides.includes(statut)) {
        return res.status(400).json({ message: 'Statut invalide' });
    }

    try {
        const [result] = await db.query(
            'UPDATE missions SET statut = ? WHERE id = ? AND entrepreneur_id = ?',
            [statut, missionId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Mission non trouvée' });
        }

        res.json({ message: 'Statut mis à jour', statut });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/statut:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
