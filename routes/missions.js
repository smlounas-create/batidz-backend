// ============================================================
// FICHIER: routes/missions.js
// ============================================================
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { creerNotification } = require('./notifications');

// ⭐ Ajuste la quantité trouvée d'un besoin (+1, -1 ou 0) et recalcule son statut.
// Avant : rien n'augmentait jamais quantite_trouvee, donc un besoin ne passait jamais « satisfait ».
// ⭐ Recalcule la quantité trouvée d'un besoin à partir de ses missions acceptées ou terminées.
//    Chaque mission apporte SA quantité (1 ouvrier, 2 compresseurs, 60 m² de carrelage...).
//    (Avant : +1 / -1 par mission, d'où « 1/60 » pour 60 m² livrés par un seul fournisseur.)
//    Le 3e paramètre n'est plus utilisé ; il est gardé pour ne pas toucher aux appels.
async function mettreAJourBesoin(db, besoinId, _delta) {
    if (!besoinId) return;
    const [rows] = await db.query('SELECT quantite FROM besoins_chantier WHERE id = ?', [besoinId]);
    if (rows.length === 0) return;
    const quantite = rows[0].quantite || 1;
    const [somme] = await db.query(
        `SELECT COALESCE(SUM(quantite), 0) AS total FROM missions WHERE besoin_id = ? AND statut IN ('en_cours', 'terminee')`,
        [besoinId]
    );
    const trouvee = Math.min(quantite, Number(somme[0].total) || 0);
    const statut = trouvee >= quantite ? 'satisfait' : (trouvee > 0 ? 'en_cours' : 'en_attente');
    await db.query('UPDATE besoins_chantier SET quantite_trouvee = ?, statut = ? WHERE id = ?', [trouvee, statut, besoinId]);
}

