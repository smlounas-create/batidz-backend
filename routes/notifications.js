// routes/notifications.js
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // ⚠️ Adapte le chemin selon ton projet
const { authentification, async } = require('../middleware/auth');

// ============================================================
// FONCTION UTILITAIRE : CRÉER UNE NOTIFICATION
// Utilisable depuis d'autres routes : creerNotification(...)
// ============================================================
async function creerNotification(utilisateur_id, type, titre, message, lien_page = null, lien_id = null) {
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
// Récupérer les notifications de l'utilisateur connecté
// ============================================================
router.get('/', authentification, async (req, res) => {
    const userId = req.user.id;
    try {
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
// Nombre de notifications non lues
// ============================================================
router.get('/count', authentification, async (req, res) => {
    const userId = req.user.id;
    try {
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
// Marquer une notification comme lue
// ============================================================
router.put('/:id/lu', authentification, async (req, res) => {
    const userId = req.user.id;
    const notifId = req.params.id;

    try {
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
// Marquer TOUTES les notifications comme lues
// ============================================================
router.put('/tout-lu', authentification, async (req, res) => {
    const userId = req.user.id;
    try {
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
// Supprimer une notification
// ============================================================
router.delete('/:id', authentification, async (req, res) => {
    const userId = req.user.id;
    const notifId = req.params.id;

    try {
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

// ============================================================
// EXPORTS
// ============================================================
module.exports = router;
module.exports.creerNotification = creerNotification;
