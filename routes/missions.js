// ============================================================
// FICHIER: routes/missions.js
// ============================================================

const express = require('express');
const router = express.Router();
const Mission = require('../models/Mission');
const authenticateToken = require('../middleware/auth');

// ⭐ 3. GET /api/missions/ouvrier - Récupérer les missions d'un ouvrier
router.get('/ouvrier', authenticateToken, async (req, res) => {
    try {
        const ouvrierId = req.user.id;
        
        const missions = await Mission.find({ ouvrier_id: ouvrierId })
            .populate('chantier_id', 'nom wilaya')
            .populate('entrepreneur_id', 'nom_complet');
        
        const formattedMissions = missions.map(m => ({
            id: m._id,
            chantier_nom: m.chantier_id?.nom || 'Chantier',
            entrepreneur_nom: m.entrepreneur_id?.nom_complet || 'Non défini',
            wilaya: m.chantier_id?.wilaya || 'Non défini',
            statut: m.statut || 'en_cours',
            note: m.note || null,
            date_debut: m.date_debut,
            date_fin: m.date_fin
        }));
        
        res.json(formattedMissions);
    } catch (error) {
        console.error('Erreur GET /missions/ouvrier:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ⭐ 4. PUT /api/missions/:id/note - Noter une mission
router.put('/:id/note', authenticateToken, async (req, res) => {
    try {
        const missionId = req.params.id;
        const { note } = req.body;
        
        if (!note || note < 1 || note > 5) {
            return res.status(400).json({
                message: 'La note doit être comprise entre 1 et 5'
            });
        }
        
        const mission = await Mission.findByIdAndUpdate(
            missionId,
            { note: note },
            { new: true }
        );
        
        if (!mission) {
            return res.status(404).json({ message: 'Mission non trouvée' });
        }
        
        res.json({
            message: 'Mission notée avec succès',
            note: mission.note
        });
    } catch (error) {
        console.error('Erreur PUT /missions/:id/note:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
