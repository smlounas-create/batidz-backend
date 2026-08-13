console.log('1. Début du test...');

try {
    console.log('2. Chargement de express...');
    const express = require('express');
    console.log('   ✅ express chargé');
    
    console.log('3. Chargement de cors...');
    const cors = require('cors');
    console.log('   ✅ cors chargé');
    
    console.log('4. Chargement de dotenv...');
    const dotenv = require('dotenv');
    console.log('   ✅ dotenv chargé');
    
    console.log('5. Chargement de config/database...');
    const db = require('./config/database');
    console.log('   ✅ database chargé');
    
    console.log('6. Chargement de routes/auth...');
    const authRoutes = require('./routes/auth');
    console.log('   ✅ auth chargé');
    
    console.log('7. Chargement de routes/annonces...');
    const annoncesRoutes = require('./routes/annonces');
    console.log('   ✅ annonces chargé');
    
    console.log('8. Création du serveur...');
    const app = express();
    app.use(express.json());
    app.use(cors());
    
    app.get('/api/health', (req, res) => {
        res.json({ status: 'OK' });
    });
    
    const PORT = 3005;
    app.listen(PORT, () => {
        console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
    });
    
} catch (error) {
    console.error('❌ ERREUR :', error.message);
    console.error('📚 Stack :', error.stack);
}