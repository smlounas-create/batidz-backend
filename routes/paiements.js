// ============================================================
// FICHIER: routes/paiements.js
// ⭐ Achat de crédits (ouvriers, fournisseurs) et d'abonnement (entrepreneurs)
//    - par reçu de virement CCP / BaridiMob : un administrateur vérifie puis valide ;
//    - par carte CIB / Edahabia en ligne (Chargily Pay) : validé automatiquement par le webhook.
//
// Réglages sur Render (rubrique Environment) — rien n'est écrit dans le code :
//    PRIX_CREDIT_OUVRIER (500 par défaut), PRIX_CREDIT_FOURNISSEUR (1000 par défaut),
//    PRIX_ABONNEMENT_MENSUEL, PRIX_ABONNEMENT_ANNUEL (sans eux, l'abonnement ne peut pas être acheté),
//    PAIEMENT_TITULAIRE, PAIEMENT_CCP, PAIEMENT_BARIDIMOB (affichés aux clients qui paient par virement),
//    CHARGILY_SECRET_KEY (sans elle, la carte n'est pas proposée), CHARGILY_MODE (« test » ou « live »).
// ============================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { abonnementActif } = require('../middleware/abonnement');
const { creerNotification } = require('./notifications');

const MOYENS_MANUELS = ['ccp', 'baridimob'];
const CREDITS_MAX_PAR_ACHAT = 50;
const RECU_TAILLE_MAX = 3 * 1024 * 1024;   // photo du reçu (déjà réduite à ~200 Ko par le site)

function entier(v) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function tarifs() {
    return {
        credit: {
            ouvrier: entier(process.env.PRIX_CREDIT_OUVRIER) || 500,
            fournisseur_materiel: entier(process.env.PRIX_CREDIT_FOURNISSEUR) || 1000,
            fournisseur_materiaux: entier(process.env.PRIX_CREDIT_FOURNISSEUR) || 1000
        },
        abonnement: {
            mensuel: entier(process.env.PRIX_ABONNEMENT_MENSUEL),
            annuel: entier(process.env.PRIX_ABONNEMENT_ANNUEL)
        },
        comptes: {
            titulaire: process.env.PAIEMENT_TITULAIRE || null,
            ccp: process.env.PAIEMENT_CCP || null,
            baridimob: process.env.PAIEMENT_BARIDIMOB || null
        },
        carte: !!process.env.CHARGILY_SECRET_KEY
    };
}

// Montant calculé par le serveur (jamais celui envoyé par la page)
function calculerAchat(profil, { objet, formule, quantite }) {
    const t = tarifs();
    if (objet === 'credits') {
        if (!t.credit[profil]) return { erreur: 'Les crédits sont réservés aux professionnels' };
        const q = Number(quantite);
        if (!Number.isInteger(q) || q < 1 || q > CREDITS_MAX_PAR_ACHAT) return { erreur: 'Nombre de crédits invalide' };
        return { objet, formule: null, quantite: q, montant: q * t.credit[profil] };
    }
    if (objet === 'abonnement') {
        if (profil !== 'entrepreneur') return { erreur: 'L\'abonnement est réservé aux entrepreneurs' };
        if (!['mensuel', 'annuel'].includes(formule)) return { erreur: 'Formule d\'abonnement invalide' };
        const prix = t.abonnement[formule];
        if (!prix) return { erreur: 'Le prix de l\'abonnement n\'est pas encore fixé' };
        return { objet, formule, quantite: 1, montant: prix };
    }
    return { erreur: 'Achat invalide' };
}

// Page du site où revenir après le paiement par carte : celle d'où vient la demande (même site),
// sinon SITE_URL réglé sur Render. Jamais une adresse d'un autre site.
function adresseRetour(req) {
    const origine = req.get('origin') || '';
    const demandee = typeof req.body.retour === 'string' ? req.body.retour.split('?')[0].split('#')[0] : '';
    if (origine && demandee.startsWith(origine + '/')) return demandee;
    return (process.env.SITE_URL || origine).replace(/\/$/, '') + '/';
}

