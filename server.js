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

// --- INITIALISATION ET RÉPARATION DB ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium'");
        console.log("✅ Base de données à jour.");
    } catch (e) { console.log("DB déjà synchronisée."); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// --- AUTHENTIFICATION ---
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

// --- DASHBOARD ENTREPRISE AMÉLIORÉ ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
        
        // Calcul des statistiques
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

// --- AUTRES ROUTES DASHBOARDS (ADMIN & AMBASSADEUR) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    const rapports = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows, userName: req.session.userName });
});

// --- ACTIONS MISSIONS ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    try {
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", 
        [req.session.userId, titre, description, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur création"); }
});

// --- GÉNÉRATION PDF ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const result = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.id = $1", [req.params.id]);
        const mission = result.rows[0];
        const doc = new PDFDocument();
        res.setHeader('Content-disposition', `attachment; filename="Rapport_${req.params.id}.pdf"`);
        doc.fontSize(25).text('FORFEO LAB - Rapport d\'Audit', { align: 'center' });
        doc.moveDown().fontSize(12).text(`Entreprise: ${mission.entreprise_nom}`);
        doc.text(`Mission: ${mission.titre}`);
        doc.moveDown().text(mission.rapport_final);
        doc.pipe(res);
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

app.listen(port, () => console.log(`🚀 Port ${port}`));
