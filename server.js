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
    secret: 'forfeo_v3_production_secret',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SETUP BDD & SEEDING ---
async function setupDatabase() {
    try {
        // Tables principales
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1));
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // Corrections colonnes
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS type_audit VARCHAR(100) DEFAULT 'Audit Standard';`);
        await pool.query(`ALTER TABLE missions ALTER COLUMN recompense TYPE VARCHAR(50);`);
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_module') THEN ALTER TABLE formations_scores ADD CONSTRAINT unique_user_module UNIQUE (user_id, module_id); END IF; END $$;`);

        // SEED MODULES (Images placeholder, pas de vidéo)
        const modules = [
            { id: 1, titre: "Excellence du Service Client", desc: "Les bases pour créer un effet WOW.", icon: "bi-emoji-smile", duree: "30 min" },
            { id: 2, titre: "Communication & Écoute Active", desc: "Le ton, l'empathie et la reformulation.", icon: "bi-ear", duree: "40 min" },
            { id: 3, titre: "Gestion des Situations Difficiles", desc: "Désamorcer les conflits calmement.", icon: "bi-shield-check", duree: "45 min" },
            { id: 4, titre: "Culture Qualité & Feedback", desc: "Utiliser le feedback pour grandir.", icon: "bi-graph-up-arrow", duree: "25 min" },
            { id: 5, titre: "Professionnalisme & Collaboration", desc: "Fiabilité et image de marque.", icon: "bi-people", duree: "35 min" }
        ];

        for (const m of modules) {
            await pool.query(
                `INSERT INTO formations_modules (id, titre, description, image_icon, duree) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (id) DO UPDATE SET titre = $2, description = $3, image_icon = $4, duree = $5`,
                [m.id, m.titre, m.desc, m.icon, m.duree]
            );
        }

        // SEED QUESTIONS (15 par module)
        const count = await pool.query("SELECT COUNT(*) FROM formations_questions");
        if (parseInt(count.rows[0].count) < 75) {
            console.log("Génération des 75 questions...");
            await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
            for (let mId = 1; mId <= 5; mId++) {
                for (let q = 1; q <= 15; q++) {
                    await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte) VALUES 
                    ($1, 'Question ${q} pour le module ${mId} : Quelle est la meilleure approche ?', 'Approche A (Incorrecte)', 'Approche B (Correcte)', 'Approche C (Neutre)', 'B')`, [mId]);
                }
            }
        }
        console.log("✅ FORFEO LAB : Système prêt.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES DE BASE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- AUTH ---
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.redirect('/login?error=Identifiants_invalides');
    } catch (e) { res.redirect('/login?error=Erreur_Systeme'); }
});

app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null, userName: null }));
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login?msg=Compte_cree');
    } catch (err) { res.redirect('/register?error=Email_existe_deja'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- PROFIL (Tous utilisateurs) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});

app.post('/profil/update', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { nom, email, new_password } = req.body;
    await pool.query("UPDATE users SET nom = $1, email = $2 WHERE id = $3", [nom, email, req.session.userId]);
    if(new_password) {
        const hash = await bcrypt.hash(new_password, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    req.session.userName = nom;
    res.redirect('/profil?msg=Profil_mis_a_jour');
});

app.post('/profil/delete', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query("DELETE FROM users WHERE id = $1", [req.session.userId]);
    req.session.destroy();
    res.redirect('/?msg=Compte_supprime');
});

// --- ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, userName: req.session.userName });
});

app.post('/admin/approuver-mission', async (req, res) => {
    // Si c'est 'soumis' (par ambassadeur), ça devient 'approuve' (final).
    // Si c'est 'en_attente' (par entreprise), ça devient 'actif' (visible ambassadeurs).
    const mission = await pool.query("SELECT statut FROM missions WHERE id = $1", [req.body.id_mission]);
    let newStatut = 'actif';
    if(mission.rows[0].statut === 'soumis') newStatut = 'approuve';
    
    await pool.query("UPDATE missions SET statut = $1 WHERE id = $2", [newStatut, req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

// --- ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    // Récupérer les scores AVEC le nom de l'employé
    const scores = await pool.query(`SELECT u.nom, m.titre, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName });
});

app.post('/entreprise/creer-audit', async (req, res) => {
    const { titre, type_audit, description, recompense } = req.body;
    const cleanRecompense = recompense.replace('$', '').trim();
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut) VALUES ($1, $2, $3, $4, $5, 'en_attente')", 
    [req.session.userId, titre, type_audit, description, cleanRecompense]);
    res.redirect('/entreprise/dashboard?msg=Audit_Publie');
});

