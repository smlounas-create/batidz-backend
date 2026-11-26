// ============================================================
// FICHIER: routes/paiements.js
// ⭐ Achat de crédits (ouvriers, fournisseurs) et d'abonnement (entrepreneurs)
//    - par reçu de virement CCP / BaridiMob : un administrateur vérifie puis valide ;
//    - par carte CIB / Edahabia en ligne (Chargily Pay) : validé automatiquement par le webhook.
//
// Réglages sur Render (rubrique Environment) — rien n'est écrit dans le code :
//    PRIX_CREDIT_OUVRIER (300 par défaut), PRIX_CREDIT_FOURNISSEUR (1200 par défaut) — prix TVA comprise, onglet « Prix ronds »,
//    PRIX_ABONNEMENT_MENSUEL (3500 par défaut), PRIX_ABONNEMENT_ANNUEL (10 mois du mensuel par défaut),
//    PAIEMENT_TITULAIRE, PAIEMENT_CCP, PAIEMENT_BARIDIMOB (affichés aux clients qui paient par virement CCP / BaridiMob),
//    PAIEMENT_BANQUE_NOM, PAIEMENT_BANQUE_RIB, PAIEMENT_BANQUE_TITULAIRE (virement bancaire compte à compte ;
//    sans PAIEMENT_BANQUE_TITULAIRE, c'est PAIEMENT_TITULAIRE qui est affiché),
//    CHARGILY_SECRET_KEY (sans elle, la carte n'est pas proposée), CHARGILY_MODE (« test » ou « live »),
//    PRIX_FORMATION_SEMAINE (3000 par défaut), PRIX_FORMATION_MOIS (9000 par défaut) : parution d'une annonce de formation.
//    REMISES_CREDITS_FOURNISSEUR (« 5:10,10:20 » par défaut) : à partir de 5 annonces −10 %, à partir de 10 annonces −20 %.
//    ⭐ Chaque prix a une valeur par défaut : une variable créée sur Render la remplace, à tout moment.
//    ⭐ Les coordonnées de paiement (titulaire, CCP, RIP, banque, RIB) se saisissent AUSSI dans l'espace
//       administrateur du site (table « parametres ») : la valeur du site passe avant celle de Render.
// ============================================================

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { abonnementActif } = require('../middleware/abonnement');
const { creerNotification } = require('./notifications');
const { ajouterParution, publierSiPrete, PARUTION_MAX } = require('./formations');

const MOYENS_MANUELS = ['ccp', 'baridimob', 'banque'];
const CREDITS_MAX_PAR_ACHAT = 50;
const RECU_TAILLE_MAX = 3 * 1024 * 1024;   // photo du reçu (déjà réduite à ~200 Ko par le site)

// ⭐ Réduction pour plusieurs annonces (fournisseurs) : « quantité:pourcentage », séparés par des virgules.
//    Exemple sur Render : REMISES_CREDITS_FOURNISSEUR = 5:10,10:20. « 0 » ou vide = aucune réduction.
function remisesFournisseur() {
    const brut = process.env.REMISES_CREDITS_FOURNISSEUR === undefined ? '5:10,10:20' : process.env.REMISES_CREDITS_FOURNISSEUR;
    return String(brut).split(',').map(x => x.split(':').map(n => parseInt(n, 10)))
        .filter(([q, p]) => Number.isInteger(q) && q >= 2 && q <= 50 && Number.isInteger(p) && p > 0 && p < 100)
        .map(([quantite, pourcentage]) => ({ quantite, pourcentage }))
        .sort((a, b) => a.quantite - b.quantite);
}

function entier(v) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// ⭐ Coordonnées de paiement : champ du site → variable Render qu'il remplace
const COORDONNEES = {
    titulaire: 'PAIEMENT_TITULAIRE',
    ccp: 'PAIEMENT_CCP',
    baridimob: 'PAIEMENT_BARIDIMOB',
    banque_titulaire: 'PAIEMENT_BANQUE_TITULAIRE',
    banque_nom: 'PAIEMENT_BANQUE_NOM',
    banque_rib: 'PAIEMENT_BANQUE_RIB'
};

