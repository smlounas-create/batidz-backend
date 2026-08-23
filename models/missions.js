// ============================================================
// FICHIER: models/Mission.js
// ============================================================

const mongoose = require('mongoose');

const MissionSchema = new mongoose.Schema({
    ouvrier_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    chantier_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Chantier', 
        required: true 
    },
    entrepreneur_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    besoin_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Besoin', 
        required: true 
    },
    date_debut: { type: Date, required: true },
    date_fin: { type: Date },
    statut: {
        type: String,
        enum: ['en_cours', 'terminee', 'annulee'],
        default: 'en_cours'
    },
    note: { type: Number, min: 1, max: 5 }
}, { timestamps: true });

module.exports = mongoose.model('Mission', MissionSchema);
