const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURATION EMAIL ---
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB ---
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS premiere_connexion BOOLEAN DEFAULT TRUE;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP;");
        console.log("✅ FORFEO LAB : Système synchronisé");
    } catch (e) { console.error(e); }
}
initDB();

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_loi25_secure_2025',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES LÉGALES ---
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.send("Page Conditions en rédaction..."));

// --- NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur' }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));

// --- PROFIL ---
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

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query(`SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0, showWelcome });
});

app.post('/postuler-mission', async (req, res) => {
    const { id_mission } = req.body;
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
    res.redirect('/ambassadeur/mes-missions');
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
});

// --- ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const userRes = await pool.query("SELECT premiere_connexion, forfait FROM users WHERE id = $1", [req.session.userId]);
    const showWelcome = userRes.rows[0].premiere_connexion;
    const forfait = userRes.rows[0].forfait || 'Freemium';
    if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, showWelcome, stats: { forfait, canPublish: true } });
});

app.get('/entreprise/statistiques', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const statsQuery = await pool.query(`SELECT TO_CHAR(date_approbation, 'Mon') as mois, COUNT(*) as total FROM missions WHERE entreprise_id = $1 AND statut = 'approuve' GROUP BY mois`, [req.session.userId]);
    res.render('entreprise-stats', { stats: statsQuery.rows, userName: req.session.userName });
});

// --- PDF ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const result = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
    const mission = result.rows[0];
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Rapport_${mission.id}.pdf`);
    doc.pipe(res);
    doc.fontSize(20).text('Rapport FORFEO LAB', { align: 'center' });
    doc.moveDown().fontSize(12).text(`Mission: ${mission.titre}`);
    doc.text(`Statut: ${mission.statut}`);
    doc.end();
});

// --- AUTH ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
    res.redirect('/login?msg=Succès');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?msg=Erreur');
});

app.listen(port, () => console.log(`🚀 Port ${port}`));
