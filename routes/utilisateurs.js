// ============================================================
// FICHIER: routes/utilisateurs.js
// ============================================================

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authenticateToken = require('../middleware/auth');

// ⭐ 5. PUT /api/utilisateurs/disponibilite - Mettre à jour la disponibilité
router.put('/disponibilite', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { disponible } = req.body;
        
        if (!disponible || !['oui', 'non'].includes(disponible)) {
            return res.status(400).json({
                message: 'La disponibilité doit être "oui" ou "non"'
            });
        }
        
        const user = await User.findByIdAndUpdate(
            userId,
            { disponible },
            { new: true }
        ).select('-mot_de_passe');
        
        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
        
        res.json({
            message: 'Disponibilité mise à jour',
            utilisateur: user
        });
    } catch (error) {
        console.error('Erreur PUT /disponibilite:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
