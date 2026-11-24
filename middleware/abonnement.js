// ============================================================
// FICHIER: middleware/abonnement.js
// ⭐ Un entrepreneur sans abonnement actif (ni essai gratuit en cours) n'a plus accès qu'à son
//    compte, à ses notifications et au paiement : les autres routes lui répondent « Abonnement requis ».
//    Les ouvriers et les fournisseurs ne sont pas concernés (ils achètent des crédits).
// ============================================================

const jwt = require('jsonwebtoken');
const { cleJWT } = require('./auth');

// Abonnement (ou essai) valable jusqu'à la fin du jour indiqué
async function abonnementActif(db, userId) {
    const [rows] = await db.query(
        'SELECT (abonnement_date_fin IS NOT NULL AND DATE(abonnement_date_fin) >= CURDATE()) AS actif FROM utilisateurs WHERE id = ?',
        [userId]
    );
    return rows.length > 0 && Number(rows[0].actif) === 1;
}

// À placer devant les routes réservées : laisse passer tout ce qui n'est pas un entrepreneur connecté
// (l'absence de jeton ou un jeton invalide reste traitée par la route elle-même).
function exigerAbonnement(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    let user;
    try {
        user = jwt.verify(token, cleJWT());
    } catch (e) {
        return next();
    }
    if (!user || user.profil !== 'entrepreneur') return next();

    abonnementActif(req.app.get('db'), user.id)
        .then(actif => {
            if (actif) return next();
            res.status(402).json({ message: 'Abonnement requis', code: 'abonnement_requis' });
        })
        .catch(error => {
            console.error('Erreur contrôle abonnement:', error);
            res.status(500).json({ message: 'Erreur serveur' });
        });
}

module.exports = { exigerAbonnement, abonnementActif };
