// ============================================================
// server.js - Version MySQL pour Clever Cloud
// ============================================================

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 1000;

// ============================================================
// 1. MIDDLEWARE
// ============================================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ============================================================
// 2. CONNEXION MySQL (Clever Cloud avec SSL)
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // ⭐ IMPORTANT: Configuration SSL pour Clever Cloud
    ssl: {
        rejectUnauthorized: false  // Nécessaire pour Clever Cloud
    }
});

// ⭐ Ajouter la base de données à l'application
app.set('db', pool);

// ⭐ Tester la connexion au démarrage
(async function testDbConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL connecté avec succès');
        console.log(`📊 Base de données: ${process.env.DB_NAME}`);
        console.log(`🌐 Hôte: ${process.env.DB_HOST}`);
        connection.release();
    } catch (error) {
        console.error('❌ Erreur de connexion MySQL:', error.message);
        console.error('   Vérifiez vos variables d\'environnement:');
        console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
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
        database: 'MySQL (Clever Cloud)',
        db_host: process.env.DB_HOST,
        db_name: process.env.DB_NAME
    });
});

// ⭐ Route racine
app.get('/', (req, res) => {
    res.json({ 
        message: 'Bienvenue sur l\'API BATIDZ',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/inscription, /api/auth/connexion, /api/auth/me',
            health: '/health'
        }
    });
});
// server.js - Ajouter ces lignes APRÈS les routes d'authentification

// ⭐ Routes des chantiers
const chantierRoutes = require('./routes/chantiers');
app.use('/api/chantiers', chantierRoutes);

// ⭐ Routes des besoins (si pas déjà fait)
const besoinRoutes = require('./routes/besoins');
app.use('/api/besoins', besoinRoutes);

// ============================================================
// 4. GESTION DES ERREURS
// ============================================================
app.use((req, res) => {
    res.status(404).json({ message: 'Route non trouvée' });
});

app.use((err, req, res, next) => {
    console.error('❌ Erreur:', err);
    res.status(500).json({ 
        message: 'Erreur serveur',
        error: err.message 
    });
});

// ============================================================
// 5. DÉMARRAGE DU SERVEUR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📍 URL: https://batidz-backend-github.onrender.com`);
    console.log(`📊 Health check: https://batidz-backend-github.onrender.com/health`);
});