// Valeurs saisies dans l'espace administrateur. Si la table n'existe pas encore (parametres.sql
// pas lancé), on continue avec Render seul : la page de paiement ne doit jamais tomber en panne.
async function coordonneesSite(db) {
    try {
        const [rows] = await db.query('SELECT cle, valeur FROM parametres WHERE cle IN (?)', [Object.values(COORDONNEES)]);
        const site = {};
        for (const r of rows) if (r.valeur !== null && String(r.valeur).trim() !== '') site[r.cle] = String(r.valeur).trim();
        return site;
    } catch (e) {
        if (!e || e.code !== 'ER_NO_SUCH_TABLE') console.error('Lecture des coordonnées de paiement:', e && e.message);
        return {};
    }
}

function tarifs(site = {}) {
    const val = (cle) => site[cle] || process.env[cle] || null;
    return {
        remises: { fournisseur: remisesFournisseur() },
        credit: {
            ouvrier: entier(process.env.PRIX_CREDIT_OUVRIER) || 300,
            fournisseur_materiel: entier(process.env.PRIX_CREDIT_FOURNISSEUR) || 1200,
            fournisseur_materiaux: entier(process.env.PRIX_CREDIT_FOURNISSEUR) || 1200
        },
        abonnement: {
            mensuel: entier(process.env.PRIX_ABONNEMENT_MENSUEL) || 3500,
            // annuel : 10 mois payés pour 12, calculé sur le mensuel s'il n'est pas fixé sur Render
            annuel: entier(process.env.PRIX_ABONNEMENT_ANNUEL) || (entier(process.env.PRIX_ABONNEMENT_MENSUEL) || 3500) * 10
        },
        formation: {
            semaine: entier(process.env.PRIX_FORMATION_SEMAINE) || 3000,
            mois: entier(process.env.PRIX_FORMATION_MOIS) || 9000
        },
        comptes: {
            titulaire: val('PAIEMENT_TITULAIRE'),
            ccp: val('PAIEMENT_CCP'),
            baridimob: val('PAIEMENT_BARIDIMOB'),
            banque_titulaire: val('PAIEMENT_BANQUE_TITULAIRE') || val('PAIEMENT_TITULAIRE'),
            banque_nom: val('PAIEMENT_BANQUE_NOM'),
            banque_rib: val('PAIEMENT_BANQUE_RIB')
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
        const prixPlein = q * t.credit[profil];
        // Réduction des fournisseurs : le palier le plus élevé atteint par la quantité
        const palier = profil.startsWith('fournisseur_') ? t.remises.fournisseur.filter(r => q >= r.quantite).pop() : null;
        const remise = palier ? palier.pourcentage : 0;
        return { objet, formule: null, quantite: q, montant: Math.round(prixPlein * (100 - remise) / 100), prix_plein: prixPlein, remise };
    }
    if (objet === 'abonnement') {
        if (profil !== 'entrepreneur') return { erreur: 'L\'abonnement est réservé aux entrepreneurs' };
        if (!['mensuel', 'annuel'].includes(formule)) return { erreur: 'Formule d\'abonnement invalide' };
        const prix = t.abonnement[formule];
        if (!prix) return { erreur: 'Le prix de l\'abonnement n\'est pas encore fixé' };
        return { objet, formule, quantite: 1, montant: prix };
    }
    if (objet === 'formation') {
        if (profil !== 'organisme_formation') return { erreur: 'La parution est réservée aux organismes de formation' };
        if (!['semaine', 'mois'].includes(formule)) return { erreur: 'Durée de parution invalide' };
        const q = Number(quantite);
        if (!Number.isInteger(q) || q < 1 || q > PARUTION_MAX) return { erreur: 'Durée de parution invalide' };
        const prix = t.formation[formule];
        if (!prix) return { erreur: 'Le prix de la parution n\'est pas encore fixé' };
        return { objet, formule, quantite: q, montant: q * prix };
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

// Parution : la formation doit appartenir à l'organisme et ne pas être refusée
async function formationAPayer(db, userId, formationId) {
    const [rows] = await db.query('SELECT id, utilisateur_id, statut, titre FROM formations WHERE id = ?', [formationId]);
    const f = rows[0];
    if (!f || Number(f.utilisateur_id) !== Number(userId)) return { erreur: 'Formation non trouvée' };
    if (f.statut === 'refusee') return { erreur: 'Cette formation a été refusée : modifiez-la avant de payer sa parution' };
    return { formation: f };
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
    } else if (paiement.objet === 'formation' && paiement.formation_id) {
        await ajouterParution(db, paiement.formation_id, paiement.formule, paiement.quantite);
        // ⭐ Reçu validé par l'administrateur : il a vu l'annonce, elle est validée en même temps
        if (adminId) await db.query(`UPDATE formations SET statut = 'validee', motif_refus = NULL WHERE id = ? AND statut = 'a_valider'`, [paiement.formation_id]);
    }
    try {
        await creerNotification(db, paiement.utilisateur_id, 'paiement_valide', '✅ Paiement validé',
            `Votre paiement de ${paiement.montant} DA a été validé.`, 'page-paiement', paiement.id);
    } catch (e) {}
    if (paiement.objet === 'formation' && paiement.formation_id) {
        try { await publierSiPrete(db, paiement.formation_id); } catch (e) { console.error('Erreur publication formation:', e); }
    }
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
router.get('/tarifs', authenticateToken, async (req, res) => {
    res.json(tarifs(await coordonneesSite(req.app.get('db'))));
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
            `SELECT p.id, p.objet, p.formule, p.quantite, p.montant, p.moyen, p.statut, p.reference, p.motif_refus, p.date_creation, p.date_traitement,
                    p.formation_id, f.titre AS formation_titre
             FROM paiements p LEFT JOIN formations f ON f.id = p.formation_id
             WHERE p.utilisateur_id = ? ORDER BY p.date_creation DESC LIMIT 50`,
            [req.user.id]
        );
        const u = rows[0];
        let formations;
        if (u.profil === 'organisme_formation') {
            [formations] = await db.query(
                'SELECT id, titre, statut, date_fin_parution FROM formations WHERE utilisateur_id = ? ORDER BY date_creation DESC',
                [req.user.id]
            );
        }
        res.json({
            profil: u.profil,
            credits: u.credits || 0,
            abonnement_statut: u.abonnement_statut,
            abonnement_date_fin: u.abonnement_date_fin,
            abonnement_actif: u.profil === 'entrepreneur' ? await abonnementActif(db, req.user.id) : null,
            est_admin: Number(u.est_admin) === 1,
            paiements,
            ...(formations ? { formations } : {})
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
    const { objet, formule, quantite, moyen, reference, recu, formation_id } = req.body;
    try {
        const user = await utilisateurConnecte(db, req.user.id);
        if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        if (!MOYENS_MANUELS.includes(moyen)) return res.status(400).json({ message: 'Moyen de paiement invalide' });
        if (typeof recu !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(recu) || recu.length > RECU_TAILLE_MAX) {
            return res.status(400).json({ message: 'Photo du reçu manquante ou invalide' });
        }
        const achat = calculerAchat(user.profil, { objet, formule, quantite });
        if (achat.erreur) return res.status(400).json({ message: achat.erreur });
        let formationId = null;
        if (achat.objet === 'formation') {
            const verif = await formationAPayer(db, user.id, formation_id);
            if (verif.erreur) return res.status(400).json({ message: verif.erreur });
            formationId = verif.formation.id;
        }

        const [result] = await db.query(
            `INSERT INTO paiements (utilisateur_id, objet, formule, quantite, montant, moyen, statut, recu, reference, formation_id)
             VALUES (?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
            [user.id, achat.objet, achat.formule, achat.quantite, achat.montant, moyen, recu,
             reference ? String(reference).trim().slice(0, 100) : null, formationId]
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
    const { objet, formule, quantite, carte, langue, formation_id } = req.body;
    const cle = process.env.CHARGILY_SECRET_KEY;
    if (!cle || typeof fetch !== 'function') return res.status(400).json({ message: 'Le paiement par carte n\'est pas encore disponible' });
    try {
        const user = await utilisateurConnecte(db, req.user.id);
        if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        const achat = calculerAchat(user.profil, { objet, formule, quantite });
        if (achat.erreur) return res.status(400).json({ message: achat.erreur });
        let formationId = null, formationTitre = '';
        if (achat.objet === 'formation') {
            const verif = await formationAPayer(db, user.id, formation_id);
            if (verif.erreur) return res.status(400).json({ message: verif.erreur });
            formationId = verif.formation.id;
            formationTitre = verif.formation.titre;
        }

        const [result] = await db.query(
            `INSERT INTO paiements (utilisateur_id, objet, formule, quantite, montant, moyen, statut, formation_id)
             VALUES (?, ?, ?, ?, ?, 'carte', 'en_attente', ?)`,
            [user.id, achat.objet, achat.formule, achat.quantite, achat.montant, formationId]
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
                description: achat.objet === 'credits' ? `BatiDZ — ${achat.quantite} crédit(s)`
                    : achat.objet === 'formation' ? `BatiDZ — parution « ${String(formationTitre).slice(0, 80)} » : ${achat.quantite} ${achat.formule === 'mois' ? 'mois' : 'semaine(s)'}`
                    : `BatiDZ — abonnement ${achat.formule}`,
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

// ============================================================
// ADMINISTRATEUR : coordonnées de paiement affichées aux clients
// ============================================================
const chiffres = (v) => String(v).replace(/\D/g, '');

// Contrôle d'un champ ; renvoie un message d'erreur, ou null si la valeur est acceptable
function erreurCoordonnee(champ, valeur) {
    if (valeur.length > 100) return 'Valeur trop longue';
    if (champ === 'ccp') {
        if (!/^[0-9A-Za-zéÉ .:\-\/]+$/.test(valeur) || chiffres(valeur).length < 6 || chiffres(valeur).length > 14) {
            return 'Numéro CCP invalide : le numéro du compte et sa clé, en chiffres';
        }
    }
    if (champ === 'baridimob' && (!/^[0-9 .\-]+$/.test(valeur) || chiffres(valeur).length !== 20)) return 'Le RIP doit contenir 20 chiffres';
    if (champ === 'banque_rib' && (!/^[0-9 .\-]+$/.test(valeur) || chiffres(valeur).length !== 20)) return 'Le RIB doit contenir 20 chiffres';
    return null;
}

router.get('/admin/coordonnees', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const site = await coordonneesSite(db);
    const reponse = { site: {}, render: {}, table_prete: true, derniere_modification: null };
    for (const [champ, cle] of Object.entries(COORDONNEES)) {
        reponse.site[champ] = site[cle] || '';
        reponse.render[champ] = process.env[cle] || '';
    }
    try {
        const [rows] = await db.query(
            `SELECT p.date_modification, u.nom_complet FROM parametres p LEFT JOIN utilisateurs u ON u.id = p.modifie_par
             WHERE p.cle IN (?) ORDER BY p.date_modification DESC LIMIT 1`, [Object.values(COORDONNEES)]);
        if (rows[0]) reponse.derniere_modification = { date: rows[0].date_modification, par: rows[0].nom_complet || null };
    } catch (e) {
        if (e && e.code === 'ER_NO_SUCH_TABLE') reponse.table_prete = false;
        else console.error('Erreur GET /paiements/admin/coordonnees:', e);
    }
    res.json(reponse);
});

// Modifier les coordonnées : mot de passe de l'administrateur exigé, car elles disent où va l'argent des clients.
// Un champ vide efface la valeur du site : c'est alors la variable Render qui s'applique.
router.put('/admin/coordonnees', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const corps = req.body || {};
    try {
        const [moi] = await db.query('SELECT id, nom_complet, mot_de_passe FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!moi[0] || typeof corps.mot_de_passe !== 'string' || !(await bcrypt.compare(corps.mot_de_passe, moi[0].mot_de_passe))) {
            return res.status(401).json({ message: 'Mot de passe incorrect' });
        }
        const aEcrire = [], aEffacer = [];
        for (const [champ, cle] of Object.entries(COORDONNEES)) {
            if (corps[champ] === undefined) continue;
            const valeur = corps[champ] === null ? '' : String(corps[champ]).trim().replace(/\s+/g, ' ');
            if (valeur === '') { aEffacer.push(cle); continue; }
            const erreur = erreurCoordonnee(champ, valeur);
            if (erreur) return res.status(400).json({ message: erreur, champ });
            aEcrire.push([cle, valeur, moi[0].id]);
        }
        if (!aEcrire.length && !aEffacer.length) return res.status(400).json({ message: 'Aucun champ à mettre à jour' });

        if (aEcrire.length) {
            await db.query(
                `INSERT INTO parametres (cle, valeur, modifie_par) VALUES ?
                 ON DUPLICATE KEY UPDATE valeur = VALUES(valeur), modifie_par = VALUES(modifie_par)`, [aEcrire]);
        }
        if (aEffacer.length) await db.query('DELETE FROM parametres WHERE cle IN (?)', [aEffacer]);

        // Tous les administrateurs sont prévenus : un changement de compte ne doit jamais passer inaperçu
        try {
            const [admins] = await db.query('SELECT id FROM utilisateurs WHERE est_admin = 1');
            for (const a of admins) {
                await creerNotification(db, a.id, 'coordonnees_paiement', '🏦 Coordonnées de paiement modifiées',
                    `${moi[0].nom_complet} a modifié les coordonnées de paiement affichées aux clients.`, 'page-admin-coordonnees', null);
            }
        } catch (e) { console.error('Erreur notification coordonnées:', e); }
        console.log(`Coordonnées de paiement modifiées par l'utilisateur ${moi[0].id} : ${[...aEcrire.map(x => x[0]), ...aEffacer.map(c => c + ' (effacée)')].join(', ')}`);

        res.json({ message: 'Coordonnées enregistrées', comptes: tarifs(await coordonneesSite(db)).comptes });
    } catch (error) {
        if (error && error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ message: 'Table parametres absente' });
        console.error('Erreur PUT /paiements/admin/coordonnees:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.get('/admin/en-attente', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [paiements] = await db.query(
            `SELECT p.id, p.objet, p.formule, p.quantite, p.montant, p.moyen, p.reference, p.recu, p.date_creation,
                    u.nom_complet, u.profil, u.telephone, u.email, p.formation_id, f.titre AS formation_titre
             FROM paiements p JOIN utilisateurs u ON u.id = p.utilisateur_id LEFT JOIN formations f ON f.id = p.formation_id
             WHERE p.statut = 'en_attente' AND p.moyen IN ('ccp', 'baridimob', 'banque')
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
        const [rows] = await db.query(`SELECT * FROM paiements WHERE id = ? AND moyen IN ('ccp', 'baridimob', 'banque')`, [req.params.id]);
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
        const [rows] = await db.query(`SELECT * FROM paiements WHERE id = ? AND moyen IN ('ccp', 'baridimob', 'banque')`, [req.params.id]);
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
module.exports.coordonneesSite = coordonneesSite;
