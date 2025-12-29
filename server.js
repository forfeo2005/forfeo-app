const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURATION EMAIL (Sécurisée contre les Timeouts) ---
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, 
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: 5000 // Évite de bloquer le serveur plus de 5s
});

// --- INITIALISATION DB ---
async function synchroniser() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS premiere_connexion BOOLEAN DEFAULT TRUE;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP;");
        console.log("✅ FORFEO LAB : Base de données synchronisée");
    } catch (e) { console.error("Erreur DB:", e); }
}
synchroniser();

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_2025_secure_key',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('register', { role: 'ambassadeur' })); // Fix Bouton Blanc Accueil

// --- PROFIL (Fix Cannot GET /profil) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], message: req.query.msg || null, userName: req.session.userName });
});

app.post('/update-profil', async (req, res) => {
    const { nom, newPassword } = req.body;
    await pool.query("UPDATE users SET nom = $1 WHERE id = $2", [nom, req.session.userId]);
    if (newPassword && newPassword.trim() !== "") {
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    res.redirect('/profil?msg=Profil mis à jour');
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    const rapports = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m LEFT JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const revenusData = await pool.query(`
        SELECT TO_CHAR(COALESCE(date_approbation, NOW()), 'Mon YYYY') as mois, 
        SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total 
        FROM missions WHERE statut = 'approuve' 
        GROUP BY mois, date_approbation ORDER BY date_approbation ASC LIMIT 6`);
    res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows, userName: req.session.userName, chartData: revenusData.rows });
});

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);
    
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query(`SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0, showWelcome });
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
});

// --- RÉSERVATION (Fix Cannot POST /postuler-mission) ---
app.post('/postuler-mission', async (req, res) => {
    if (!req.session.userId) return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        const info = await pool.query(`SELECT m.titre, u.email, u.nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1`, [id_mission]);
        if (info.rows.length > 0) {
            await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
            // Tentative d'email silencieuse pour éviter le crash
            transporter.sendMail({
                from: `"FORFEO LAB" <${process.env.EMAIL_USER}>`,
                to: info.rows[0].email,
                subject: `Réservation : ${info.rows[0].titre}`,
                text: `L'ambassadeur ${req.session.userName} a réservé votre mission.`
            }).catch(e => console.log("⚠️ Email SMTP non envoyé (Timeout), mais réservation réussie."));
        }
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur réservation"); }
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion, forfait FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    const forfait = userRes.rows[0].forfait || 'Freemium';
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);

    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, showWelcome, stats: { totale: missions.rows.length, forfait, canPublish: (forfait === 'Premium' || missions.rows.length < 1) } });
});

app.get('/entreprise/statistiques', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const statsQuery = await pool.query(`SELECT TO_CHAR(date_approbation, 'Mon') as mois, COUNT(*) as total FROM missions WHERE entreprise_id = $1 AND statut = 'approuve' GROUP BY mois`, [req.session.userId]);
    res.render('entreprise-stats', { stats: statsQuery.rows, userName: req.session.userName });
});

// --- AUTHENTIFICATION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?msg=Identifiants incorrects');
});

app.post('/admin/delete-user', async (req, res) => {
    const { id_a_supprimer } = req.body;
    await pool.query("DELETE FROM missions WHERE entreprise_id = $1 OR ambassadeur_id = $1", [id_a_supprimer]);
    await pool.query("DELETE FROM users WHERE id = $1", [id_a_supprimer]);
    if (id_a_supprimer == req.session.userId) req.session.destroy();
    res.redirect('/login?msg=Compte supprimé');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB Live sur port ${port}`));
