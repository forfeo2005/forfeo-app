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

// --- NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.send("<script>alert('Erreur'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
        
        const stats = {
            totale: missions.rows.length,
            enCours: missions.rows.filter(m => m.statut === 'actif' || m.statut === 'reserve').length,
            termine: missions.rows.filter(m => m.statut === 'termine' || m.statut === 'approuve').length,
            totalInvesti: missions.rows.reduce((acc, m) => acc + (parseFloat(m.recompense) || 0), 0),
            forfait: user.rows[0]?.forfait || 'Freemium'
        };

        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: req.session.userName,
            stats: stats
        });
    } catch (err) { res.status(500).send("Erreur Dashboard"); }
});

// --- CRÉATION DE MISSION ENRICHIE ---
app.post('/creer-mission', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.status(403).send("Accès refusé");
    const { titre, description, recompense, type_mission, criteres } = req.body;
    const listeCriteres = Array.isArray(criteres) ? criteres.join(', ') : (criteres || 'Standard');
    
    const descriptionComplete = `TYPE : ${type_mission}\nCRITÈRES : ${listeCriteres}\n---\nDETAILS : ${description}`;

    try {
        await pool.query(
            "INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", 
            [req.session.userId, titre, descriptionComplete, recompense]
        );
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur création"); }
});

// --- TÉLÉCHARGEMENT PDF ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1", [req.params.id]);
        const mission = result.rows[0];
        const doc = new PDFDocument();
        res.setHeader('Content-disposition', `attachment; filename="Rapport_${req.params.id}.pdf"`);
        doc.fontSize(20).text('FORFEO LAB - RAPPORT QUALITÉ', { align: 'center' });
        doc.moveDown().fontSize(12).text(`Entreprise: ${mission.entreprise_nom}\nMission: ${mission.titre}\n\n${mission.rapport_final}`);
        doc.pipe(res);
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
