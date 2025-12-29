const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_2025_secure_key_v3',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SYNC DB ET SEEDER ---
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, video_url VARCHAR(255));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);
        console.log("✅ FORFEO LAB : Base de données synchronisée.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES AUTH ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.render('login', { error: 'Identifiants invalides', msg: null, userName: null });
});

// --- ADMIN DASHBOARD (RÉPARÉ) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users");
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, userName: req.session.userName });
});

app.post('/admin/approuver-mission', async (req, res) => {
    await pool.query("UPDATE missions SET statut = 'actif' WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

// --- ENTREPRISE : AUDITS ET PDF ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName });
});

app.post('/entreprise/creer-audit', async (req, res) => {
    const { titre, type_audit, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut) VALUES ($1, $2, $3, $4, $5, 'en_attente')", 
    [req.session.userId, titre, type_audit, description, recompense]);
    res.redirect('/entreprise/dashboard?msg=Mission envoyée pour approbation');
});

app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const mission = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(20).text(`Rapport d'Audit : ${mission.rows[0].titre}`, { align: 'center' });
    doc.moveDown().fontSize(12).text(`Type : ${mission.rows[0].type_audit}`);
    doc.text(`Statut : ${mission.rows[0].statut}`);
    doc.text(`Description : ${mission.rows[0].description}`);
    doc.end();
});

// --- EMPLOYE DASHBOARD ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules");
    res.render('employe-dashboard', { modules: modules.rows, userName: req.session.userName });
});

app.post('/entreprise/ajouter-employe', async (req, res) => {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", 
    [email.split('@')[0], email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});

app.listen(port, () => console.log(`🚀 LIVE`));
