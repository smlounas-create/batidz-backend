// ============================================================
// config/database.js - LA SEULE réserve de connexions MySQL du serveur
// ============================================================
// ⭐ server.js et tous les fichiers qui en ont besoin importent CE fichier.
// Ne créez pas d'autre createPool / createConnection ailleurs :
// la base Clever Cloud n'accepte que 5 connexions en même temps pour ce compte.

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'batidz',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    waitForConnections: true,
    connectionLimit: 3,     // ⭐ 3 sur 5 : il en reste pour phpMyAdmin et les redéploiements Render
    maxIdle: 1,             // ⭐ une seule connexion gardée ouverte quand le site est calme
    idleTimeout: 30000,     // ⭐ les autres sont refermées après 30 s d'inactivité
    enableKeepAlive: true,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false  // ⚠️ Important pour Clever Cloud
    }
});

module.exports = pool;
