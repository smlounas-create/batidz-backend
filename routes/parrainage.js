// ============================================================
// ⭐ PARRAINAGE ET « COMMENT AVEZ-VOUS CONNU BATIDZ ? »
//
//  - Chaque membre a un lien d'invitation : https://<site>/?invite=<son id>
//  - À l'inscription, on enregistre qui l'a invité (parrain_id) et d'où il vient (source_inscription).
//  - Quand l'invité publie sa PREMIÈRE annonce, le parrain est récompensé (une seule fois par invité) :
//      ouvrier / fournisseur  → PARRAINAGE_CREDITS crédits   (1 par défaut)
//      entrepreneur           → PARRAINAGE_JOURS jours d'abonnement (7 par défaut)
//    Au plus PARRAINAGE_MAX_PAR_MOIS récompenses par parrain et par mois (10 par défaut).
//    Mettre une de ces variables à 0 sur Render désactive la récompense correspondante.
//  - Tout est lu à part : tant que parrainage.sql n'a pas été lancé, l'inscription et les
//    annonces marchent normalement (le parrainage est simplement ignoré).
// ============================================================
const express = require('express');
const authenticateToken = require('../middleware/auth');
const { creerNotification } = require('./notifications');

const router = express.Router();

const SOURCES = ['facebook', 'tiktok', 'instagram', 'whatsapp', 'bouche_a_oreille', 'invitation',
                 'flyer', 'salon', 'radio_presse', 'recherche', 'autre'];
const PROFILS_INVITANTS = ['ouvrier', 'fournisseur_materiel', 'fournisseur_materiaux', 'entrepreneur'];

const nombre = (valeur, defaut) => {
    if (valeur === undefined || valeur === null || String(valeur).trim() === '') return defaut;
    const n = parseInt(valeur, 10);
    return Number.isFinite(n) && n >= 0 ? n : defaut;
};
function reglesParrainage() {
    return {
        credits: nombre(process.env.PARRAINAGE_CREDITS, 1),
        jours: nombre(process.env.PARRAINAGE_JOURS, 7),
        max_par_mois: nombre(process.env.PARRAINAGE_MAX_PAR_MOIS, 10)
    };
}
const colonneAbsente = (e) => e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE');

// ⭐ La date d'inscription n'a pas le même nom (ou n'existe pas) selon la façon dont la table
//    utilisateurs a été créée. On regarde une fois quelles colonnes existent, au lieu de supposer
//    « date_creation » : sinon la page de parrainage restait sur « bientôt disponible ».
const NOMS_DATE_INSCRIPTION = ['date_creation', 'date_inscription', 'created_at', 'createdAt', 'date_ajout'];
let colonneDateConnue;   // undefined = pas encore regardé ; null = aucune colonne de date
async function colonneDateInscription(db) {
    if (colonneDateConnue !== undefined) return colonneDateConnue;
    try {
        const [colonnes] = await db.query('SHOW COLUMNS FROM utilisateurs');
        const noms = (colonnes || []).map(c => c.Field);
        colonneDateConnue = NOMS_DATE_INSCRIPTION.find(n => noms.includes(n)) || null;
        return colonneDateConnue;
    } catch (e) {
        return null;   // on réessaiera à la prochaine demande
    }
}
// Message clair pour le journal Render et pour l'administrateur : quelle colonne manque
const detailColonne = (e) => String((e && e.sqlMessage) || (e && e.message) || '').slice(0, 200);

// À l'inscription : source et parrain (appelé par routes/auth.js, ne bloque jamais l'inscription)
async function enregistrerParrainage(db, nouveauId, { source, parrainId } = {}) {
    const sourcePropre = SOURCES.includes(source) ? source : null;
    let parrain = null;
    const idParrain = Number(parrainId);
    if (Number.isInteger(idParrain) && idParrain > 0 && idParrain !== Number(nouveauId)) {
        const [p] = await db.query('SELECT id, profil FROM utilisateurs WHERE id = ?', [idParrain]);
        if (p[0] && PROFILS_INVITANTS.includes(p[0].profil)) parrain = p[0].id;
    }
    if (!sourcePropre && !parrain) return;
    try {
        await db.query('UPDATE utilisateurs SET source_inscription = ?, parrain_id = ? WHERE id = ?',
            [sourcePropre || (parrain ? 'invitation' : null), parrain, nouveauId]);
    } catch (e) {
        if (!colonneAbsente(e)) throw e;
    }
}