async function utilisateurConnecte(db, id) {
    const [rows] = await db.query('SELECT id, nom_complet, profil, est_admin FROM utilisateurs WHERE id = ?', [id]);
    return rows[0] || null;
}

// ⭐ Applique un paiement une seule fois : crédits ajoutés ou abonnement prolongé.
//    Le changement de statut est conditionnel : un 2e appel (webhook répété, double clic) ne fait rien.
async function appliquerPaiement(db, paiement, nouveauStatut, adminId = null) {
    const [maj] = await db.query(
        `UPDATE paiements SET statut = ?, date_traitement = NOW(), traite_par = ? WHERE id = ? AND statut = 'en_attente'`,
        [nouveauStatut, adminId, paiement.id]
    );
    if (!maj.affectedRows) return false;

    if (paiement.objet === 'credits') {
        await db.query('UPDATE utilisateurs SET credits = COALESCE(credits, 0) + ? WHERE id = ?', [paiement.quantite, paiement.utilisateur_id]);
    } else if (paiement.objet === 'abonnement') {
        // Prolongé à partir de la fin actuelle si elle est encore à venir, sinon à partir d'aujourd'hui
        const duree = paiement.formule === 'annuel' ? 'INTERVAL 1 YEAR' : 'INTERVAL 1 MONTH';
        await db.query(
            `UPDATE utilisateurs SET abonnement_statut = 'actif',
                 abonnement_date_fin = DATE_ADD(GREATEST(COALESCE(abonnement_date_fin, NOW()), NOW()), ${duree})
             WHERE id = ?`,
            [paiement.utilisateur_id]
        );
    }
    try {
        await creerNotification(db, paiement.utilisateur_id, 'paiement_valide', '✅ Paiement validé',
            `Votre paiement de ${paiement.montant} DA a été validé.`, 'page-paiement', paiement.id);
    } catch (e) {}
    return true;
}

async function prevenirAdministrateurs(db, nomClient, montant, paiementId) {
    try {
        const [admins] = await db.query('SELECT id FROM utilisateurs WHERE est_admin = 1');
        for (const a of admins) {
            await creerNotification(db, a.id, 'paiement_a_verifier', '💳 Paiement à vérifier',
                `${nomClient} a envoyé un reçu de ${montant} DA.`, 'page-admin-paiements', paiementId);
        }
    } catch (e) {
        console.error('Erreur notification administrateurs:', e);
    }
}

// ============================================================
// GET /api/paiements/tarifs — prix, comptes de virement, carte disponible ou non
// ============================================================
router.get('/tarifs', authenticateToken, (req, res) => {
    res.json(tarifs());
});

