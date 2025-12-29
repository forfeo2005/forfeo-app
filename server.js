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
    secret: 'forfeo_2025_ultimate_secure_key',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- AUTO-MIGRATION : RÉPARATION ET SEEDER DES QUESTIONS ---
async function setupDatabase() {
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
        console.log("✅ Système FORFEO synchronisé.");
    } catch (err) { console.error("❌ Erreur DB Init:", err); }
}
setupDatabase();

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

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

// --- PROFIL & MOT DE PASSE (Fix Cannot GET /profil) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], userName: req.session.userName, message: req.query.msg || null });
});

app.post('/profil/update-password', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const hash = await bcrypt.hash(req.body.new_password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    res.redirect('/profil?msg=Mot de passe mis à jour');
});

// --- ADMIN (Fix Cannot POST /admin/approuver-mission) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, userName: req.session.userName });
});

app.post('/admin/approuver-mission', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Refusé");
    await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

app.post('/admin/delete-user', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Refusé");
    await pool.query("DELETE FROM users WHERE id = $1", [req.body.id_a_supprimer]);
    res.redirect('/admin/dashboard');
});

// --- AMBASSADEUR : POSTULER ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut = 'disponible'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    const gainsQuery = `SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`;
    const gainsResult = await pool.query(gainsQuery, [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, totalGains: gainsResult.rows[0].total || 0, userName: req.session.userName });
});

app.post('/postuler-mission', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Refusé");
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});

// --- ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom as nom_employe, m.titre as nom_module, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const stats = { approuve: missions.rows.filter(m => m.statut === 'approuve').length, reserve: missions.rows.filter(m => m.statut === 'reserve').length, actif: missions.rows.filter(m => m.statut === 'actif').length };
    res.render('entreprise-dashboard', { missions: missions.rows, employeesScores: scores.rows, stats: stats, userName: req.session.userName });
});

// --- ACADÉMIE ---
app.get('/formations', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    res.render('formations-liste', { modules: modules.rows, userName: req.session.userName });
});

app.get('/formations/module/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const score = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1 AND module_id = $2", [req.session.userId, req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], userScore: score.rows[0] || { tentatives: 0, meilleur_score: 0 }, questions: questions.rows, userName: req.session.userName });
});

app.post('/formations/soumettre-quizz', async (req, res) => {
    const { module_id, score_obtenu } = req.body;
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    await pool.query(`
        INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) 
        VALUES ($1, $2, $3, 1, $4, $5)
        ON CONFLICT (user_id, module_id) DO UPDATE 
        SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1`, 
    [req.session.userId, module_id, score_obtenu, score_obtenu >= 12 ? 'réussi' : 'échec', code]);
    res.redirect(`/formations/resultat/${module_id}`);
});

app.get('/formations/resultat/:id', async (req, res) => {
    const scoreRes = await pool.query("SELECT s.*, m.titre FROM formations_scores s JOIN formations_modules m ON s.module_id = m.id WHERE s.user_id = $1 AND s.module_id = $2", [req.session.userId, req.params.id]);
    res.render('formation-resultat', { score: scoreRes.rows[0], userName: req.session.userName });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB LIVE`));
