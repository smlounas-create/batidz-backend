// ============================================================
// FICHIER: server.js (ou app.js)
// ============================================================

const express = require('express');
const app = express();
const mongoose = require('mongoose');

// Import des routes
const authRoutes = require('./routes/auth');
const missionRoutes = require('./routes/missions');
const utilisateurRoutes = require('./routes/utilisateurs');

// Middleware
app.use(express.json());

// ⭐ Enregistrer les routes
app.use('/api/auth', authRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/utilisateurs', utilisateurRoutes);

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
