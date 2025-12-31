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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// BANQUE DE QUESTIONS INTÉGRÉE (Résout l'affichage vide des modules)
const QUESTIONS_DATA = [
    {
        id: 1, titre: "Excellence du Service Client", description: "Les bases pour créer un effet WOW.", icon: "bi-emoji-smile", duree: "30 min",
        questions: [
            { q: "Un client entre pendant que vous êtes au téléphone.", sit: "Situation : Vous êtes occupé au téléphone.", a: "L'ignorer", b: "Signe de main et sourire", c: "Raccrocher", rep: "B", expl: "Le contact visuel valide la présence." },
            { q: "Un client régulier arrive.", sit: "Situation : Vous connaissez son nom.", a: "Bonjour", b: "Bonjour M. Tremblay !", c: "Suivant", rep: "B", expl: "La personnalisation fidélise." },
            { q: "Incapable de répondre à une question technique.", sit: "Situation : Produit complexe.", a: "Je sais pas", b: "Je vérifie pour vous", c: "Demandez ailleurs", rep: "B", expl: "Être proactif rassure." }
        ]
    },
    {
        id: 2, titre: "Gestion des Situations Difficiles", description: "Calmer le jeu avec professionnalisme.", icon: "bi-shield-check", duree: "45 min",
        questions: [
            { q: "Client en colère crie.", sit: "Situation : Conflit au comptoir.", a: "Crier aussi", b: "Rester calme et écouter", c: "Partir", rep: "B", expl: "Le calme est contagieux." },
            { q: "Refus de remboursement.", sit: "Situation : Politique stricte de l'entreprise.", a: "Non.", b: "Expliquer + Alternative", c: "Impossible", rep: "B", expl: "Le 'Non, mais...'." }
        ]
    }
];

const knowledgeBase = `Tu es Forfy, IA de Forfeo Lab (Division de FORFEO INC). Tu aides Ambassadeurs, Entreprises et Admins.`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_v23_full_production',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');

// INITIALISATION BDD & RE-SEEDING DES QUESTIONS
async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, nom VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), role VARCHAR(50), entreprise_id INTEGER, forfait VARCHAR(50) DEFAULT 'Freemium', telephone VARCHAR(50), adresse TEXT);
            CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, ambassadeur_id INTEGER, titre VARCHAR(255), type_audit VARCHAR(100), description TEXT, recompense VARCHAR(50), statut VARCHAR(50) DEFAULT 'en_attente', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, client_nom VARCHAR(255), client_email VARCHAR(255), adresse VARCHAR(255), google_map_link TEXT, statut_paiement VARCHAR(50) DEFAULT 'non_paye', date_paiement TIMESTAMP);
            CREATE TABLE IF NOT EXISTS formations_modules (id SERIAL PRIMARY KEY, titre VARCHAR(255), description TEXT, image_icon VARCHAR(50), duree VARCHAR(50));
            CREATE TABLE IF NOT EXISTS formations_questions (id SERIAL PRIMARY KEY, module_id INTEGER, question TEXT, option_a TEXT, option_b TEXT, option_c TEXT, reponse_correcte CHAR(1), mise_en_situation TEXT, explication TEXT);
            CREATE TABLE IF NOT EXISTS formations_scores (id SERIAL PRIMARY KEY, user_id INTEGER, module_id INTEGER, meilleur_score INTEGER DEFAULT 0, tentatives INTEGER DEFAULT 0, statut VARCHAR(50), code_verif VARCHAR(12) UNIQUE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, mission_id INTEGER UNIQUE, ambassadeur_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        `);

        // Force Reload des Questions
        await pool.query("TRUNCATE formations_questions RESTART IDENTITY CASCADE");
        await pool.query("TRUNCATE formations_modules RESTART IDENTITY CASCADE");
        for (const mod of QUESTIONS_DATA) {
            await pool.query(`INSERT INTO formations_modules (id, titre, description, image_icon, duree) VALUES ($1, $2, $3, $4, $5)`, [mod.id, mod.titre, mod.description, mod.icon, mod.duree]);
            for (const q of mod.questions) {
                await pool.query(`INSERT INTO formations_questions (module_id, question, option_a, option_b, option_c, reponse_correcte, mise_en_situation, explication) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [mod.id, q.q, q.a, q.b, q.c, q.rep, q.sit, q.expl]);
            }
        }
        console.log("✅ Système prêt.");
    } catch (err) { console.error(err); }
}
setupDatabase();

