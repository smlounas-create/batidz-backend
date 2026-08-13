const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',  // ⚠️ Pour Render/Netlify
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const db = require('./config/database');
app.set('db', db);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API BATIDZ en ligne' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/annonces', require('./routes/annonces'));

app.listen(PORT, () => {
    console.log(`🚀 Serveur BATIDZ démarré sur http://localhost:${PORT}`);
});