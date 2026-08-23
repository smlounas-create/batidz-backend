// ============================================================
// server.js - Version MySQL (corrigée)
// ============================================================

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// 1. MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());

// ============================================================
// 2. CONNEXION MySQL
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'batidz',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ⭐ Ajouter la base de données à l'application
app.set('db', pool);

// ⭐ Tester la connexion au démarrage
(async function testDbConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL connecté avec succès');
        connection.release();
    } catch (error) {
        console.error('❌ Erreur de connexion MySQL:', error.message);
        console.error('   Vérifiez vos variables d\'environnement DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
        process.exit(1);
    }
})();

// ============================================================
// 3. ROUTES
// ============================================================

// ⭐ Routes d'authentification
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ⭐ Route de santé (health check)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: 'MySQL'
    });
});

// ⭐ Route racine
app.get('/', (req, res) => {
    res.json({ 
        message: 'Bienvenue sur l\'API BATIDZ',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/inscription, /api/auth/connexion, /api/auth/me'
        }
    });
});

// ============================================================
// 4. GESTION DES ERREURS 404
// ============================================================
app.use((req, res) => {
    res.status(404).json({ message: 'Route non trouvée' });
});

// ============================================================
// 5. DÉMARRAGE DU SERVEUR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
