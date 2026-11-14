const express = require('express');
const router = express.Router();

// ⚠️ On récupère le pool MySQL depuis l'application Express
const getDb = (req) => req.app.get('db');

// ⚠️ On importe le middleware. Vérifie bien le nom de la fonction exportée dans ton auth.js !
const { authentification } = require('../middleware/auth'); 

// ============================================================
// FONCTION UTILITAIRE : CRÉER UNE NOTIFICATION
// ============================================================
async function creerNotification(db, utilisateur_id, type, titre, message, lien_page = null, lien_id = null) {
    try {
        await db.query(
            `INSERT INTO notifications (utilisateur_id, type, titre, message, lien_page, lien_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [utilisateur_id, type, titre, message, lien_page, lien_id]
        );
        return true;
    } catch (error) {
        console.error('Erreur creation notification:', error);
        return false;
    }
}

// ============================================================
// GET /api/notifications
// ============================================================
router.get('/', authentification, async (req, res) => {
    try {
        const db = getDb(req);
        const userId = req.user.id;
        
        const [notifs] = await db.query(
            `SELECT * FROM notifications 
             WHERE utilisateur_id = ? 
             ORDER BY date_creation DESC 
             LIMIT 50`,
            [userId]
        );
        res.json(notifs);
    } catch (error) {
        console.error('Erreur GET /notifications:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/notifications/count
// ============================================================
router.get('/count', authentification, async (req, res) => {
    try {
        const db = getDb(req);
        const userId = req.user.id;
        
        const [rows] = await db.query(
            `SELECT COUNT(*) AS total FROM notifications 
             WHERE utilisateur_id = ? AND lu = 0`,
            [userId]
        );
        res.json({ total: rows[0].total });
    } catch (error) {
        console.error('Erreur GET /notifications/count:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/notifications/:id/lu
// ============================================================
router.put('/:id/lu', authentification, async (req, res) => {
    try {
        const db = getDb(req);
        const userId = req.user.id;
        const notifId = req.params.id;

        const [result] = await db.query(
            `UPDATE notifications SET lu = 1 
             WHERE id = ? AND utilisateur_id = ?`,
            [notifId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Notification non trouvée' });
        }
        res.json({ message: 'Notification marquée comme lue' });
    } catch (error) {
        console.error('Erreur PUT /notifications/:id/lu:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// PUT /api/notifications/tout-lu
// ============================================================
router.put('/tout-lu', authentification, async (req, res) => {
    try {
        const db = getDb(req);
        const userId = req.user.id;
        
        await db.query(
            `UPDATE notifications SET lu = 1 
             WHERE utilisateur_id = ? AND lu = 0`,
            [userId]
        );
        res.json({ message: 'Toutes les notifications marquées comme lues' });
    } catch (error) {
        console.error('Erreur PUT /notifications/tout-lu:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// DELETE /api/notifications/:id
// ============================================================
router.delete('/:id', authentification, async (req, res) => {
    try {
        const db = getDb(req);
        const userId = req.user.id;
        const notifId = req.params.id;

        const [result] = await db.query(
            `DELETE FROM notifications WHERE id = ? AND utilisateur_id = ?`,
            [notifId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Notification non trouvée' });
        }
        res.json({ message: 'Notification supprimée' });
    } catch (error) {
        console.error('Erreur DELETE /notifications/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
module.exports.creerNotification = creerNotification;
