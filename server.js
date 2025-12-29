const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS premiere_connexion BOOLEAN DEFAULT TRUE;");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        console.log("✅ FORFEO LAB : Système Stable & Connecté");
    } catch (e) { console.log("Init Error:", e); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- GESTION DES SESSIONS (Persistance sur Render) ---
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_secret_2025_prod',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('register', { role: 'ambassadeur' }));

// --- GESTION DU PROFIL (Fix Cannot GET /profil) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const result = await pool.query("SELECT id, nom, email, role, forfait FROM users WHERE id = $1", [req.session.userId]);
        res.render('profil', { user: result.rows[0], message: req.query.msg || null, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur Profil"); }
});

app.post('/update-profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { nom, newPassword } = req.body;
    try {
        await pool.query("UPDATE users SET nom = $1 WHERE id = $2", [nom, req.session.userId]);
        req.session.userName = nom;
        if (newPassword && newPassword.trim() !== "") {
            const hash = await bcrypt.hash(newPassword, 10);
            await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
        }
        res.redirect('/profil?msg=Profil mis à jour !');
    } catch (err) { res.status(500).send("Erreur Mise à jour"); }
});

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const userRes = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
        const showWelcome = userRes.rows[0].premiere_connexion;
        if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);

        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query(`
            SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total 
            FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
        
        res.render('ambassadeur-dashboard', { 
            missions: disponibles.rows, userName: req.session.userName, 
            totalGains: gains.rows[0].total || 0, showWelcome: showWelcome 
        });
    } catch (err) { res.status(500).send("Erreur Dashboard"); }
});

// --- RESERVATION (Fix Cannot POST /postuler-mission) ---
app.post('/postuler-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur réservation"); }
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
        res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur chargement missions"); }
});

// --- SUPPRESSION DE COMPTE ---
app.post('/admin/delete-user', async (req, res) => {
    if (!req.session.userId) return res.status(403).send("Non autorisé");
    const { id_a_supprimer } = req.body;
    try {
        await pool.query("DELETE FROM missions WHERE entreprise_id = $1 OR ambassadeur_id = $1", [id_a_supprimer]);
        await pool.query("DELETE FROM users WHERE id = $1", [id_a_supprimer]);
        if (id_a_supprimer == req.session.userId) {
            req.session.destroy();
            return res.redirect('/login?msg=Compte supprimé');
        }
        res.redirect('/admin/dashboard?msg=Utilisateur supprimé');
    } catch (err) { res.status(500).send("Erreur suppression"); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB sur port ${port}`));
