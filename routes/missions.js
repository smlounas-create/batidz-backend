// ============================================================
// FICHIER: routes/missions.js
// ============================================================
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { creerNotification } = require('./notifications');

// ============================================================
// GET /api/missions/ouvrier
// ============================================================
router.get('/ouvrier', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const ouvrierId = req.user.id;
    try {
        const [missions] = await db.query(
            `SELECT m.*, c.nom as chantier_nom, c.wilaya, u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.ouvrier_id = ? ORDER BY m.date_debut DESC`,
            [ouvrierId]
        );
        res.json(missions);
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/missions/chantier/:chantier_id
// ============================================================
router.get('/chantier/:chantier_id', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const { chantier_id } = req.params;
    const { statut } = req.query;
    try {
        const [chantier] = await db.query('SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?', [chantier_id, req.user.id]);
        if (chantier.length === 0) return res.status(403).json({ message: 'Non autorisé' });

        let query = `
            SELECT m.*, u.nom_complet AS ouvrier_nom, u.telephone AS ouvrier_telephone, u.email AS ouvrier_email, u.profil AS ouvrier_profil, c.nom AS chantier_nom, b.titre AS besoin_titre, b.categorie AS besoin_categorie
            FROM missions m
            JOIN utilisateurs u ON m.ouvrier_id = u.id
            JOIN chantiers c ON m.chantier_id = c.id
            LEFT JOIN besoins_chantier b ON m.besoin_id = b.id
            WHERE m.chantier_id = ?`;
        const params = [chantier_id];

        if (statut && statut !== '' && statut !== 'toutes') {
            query += ' AND m.statut = ?';
            params.push(statut);
        }
        query += ' ORDER BY m.date_creation DESC';

        const [missions] = await db.query(query, params);
        res.json(missions);
    } catch (error) {
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
        const [chantier] = await db.query('SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?', [chantier_id, req.user.id]);
        if (chantier.length === 0) return res.status(403).json({ message: 'Non autorisé sur ce chantier' });

        let typeMission = type || 'ouvrier';
        if (!type) {
            const [besoin] = await db.query('SELECT categorie FROM besoins_chantier WHERE id = ?', [besoin_id]);
            if (besoin.length > 0) {
                const map = { 'main_oeuvre': 'ouvrier', 'materiel': 'materiel', 'materiaux': 'materiaux' };
                typeMission = map[besoin[0].categorie] || 'ouvrier';
            }
        }

        const [result] = await db.query(
            `INSERT INTO missions (ouvrier_id, chantier_id, entrepreneur_id, besoin_id, type, date_debut, date_fin, statut) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'en_cours')`,
            [ouvrier_id, chantier_id, entrepreneurId, besoin_id, typeMission, date_debut, date_fin || null]
        );

        const missionId = result.insertId;

        const [newMission] = await db.query(
            `SELECT m.*, c.nom as chantier_nom, u.nom_complet as entrepreneur_nom
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             WHERE m.id = ?`,
            [missionId]
        );

        // ⭐ Créer la notification
        try {
            const [besoinRows] = await db.query('SELECT titre FROM besoins_chantier WHERE id = ?', [besoin_id]);
            const titreBesoin = besoinRows[0] ? besoinRows[0].titre : 'votre besoin';
            await creerNotification(db, ouvrier_id, 'mission', '🆕 Nouvelle mission reçue', `Vous avez été engagé pour "${titreBesoin}".`, 'page-ouvrier', missionId);
        } catch (notifError) {
            console.error('Erreur notification mission:', notifError);
        }

        res.status(201).json(newMission[0]);
    } catch (error) {
        console.error('Erreur POST /missions:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/terminer
// ============================================================
router.put('/:id/terminer', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;

    try {
        const [missions] = await db.query('SELECT * FROM missions WHERE id = ? AND entrepreneur_id = ?', [missionId, entrepreneurId]);
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });
        
        const mission = missions[0];
        if (mission.statut === 'terminee') return res.status(400).json({ message: 'Déjà terminée' });
        if (mission.statut === 'annulee') return res.status(400).json({ message: 'Mission annulée' });

        const today = new Date().toISOString().split('T')[0];
        await db.query(`UPDATE missions SET statut = 'terminee', date_fin = ? WHERE id = ?`, [today, missionId]);

        // ⭐ Créer la notification
        try {
            const [ouvrierRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [mission.ouvrier_id]);
            const nomOuvrier = ouvrierRows[0] ? ouvrierRows[0].nom_complet : 'L\'ouvrier';
            await creerNotification(db, mission.entrepreneur_id, 'mission_terminee', '✅ Mission terminée', `${nomOuvrier} a terminé sa mission. Vous pouvez le noter et le payer.`, 'page-chantier-detail', mission.chantier_id);
        } catch (notifError) {
            console.error('Erreur notification terminer:', notifError);
        }

        const [besoin] = await db.query('SELECT categorie, quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?', [mission.besoin_id]);
        if (besoin.length > 0) {
            await db.query(`UPDATE annonces SET disponible = 'oui', statut = 'active' WHERE utilisateur_id = ? AND categorie = ? AND disponible = 'non' ORDER BY date_creation DESC LIMIT 1`, [mission.ouvrier_id, besoin[0].categorie]);
            if (besoin[0].quantite_trouvee < besoin[0].quantite) {
                await db.query(`UPDATE besoins_chantier SET statut = 'en_attente' WHERE id = ?`, [mission.besoin_id]);
            } else {
                await db.query(`UPDATE besoins_chantier SET statut = 'satisfait' WHERE id = ?`, [mission.besoin_id]);
            }
        }
        res.json({ message: 'Mission terminée', mission_id: missionId });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/annuler
// ============================================================
router.put('/:id/annuler', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;

    try {
        const [missions] = await db.query('SELECT * FROM missions WHERE id = ? AND entrepreneur_id = ?', [missionId, entrepreneurId]);
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });
        const mission = missions[0];
        if (mission.statut === 'terminee') return res.status(400).json({ message: 'Déjà terminée' });

        await db.query(`UPDATE missions SET statut = 'annulee' WHERE id = ?`, [missionId]);

        const [besoin] = await db.query('SELECT quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?', [mission.besoin_id]);
        if (besoin.length > 0) {
            const nouvelleQte = Math.max(0, (besoin[0].quantite_trouvee || 0) - 1);
            const nouveauStatut = nouvelleQte >= besoin[0].quantite ? 'satisfait' : (nouvelleQte > 0 ? 'en_cours' : 'en_attente');
            await db.query(`UPDATE besoins_chantier SET quantite_trouvee = ?, statut = ? WHERE id = ?`, [nouvelleQte, nouveauStatut, mission.besoin_id]);
            
            const [besoinFull] = await db.query('SELECT categorie FROM besoins_chantier WHERE id = ?', [mission.besoin_id]);
            if (besoinFull.length > 0) {
                await db.query(`UPDATE annonces SET disponible = 'oui', statut = 'active' WHERE utilisateur_id = ? AND categorie = ? AND disponible = 'non' ORDER BY date_creation DESC LIMIT 1`, [mission.ouvrier_id, besoinFull[0].categorie]);
            }
        }
        res.json({ message: 'Mission annulée' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/noter
// ============================================================
router.put('/:id/noter', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const entrepreneurId = req.user.id;
    const { note, commentaire } = req.body;

    if (!note || note < 1 || note > 5) return res.status(400).json({ message: 'Note entre 1 et 5' });

    try {
        const [missions] = await db.query('SELECT id, statut, ouvrier_id FROM missions WHERE id = ? AND entrepreneur_id = ?', [missionId, entrepreneurId]);
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });

        await db.query(`UPDATE missions SET note = ?, commentaire = ? WHERE id = ?`, [note, commentaire || null, missionId]);

        // ⭐ Créer la notification
        try {
            const [entrepreneurRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [entrepreneurId]);
            const nomEntrepreneur = entrepreneurRows[0] ? entrepreneurRows[0].nom_complet : 'L\'entrepreneur';
            await creerNotification(db, missions[0].ouvrier_id, 'note', `⭐ Nouvelle note reçue : ${note}/5`, `${nomEntrepreneur} vous a laissé un avis.`, 'page-ouvrier', missionId);
        } catch (notifError) {
            console.error('Erreur notification note:', notifError);
        }

        res.json({ message: 'Mission notée', note, commentaire });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/paiement
// ============================================================
router.put('/:id/paiement', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const { paiement_pourcentage } = req.body;

    if (paiement_pourcentage === undefined || paiement_pourcentage < 0 || paiement_pourcentage > 100) return res.status(400).json({ message: 'Invalide' });

    try {
        const [result] = await db.query(`UPDATE missions SET paiement_pourcentage = ? WHERE id = ? AND entrepreneur_id = ?`, [paiement_pourcentage, missionId, req.user.id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Non trouvée' });
        res.json({ message: 'Pourcentage mis à jour', paiement_pourcentage });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/statut
// ============================================================
router.put('/:id/statut', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const { statut } = req.body;
    if (!['en_cours', 'terminee', 'annulee'].includes(statut)) return res.status(400).json({ message: 'Statut invalide' });

    try {
        const [result] = await db.query('UPDATE missions SET statut = ? WHERE id = ? AND entrepreneur_id = ?', [statut, missionId, req.user.id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Non trouvée' });
        res.json({ message: 'Statut mis à jour', statut });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