// ============================================================
// GET /api/paiements/mon-compte — crédits, abonnement et historique des paiements
// ============================================================
router.get('/mon-compte', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(
            'SELECT profil, credits, abonnement_statut, abonnement_date_fin, est_admin FROM utilisateurs WHERE id = ?',
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        const [paiements] = await db.query(
            `SELECT id, objet, formule, quantite, montant, moyen, statut, reference, motif_refus, date_creation, date_traitement
             FROM paiements WHERE utilisateur_id = ? ORDER BY date_creation DESC LIMIT 50`,
            [req.user.id]
        );
        const u = rows[0];
        res.json({
            profil: u.profil,
            credits: u.credits || 0,
            abonnement_statut: u.abonnement_statut,
            abonnement_date_fin: u.abonnement_date_fin,
            abonnement_actif: u.profil === 'entrepreneur' ? await abonnementActif(db, req.user.id) : null,
            est_admin: Number(u.est_admin) === 1,
            paiements
        });
    } catch (error) {
        console.error('Erreur GET /paiements/mon-compte:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/paiements/demande — paiement par virement CCP / BaridiMob avec la photo du reçu
// ============================================================
router.post('/demande', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const { objet, formule, quantite, moyen, reference, recu } = req.body;
    try {
        const user = await utilisateurConnecte(db, req.user.id);
        if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        if (!MOYENS_MANUELS.includes(moyen)) return res.status(400).json({ message: 'Moyen de paiement invalide' });
        if (typeof recu !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(recu) || recu.length > RECU_TAILLE_MAX) {
            return res.status(400).json({ message: 'Photo du reçu manquante ou invalide' });
        }
        const achat = calculerAchat(user.profil, { objet, formule, quantite });
        if (achat.erreur) return res.status(400).json({ message: achat.erreur });

        const [result] = await db.query(
            `INSERT INTO paiements (utilisateur_id, objet, formule, quantite, montant, moyen, statut, recu, reference)
             VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
            [user.id, achat.objet, achat.formule, achat.quantite, achat.montant, moyen, recu,
             reference ? String(reference).trim().slice(0, 100) : null]
        );
        await prevenirAdministrateurs(db, user.nom_complet, achat.montant, result.insertId);
        res.status(201).json({ message: 'Reçu envoyé', id: result.insertId, montant: achat.montant });
    } catch (error) {
        console.error('Erreur POST /paiements/demande:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/paiements/carte — paiement par carte CIB / Edahabia (page de paiement Chargily)
// ============================================================
router.post('/carte', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const { objet, formule, quantite, carte, langue } = req.body;
    const cle = process.env.CHARGILY_SECRET_KEY;
    if (!cle || typeof fetch !== 'function') return res.status(400).json({ message: 'Le paiement par carte n\'est pas encore disponible' });
    try {
        const user = await utilisateurConnecte(db, req.user.id);
        if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        const achat = calculerAchat(user.profil, { objet, formule, quantite });
        if (achat.erreur) return res.status(400).json({ message: achat.erreur });

        const [result] = await db.query(
            `INSERT INTO paiements (utilisateur_id, objet, formule, quantite, montant, moyen, statut)
             VALUES (?, ?, ?, ?, ?, 'carte', 'en_attente')`,
            [user.id, achat.objet, achat.formule, achat.quantite, achat.montant]
        );
        const paiementId = result.insertId;

        const base = process.env.CHARGILY_MODE === 'live' ? 'https://pay.chargily.net/api/v2' : 'https://pay.chargily.net/test/api/v2';
        const retour = adresseRetour(req);
        const api = (process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
        const reponse = await fetch(`${base}/checkouts`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cle}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                amount: achat.montant,
                currency: 'dzd',
                payment_method: carte === 'cib' ? 'cib' : 'edahabia',
                success_url: `${retour}?paiement=ok`,
                failure_url: `${retour}?paiement=echec`,
                webhook_endpoint: `${api}/api/paiements/webhook/chargily`,
                locale: langue === 'ar' ? 'ar' : 'fr',
                description: achat.objet === 'credits' ? `BatiDZ — ${achat.quantite} crédit(s)` : `BatiDZ — abonnement ${achat.formule}`,
                metadata: { paiement_id: String(paiementId) }
            })
        });
        const checkout = await reponse.json().catch(() => ({}));
        if (!reponse.ok || !checkout.checkout_url) {
            console.error('Erreur Chargily:', reponse.status, checkout);
            await db.query(`UPDATE paiements SET statut = 'echec' WHERE id = ?`, [paiementId]);
            return res.status(502).json({ message: 'Le paiement par carte est momentanément indisponible' });
        }
        await db.query('UPDATE paiements SET reference = ? WHERE id = ?', [checkout.id, paiementId]);
        res.status(201).json({ checkout_url: checkout.checkout_url, id: paiementId });
    } catch (error) {
        console.error('Erreur POST /paiements/carte:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/paiements/webhook/chargily — Chargily confirme un paiement par carte
// (sans connexion : la signature HMAC-SHA256 du message, faite avec la clé secrète, est vérifiée)
// ============================================================
router.post('/webhook/chargily', async (req, res) => {
    const db = req.app.get('db');
    const cle = process.env.CHARGILY_SECRET_KEY;
    const signature = req.headers['signature'];
    if (!cle) return res.status(400).end();
    if (!signature) return res.status(400).end();

    // Le message tel qu'il a été reçu (server.js le garde dans req.rawBody)
    const brut = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
    const attendue = crypto.createHmac('sha256', cle).update(brut).digest('hex');
    const a = Buffer.from(String(signature)), b = Buffer.from(attendue);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).end();

    try {
        const evenement = req.body || {};
        const checkout = evenement.data || {};
        const [rows] = await db.query(`SELECT * FROM paiements WHERE reference = ? AND moyen = 'carte'`, [checkout.id]);
        if (rows.length === 0) return res.status(200).end();   // inconnu : rien à faire
        const paiement = rows[0];

        if (evenement.type === 'checkout.paid') {
            if (Number(checkout.amount) !== Number(paiement.montant)) {
                console.error('Montant Chargily différent du paiement', paiement.id, checkout.amount);
                return res.status(200).end();
            }
            await appliquerPaiement(db, paiement, 'paye');
        } else if (evenement.type === 'checkout.failed' || evenement.type === 'checkout.canceled' || evenement.type === 'checkout.expired') {
            await db.query(`UPDATE paiements SET statut = 'echec', date_traitement = NOW() WHERE id = ? AND statut = 'en_attente'`, [paiement.id]);
        }
        res.status(200).end();
    } catch (error) {
        console.error('Erreur webhook Chargily:', error);
        res.status(500).end();
    }
});

// ============================================================
// ADMINISTRATEUR : vérifier les reçus
// ============================================================
async function exigerAdmin(req, res, next) {
    try {
        const user = await utilisateurConnecte(req.app.get('db'), req.user.id);
        if (!user || Number(user.est_admin) !== 1) return res.status(403).json({ message: 'Réservé à l\'administrateur' });
        next();
    } catch (error) {
        console.error('Erreur contrôle administrateur:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
}

router.get('/admin/en-attente', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [paiements] = await db.query(
            `SELECT p.id, p.objet, p.formule, p.quantite, p.montant, p.moyen, p.reference, p.recu, p.date_creation,
                    u.nom_complet, u.profil, u.telephone, u.email
             FROM paiements p JOIN utilisateurs u ON u.id = p.utilisateur_id
             WHERE p.statut = 'en_attente' AND p.moyen IN ('ccp', 'baridimob')
             ORDER BY p.date_creation ASC`
        );
        res.json(paiements);
    } catch (error) {
        console.error('Erreur GET /paiements/admin/en-attente:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.put('/admin/:id/valider', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(`SELECT * FROM paiements WHERE id = ? AND moyen IN ('ccp', 'baridimob')`, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Paiement non trouvé' });
        const fait = await appliquerPaiement(db, rows[0], 'valide', req.user.id);
        if (!fait) return res.status(400).json({ message: 'Ce paiement a déjà été traité' });
        res.json({ message: 'Paiement validé' });
    } catch (error) {
        console.error('Erreur PUT /paiements/admin/:id/valider:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.put('/admin/:id/refuser', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const motif = String(req.body.motif || '').trim().slice(0, 255);
    if (!motif) return res.status(400).json({ message: 'Indiquez le motif du refus' });
    try {
        const [rows] = await db.query(`SELECT * FROM paiements WHERE id = ? AND moyen IN ('ccp', 'baridimob')`, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Paiement non trouvé' });
        const [maj] = await db.query(
            `UPDATE paiements SET statut = 'refuse', motif_refus = ?, date_traitement = NOW(), traite_par = ? WHERE id = ? AND statut = 'en_attente'`,
            [motif, req.user.id, req.params.id]
        );
        if (!maj.affectedRows) return res.status(400).json({ message: 'Ce paiement a déjà été traité' });
        try {
            await creerNotification(db, rows[0].utilisateur_id, 'paiement_refuse', '❌ Paiement refusé',
                `Votre paiement de ${rows[0].montant} DA a été refusé : ${motif}`, 'page-paiement', rows[0].id);
        } catch (e) {}
        res.json({ message: 'Paiement refusé' });
    } catch (error) {
        console.error('Erreur PUT /paiements/admin/:id/refuser:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
module.exports.calculerAchat = calculerAchat;
module.exports.tarifs = tarifs;
