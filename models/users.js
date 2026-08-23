// ============================================================
// FICHIER: models/User.js
// ============================================================

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nom_complet: { type: String, required: true },
    telephone: { type: String, required: true, unique: true },
    email: { type: String },
    wilaya: { type: String, required: true },
    profil: {
        type: String,
        enum: ['entrepreneur', 'ouvrier', 'fournisseur_materiel', 'fournisseur_materiaux'],
        required: true
    },
    mot_de_passe: { type: String, required: true },
    
    // Champs ouvrier
    metier: { type: String },
    experience: { type: String },
    tranche_horaire: { type: String },
    salaire_souhaite: { type: Number },
    type_remuneration: { type: String },
    securite_sociale: { type: String },
    disponible: { type: String, enum: ['oui', 'non'], default: 'oui' },
    
    // Champs entrepreneur
    domaine: { type: String },
    registre_commerce: { type: String },
    qualification: { type: Number },
    
    // Champs fournisseur matériel
    type_materiel: { type: String },
    marque_materiel: { type: String },
    annee_materiel: { type: Number },
    
    // Champs fournisseur matériaux
    type_materiaux: { type: String },
    conditionnement_materiaux: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
