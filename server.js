const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const PDFDocument = require('pdfkit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- MIDDLEWARES ---
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_2025_prod_key',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('register', { role: 'ambassadeur' })); // Fix Bouton Blanc
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- GESTION DES MISSIONS & RÉSERVATION (Fix Bouton Statique) ---
app.post('/postuler-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur de réservation"); }
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
        res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur de chargement"); }
});

// --- DASHBOARD ADMIN (Fix Approbation) ---
app.post('/admin/approuver-mission', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET statut = 'approuve', date_approbation = NOW() WHERE id = $1", [id_mission]);
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send("Erreur d'approbation"); }
});

// --- GÉNÉRATION PDF (Fix PDF Statiques) ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
        const mission = result.rows[0];
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rapport_${mission.id}.pdf`);
        doc.pipe(res);
        doc.fontSize(25).text('Rapport d\'Audit FORFEO LAB', { align: 'center' });
        doc.moveDown().fontSize(14).text(`Mission: ${mission.titre}`);
        doc.text(`Statut: ${mission.statut}`);
        doc.text(`Récompense: ${mission.recompense}`);
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur port ${port}`));