app.post('/entreprise/ajouter-employe', async (req, res) => {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const nom = email.split('@')[0];
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", 
    [nom, email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard?msg=Employe_Ajoute');
});

// Téléchargement du rapport PDF final par l'entreprise
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const report = await pool.query("SELECT r.*, m.titre, m.type_audit, u.nom as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1", [req.params.id]);
    
    if(report.rows.length === 0) return res.send("Rapport en attente de validation par l'ambassadeur ou l'admin.");

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=rapport-audit-${req.params.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text(`RAPPORT D'AUDIT : ${report.rows[0].titre}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Type: ${report.rows[0].type_audit}`);
    doc.text(`Ambassadeur: ${report.rows[0].ambassadeur_nom}`);
    doc.text(`Date: ${new Date(report.rows[0].created_at).toLocaleDateString()}`);
    doc.moveDown();
    doc.fontSize(14).text("RÉSULTATS DE L'ÉVALUATION", { underline: true });
    doc.moveDown();
    
    const details = report.rows[0].details;
    // On parse le JSON pour l'afficher proprement
    for (const [key, value] of Object.entries(details)) {
        doc.fontSize(12).text(`${key.toUpperCase()} : ${value}`);
        doc.moveDown(0.5);
    }
    doc.end();
});

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    
    res.render('ambassadeur-dashboard', { 
        missions: missions.rows, 
        historique: historique.rows, 
        totalGains: gains.rows[0].total || 0, 
        userName: req.session.userName 
    });
});

app.post('/ambassadeur/postuler', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard?msg=Mission_Reservee');
});

// Soumission du formulaire d'audit par l'ambassadeur
app.post('/ambassadeur/soumettre-rapport', async (req, res) => {
    const { mission_id, ...reponses } = req.body;
    await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1, $2, $3) ON CONFLICT (mission_id) DO NOTHING", 
        [mission_id, req.session.userId, JSON.stringify(reponses)]);
    await pool.query("UPDATE missions SET statut = 'soumis' WHERE id = $1", [mission_id]);
    res.redirect('/ambassadeur/dashboard?msg=Rapport_Envoye');
});

// --- EMPLOYE ACADEMIE ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});

app.get('/formations/module/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    // Récupérer les 15 questions
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});

app.post('/formations/soumettre-quizz', async (req, res) => {
    const { module_id } = req.body;
    const questions = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id = $1", [module_id]);
    let score = 0;
    // Vérification des 15 réponses
    questions.rows.forEach(q => { if (req.body['q' + q.id] === q.reponse_correcte) score++; });
    
    // Seuil de réussite (12/15 = 80%)
    const statut = score >= 12 ? 'reussi' : 'echec';
    const code = Math.random().toString(36).substring(2, 12).toUpperCase();
    
    await pool.query(`INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) 
        VALUES ($1, $2, $3, 1, $4, $5) 
        ON CONFLICT (user_id, module_id) 
        DO UPDATE SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1, statut = EXCLUDED.statut`, 
    [req.session.userId, module_id, score, statut, code]);
    
    res.redirect('/employe/dashboard?msg=Quizz_Termine');
});

// Télécharger Certificat Employé
app.get('/certificat/:code', async (req, res) => {
    const data = await pool.query("SELECT s.*, u.nom, m.titre FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE s.code_verif = $1", [req.params.code]);
    
    if(data.rows.length === 0) return res.send("Certificat introuvable.");

    const doc = new PDFDocument({ layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificat-${req.params.code}.pdf`);
    doc.pipe(res);

    // Design Certificat
    doc.rect(20, 20, 750, 550).stroke('#0061ff');
    doc.fontSize(40).fillColor('#0061ff').text('CERTIFICAT DE RÉUSSITE', { align: 'center', mt: 100 });
    doc.moveDown();
    doc.fontSize(20).fillColor('black').text('Félicitations à', { align: 'center' });
    doc.moveDown();
    doc.fontSize(30).text(data.rows[0].nom, { align: 'center' });
    doc.moveDown();
    doc.fontSize(15).text('Pour avoir complété avec succès le module :', { align: 'center' });
    doc.moveDown();
    doc.fontSize(25).text(data.rows[0].titre, { align: 'center' });
    doc.moveDown();
    doc.fontSize(15).text(`Note obtenue : ${data.rows[0].meilleur_score}/15`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Code unique : ${data.rows[0].code_verif} | Date : ${new Date().toLocaleDateString()}`, { align: 'center' });
    
    doc.end();
});

app.listen(port, () => console.log(`🚀 FORFEO LIVE`));
