const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Config OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cerveau Forfy (Base de connaissances)
const knowledgeBase = require('./forfeo-knowledge');

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images'))); // Logo
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v13_final_prod',
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// --- SETUP BDD, MIGRATION & SEEDING ---
async function setupDatabase() {
    try {
        // 1. Tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium');
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // 2. Migrations (Colonnes manquantes)
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_paiement TIMESTAMP;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut_paiement VARCHAR(50) DEFAULT 'non_paye';`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS google_map_link TEXT;`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS client_nom VARCHAR(255);`);
        await pool.query(`ALTER TABLE missions ADD COLUMN IF NOT EXISTS adresse VARCHAR(255);`);
        await pool.query(`ALTER TABLE formations_modules ADD COLUMN IF NOT EXISTS image_icon VARCHAR(50);`);
        
        // Colonnes spécifiques pour les questions riches
        await pool.query(`ALTER TABLE formations_questions ADD COLUMN IF NOT EXISTS mise_en_situation TEXT;`);
        await pool.query(`ALTER TABLE formations_questions ADD COLUMN IF NOT EXISTS explication TEXT;`);

        // 3. Seeding des Questions depuis JSON
        const count = await pool.query("SELECT COUNT(*) FROM formations_questions");
        if (parseInt(count.rows[0].count) < 75) {
            console.log("📥 Chargement de la banque de questions...");
            try {
                const rawData = fs.readFileSync(path.join(__dirname, 'data', 'question_bank.json'));
                const modules = JSON.parse(rawData);

                for (const mod of modules) {
                    // Upsert Module
                    await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET titre=$2, description=$3, image_icon=$4`, [mod.id, mod.titre, mod.description, mod.image_icon, mod.duree]);
                    
                    // Upsert Questions
                    for (const q of mod.questions) {
                        // On utilise une clé composite virtuelle ou on supprime/recrée (ici suppression safe par module)
                        // Pour faire simple et robuste : Insert simple ignoré si existe, ou on vide avant.
                        // On va insérer directement.
                        await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [mod.id, q.question, q.choix_a, q.choix_b, q.choix_c, q.bonne_reponse, q.mise_en_situation, q.explication]);
                    }
                }
                console.log("✅ Questions chargées avec succès.");
            } catch (e) {
                console.log("⚠️ Fichier JSON non trouvé ou erreur seed (Normal si 1er déploiement sans fichier data).", e);
            }
        }

        console.log("✅ FORFEO LAB : Prêt.");
    } catch (err) { console.error("Erreur DB:", err); }
}
setupDatabase();

// --- ROUTES BASE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- API IA ---
app.post('/api/chat', async (req, res) => {
    try {
        const userMsg = req.body.message;
        const userId = req.session.userId;
        let context = "Visiteur.";
        if(userId) {
            const user = await pool.query("SELECT nom, role FROM users WHERE id = $1", [userId]);
            context = `User: ${user.rows[0].nom}, Role: ${user.rows[0].role}. `;
        }
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: `${knowledgeBase}\nCtx: ${context}` }, { role: "user", content: userMsg }],
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (err) { res.json({ reply: "Maintenance IA." }); }
});

