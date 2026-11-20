// ============================================================
// server.js - Version MySQL pour Clever Cloud
// ============================================================

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 1000;

// ============================================================
// 1. MIDDLEWARE
// ============================================================
// ============================================================
// CORS - Configuration sécurisée
// ============================================================
const corsOptions = {
    origin: function(origin, callback) {
        // 1. Pas d'origine = Postman, apps mobiles, curl → autoriser
        if (!origin) {
            return callback(null, true);
        }
        
        // 2. Autoriser tout ce qui est localhost / 127.0.0.1 / IP locale (dev)
        if (origin.includes('localhost') || 
            origin.includes('127.0.0.1') || 
            origin.includes('192.168.') ||
            origin.includes('10.0.') ||
            origin.includes('172.')) {
            return callback(null, true);
        }
        
        // 3. Domaines autorisés en production
        const domainesAutorises = [
            'https://batidz-backend-github.onrender.com',
            'https://batidz.netlify.app',
            'https://batidz.com',
              'https://btphdz.netlify.app', // ⭐ TA NOUVELLE URL
            'https://www.batidz.com'
        ];
        
        if (domainesAutorises.includes(origin)) {
            return callback(null, true);
        }
        
        // 4. Bloquer tout le reste
        console.log('🚫 CORS bloqué pour:', origin);
        callback(new Error('Non autorisé par CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
// ⭐ Les photos sont envoyées en texte (base64) : jusqu'à ~7 Mo pour une photo de 5 Mo.
// La limite par défaut d'Express (100 Ko) refusait presque toutes les photos.
app.use(express.json({ limit: '10mb' }));

// ============================================================
// 2. CONNEXION MySQL (Clever Cloud avec SSL)
// ============================================================
// ⭐ Une seule réserve de connexions pour tout le serveur : celle de config/database.js
// (avant : une 2e réserve ici, 10 + 10 connexions pour une base limitée à 5)
const pool = require('./config/database');

// ⭐ Ajouter la base de données à l'application
app.set('db', pool);

// ⭐ Tester la connexion au démarrage
// ⭐ Si la base est momentanément pleine (ex. pendant un redéploiement), on réessaie au lieu d'arrêter le serveur
(async function testDbConnection(essai = 1) {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL connecté avec succès');
        console.log(`📊 Base de données: ${process.env.DB_NAME}`);
        console.log(`🌐 Hôte: ${process.env.DB_HOST}`);
        connection.release();
    } catch (error) {
        console.error(`❌ Erreur de connexion MySQL (essai ${essai}/5) :`, error.message);
        if (essai < 5) {
            setTimeout(() => testDbConnection(essai + 1), 10000);
            return;
        }
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
        database: 'MySQL (Clever Cloud)'
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

// ⭐ Routes des besoins (si pas déjà fait)// ⭐ Routes des annonces
const annonceRoutes = require('./routes/annonces');
app.use('/api/annonces', annonceRoutes);

// ⭐ Routes des missions
const missionRoutes = require('./routes/missions');
app.use('/api/missions', missionRoutes);

// ⭐ Routes des utilisateurs
const utilisateurRoutes = require('./routes/utilisateurs');
app.use('/api/utilisateurs', utilisateurRoutes);
const besoinRoutes = require('./routes/besoins');
app.use('/api/besoins', besoinRoutes);
// ⭐ Routes des notifications
const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);

const messageRoutes = require('./routes/messages');
app.use('/api/messages', messageRoutes);

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