// --- ROUTES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/a-propos', (req, res) => res.render('a-propos', { userName: req.session.userName || null }));

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
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// PROFIL COMPLET
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: user.rows[0], userName: req.session.userName, message: req.query.msg || null });
});
app.post('/profil/update', async (req, res) => {
    await pool.query("UPDATE users SET nom = $1, email = $2, telephone = $3, adresse = $4 WHERE id = $5", [req.body.nom, req.body.email, req.body.telephone, req.body.adresse, req.session.userId]);
    if(req.body.new_password) {
        const hash = await bcrypt.hash(req.body.new_password, 10);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hash, req.session.userId]);
    }
    res.redirect('/profil?msg=updated');
});

// ADMIN (TAXES + PDF)
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const paiements = await pool.query(`SELECT m.*, u.nom as ambassadeur_nom FROM missions m LEFT JOIN users u ON m.ambassadeur_id = u.id WHERE m.statut_paiement = 'paye' ORDER m.date_paiement DESC`);
    let brut = 0; paiements.rows.forEach(p => brut += (parseFloat(p.recompense) || 0));
    const tps = brut * 0.05; const tvq = brut * 0.09975;
    res.render('admin-dashboard', { missions: missions.rows, users: users.rows, paiements: paiements.rows, finance: { brut: brut.toFixed(2), tps: tps.toFixed(2), tvq: tvq.toFixed(2), total: (brut + tps + tvq).toFixed(2) }, totalAPayer: 0, userName: req.session.userName });
});

// PDF COMPTABLE ADMIN
app.get('/admin/rapport-comptable', async (req, res) => {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    const logoPath = path.join(__dirname, 'images', 'logo-forfeo.png');
    if(fs.existsSync(logoPath)) doc.image(logoPath, 50, 45, { width: 100 });
    doc.moveDown(5).fontSize(18).text('RAPPORT COMPTABLE DES PAIEMENTS', { align: 'center' });
    doc.end();
});

// AMBASSADEUR
app.get('/ambassadeur/dashboard', async (req, res) => {
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const historique = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, historique: historique.rows, totalGains: 0, userName: req.session.userName });
});
app.post('/ambassadeur/soumettre-rapport', async (req, res) => {
    await pool.query("INSERT INTO audit_reports (mission_id, ambassadeur_id, details) VALUES ($1, $2, $3)", [req.body.mission_id, req.session.userId, JSON.stringify(req.body)]);
    await pool.query("UPDATE missions SET statut = 'soumis' WHERE id = $1", [req.body.mission_id]);
    res.redirect('/ambassadeur/dashboard');
});

// ENTREPRISE (FREEMIUM)
const checkLimit = async (req, res, next) => {
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    if (user.rows[0].forfait === 'Freemium') {
        const count = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        if (parseInt(count.rows[0].count) >= 1) return res.redirect('/entreprise/dashboard?error=limit_atteinte');
    }
    next();
};
app.get('/entreprise/dashboard', async (req, res) => {
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { user: user.rows[0], missions: missions.rows, userName: req.session.userName, error: req.query.error });
});
app.get('/entreprise/upgrade-success', async (req, res) => {
    await pool.query("UPDATE users SET forfait = 'Pro' WHERE id = $1", [req.session.userId]);
    res.redirect('/entreprise/dashboard');
});

// PDF ENTREPRISE
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const report = await pool.query(`SELECT r.details, m.titre FROM audit_reports r JOIN missions m ON r.mission_id = m.id WHERE m.id = $1`, [req.params.id]);
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    const logoPath = path.join(__dirname, 'images', 'logo-forfeo.png');
    if(fs.existsSync(logoPath)) doc.image(logoPath, 50, 45, { width: 100 });
    doc.moveDown(5).fontSize(20).text('RAPPORT FORFEO LAB', { align: 'center' });
    doc.fontSize(10).text("Merci d'avoir choisi Forfeo Lab, une division de FORFEO INC. Ce rapport a été préparé par un ambassadeur sélectionné avec rigueur.", { align: 'center' });
    doc.end();
});

// EMPLOYÉ
app.get('/employe/dashboard', async (req, res) => {
    const modules = await pool.query("SELECT * FROM formations_modules ORDER BY id ASC");
    const scores = await pool.query("SELECT * FROM formations_scores WHERE user_id = $1", [req.session.userId]);
    res.render('employe-dashboard', { modules: modules.rows, scores: scores.rows, userName: req.session.userName });
});
app.get('/formations/module/:id', async (req, res) => {
    const module = await pool.query("SELECT * FROM formations_modules WHERE id = $1", [req.params.id]);
    const questions = await pool.query("SELECT * FROM formations_questions WHERE module_id = $1 ORDER BY id ASC", [req.params.id]);
    res.render('formation-detail', { module: module.rows[0], questions: questions.rows, userName: req.session.userName });
});

app.listen(port, () => console.log('🚀 LIVE'));
