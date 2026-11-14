const express = require('express');
const router = express.Router();
const db = require('../config/db'); // ⚠️ Si ça plante ici, utilise la méthode du pool (voir plus bas)

// ⚠️ On importe TON middleware sous son vrai nom
const authenticateToken = require('../middleware/auth');

// ============================================================
// FONCTION UTILITAIRE : CRÉER UNE NOTIFICATION
// ============================================================
async function creerNotification(utilisateur_id, type, titre, message, lien_page = null, lien_id = null) {
    try {
        const pool = require('../server').pool; // Récupère le pool depuis server.js
        await pool.query(
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
router.get('/', authenticateToken, async (req, res) => {
    try {
        const pool = req.app.get('db'); // Récupère la BDD depuis l'app Express
        const userId = req.user.id;
        
        const [notifs] = await pool.query(
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
router.get('/count', authenticateToken, async (req, res) => {
    try {
        const pool = req.app.get('db');
        const userId = req.user.id;
        
        const [rows] = await pool.query(
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
router.put('/:id/lu', authenticateToken, async (req, res) => {
    try {
        const pool = req.app.get('db');
        const userId = req.user.id;
        const notifId = req.params.id;

        const [result] = await pool.query(
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
router.put('/tout-lu', authenticateToken, async (req, res) => {
    try {
        const pool = req.app.get('db');
        const userId = req.user.id;
        
        await pool.query(
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
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const pool = req.app.get('db');
        const userId = req.user.id;
        const notifId = req.params.id;

        const [result] = await pool.query(
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
