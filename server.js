const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium'");
        console.log("✅ Base de données synchronisée.");
    } catch (e) { console.log("DB déjà à jour."); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- NAVIGATION PRINCIPALE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query("SELECT SUM(recompense::numeric) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
        res.render('ambassadeur-dashboard', { 
            missions: disponibles.rows, 
            userName: req.session.userName,
            totalGains: gains.rows[0].total || 0
        });
    } catch (err) { res.status(500).send("Erreur Dashboard"); }
});

// --- PAGE MES MISSIONS (QUESTIONNAIRE DYNAMIQUE) ---
app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const mesMissions = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
        res.render('ambassadeur-missions', { missions: mesMissions.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur Mes Missions"); }
});

// --- ACTIONS MISSIONS ---
app.post('/postuler-mission', async (req, res) => {
    try {
        await pool.query("UPDATE missions SET statut = 'reserve', ambassadeur_id = $1 WHERE id = $2", [req.session.userId, req.body.id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur réservation"); }
});

app.post('/envoyer-rapport', async (req, res) => {
    const { id_mission, feedback_general, ...reponses } = req.body;
    // On compile les réponses du questionnaire dynamique en un texte structuré
    let rapportCompile = "RÉSULTATS DU QUESTIONNAIRE :\n";
    for (const [key, value] of Object.entries(reponses)) {
        rapportCompile += `- ${key} : ${value}\n`;
    }
    rapportCompile += `\nFEEDBACK GÉNÉRAL :\n${feedback_general}`;

    try {
        await pool.query("UPDATE missions SET rapport_final = $1, statut = 'termine' WHERE id = $2", [rapportCompile, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur envoi rapport"); }
});

// --- DASHBOARD ENTREPRISE & ADMIN (PRÉSERVÉS) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    const stats = { totale: missions.rows.length, enCours: missions.rows.filter(m => m.statut === 'actif' || m.statut === 'reserve').length, termine: missions.rows.filter(m => m.statut === 'termine' || m.statut === 'approuve').length, totalInvesti: missions.rows.reduce((acc, m) => acc + (parseFloat(m.recompense) || 0), 0), forfait: user.rows[0]?.forfait || 'Freemium' };
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, stats: stats });
});

app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense, type_mission, criteres } = req.body;
    const descAction = `TYPE : ${type_mission}\nCRITÈRES : ${Array.isArray(criteres) ? criteres.join('|') : criteres}\n---\n${description}`;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", [req.session.userId, titre, descAction, recompense]);
    res.redirect('/entreprise/dashboard');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB sur port ${port}`));
