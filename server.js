const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
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
    secret: 'forfeo_prod_2025_safe',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- AUTO-MIGRATION ET SEEDER ---
async function initDatabase() {
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS entreprise_id INTEGER;`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, video_url VARCHAR(255));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            INSERT INTO formations_modules (id, titre, description, video_url) 
            VALUES (1, 'Harcèlement au Travail', 'Module obligatoire CNESST Québec.', 'https://www.youtube.com/embed/dQw4w9WgXcQ')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Définition du harcèlement psychologique ?', 'Conflit simple', 'Conduite vexatoire répétée', 'Critique travail', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE module_id = 1);
        `);
        console.log("✅ Système synchronisé.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDatabase();

// --- ROUTES AUTHENTIFICATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null }));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?error=Identifiants invalides');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- GESTION PROFIL ET MOT DE PASSE (CORRECTION CHANGEMENT PASS) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], userName: req.session.userName, message: req.query.msg || null });
});

app.post('/profil/update-password', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { new_password } = req.body;
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    res.redirect('/profil?msg=Mot de passe mis à jour');
});

// --- ADMIN : SUPPRESSION ET APPROBATION ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, userName: req.session.userName });
});

app.post('/admin/delete-user', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Refusé");
    await pool.query("DELETE FROM users WHERE id = $1", [req.body.id_a_supprimer]);
    res.redirect('/admin/dashboard');
});

// --- AMBASSADEUR : GAINS ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut = 'disponible'");
        const gainsQuery = `SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`;
        const gainsResult = await pool.query(gainsQuery, [req.session.userId]);
        res.render('ambassadeur-dashboard', { missions: missions.rows, totalGains: gainsResult.rows[0].total || 0, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur gains"); }
});

// --- ACADÉMIE ---
app.get('/formations', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    res.render('formations-liste', { modules: modules.rows, userName: req.session.userName });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB LIVE`));
