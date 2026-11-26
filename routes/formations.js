// ============================================================
// FICHIER: routes/formations.js
// ⭐ Annonces de formation (bâtiment, travaux publics, hydraulique, sécurité, logiciels…)
//    - publiées par les organismes de formation (profil « organisme_formation ») ou saisies par l'administrateur ;
//    - vérifiées par l'administrateur, puis visibles pendant la durée de parution payée ;
//    - montrées sur la page « Formations », dans des encarts des espaces, et annoncées par notification
//      aux utilisateurs visés (au plus une notification de formation par personne tous les FORMATION_NOTIF_JOURS jours) ;
//    - coordonnées de l'organisme affichées, et bouton « Je suis intéressé » (nom et téléphone transmis avec accord).
//
// Réglages sur Render : PRIX_FORMATION_SEMAINE, PRIX_FORMATION_MOIS (voir routes/paiements.js),
//    FORMATION_NOTIF_JOURS (7 par défaut).
// ============================================================

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { cleJWT } = require('../middleware/auth');
const { creerNotification } = require('./notifications');

const DOMAINES = ['batiment', 'travaux_publics', 'hydraulique', 'securite', 'logiciels', 'gestion', 'engins', 'autre'];
const PUBLICS = ['tous', 'entrepreneur', 'ouvrier', 'fournisseur'];
const MODES = ['presentiel', 'en_ligne'];
const PROFILS_PAR_PUBLIC = {
    tous: ['entrepreneur', 'ouvrier', 'fournisseur_materiel', 'fournisseur_materiaux'],
    entrepreneur: ['entrepreneur'],
    ouvrier: ['ouvrier'],
    fournisseur: ['fournisseur_materiel', 'fournisseur_materiaux']
};
const AFFICHE_TAILLE_MAX = 900 * 1024;     // l'affiche est réduite par le site avant l'envoi
const PARUTION_MAX = 12;                    // semaines ou mois ajoutés en une fois

// Champs montrés à tout le monde (l'affiche est servie à part, par /:id/affiche)
const CHAMPS_PUBLICS = `id, titre, domaine, public_vise, mode, wilaya, lieu, date_debut, duree, prix, description,
    organisme_nom, telephone, email, site_web, agrement, (affiche IS NOT NULL) AS a_affiche, date_fin_parution, date_creation`;

// ------------------------------------------------------------
// Outils
// ------------------------------------------------------------
function texte(v, max) {
    if (v === undefined || v === null) return '';
    return String(v).trim().slice(0, max);
}

// Connexion facultative : la liste des formations est publique, mais on reconnaît la personne connectée
function utilisateurFacultatif(req) {
    const entete = req.headers['authorization'] || '';
    const jeton = entete.split(' ')[1];
    if (!jeton) return null;
    try {
        return jwt.verify(jeton, cleJWT()) || null;
    } catch (e) {
        return null;
    }
}

async function lireUtilisateur(db, id) {
    const [rows] = await db.query('SELECT id, nom_complet, telephone, email, profil, wilaya, est_admin FROM utilisateurs WHERE id = ?', [id]);
    return rows[0] || null;
}

const estAdmin = (u) => !!u && Number(u.est_admin) === 1;

async function lireFormationParId(db, id) {
    const [rows] = await db.query('SELECT * FROM formations WHERE id = ?', [id]);
    return rows[0] || null;
}

function estVisible(f) {
    return !!f && f.statut === 'validee' && f.date_fin_parution && new Date(f.date_fin_parution).getTime() >= Date.now();
}

