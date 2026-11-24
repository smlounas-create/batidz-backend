// ============================================================
// FICHIER: middleware/auth.js
// ============================================================

const jwt = require('jsonwebtoken');

// ⭐ Clé secrète des jetons de connexion : UNIQUEMENT celle définie sur Render (variable JWT_SECRET).
//    Avant : une clé de secours était écrite ici ('votre_secret'), et une autre dans routes/auth.js
//    ('secret_development'). Si JWT_SECRET venait à manquer, quiconque lit ce code aurait pu
//    fabriquer un jeton et se connecter à la place de n'importe quel utilisateur.
function cleJWT() {
    const cle = process.env.JWT_SECRET;
    if (!cle) {
        throw new Error('JWT_SECRET n\'est pas défini sur le serveur');
    }
    return cle;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Token manquant' });
    }

    let cle;
    try {
        cle = cleJWT();
    } catch (e) {
        console.error('❌', e.message);
        return res.status(500).json({ message: 'Erreur serveur' });
    }
    
    jwt.verify(token, cle, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token invalide' });
        }
        req.user = user;
        next();
    });
}

module.exports = authenticateToken;
module.exports.cleJWT = cleJWT;