// À la première annonce d'un invité : récompense du parrain (appelé par routes/annonces.js)
async function recompenserParrain(db, filleulId) {
    let filleul;
    try {
        const [f] = await db.query('SELECT id, nom_complet, parrain_id, parrainage_recompense_le FROM utilisateurs WHERE id = ?', [filleulId]);
        filleul = f[0];
    } catch (e) {
        if (colonneAbsente(e)) return null;
        throw e;
    }
    if (!filleul || !filleul.parrain_id || filleul.parrainage_recompense_le) return null;

    // On marque d'abord l'invité : une seule récompense, même si deux annonces partent en même temps
    const [marque] = await db.query('UPDATE utilisateurs SET parrainage_recompense_le = NOW() WHERE id = ? AND parrainage_recompense_le IS NULL', [filleul.id]);
    if (!marque.affectedRows) return null;

    const [p] = await db.query('SELECT id, profil FROM utilisateurs WHERE id = ?', [filleul.parrain_id]);
    const parrain = p[0];
    if (!parrain || !PROFILS_INVITANTS.includes(parrain.profil)) return null;

    const regles = reglesParrainage();
    const [compte] = await db.query(
        "SELECT COUNT(*) AS n FROM utilisateurs WHERE parrain_id = ? AND parrainage_recompense_le >= DATE_FORMAT(NOW(), '%Y-%m-01')",
        [parrain.id]);
    if (Number(compte[0].n) > regles.max_par_mois) return { parrain: parrain.id, recompense: null, raison: 'plafond' };

    let recompense = null;
    if (parrain.profil === 'entrepreneur') {
        if (regles.jours > 0) {
            await db.query(
                'UPDATE utilisateurs SET abonnement_date_fin = DATE_ADD(GREATEST(COALESCE(abonnement_date_fin, NOW()), NOW()), INTERVAL ? DAY) WHERE id = ?',
                [regles.jours, parrain.id]);
            recompense = { jours: regles.jours };
        }
    } else if (regles.credits > 0) {
        await db.query('UPDATE utilisateurs SET credits = credits + ? WHERE id = ?', [regles.credits, parrain.id]);
        recompense = { credits: regles.credits };
    }

    try {
        const gain = !recompense ? null
            : recompense.jours ? `${recompense.jours} jours d'abonnement vous sont offerts`
            : `${recompense.credits} crédit${recompense.credits > 1 ? 's' : ''} vous ${recompense.credits > 1 ? 'sont offerts' : 'est offert'}`;
        await creerNotification(db, parrain.id, 'parrainage', '🎁 Merci pour votre invitation',
            gain ? `${filleul.nom_complet} a publié sa première annonce : ${gain}.`
                 : `${filleul.nom_complet} a publié sa première annonce.`,
            'page-parrainage', null);
    } catch (e) { console.error('Erreur notification parrainage:', e); }

    console.log(`Parrainage : utilisateur ${parrain.id} récompensé pour l'invité ${filleul.id}`, recompense);
    return { parrain: parrain.id, recompense };
}

// GET /api/parrainage — mon lien et mes invités
router.get('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    const regles = reglesParrainage();
    try {
        const [moi] = await db.query('SELECT id, profil FROM utilisateurs WHERE id = ?', [req.user.id]);
        if (!moi[0]) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        let invites = [];
        const colonneDate = await colonneDateInscription(db);   // nom pris dans une liste fixe : pas d'injection
        try {
            [invites] = await db.query(
                `SELECT nom_complet, profil, ${colonneDate ? `\`${colonneDate}\`` : 'NULL'} AS date_inscription, parrainage_recompense_le
                 FROM utilisateurs WHERE parrain_id = ? ORDER BY ${colonneDate ? `\`${colonneDate}\`` : 'id'} DESC LIMIT 100`, [req.user.id]);
        } catch (e) {
            if (colonneAbsente(e)) {
                console.error('Parrainage indisponible :', detailColonne(e));
                return res.status(503).json({ message: 'Table parrainage absente', detail: detailColonne(e) });
            }
            throw e;
        }
        res.json({
            code: moi[0].id,
            peut_inviter: PROFILS_INVITANTS.includes(moi[0].profil),
            recompense: moi[0].profil === 'entrepreneur' ? { jours: regles.jours } : { credits: regles.credits },
            max_par_mois: regles.max_par_mois,
            invites: invites.map(i => ({
                prenom: String(i.nom_complet || '').trim().split(/\s+/)[0],   // le prénom seulement
                profil: i.profil,
                date_inscription: i.date_inscription || null,
                recompense: !!i.parrainage_recompense_le
            }))
        });
    } catch (error) {
        console.error('Erreur GET /parrainage:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

module.exports = router;
module.exports.SOURCES = SOURCES;
module.exports.enregistrerParrainage = enregistrerParrainage;
module.exports.recompenserParrain = recompenserParrain;
module.exports.reglesParrainage = reglesParrainage;
module.exports.colonneDateInscription = colonneDateInscription;