function dateFr(d) {
    const x = new Date(d);
    if (isNaN(x)) return '';
    return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

// Contrôle et nettoyage des champs envoyés par le site. affiche : undefined = inchangée, '' = retirée.
function lireChampsFormation(body, { creation }) {
    const f = {
        titre: texte(body.titre, 150),
        domaine: texte(body.domaine, 30),
        public_vise: texte(body.public_vise, 20) || 'tous',
        mode: texte(body.mode, 20) || 'presentiel',
        wilaya: texte(body.wilaya, 10) || null,
        lieu: texte(body.lieu, 150) || null,
        date_debut: texte(body.date_debut, 10) || null,
        duree: texte(body.duree, 60) || null,
        prix: null,
        description: texte(body.description, 3000),
        organisme_nom: texte(body.organisme_nom, 150),
        telephone: texte(body.telephone, 30) || null,
        email: texte(body.email, 150) || null,
        site_web: texte(body.site_web, 200) || null,
        agrement: texte(body.agrement, 60) || null
    };
    if (f.titre.length < 3) return { erreur: 'Titre de la formation requis' };
    if (!DOMAINES.includes(f.domaine)) return { erreur: 'Domaine de formation invalide' };
    if (!PUBLICS.includes(f.public_vise)) return { erreur: 'Public visé invalide' };
    if (!MODES.includes(f.mode)) return { erreur: 'Mode de formation invalide' };
    if (f.mode === 'en_ligne') f.wilaya = null;
    else if (!f.wilaya) return { erreur: 'Wilaya de la formation requise' };
    if (f.date_debut && (!/^\d{4}-\d{2}-\d{2}$/.test(f.date_debut) || isNaN(new Date(f.date_debut)))) return { erreur: 'Date de début invalide' };
    if (body.prix !== undefined && body.prix !== null && String(body.prix).trim() !== '') {
        const p = Number(String(body.prix).replace(/\s/g, ''));
        if (!Number.isInteger(p) || p < 0 || p > 100000000) return { erreur: 'Prix invalide' };
        f.prix = p;
    }
    if (f.description.length < 10) return { erreur: 'Description de la formation requise' };
    if (f.organisme_nom.length < 2) return { erreur: 'Nom de l\'organisme requis' };
    if (!f.telephone && !f.email) return { erreur: 'Indiquez un téléphone ou un email de contact' };
    if (f.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(f.email)) return { erreur: 'Email invalide' };
    if (f.site_web && !/^https?:\/\/[^\s<>"']+$/i.test(f.site_web)) return { erreur: 'Adresse du site invalide (elle doit commencer par https://)' };

    if (body.affiche === '' || body.affiche === null) f.affiche = null;
    else if (body.affiche !== undefined) {
        if (typeof body.affiche !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(body.affiche) || body.affiche.length > AFFICHE_TAILLE_MAX) {
            return { erreur: 'Affiche invalide (image JPG, PNG ou WEBP)' };
        }
        f.affiche = body.affiche;
    } else if (creation) f.affiche = null;
    return { champs: f };
}

// Ajoute une durée de parution (prolongée à partir de la fin actuelle si elle est encore à venir)
async function ajouterParution(db, formationId, formule, quantite) {
    const unite = formule === 'mois' ? 'MONTH' : 'WEEK';
    await db.query(
        `UPDATE formations SET date_fin_parution = DATE_ADD(GREATEST(COALESCE(date_fin_parution, NOW()), NOW()), INTERVAL ? ${unite}) WHERE id = ?`,
        [quantite, formationId]
    );
}

async function prevenirAdministrateurs(db, type, titre, message, lienId) {
    try {
        const [admins] = await db.query('SELECT id FROM utilisateurs WHERE est_admin = 1');
        for (const a of admins) await creerNotification(db, a.id, type, titre, message, 'page-admin-formations', lienId);
    } catch (e) {
        console.error('Erreur notification administrateurs (formations):', e);
    }
}

// ⭐ Quand une formation devient visible pour la 1re fois : l'organisme est prévenu, puis les personnes visées
//    (profil et wilaya), sauf celles qui ont déjà reçu une notification de formation ces derniers jours.
async function publierSiPrete(db, formationId) {
    const [maj] = await db.query(
        `UPDATE formations SET notifie = 1 WHERE id = ? AND notifie = 0 AND statut = 'validee' AND date_fin_parution >= NOW()`,
        [formationId]
    );
    if (!maj.affectedRows) return false;
    const f = await lireFormationParId(db, formationId);
    if (!f) return false;
    if (f.utilisateur_id) {
        try {
            await creerNotification(db, f.utilisateur_id, 'formation_publiee', '🟢 Formation publiée',
                `Votre formation « ${f.titre} » est en ligne jusqu'au ${dateFr(f.date_fin_parution)}.`, 'page-organisme', f.id);
        } catch (e) {}
    }
    try {
        const jours = parseInt(process.env.FORMATION_NOTIF_JOURS, 10) || 7;
        const wilaya = f.mode === 'presentiel' ? f.wilaya : null;
        const [cibles] = await db.query(
            `SELECT u.id FROM utilisateurs u
             WHERE u.profil IN (?) AND u.id <> ? AND (? IS NULL OR u.wilaya = ?)
               AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.utilisateur_id = u.id AND n.type = 'formation_nouvelle'
                               AND n.date_creation > NOW() - INTERVAL ? DAY)
             LIMIT 5000`,
            [PROFILS_PAR_PUBLIC[f.public_vise] || PROFILS_PAR_PUBLIC.tous, f.utilisateur_id || 0, wilaya, wilaya, jours]
        );
        const message = `${f.organisme_nom} propose la formation « ${f.titre} ».`;
        for (let i = 0; i < cibles.length; i += 500) {
            const lignes = cibles.slice(i, i + 500).map(c => [c.id, 'formation_nouvelle', '🎓 Nouvelle formation', message, 'page-formations', f.id]);
            await db.query('INSERT INTO notifications (utilisateur_id, type, titre, message, lien_page, lien_id) VALUES ?', [lignes]);
        }
    } catch (e) {
        console.error('Erreur notifications nouvelle formation:', e);
    }
    return true;
}

// ============================================================
// GET /api/formations — formations en ligne (publique). Filtres : domaine, public, wilaya
// ============================================================
router.get('/', async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(
            `SELECT ${CHAMPS_PUBLICS} FROM formations WHERE statut = 'validee' AND date_fin_parution >= NOW() ORDER BY date_creation DESC LIMIT 300`
        );
        const { domaine, public: publicVise, wilaya } = req.query || {};
        let liste = rows.map(r => ({ ...r, a_affiche: Number(r.a_affiche) === 1 }));
        if (domaine) liste = liste.filter(f => f.domaine === domaine);
        if (publicVise) liste = liste.filter(f => f.public_vise === 'tous' || f.public_vise === publicVise);
        if (wilaya === 'en_ligne') liste = liste.filter(f => f.mode === 'en_ligne');
        else if (wilaya) liste = liste.filter(f => f.mode === 'en_ligne' || String(f.wilaya) === String(wilaya));

        const user = utilisateurFacultatif(req);
        if (user && user.id) {
            const [interets] = await db.query('SELECT formation_id FROM formation_interets WHERE utilisateur_id = ?', [user.id]);
            const deja = new Set(interets.map(i => Number(i.formation_id)));
            liste = liste.map(f => ({ ...f, deja_interesse: deja.has(Number(f.id)) }));
        }
        res.json(liste);
    } catch (error) {
        console.error('Erreur GET /formations:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/formations/mes-formations — l'organisme voit toutes ses formations et leur état
// ============================================================
router.get('/mes-formations', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(
            `SELECT f.*, (SELECT COUNT(*) FROM formation_interets i WHERE i.formation_id = f.id) AS nb_interesses,
                    (SELECT COUNT(*) FROM paiements p WHERE p.formation_id = f.id AND p.statut = 'en_attente' AND p.moyen <> 'carte') AS paiements_en_attente
             FROM formations f WHERE f.utilisateur_id = ? ORDER BY f.date_creation DESC`,
            [req.user.id]
        );
        res.json(rows.map(f => ({ ...f, visible: estVisible(f), nb_interesses: Number(f.nb_interesses) || 0, paiements_en_attente: Number(f.paiements_en_attente) || 0 })));
    } catch (error) {
        console.error('Erreur GET /formations/mes-formations:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// ADMINISTRATEUR
// ============================================================
async function exigerAdmin(req, res, next) {
    try {
        const user = await lireUtilisateur(req.app.get('db'), req.user.id);
        if (!estAdmin(user)) return res.status(403).json({ message: 'Réservé à l\'administrateur' });
        req.utilisateur = user;
        next();
    } catch (error) {
        console.error('Erreur contrôle administrateur (formations):', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
}

router.get('/admin/liste', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(
            `SELECT f.id, f.utilisateur_id, f.titre, f.domaine, f.public_vise, f.mode, f.wilaya, f.lieu, f.date_debut, f.duree, f.prix,
                    f.description, f.organisme_nom, f.telephone, f.email, f.site_web, f.agrement, (f.affiche IS NOT NULL) AS a_affiche,
                    f.statut, f.motif_refus, f.date_fin_parution, f.date_creation, u.nom_complet AS compte_nom,
                    (SELECT COUNT(*) FROM formation_interets i WHERE i.formation_id = f.id) AS nb_interesses
             FROM formations f LEFT JOIN utilisateurs u ON u.id = f.utilisateur_id
             ORDER BY f.date_creation DESC LIMIT 500`
        );
        res.json(rows.map(f => ({ ...f, a_affiche: Number(f.a_affiche) === 1, visible: estVisible(f), nb_interesses: Number(f.nb_interesses) || 0 })));
    } catch (error) {
        console.error('Erreur GET /formations/admin/liste:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.put('/admin/:id/valider', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    try {
        const f = await lireFormationParId(db, req.params.id);
        if (!f) return res.status(404).json({ message: 'Formation non trouvée' });
        if (f.statut === 'validee') return res.status(400).json({ message: 'Cette formation est déjà validée' });
        await db.query(`UPDATE formations SET statut = 'validee', motif_refus = NULL WHERE id = ?`, [f.id]);
        if (f.utilisateur_id) {
            try {
                await creerNotification(db, f.utilisateur_id, 'formation_validee', '✅ Formation validée',
                    `Votre formation « ${f.titre} » a été validée.`, 'page-organisme', f.id);
            } catch (e) {}
        }
        const publiee = await publierSiPrete(db, f.id);
        res.json({ message: 'Formation validée', publiee });
    } catch (error) {
        console.error('Erreur PUT /formations/admin/:id/valider:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.put('/admin/:id/refuser', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const motif = texte(req.body.motif, 255);
    if (!motif) return res.status(400).json({ message: 'Indiquez le motif du refus' });
    try {
        const f = await lireFormationParId(db, req.params.id);
        if (!f) return res.status(404).json({ message: 'Formation non trouvée' });
        await db.query(`UPDATE formations SET statut = 'refusee', motif_refus = ? WHERE id = ?`, [motif, f.id]);
        if (f.utilisateur_id) {
            try {
                await creerNotification(db, f.utilisateur_id, 'formation_refusee', '❌ Formation refusée',
                    `Votre formation « ${f.titre} » a été refusée : ${motif}`, 'page-organisme', f.id);
            } catch (e) {}
        }
        res.json({ message: 'Formation refusée' });
    } catch (error) {
        console.error('Erreur PUT /formations/admin/:id/refuser:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// L'administrateur ajoute une durée de parution sans paiement en ligne (accord conclu hors du site, offre d'essai…)
router.put('/admin/:id/parution', authenticateToken, exigerAdmin, async (req, res) => {
    const db = req.app.get('db');
    const formule = req.body.formule === 'mois' ? 'mois' : req.body.formule === 'semaine' ? 'semaine' : null;
    const quantite = Number(req.body.quantite);
    if (!formule || !Number.isInteger(quantite) || quantite < 1 || quantite > PARUTION_MAX) {
        return res.status(400).json({ message: 'Durée de parution invalide' });
    }
    try {
        const f = await lireFormationParId(db, req.params.id);
        if (!f) return res.status(404).json({ message: 'Formation non trouvée' });
        await ajouterParution(db, f.id, formule, quantite);
        const publiee = await publierSiPrete(db, f.id);
        res.json({ message: 'Parution prolongée', publiee });
    } catch (error) {
        console.error('Erreur PUT /formations/admin/:id/parution:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/formations — un organisme propose une formation (à vérifier), ou l'administrateur en saisit une
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const user = await lireUtilisateur(db, req.user.id);
        if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
        const admin = estAdmin(user);
        if (user.profil !== 'organisme_formation' && !admin) {
            return res.status(403).json({ message: 'Réservé aux organismes de formation' });
        }
        const lu = lireChampsFormation(req.body, { creation: true });
        if (lu.erreur) return res.status(400).json({ message: lu.erreur });
        const f = lu.champs;

        // Saisie par l'administrateur pour un organisme : validée tout de suite, avec sa durée de parution
        const pourOrganisme = admin && user.profil !== 'organisme_formation';
        let parution = null;
        if (pourOrganisme) {
            const q = Number(req.body.parution_quantite);
            const formule = req.body.parution_formule === 'mois' ? 'mois' : 'semaine';
            if (!Number.isInteger(q) || q < 1 || q > PARUTION_MAX) return res.status(400).json({ message: 'Durée de parution invalide' });
            parution = { formule, quantite: q };
        }

        const [result] = await db.query(
            `INSERT INTO formations (utilisateur_id, cree_par, titre, domaine, public_vise, mode, wilaya, lieu, date_debut, duree, prix,
                description, organisme_nom, telephone, email, site_web, agrement, affiche, statut)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pourOrganisme ? null : user.id, user.id, f.titre, f.domaine, f.public_vise, f.mode, f.wilaya, f.lieu, f.date_debut, f.duree, f.prix,
             f.description, f.organisme_nom, f.telephone, f.email, f.site_web, f.agrement, f.affiche, pourOrganisme ? 'validee' : 'a_valider']
        );
        const id = result.insertId;
        let publiee = false;
        if (parution) {
            await ajouterParution(db, id, parution.formule, parution.quantite);
            publiee = await publierSiPrete(db, id);
        } else {
            await prevenirAdministrateurs(db, 'formation_a_valider', '🎓 Formation à vérifier',
                `${f.organisme_nom} a soumis la formation « ${f.titre} ».`, id);
        }
        res.status(201).json({ message: 'Formation enregistrée', id, publiee });
    } catch (error) {
        console.error('Erreur POST /formations:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/formations/:id/affiche — l'image de l'annonce (formation en ligne uniquement)
// ============================================================
router.get('/:id/affiche', async (req, res) => {
    const db = req.app.get('db');
    try {
        const [rows] = await db.query(
            `SELECT affiche FROM formations WHERE id = ? AND statut = 'validee' AND date_fin_parution >= NOW()`,
            [req.params.id]
        );
        const m = rows.length && rows[0].affiche ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(rows[0].affiche) : null;
        if (!m) return res.status(404).end();
        res.set('Content-Type', m[1]);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(Buffer.from(m[2], 'base64'));
    } catch (error) {
        console.error('Erreur GET /formations/:id/affiche:', error);
        res.status(500).end();
    }
});

// ============================================================
// GET /api/formations/:id — une formation : en ligne pour tous, toutes ses données pour l'organisme et l'administrateur
// ============================================================
router.get('/:id', async (req, res) => {
    const db = req.app.get('db');
    try {
        const f = await lireFormationParId(db, req.params.id);
        const connecte = utilisateurFacultatif(req);
        let proprio = false, admin = false;
        if (f && connecte && connecte.id) {
            proprio = Number(f.utilisateur_id) === Number(connecte.id);
            if (!proprio) admin = estAdmin(await lireUtilisateur(db, connecte.id));
        }
        if (!f || (!estVisible(f) && !proprio && !admin)) return res.status(404).json({ message: 'Formation non trouvée' });
        const { affiche, notifie, cree_par, ...reste } = f;
        res.json({ ...reste, a_affiche: !!affiche, visible: estVisible(f), ...(proprio || admin ? { affiche } : {}) });
    } catch (error) {
        console.error('Erreur GET /formations/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Formation de l'organisme connecté, ou n'importe laquelle pour l'administrateur
async function formationModifiable(req, res) {
    const db = req.app.get('db');
    const user = await lireUtilisateur(db, req.user.id);
    const f = await lireFormationParId(db, req.params.id);
    if (!user || !f) { res.status(404).json({ message: 'Formation non trouvée' }); return null; }
    const proprio = Number(f.utilisateur_id) === Number(user.id);
    if (!proprio && !estAdmin(user)) { res.status(403).json({ message: 'Cette formation ne vous appartient pas' }); return null; }
    return { db, user, f, proprio };
}

// ============================================================
// PUT /api/formations/:id — modifier (une formation modifiée par l'organisme est vérifiée à nouveau)
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const ctx = await formationModifiable(req, res);
        if (!ctx) return;
        const { db, f, proprio } = ctx;
        const lu = lireChampsFormation(req.body, { creation: false });
        if (lu.erreur) return res.status(400).json({ message: lu.erreur });
        const c = lu.champs;
        const affiche = c.affiche === undefined ? f.affiche : c.affiche;
        const statut = proprio ? 'a_valider' : f.statut;
        await db.query(
            `UPDATE formations SET titre = ?, domaine = ?, public_vise = ?, mode = ?, wilaya = ?, lieu = ?, date_debut = ?, duree = ?, prix = ?,
                description = ?, organisme_nom = ?, telephone = ?, email = ?, site_web = ?, agrement = ?, affiche = ?, statut = ?,
                motif_refus = NULL, date_modification = NOW()
             WHERE id = ?`,
            [c.titre, c.domaine, c.public_vise, c.mode, c.wilaya, c.lieu, c.date_debut, c.duree, c.prix,
             c.description, c.organisme_nom, c.telephone, c.email, c.site_web, c.agrement, affiche, statut, f.id]
        );
        if (proprio) {
            await prevenirAdministrateurs(db, 'formation_a_valider', '🎓 Formation à vérifier',
                `${c.organisme_nom} a soumis la formation « ${c.titre} ».`, f.id);
        }
        res.json({ message: 'Formation modifiée', a_verifier: proprio });
    } catch (error) {
        console.error('Erreur PUT /formations/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// DELETE /api/formations/:id
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const ctx = await formationModifiable(req, res);
        if (!ctx) return;
        await ctx.db.query('DELETE FROM formation_interets WHERE formation_id = ?', [ctx.f.id]);
        await ctx.db.query('DELETE FROM formations WHERE id = ?', [ctx.f.id]);
        res.json({ message: 'Formation supprimée' });
    } catch (error) {
        console.error('Erreur DELETE /formations/:id:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// POST /api/formations/:id/interet — « Je suis intéressé » : nom et téléphone transmis à l'organisme
// ============================================================
router.post('/:id/interet', authenticateToken, async (req, res) => {
    const db = req.app.get('db');
    try {
        const user = await lireUtilisateur(db, req.user.id);
        const f = await lireFormationParId(db, req.params.id);
        if (!user || !estVisible(f)) return res.status(404).json({ message: 'Formation non trouvée' });
        if (Number(f.utilisateur_id) === Number(user.id)) return res.status(400).json({ message: 'C\'est votre propre formation' });
        const [ins] = await db.query('INSERT IGNORE INTO formation_interets (formation_id, utilisateur_id) VALUES (?, ?)', [f.id, user.id]);
        if (!ins.affectedRows) return res.json({ message: 'Demande déjà envoyée', deja: true });

        const contact = user.telephone || user.email || '';
        const message = `${user.nom_complet}${contact ? ` (${contact})` : ''} est intéressé(e) par « ${f.titre} ».`;
        if (f.utilisateur_id) {
            try {
                await creerNotification(db, f.utilisateur_id, 'formation_interet', '🙋 Personne intéressée', message, 'page-organisme', f.id);
            } catch (e) {}
        } else {
            await prevenirAdministrateurs(db, 'formation_interet', '🙋 Personne intéressée', message, f.id);
        }
        res.status(201).json({ message: 'Demande envoyée', deja: false });
    } catch (error) {
        console.error('Erreur POST /formations/:id/interet:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ============================================================
// GET /api/formations/:id/interets — les personnes intéressées (organisme de la formation ou administrateur)
// ============================================================
router.get('/:id/interets', authenticateToken, async (req, res) => {
    try {
        const ctx = await formationModifiable(req, res);
        if (!ctx) return;
        const [rows] = await ctx.db.query(
            `SELECT u.id, u.nom_complet, u.profil, u.wilaya, u.telephone, u.email, i.date_creation
             FROM formation_interets i JOIN utilisateurs u ON u.id = i.utilisateur_id
             WHERE i.formation_id = ? ORDER BY i.date_creation DESC`,
            [ctx.f.id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Erreur GET /formations/:id/interets:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// ⭐ Un organisme de formation n'a pas accès aux profils des membres de BatiDZ.
//    Il ne voit la fiche (téléphone, email) et ne peut écrire qu'aux administrateurs, aux personnes
//    qui se sont dites intéressées par une de ses formations, ou à celles avec qui il échange déjà.
async function organismeEnRelation(db, organismeId, membreId) {
    if (Number(organismeId) === Number(membreId)) return true;
    const [admin] = await db.query('SELECT est_admin FROM utilisateurs WHERE id = ?', [membreId]);
    if (admin[0] && Number(admin[0].est_admin) === 1) return true;
    const [interet] = await db.query(
        `SELECT 1 FROM formation_interets fi JOIN formations f ON f.id = fi.formation_id
         WHERE f.utilisateur_id = ? AND fi.utilisateur_id = ? LIMIT 1`, [organismeId, membreId]);
    if (interet.length) return true;
    const [echange] = await db.query(
        `SELECT 1 FROM messages WHERE (expediteur_id = ? AND destinataire_id = ?) OR (expediteur_id = ? AND destinataire_id = ?) LIMIT 1`,
        [organismeId, membreId, membreId, organismeId]);
    return echange.length > 0;
}

module.exports = router;
module.exports.organismeEnRelation = organismeEnRelation;
module.exports.ajouterParution = ajouterParution;
module.exports.publierSiPrete = publierSiPrete;
module.exports.lireChampsFormation = lireChampsFormation;
module.exports.DOMAINES = DOMAINES;
module.exports.PARUTION_MAX = PARUTION_MAX;
