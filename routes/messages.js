// routes/messages.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { creerNotification } = require('./notifications');

// ⭐ Entrepreneur sans abonnement (ni essai en cours) : accès refusé à ces routes
const { exigerAbonnement } = require('../middleware/abonnement');
router.use(exigerAbonnement);

// ============================================================
// GET /api/messages/contacts
// Récupérer la liste des personnes avec qui on a discuté
// ============================================================
router.get('/contacts', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;

    try {
        const [contacts] = await db.query(
            `SELECT DISTINCT u.id, u.nom_complet, u.profil, u.photo,
                (SELECT COUNT(*) FROM messages WHERE expediteur_id = u.id AND destinataire_id = ? AND lu = 0) AS non_lus
             FROM utilisateurs u
             JOIN messages m ON (u.id = m.expediteur_id OR u.id = m.destinataire_id)
             WHERE (m.expediteur_id = ? OR m.destinataire_id = ?) 
               AND u.id != ?
             ORDER BY u.nom_complet ASC`,
            [userId, userId, userId, userId]
        );
        res.json(contacts);
    } catch (error) {
        console.error('Erreur GET /messages/contacts:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/messages/:contact_id
// Récupérer la conversation avec un contact
// ============================================================
router.get('/:contact_id', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const userId = req.user.id;
    const contactId = req.params.contact_id;

    try {
        const [messages] = await db.query(
            `SELECT * FROM messages 
             WHERE (expediteur_id = ? AND destinataire_id = ?) 
                OR (expediteur_id = ? AND destinataire_id = ?)
             ORDER BY date_envoi ASC`,
            [userId, contactId, contactId, userId]
        );
        
        // Marquer les messages reçus comme lus
        await db.query(
            `UPDATE messages SET lu = 1 WHERE expediteur_id = ? AND destinataire_id = ? AND lu = 0`,
            [contactId, userId]
        );

        res.json(messages);
    } catch (error) {
        console.error('Erreur GET /messages/:contact_id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/messages
// Envoyer un message
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const expediteurId = req.user.id;
    const { destinataire_id, contenu, annonce_id } = req.body; // ⭐ On ajoute annonce_id

    if (!destinataire_id || !contenu || contenu.trim() === '') {
        return res.status(400).json({ message: 'Destinataire et contenu obligatoires' });
    }

    if (Number(destinataire_id) === Number(expediteurId)) {
        return res.status(400).json({ message: 'Vous ne pouvez pas vous écrire à vous-même' });
    }

    try {
        // ⭐ Le destinataire doit exister (avant : erreur serveur ou message perdu)
        const [dest] = await db.query('SELECT id FROM utilisateurs WHERE id = ?', [destinataire_id]);
        if (dest.length === 0) {
            return res.status(404).json({ message: 'Destinataire introuvable' });
        }

        // ⭐ On inclut annonce_id dans l'insertion (s'il existe, sinon NULL)
        const [result] = await db.query(
            `INSERT INTO messages (expediteur_id, destinataire_id, annonce_id, contenu) VALUES (?, ?, ?, ?)`,
            [expediteurId, destinataire_id, annonce_id || null, contenu]
        );

        // Créer la notification pour le destinataire
        try {
            const [expRows] = await db.query('SELECT nom_complet FROM utilisateurs WHERE id = ?', [expediteurId]);
            const nomExpediteur = expRows[0] ? expRows[0].nom_complet : 'Un utilisateur';
            
            await creerNotification(
                db, 
                destinataire_id, 
                'message', 
                'Nouveau message', 
                `${nomExpediteur} vous a envoyé un message.`, 
                'page-messages', 
                expediteurId // Lien vers la conversation
            );
        } catch (notifErr) {
            console.error('Erreur notif message:', notifErr);
        }

        res.status(201).json({ id: result.insertId, message: 'Message envoyé' });
    } catch (error) {
        console.error('Erreur POST /messages:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
