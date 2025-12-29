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
    secret: 'forfeo_ultra_safe_2025_prod',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- CONFIGURATION EMAIL ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- AUTO-MIGRATION ET SEEDER DES 15 QUESTIONS ---
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

            -- Injection des 15 questions réelles
            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Qu''est-ce qui définit le harcèlement psychologique au Québec ?', 'Un simple désaccord.', 'Une conduite vexatoire répétée qui porte atteinte à la dignité.', 'Une critique de travail.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 1);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Une seule conduite grave peut-elle constituer du harcèlement ?', 'Oui, si elle produit un effet nocif continu.', 'Non, il faut toujours une répétition.', 'Seulement si c''est physique.', 'A'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 2);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Qui doit prévenir le harcèlement en entreprise ?', 'L''employé victime.', 'Le syndicat.', 'L''employeur.', 'C'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 3);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Le harcèlement sexuel inclut-il les commentaires sur l''apparence ?', 'Oui, s''ils sont importuns et à connotation sexuelle.', 'Non, c''est de la drague.', 'Seulement s''il y a contact.', 'A'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 4);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Que doit faire un témoin de harcèlement ?', 'Ne rien dire.', 'Encourager la victime à dénoncer selon la politique.', 'Démissionner.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 5);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'La politique de prévention est-elle obligatoire ?', 'Optionnelle.', 'Oui, pour toutes les entreprises au Québec.', 'Seulement pour 50+ employés.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 6);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Le harcèlement peut-il provenir d''un client ?', 'Non.', 'Oui, l''employeur doit protéger son personnel.', 'Seulement les habitués.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 7);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Le droit de gérance permet-il de harceler ?', 'Oui.', 'Non, il doit respecter la dignité.', 'Seulement en crise.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 8);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Un commentaire sur Facebook peut-il être du harcèlement ?', 'Non.', 'Oui, s''il a un impact sur le milieu de travail.', 'Seulement sur les heures de bureau.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 9);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'La médiation est-elle obligatoire ?', 'Oui.', 'Non, elle doit être volontaire.', 'Si le patron l''exige.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 10);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'L''intention de nuire est-elle nécessaire ?', 'Oui.', 'Non, c''est l''effet sur la victime qui compte.', 'Seulement pour le sexe.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 11);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Le harcèlement peut être vertical ou horizontal ?', 'Oui, patron ou collègues.', 'Seulement patron.', 'Seulement collègues.', 'A'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 12);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Quelle émotion est associée au harcèlement ?', 'Motivation.', 'Humiliation ou isolement.', 'Indifférence.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 13);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'Quel organisme gère les plaintes au Québec ?', 'La Police.', 'La CNESST.', 'Le Logement.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 14);

            INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte)
            SELECT 1, 'La première étape recommandée pour une victime ?', 'Appeler la police.', 'Exprimer son désaccord si possible.', 'Attendre.', 'B'
            WHERE NOT EXISTS (SELECT 1 FROM formations_questions WHERE id = 15);
        `);
        console.log("✅ Système FORFEO et 15 questions synchronisés.");
    } catch (err) { console.error("❌ Erreur DB Init:", err); }
}
initDatabase();

// --- ROUTES PUBLIQUES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], userName: req.session.userName, message: null });
});
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

// --- DASHBOARD AMBASSADEUR (FIX NUMERIC) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut = 'disponible'");
        const gainsQuery = `
            SELECT SUM(
                CASE 
                    WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC)
                    WHEN recompense ~ '^\\$[0-9.]+$' THEN CAST(SUBSTRING(recompense FROM 2) AS NUMERIC)
                    ELSE 0 
                END
            ) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`;
        const gainsResult = await pool.query(gainsQuery, [req.session.userId]);
        res.render('ambassadeur-dashboard', { missions: missions.rows, totalGains: gainsResult.rows[0].total || 0, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur ambassadeur"); }
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const stats = await pool.query(`SELECT u_ent.nom as entreprise, COUNT(s.id) as total FROM formations_scores s JOIN users u_emp ON s.user_id = u_emp.id JOIN users u_ent ON u_emp.entreprise_id = u_ent.id WHERE s.meilleur_score >= 12 GROUP BY u_ent.nom`);
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, formationStats: stats.rows, userName: req.session.userName });
});
app.post('/admin/approuver-mission', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Refusé");
    await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
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
    res.redirect(`/formations/module/${module_id}`);
});

app.listen(port, () => console.log(`🚀 FORFEO LAB LIVE`));
