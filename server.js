const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const PDFDocument = require('pdfkit'); // Nécessaire pour les rapports
require('dotenv').config();

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_final_production_2025',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { error: null, msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DASHBOARD ENTREPRISE (AVEC PDF) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

// GÉNÉRATION DU RAPPORT PDF
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
        const mission = result.rows[0];
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rapport_${mission.id}.pdf`);
        doc.pipe(res);
        doc.fontSize(20).text('RAPPORT D\'AUDIT - FORFEO LAB', { align: 'center' });
        doc.moveDown().fontSize(12).text(`Mission : ${mission.titre}`);
        doc.text(`Statut final : ${mission.statut}`);
        doc.text(`Date de complétion : ${new Date().toLocaleDateString()}`);
        doc.moveDown().text('Commentaire de l\'expert : Audit conforme aux standards de qualité Forfeo.');
        doc.end();
    } catch (err) { res.status(500).send("Erreur PDF"); }
});

// --- CONSOLE ADMIN (AVEC APPROBATION) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.statut DESC");
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, userName: req.session.userName });
});

// ACTION APPROUVER MISSION
app.post('/admin/approuver-mission', async (req, res) => {
    const { id_mission } = req.body;
    await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [id_mission]);
    res.redirect('/admin/dashboard');
});

app.listen(process.env.PORT || 10000);
