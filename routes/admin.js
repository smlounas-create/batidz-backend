// ============================================================
// FICHIER: routes/admin.js
// ⭐ Tableau de bord de l'administrateur : ce qui attend une action (reçus, formations),
//    les chiffres clés et les réglages qui manquent encore (coordonnées, variables Render).
//    Un administrateur est un compte avec est_admin = 1 ; le profil « administrateur »
//    se donne uniquement dans phpMyAdmin (fichier admin.sql), jamais à l'inscription.
// ============================================================

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { tarifs, coordonneesSite } = require('./paiements');
const { creerNotification } = require('./notifications');
const { conditionTelephone } = require('./auth');
const { colonneDateInscription } = require('./parrainage');
const crypto = require('crypto');

async function exigerAdmin(req, res, next) {
    try {
        const [rows] = await req.app.get('db').query('SELECT est_admin FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!rows[0] || Number(rows[0].est_admin) !== 1) return res.status(403).json({ message: 'Réservé à l\'administrateur' });
        next();
    } catch (error) {
        console.error('Erreur contrôle administrateur:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
}

// Chaque chiffre est lu à part : une table pas encore créée ne fait pas tomber tout le tableau de bord
async function lire(db, sql, params = []) {
    try {
        const [rows] = await db.query(sql, params);
        return rows;
    } catch (e) {
        console.error('Tableau de bord :', e.message);
        return null;
    }
}
const nombre = (rows, champ = 'n') => (rows && rows[0] ? Number(rows[0][champ]) || 0 : null);

const VARIABLES_PRIX = ['PRIX_CREDIT_FOURNISSEUR', 'PRIX_CREDIT_OUVRIER', 'PRIX_ABONNEMENT_MENSUEL', 'PRIX_ABONNEMENT_ANNUEL',
    'PRIX_FORMATION_SEMAINE', 'PRIX_FORMATION_MOIS', 'REMISES_CREDITS_FOURNISSEUR'];

router.get('/tableau-de-bord', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const recus = await lire(db, "SELECT COUNT(*) AS n FROM paiements WHERE statut = 'en_attente' AND moyen IN ('ccp', 'baridimob', 'banque')");
        const formations = await lire(db, "SELECT COUNT(*) AS n FROM formations WHERE statut = 'a_valider'");
        const motsDePasse = await lire(db, "SELECT COUNT(*) AS n FROM demandes_mot_de_passe WHERE statut = 'en_attente'");
        const enLigne = await lire(db, "SELECT COUNT(*) AS n FROM formations WHERE statut = 'validee' AND date_fin_parution >= NOW()");
        const abonnes = await lire(db, "SELECT COUNT(*) AS n FROM utilisateurs WHERE profil = 'entrepreneur' AND abonnement_date_fin IS NOT NULL AND DATE(abonnement_date_fin) >= CURDATE()");
        const parProfil = await lire(db, 'SELECT profil, COUNT(*) AS n FROM utilisateurs GROUP BY profil');
        const mois = await lire(db, "SELECT COUNT(*) AS nombre, COALESCE(SUM(montant), 0) AS montant FROM paiements WHERE statut = 'valide' AND date_traitement >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
        // ⭐ D'où viennent les inscrits des 30 derniers jours, et qui invite le plus
        //    Sans colonne de date d'inscription dans la table, on compte tous les inscrits.
        const colonneDate = await colonneDateInscription(db);
        const sources = await lire(db, `SELECT COALESCE(source_inscription, 'non_renseigne') AS source, COUNT(*) AS n FROM utilisateurs
                                        ${colonneDate ? `WHERE \`${colonneDate}\` >= NOW() - INTERVAL 30 DAY` : ''}
                                        GROUP BY COALESCE(source_inscription, 'non_renseigne') ORDER BY n DESC`);
        const parrains = await lire(db, `SELECT p.id, p.nom_complet, p.profil, COUNT(f.id) AS invites, SUM(f.parrainage_recompense_le IS NOT NULL) AS actifs
                                          FROM utilisateurs f JOIN utilisateurs p ON p.id = f.parrain_id
                                          GROUP BY p.id, p.nom_complet, p.profil ORDER BY invites DESC LIMIT 5`);

        const inscrits = {};
        for (const r of parProfil || []) inscrits[r.profil] = Number(r.n) || 0;
        const t = tarifs(await coordonneesSite(db));

        res.json({
            a_traiter: { recus: nombre(recus), formations: nombre(formations), mots_de_passe: nombre(motsDePasse) },
            chiffres: {
                inscrits,
                abonnements_actifs: nombre(abonnes),
                formations_en_ligne: nombre(enLigne),
                paiements_mois: mois && mois[0] ? { nombre: Number(mois[0].nombre) || 0, montant: Number(mois[0].montant) || 0 } : null
            },
            reglages: {
                virement: !!(t.comptes.ccp || t.comptes.baridimob),
                banque: !!t.comptes.banque_rib,
                carte: !!t.carte,
                variables_manquantes: VARIABLES_PRIX.filter(v => !process.env[v])
            },
            acquisition: {
                sources: sources ? sources.map(r => ({ source: r.source, n: Number(r.n) || 0 })) : null,
                periode_jours: colonneDate ? 30 : null,
                parrains: parrains ? parrains.map(r => ({ id: r.id, nom_complet: r.nom_complet, profil: r.profil, invites: Number(r.invites) || 0, actifs: Number(r.actifs) || 0 })) : null
            }
        });
    } catch (error) {
        console.error('Erreur GET /admin/tableau-de-bord:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// ⭐ Équipe d'administration : nommer un administrateur ou lui retirer les droits,
//    depuis le tableau de bord (plus besoin de phpMyAdmin).
//    - On cherche le membre par son numéro de téléphone (il doit déjà être inscrit).
//    - Il garde son profil (entrepreneur, ouvrier…) : on ne change que est_admin.
//    - Le mot de passe de l'administrateur qui agit est exigé.
//    - On ne peut pas se retirer ses propres droits : il reste toujours au moins un administrateur.
//    - Tous les administrateurs, et la personne concernée, sont prévenus.
// ============================================================
router.get('/administrateurs', authenticateToken, exigerAdmin, async (req, res) => {
    try {
        const [rows] = await req.app.get('db').query(
            'SELECT id, nom_complet, telephone, profil FROM utilisateurs WHERE est_admin = 1 ORDER BY nom_complet');
        res.json(rows);
    } catch (error) {
        console.error('Erreur GET /admin/administrateurs:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.get('/membre', authenticateToken, exigerAdmin, async (req, res) => {
    const telephone = String(req.query.telephone || '').trim();
    if (telephone.replace(/\D/g, '').length < 9) return res.status(400).json({ message: 'Numéro de téléphone invalide' });
    try {
        const cond = conditionTelephone(telephone);
        const [rows] = await req.app.get('db').query(
            `SELECT id, nom_complet, telephone, profil, wilaya, est_admin FROM utilisateurs WHERE ${cond.sql} LIMIT 5`, cond.params);
        if (!rows.length) return res.status(404).json({ message: 'Aucun membre avec ce numéro' });
        res.json(rows.map(r => ({ ...r, est_admin: Number(r.est_admin) === 1 })));
    } catch (error) {
        console.error('Erreur GET /admin/membre:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.put('/administrateurs/:id', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const corps = req.body || {};
    const id = Number(req.params.id);
    const nommer = corps.admin === true;
    if (!Number.isInteger(id) || id <= 0 || typeof corps.admin !== 'boolean') return res.status(400).json({ message: 'Demande invalide' });
    try {
        const [moi] = await db.query('SELECT id, nom_complet, mot_de_passe FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!moi[0] || typeof corps.mot_de_passe !== 'string' || !(await bcrypt.compare(corps.mot_de_passe, moi[0].mot_de_passe))) {
            return res.status(401).json({ message: 'Mot de passe incorrect' });
        }
        if (!nommer && id === Number(moi[0].id)) return res.status(400).json({ message: 'Vous ne pouvez pas retirer vos propres droits' });

        const [cible] = await db.query('SELECT id, nom_complet, profil, est_admin FROM utilisateurs WHERE id = ?', [id]);
        const membre = cible[0];
        if (!membre) return res.status(404).json({ message: 'Membre introuvable' });
        if (nommer && membre.profil === 'organisme_formation') return res.status(400).json({ message: 'Un organisme de formation ne peut pas être administrateur' });
        if (!nommer && membre.profil === 'administrateur') return res.status(400).json({ message: 'Ce compte n\'a pas d\'autre profil : retirez ses droits dans phpMyAdmin' });
        if ((Number(membre.est_admin) === 1) === nommer) {
            return res.status(400).json({ message: nommer ? 'Ce membre est déjà administrateur' : 'Ce membre n\'est pas administrateur' });
        }

        await db.query('UPDATE utilisateurs SET est_admin = ? WHERE id = ?', [nommer ? 1 : 0, id]);
        console.log(`Administrateur ${nommer ? 'nommé' : 'retiré'} : utilisateur ${id}, par l'utilisateur ${moi[0].id}`);

        try {
            if (nommer) {
                await creerNotification(db, id, 'admin_nomme', '🛡️ Vous êtes administrateur',
                    `${moi[0].nom_complet} vous a nommé administrateur de BatiDZ.`, 'page-admin', null);
            } else {
                await creerNotification(db, id, 'admin_retire', '🛡️ Droits d\'administrateur retirés',
                    `${moi[0].nom_complet} vous a retiré les droits d'administrateur de BatiDZ.`, null, null);
            }
            const [admins] = await db.query('SELECT id FROM utilisateurs WHERE est_admin = 1');
            for (const a of admins) {
                if (Number(a.id) === id) continue;
                await creerNotification(db, a.id, 'equipe_admin',
                    nommer ? '🛡️ Nouvel administrateur' : '🛡️ Administrateur retiré',
                    nommer ? `${moi[0].nom_complet} a nommé ${membre.nom_complet} administrateur.`
                           : `${moi[0].nom_complet} a retiré les droits d'administrateur à ${membre.nom_complet}.`,
                    'page-admin', null);
            }
        } catch (e) { console.error('Erreur notification équipe administrateur:', e); }

        const [liste] = await db.query('SELECT id, nom_complet, telephone, profil FROM utilisateurs WHERE est_admin = 1 ORDER BY nom_complet');
        res.json({ message: nommer ? 'Administrateur nommé' : 'Droits retirés', administrateurs: liste });
    } catch (error) {
        console.error('Erreur PUT /admin/administrateurs/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// ⭐ Mots de passe oubliés : l'administrateur rappelle le membre au numéro inscrit,
//    puis crée un mot de passe provisoire (8 chiffres, valable 48 h) qu'il lui donne
//    par téléphone ou WhatsApp. Le membre devra choisir son propre mot de passe à la connexion.
// ============================================================
const DUREE_PROVISOIRE_MS = 48 * 60 * 60 * 1000;
const tableAbsente = (e) => e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR');

router.get('/mots-de-passe', authenticateToken, exigerAdmin, async (req, res) => {
    try {
        const [rows] = await req.app.get('db').query(
            `SELECT d.id, d.date_creation, u.id AS utilisateur_id, u.nom_complet, u.telephone, u.email, u.profil, u.wilaya
             FROM demandes_mot_de_passe d JOIN utilisateurs u ON u.id = d.utilisateur_id
             WHERE d.statut = 'en_attente' ORDER BY d.date_creation ASC`);
        res.json(rows);
    } catch (error) {
        if (tableAbsente(error)) return res.status(503).json({ message: 'Table demandes_mot_de_passe absente' });
        console.error('Erreur GET /admin/mots-de-passe:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.post('/mots-de-passe/:id/provisoire', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const id = Number(req.params.id);
    const corps = req.body || {};
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Demande invalide' });
    try {
        const [moi] = await db.query('SELECT id, nom_complet, mot_de_passe FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!moi[0] || typeof corps.mot_de_passe !== 'string' || !(await bcrypt.compare(corps.mot_de_passe, moi[0].mot_de_passe))) {
            return res.status(401).json({ message: 'Mot de passe incorrect' });
        }
        const [demandes] = await db.query(
            `SELECT d.id, d.statut, d.utilisateur_id, u.nom_complet, u.telephone, u.est_admin
             FROM demandes_mot_de_passe d JOIN utilisateurs u ON u.id = d.utilisateur_id WHERE d.id = ?`, [id]);
        const d = demandes[0];
        if (!d) return res.status(404).json({ message: 'Demande introuvable' });
        if (d.statut !== 'en_attente') return res.status(400).json({ message: 'Demande déjà traitée' });

        const provisoire = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
        const hash = await bcrypt.hash(provisoire, await bcrypt.genSalt(10));
        const expire = new Date(Date.now() + DUREE_PROVISOIRE_MS);
        await db.query('UPDATE utilisateurs SET mot_de_passe = ?, mdp_provisoire_expire = ? WHERE id = ?', [hash, expire, d.utilisateur_id]);
        await db.query(
            "UPDATE demandes_mot_de_passe SET statut = 'traitee', traitee_par = ?, date_traitement = NOW() WHERE utilisateur_id = ? AND statut = 'en_attente'",
            [moi[0].id, d.utilisateur_id]);
        console.log(`Mot de passe provisoire créé pour l'utilisateur ${d.utilisateur_id} par l'administrateur ${moi[0].id}`);

        // Le compte d'un administrateur est sensible : les autres administrateurs sont prévenus
        if (Number(d.est_admin) === 1) {
            try {
                const [admins] = await db.query('SELECT id FROM utilisateurs WHERE est_admin = 1');
                for (const a of admins) {
                    if (Number(a.id) === Number(moi[0].id) || Number(a.id) === Number(d.utilisateur_id)) continue;
                    await creerNotification(db, a.id, 'equipe_admin', '🔑 Mot de passe d\'administrateur',
                        `${moi[0].nom_complet} a créé un mot de passe provisoire pour ${d.nom_complet}.`, 'page-admin', null);
                }
            } catch (e) { console.error('Erreur notification mot de passe administrateur:', e); }
        }
        res.json({ mot_de_passe_provisoire: provisoire, expire, nom_complet: d.nom_complet, telephone: d.telephone });
    } catch (error) {
        if (tableAbsente(error)) return res.status(503).json({ message: 'Table demandes_mot_de_passe absente' });
        console.error('Erreur POST /admin/mots-de-passe/:id/provisoire:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.post('/mots-de-passe/:id/annuler', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Demande invalide' });
    try {
        const [r] = await db.query(
            "UPDATE demandes_mot_de_passe SET statut = 'annulee', traitee_par = ?, date_traitement = NOW() WHERE id = ? AND statut = 'en_attente'",
            [req.user.id, id]);
        if (!r.affectedRows) return res.status(404).json({ message: 'Demande introuvable' });
        res.json({ message: 'Demande annulée' });
    } catch (error) {
        if (tableAbsente(error)) return res.status(503).json({ message: 'Table demandes_mot_de_passe absente' });
        console.error('Erreur POST /admin/mots-de-passe/:id/annuler:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
