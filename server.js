const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
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
    secret: 'forfeo_2025_ultimate_production_key',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- AUTO-MIGRATION : CONFIGURATION DE LA BASE ---
async function setupDatabase() {
    try {
        // Ajout de la colonne entreprise_id pour lier les employés
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS entreprise_id INTEGER;`);
        
        // Création des tables de formation
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, video_url VARCHAR(255));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            -- Insertion du module par défaut
            INSERT INTO formations_modules (id, titre, description, video_url) 
            VALUES (1, 'Harcèlement au Travail', 'Module obligatoire CNESST Québec.', 'https://www.youtube.com/embed/dQw4w9WgXcQ')
            ON CONFLICT (id) DO NOTHING;

            -- Insertion des questions réelles
            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Définit le harcèlement psychologique ?', 'Conflit simple', 'Conduite vexatoire répétée', 'Critique travail', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE module_id = 1);
        `);
        console.log("✅ Système FORFEO synchronisé.");
    } catch (err) { console.error("❌ Erreur DB Init:", err); }
}
setupDatabase();

// --- ROUTES PUBLIQUES (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- AUTHENTIFICATION ---
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

// --- PROFIL & MOT DE PASSE ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});

app.post('/profil/update-password', async (req, res) => {
    const hash = await bcrypt.hash(req.body.new_password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    res.redirect('/profil?msg=Mis à jour');
});

// --- PORTAIL EMPLOYÉ (LMS) ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    res.render('employe-dashboard', { modules: modules.rows, userName: req.session.userName });
});

app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const score = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1 AND module_id = $2", [req.session.userId, req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { 
        module: module.rows[0], 
        userScore: score.rows[0] || { tentatives: 0, meilleur_score: 0 },
        questions: questions.rows,
        userName: req.session.userName 
    });
});

app.post('/formations/soumettre-quizz', async (req, res) => {
    const { module_id, score_obtenu } = req.body;
    await pool.query(`
        INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut) 
        VALUES ($1, $2, $3, 1, $4)
        ON CONFLICT (user_id, module_id) DO UPDATE 
        SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1`, 
    [req.session.userId, module_id, score_obtenu, score_obtenu >= 12 ? 'réussi' : 'échec']);
    res.redirect('/employe/dashboard');
});

// --- PORTAIL ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const scores = await pool.query(`
        SELECT u.nom as nom_employe, m.titre as nom_module, s.* FROM formations_scores s 
        JOIN users u ON s.user_id = u.id 
        JOIN formations_modules m ON s.module_id = m.id 
        WHERE u.entreprise_id = $1`, [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, employeesScores: scores.rows, userName: req.session.userName });
});

// --- PORTAIL AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, userName: req.session.userName });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB LIVE`));