// ============================================================
// GET /api/missions/ouvrier
// ============================================================
router.get('/ouvrier', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const ouvrierId = req.user.id;
    try {
        const [missions] = await db.query(
            `SELECT m.*, c.nom as chantier_nom, c.wilaya, u.nom_complet as entrepreneur_nom,
                    b.titre AS besoin_titre, b.categorie AS besoin_categorie, b.unite AS besoin_unite
             FROM missions m
             JOIN chantiers c ON m.chantier_id = c.id
             JOIN utilisateurs u ON m.entrepreneur_id = u.id
             LEFT JOIN besoins_chantier b ON m.besoin_id = b.id
             WHERE m.ouvrier_id = ? ORDER BY m.date_debut DESC`,
            [ouvrierId]
        );
        res.json(missions);
    } catch (error) {
        console.error('Erreur GET /missions/ouvrier:', error);
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
            SELECT m.*, u.nom_complet AS ouvrier_nom, u.telephone AS ouvrier_telephone, u.email AS ouvrier_email, u.profil AS ouvrier_profil, c.nom AS chantier_nom, b.titre AS besoin_titre, b.categorie AS besoin_categorie, b.unite AS besoin_unite
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
        console.error('Erreur GET /missions/chantier:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/missions/:id - Une mission (pour retrouver son chantier depuis une notification)
// ============================================================
router.get('/:id', authenticateToken, async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const db = req.app.get('db');
    try {
        // ⭐ Seuls l'entrepreneur et le professionnel de la mission y ont accès
        // (entrepreneur, professionnel et nom du professionnel : la page vérifie ainsi
        //  qu'une notification correspond bien à cette mission)
        const [missions] = await db.query(
            `SELECT m.id, m.chantier_id, m.statut, m.entrepreneur_id, m.ouvrier_id, u.nom_complet AS ouvrier_nom
             FROM missions m LEFT JOIN utilisateurs u ON u.id = m.ouvrier_id
             WHERE m.id = ? AND (m.entrepreneur_id = ? OR m.ouvrier_id = ?)`,
            [req.params.id, req.user.id, req.user.id]
        );
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });
        res.json(missions[0]);
    } catch (error) {
        console.error('Erreur GET /missions/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/missions - Créer une mission
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const entrepreneurId = req.user.id;
    const { ouvrier_id, chantier_id, besoin_id, date_debut, date_fin, type, quantite } = req.body;

    if (!ouvrier_id || !chantier_id || !besoin_id || !date_debut) {
        return res.status(400).json({ message: 'Champs obligatoires manquants' });
    }

    try {
        const [chantier] = await db.query('SELECT id FROM chantiers WHERE id = ? AND entrepreneur_id = ?', [chantier_id, req.user.id]);
        if (chantier.length === 0) return res.status(403).json({ message: 'Non autorisé sur ce chantier' });

        // ⭐ On ne s'engage pas soi-même
        if (Number(ouvrier_id) === Number(entrepreneurId)) {
            return res.status(400).json({ message: 'Vous ne pouvez pas vous engager vous-même' });
        }

        // ⭐ Pas de doublon : même professionnel, même besoin, mission encore ouverte
        // (avant : chaque clic sur « Engager » créait une nouvelle mission identique)
        const [doublon] = await db.query(
            `SELECT id FROM missions WHERE besoin_id = ? AND ouvrier_id = ? AND statut IN ('en_attente_acceptation', 'en_cours')`,
            [besoin_id, ouvrier_id]
        );
        if (doublon.length > 0) {
            return res.status(409).json({ message: 'Ce professionnel est déjà engagé pour ce besoin' });
        }

        // ⭐ Le besoin doit appartenir à CE chantier (avant : on pouvait viser le besoin d'un autre
        //    entrepreneur et modifier son compteur).
        const [besoin] = await db.query('SELECT categorie, quantite FROM besoins_chantier WHERE id = ? AND chantier_id = ?', [besoin_id, chantier_id]);
        if (besoin.length === 0) return res.status(404).json({ message: 'Besoin non trouvé sur ce chantier' });
        let typeMission = type || 'ouvrier';
        if (!type && besoin.length > 0) {
            const map = { 'main_oeuvre': 'ouvrier', 'materiel': 'materiel', 'materiaux': 'materiaux' };
            typeMission = map[besoin[0].categorie] || 'ouvrier';
        }

        // ⭐ Un ouvrier ne peut être que sur un chantier à la fois : s'il a déjà une mission
        //    en cours, on ne peut pas l'engager ailleurs (il redevient libre quand elle est
        //    terminée ou annulée). Les fournisseurs, eux, servent plusieurs chantiers.
        if (typeMission === 'ouvrier') {
            const [enMission] = await db.query(
                `SELECT id FROM missions WHERE ouvrier_id = ? AND statut = 'en_cours' AND type = 'ouvrier' LIMIT 1`,
                [ouvrier_id]
            );
            if (enMission.length > 0) {
                return res.status(409).json({ message: 'Cet ouvrier est déjà en mission' });
            }
        }

        // ⭐ Quantité demandée à ce professionnel : 1 pour un ouvrier ; pour le matériel et les matériaux,
        //    ce que l'entrepreneur a indiqué (entre 1 et la quantité totale du besoin).
        let quantiteMission = 1;
        if (besoin.length > 0 && besoin[0].categorie !== 'main_oeuvre' && quantite !== undefined && quantite !== null && quantite !== '') {
            quantiteMission = Number(quantite);
            const maximum = besoin[0].quantite || 1;
            if (!Number.isInteger(quantiteMission) || quantiteMission < 1 || quantiteMission > maximum) {
                return res.status(400).json({ message: 'Quantité invalide pour ce besoin' });
            }
        }

        const [result] = await db.query(
            `INSERT INTO missions (ouvrier_id, chantier_id, entrepreneur_id, besoin_id, type, date_debut, date_fin, statut, quantite) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'en_attente_acceptation', ?)`,
            [ouvrier_id, chantier_id, entrepreneurId, besoin_id, typeMission, date_debut, date_fin || null, quantiteMission]
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

        // ⭐ Notifier le professionnel engagé
        try {
            const notifResult = await creerNotification(
                db, 
                ouvrier_id, 
                'mission', 
                '🆕 Nouvelle mission reçue', 
                'Vous avez été engagé pour un nouveau besoin.', 
                'page-ouvrier', 
                missionId
            );
            console.log("✅ Résultat notification:", notifResult);
        } catch (notifError) {
            console.error('❌ Erreur notification mission:', notifError);
        }

        res.status(201).json(newMission[0]);
    } catch (error) {
        console.error('Erreur POST /missions:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});
// ============================================================
// PUT /api/missions/:id/accepter - L'ouvrier accepte la mission
// ============================================================
router.put('/:id/accepter', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const ouvrierId = req.user.id;

    try {
        // On vérifie que la mission appartient bien à cet ouvrier
        const [missions] = await db.query('SELECT * FROM missions WHERE id = ? AND ouvrier_id = ?', [missionId, ouvrierId]);
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });
        
        if (missions[0].statut !== 'en_attente_acceptation') {
            return res.status(400).json({ message: 'Cette mission n\'est plus en attente' });
        }

        // ⭐ Un ouvrier ne peut pas accepter une 2e mission tant que la première est en cours
        const estOuvrier = missions[0].type === 'ouvrier';
        if (estOuvrier) {
            const [enMission] = await db.query(
                `SELECT id FROM missions WHERE ouvrier_id = ? AND statut = 'en_cours' AND type = 'ouvrier' AND id <> ? LIMIT 1`,
                [ouvrierId, missionId]
            );
            if (enMission.length > 0) {
                return res.status(409).json({ message: 'Vous avez déjà une mission en cours' });
            }
        }

        // On passe le statut à "en_cours"
        await db.query(`UPDATE missions SET statut = 'en_cours' WHERE id = ?`, [missionId]);
        // ⭐ Le professionnel a accepté : le besoin compte une personne / un équipement trouvé de plus
        await mettreAJourBesoin(db, missions[0].besoin_id, +1);

        // ⭐ On notifie l'entrepreneur
        const mission = missions[0];
        try {
            const [ouvrierRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [ouvrierId]);
            const nomOuvrier = ouvrierRows[0] ? ouvrierRows[0].nom_complet : 'Le pro';
            await creerNotification(db, mission.entrepreneur_id, 'mission_acceptee', '✅ Mission acceptée', `${nomOuvrier} a accepté votre proposition.`, 'page-chantier-detail', missionId);   // ⭐ n° de la mission (avant : du chantier)
        } catch (e) {}

        // ⭐ L'ouvrier est maintenant « en mission » : ses autres propositions en attente sont annulées
        //    et les entrepreneurs concernés sont prévenus (ils n'attendent pas une réponse qui ne viendra pas).
        if (estOuvrier) {
            try {
                const [autres] = await db.query(
                    `SELECT id, entrepreneur_id FROM missions WHERE ouvrier_id = ? AND statut = 'en_attente_acceptation' AND type = 'ouvrier' AND id <> ?`,
                    [ouvrierId, missionId]
                );
                if (autres.length > 0) {
                    const [ouvrierRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [ouvrierId]);
                    const nomOuvrier = ouvrierRows[0] ? ouvrierRows[0].nom_complet : 'L\'ouvrier';
                    for (const autre of autres) {
                        await db.query(`UPDATE missions SET statut = 'annulee' WHERE id = ?`, [autre.id]);
                        await creerNotification(db, autre.entrepreneur_id, 'mission_refusee', '❌ Ouvrier indisponible', `${nomOuvrier} a accepté une autre mission et n'est plus disponible.`, 'page-chantier-detail', autre.id);
                    }
                }
            } catch (e) {
                console.error('Erreur annulation des autres propositions:', e);
            }
        }

        res.json({ message: 'Mission acceptée avec succès' });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/accepter:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/missions/:id/refuser - L'ouvrier refuse la mission
// ============================================================
router.put('/:id/refuser', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const missionId = req.params.id;
    const ouvrierId = req.user.id;

    try {
        const [missions] = await db.query('SELECT * FROM missions WHERE id = ? AND ouvrier_id = ?', [missionId, ouvrierId]);
        if (missions.length === 0) return res.status(404).json({ message: 'Mission non trouvée' });
        
        if (missions[0].statut !== 'en_attente_acceptation') {
            return res.status(400).json({ message: 'Cette mission n\'est plus en attente' });
        }

        // On passe le statut à "annulee" : la mission refusée apparaît dans le filtre « Annulées » de la page chantier
        await db.query(`UPDATE missions SET statut = 'annulee' WHERE id = ?`, [missionId]);

        // ⭐ On notifie l'entrepreneur
        const mission = missions[0];
        try {
            const [ouvrierRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [ouvrierId]);
            const nomOuvrier = ouvrierRows[0] ? ouvrierRows[0].nom_complet : 'Le pro';
            await creerNotification(db, mission.entrepreneur_id, 'mission_refusee', '❌ Mission refusée', `${nomOuvrier} a refusé votre proposition.`, 'page-chantier-detail', missionId);   // ⭐ n° de la mission (avant : du chantier)
        } catch (e) {}

        res.json({ message: 'Mission refusée' });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/refuser:', error);
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
         if (mission.statut === 'en_attente_acceptation') return res.status(400).json({ message: 'Le pro n\'a pas encore accepté cette mission.' });
        if (mission.statut === 'terminee') return res.status(400).json({ message: 'Déjà terminée' });
        if (mission.statut === 'annulee') return res.status(400).json({ message: 'Mission annulée' });

        const today = new Date().toISOString().split('T')[0];
        await db.query(`UPDATE missions SET statut = 'terminee', date_fin = ? WHERE id = ?`, [today, missionId]);

        // ⭐ Notifier le professionnel. Avant : la notification partait vers l'entrepreneur,
        // c'est-à-dire vers la personne qui venait elle-même de cliquer « Terminer ».
        try {
            const [entrepreneurRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [entrepreneurId]);
            const nomEntrepreneur = entrepreneurRows[0] ? entrepreneurRows[0].nom_complet : 'L\'entrepreneur';
            await creerNotification(db, mission.ouvrier_id, 'mission_terminee', '✅ Mission terminée', `${nomEntrepreneur} a marqué votre mission comme terminée.`, 'page-ouvrier', missionId);
        } catch (notifError) {
            console.error('Erreur notification terminer:', notifError);
        }

        const [besoin] = await db.query('SELECT categorie, quantite, quantite_trouvee FROM besoins_chantier WHERE id = ?', [mission.besoin_id]);
        if (besoin.length > 0) {
            // ⭐ L'annonce du professionnel n'est plus touchée : sa disponibilité, c'est lui qui la choisit.
            // ⭐ Avant : « en_attente » même si une partie était déjà trouvée
            await mettreAJourBesoin(db, mission.besoin_id, 0);
        }
        res.json({ message: 'Mission terminée', mission_id: missionId });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/terminer:', error);
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
        // ⭐ Avant : une 2e annulation diminuait encore la quantité trouvée du besoin
        if (mission.statut === 'annulee') return res.status(400).json({ message: 'Mission déjà annulée' });
        const etaitAcceptee = mission.statut === 'en_cours';   // statut AVANT l'annulation

        await db.query(`UPDATE missions SET statut = 'annulee' WHERE id = ?`, [missionId]);

        // ⭐ Prévenir le professionnel (avant : aucune notification)
        try {
            const [entrepreneurRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [entrepreneurId]);
            const nomEntrepreneur = entrepreneurRows[0] ? entrepreneurRows[0].nom_complet : 'L\'entrepreneur';
            await creerNotification(db, mission.ouvrier_id, 'mission_annulee', '❌ Mission annulée', `${nomEntrepreneur} a annulé la mission.`, 'page-ouvrier', missionId);
        } catch (notifError) {
            console.error('Erreur notification annuler:', notifError);
        }

        // ⭐ La quantité trouvée ne baisse que si la mission avait été acceptée (donc comptée)
        if (etaitAcceptee) await mettreAJourBesoin(db, mission.besoin_id, -1);

        // ⭐ L'annonce du professionnel n'est plus touchée (avant : elle était remise « disponible »
        //    et « active », même si son propriétaire l'avait désactivée).
        res.json({ message: 'Mission annulée' });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/annuler:', error);
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
        // ⭐ La page ne propose « Noter » qu'après la fin : le serveur l'impose aussi
        if (missions[0].statut !== 'terminee') return res.status(400).json({ message: 'La mission doit être terminée pour être notée' });

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
        console.error('Erreur PUT /missions/:id/noter:', error);
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
        console.error('Erreur PUT /missions/:id/paiement:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ⭐ La route PUT /api/missions/:id/statut a été retirée : le site ne s'en servait pas, et elle
//    permettait de passer une mission « en cours » sans l'accord du professionnel (ce qui bloquait
//    un ouvrier), sans mettre à jour le besoin ni prévenir personne. On utilise accepter / refuser /
//    terminer / annuler, qui font tout cela.

module.exports = router;