// --- AUTH ---
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null, userName: null }));
app.post('/login', async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [req.body.email]);
    if (result.rows.length > 0 && await bcrypt.compare(req.body.password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login?error=1');
});
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur', error: null, userName: null }));
app.post('/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/login?msg=ok');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- ADMIN (GESTION UTILISATEURS AJOUTÉE) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const aPayer = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE statut = 'approuve' AND statut_paiement = 'non_paye'");
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER BY m.date_paiement DESC`);
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, paiements: paiements.rows, totalAPayer: aPayer.rows[0].total || 0, userName: req.session.userName });
});
app.post('/admin/delete-user', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    // Suppression en cascade (Attention: supprime aussi missions/rapports liés)
    await pool.query("DELETE FROM users WHERE id = $1", [req.body.user_id]);
    res.redirect('/admin/dashboard?msg=User_Deleted');
});
app.post('/admin/create-user', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [req.body.nom, req.body.email, hash, req.body.role]);
    res.redirect('/admin/dashboard?msg=User_Created');
});
// ... Routes Admin existantes (approbation, etc.) conservées ...
app.post('/admin/approuver-mission', async (req, res) => {
    const mission = await pool.query("SELECT statut FROM missions WHERE id = $1", [req.body.id_mission]);
    let newStatut = 'actif';
    if(mission.rows[0].statut === 'soumis') newStatut = 'approuve';
    await pool.query("UPDATE missions SET statut = $1 WHERE id = $2", [newStatut, req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.post('/admin/payer-ambassadeur', async (req, res) => {
    await pool.query("UPDATE missions SET statut_paiement = 'paye', date_paiement = NOW() WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});
app.get('/admin/rapport/:missionId', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const data = await pool.query(`SELECT r.*, m.titre, m.type_audit, m.client_email, m.id as mission_id, u.nom as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1`, [req.params.missionId]);
    if(data.rows.length === 0) return res.send("Aucun rapport.");
    res.render('admin-rapport-detail', { rapport: data.rows[0], details: data.rows[0].details, userName: req.session.userName });
});

// --- ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const scores = await pool.query(`SELECT u.nom, m.titre, s.* FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE u.entreprise_id = $1`, [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], employeesScores: scores.rows, missions: missions.rows, userName: req.session.userName });
});
// ... Routes Entreprise existantes ...
app.post('/entreprise/creer-audit', async (req, res) => {
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(req.body.adresse)}`;
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, adresse, google_map_link) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, req.body.titre, req.body.type_audit, "Visite terrain.", req.body.recompense, req.body.adresse, mapLink]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/commander-sondage', async (req, res) => {
    await pool.query("INSERT INTO missions (entreprise_id, titre, type_audit, description, recompense, statut, client_nom, client_email) VALUES ($1, $2, $3, $4, $5, 'en_attente', $6, $7)", 
    [req.session.userId, "Sondage : " + req.body.client_nom, req.body.type_sondage, "Enquête client.", req.body.recompense, req.body.client_nom, req.body.client_email]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/supprimer-mission', async (req, res) => {
    await pool.query("DELETE FROM missions WHERE id = $1 AND entreprise_id = $2", [req.body.id_mission, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.post('/entreprise/ajouter-employe', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role, entreprise_id) VALUES ($1, $2, $3, 'employe', $4)", [req.body.email.split('@')[0], req.body.email, hash, req.session.userId]);
    res.redirect('/entreprise/dashboard');
});
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const query = `SELECT r.details, m.titre, m.type_audit, m.created_at, COALESCE(u.nom, 'Ambassadeur') as ambassadeur_nom FROM audit_reports r JOIN missions m ON r.mission_id = m.id LEFT JOIN users u ON r.ambassadeur_id = u.id WHERE m.id = $1 AND m.entreprise_id = $2`;
    const report = await pool.query(query, [req.params.id, req.session.userId]);
    if(report.rows.length === 0) return res.send("Rapport non disponible.");
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.text(`RAPPORT: ${report.rows[0].titre}`);
    const details = report.rows[0].details;
    if (details) { for (const [key, value] of Object.entries(details)) { doc.text(`${key}: ${value}`); } }
    doc.end();
});

// --- AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    const gains = await pool.query("SELECT SUM(CASE WHEN recompense ~ '^[0-9.]+$' THEN CAST(recompense AS NUMERIC) ELSE 0 END) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, totalGains: gains.rows[0].total || 0, userName: req.session.userName });
});
app.post('/ambassadeur/postuler', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});
app.post('/ambassadeur/soumettre-rapport', async (req, res) => {
    const { mission_id, ...reponses } = req.body;
    await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1, $2, $3) ON CONFLICT (mission_id) DO UPDATE SET details = $3", 
        [mission_id, req.session.userId, JSON.stringify(reponses)]);
    await pool.query("UPDATE missions SET statut = 'soumis' WHERE id = $1", [mission_id]);
    res.redirect('/ambassadeur/dashboard');
});

// --- ACADEMIE ---
app.get('/employe/dashboard', async (req, res) => {
    if (req.session.userRole !== 'employe') return res.redirect('/login');
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});
app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});
app.post('/formations/soumettre-quizz', async (req, res) => {
    const questions = await pool.query("SELECT id, reponse_correcte FROM formations_questions WHERE module_id = $1", [req.body.module_id]);
    let score = 0;
    questions.rows.forEach(q => { if (req.body['q' + q.id] === q.reponse_correcte) score++; });
    const statut = score >= 12 ? 'reussi' : 'echec';
    const code = Math.random().toString(36).substring(2, 12).toUpperCase();
    await pool.query(`INSERT INTO formations_scores (user_id, module_id, meilleur_score, tentatives, statut, code_verif) VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT (user_id, module_id) DO UPDATE SET meilleur_score = GREATEST(formations_scores.meilleur_score, EXCLUDED.meilleur_score), tentatives = formations_scores.tentatives + 1, statut = EXCLUDED.statut`, [req.session.userId, req.body.module_id, score, statut, code]);
    res.redirect('/employe/dashboard');
});
app.get('/certificat/:code', async (req, res) => {
    const data = await pool.query("SELECT s.*, u.nom, m.titre FROM formations_scores s JOIN users u ON s.user_id = u.id JOIN formations_modules m ON s.module_id = m.id WHERE s.code_verif = $1", [req.params.code]);
    if(data.rows.length === 0) return res.send("Non trouvé");
    const doc = new PDFDocument({ layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(30).text('CERTIFICAT', {align:'center'});
    doc.text(data.rows[0].nom, {align:'center'});
    doc.end();
});

// --- PROFIL ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    await pool.query("UPDATE users SET nom = $1, email = $2 WHERE id = $3", [req.body.nom, req.body.email, req.session.userId]);
    res.redirect('/profil');
});
app.post('/profil/delete', async (req, res) => {
    await pool.query("DELETE FROM users WHERE id = $1", [req.session.userId]);
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => console.log(`🚀 LIVE`));
