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
    secret: 'forfeo_2025_ultimate_secure_key',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- AUTO-MIGRATION : RÉPARATION ET CRÉATION DES TABLES ---
async function setupDatabase() {
    try {
        // 1. Réparation de la table users (Ajout entreprise_id si manquant)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS entreprise_id INTEGER;`);
        
        // 2. Création des tables LMS
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, video_url VARCHAR(255));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            -- Insertion du module par défaut s'il est absent
            INSERT INTO formations_modules (id, titre, description, video_url) 
            VALUES (1, 'Harcèlement au Travail', 'Module obligatoire CNESST Québec.', 'https://www.youtube.com/embed/dQw4w9WgXcQ')
            ON CONFLICT (id) DO NOTHING;
        `);
        console.log("✅ Base de données synchronisée et réparée.");
    } catch (err) { console.error("❌ Erreur de synchronisation:", err); }
}
setupDatabase();

// --- ROUTES DE NAVIGATION & AUTH ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/verifier-certificat', (req, res) => res.render('verifier-certificat', { certificat: null, error: null, userName: req.session.userName || null }));

app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (nom, email, password, role, forfait) VALUES ($1, $2, $3, $4, 'Freemium')", [nom, email, hash, role]);
        res.redirect('/login?msg=Compte créé avec succès');
    } catch (err) { res.redirect('/register?error=Email déjà utilisé'); }
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
    res.redirect('/login?error=Identifiants invalides');
});

// --- ACADÉMIE : ROUTES FORMATION ---
app.get('/formations', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    res.render('formations-liste', { modules: modules.rows, userName: req.session.userName });
});

app.get('/formations/module/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const score = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1 AND module_id = $2", [req.session.userId, req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY RANDOM() LIMIT 15", [req.params.id]);
    res.render('formation-detail', { 
        module: module.rows[0], 
        userScore: score.rows[0] || { tentatives: 0, meilleur_score: 0 },
        questions: questions.rows,
        userName: req.session.userName 
    });
});

app.post('/formations/soumettre-quizz', async (req, res) => {
    const { module_id, score_obtenu } = req.body;
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    await pool.query(`
        INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) 
        VALUES ($1, $2, $3, 1, $4, $5)
        ON CONFLICT (user_id, module_id) DO UPDATE 
        SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), 
            tentatives = formations_scores.tentatives + 1`, 
    [req.session.userId, module_id, score_obtenu, score_obtenu >= 12 ? 'réussi' : 'échec', code]);
    res.redirect(`/formations/module/${module_id}`);
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const formationStats = await pool.query(`SELECT u_ent.nom as entreprise, COUNT(s.id) as total FROM formations_scores s JOIN users u_emp ON s.user_id = u_emp.id JOIN users u_ent ON u_emp.entreprise_id = u_ent.id WHERE s.meilleur_score >= 12 GROUP BY u_ent.nom`);
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, formationStats: formationStats.rows, userName: req.session.userName });
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const empScores = await pool.query(`
            SELECT u.nom as nom_employe, m.titre as nom_module, s.* FROM formations_scores s 
            JOIN users u ON s.user_id = u.id 
            JOIN formations_modules m ON s.module_id = m.id 
            WHERE u.entreprise_id = $1`, [req.session.userId]);
        
        const stats = {
            approuve: missions.rows.filter(m => m.statut === 'approuve').length,
            reserve: missions.rows.filter(m => m.statut === 'reserve').length,
            actif: missions.rows.filter(m => m.statut === 'actif' || m.statut === 'disponible').length
        };

        res.render('entreprise-dashboard', { missions: missions.rows, employeesScores: empScores.rows, stats, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur dashboard entreprise"); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB LIVE`));
