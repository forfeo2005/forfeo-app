const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- INITIALISATION DB ---
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        console.log("✅ FORFEO LAB : Système de routes et session prêt");
    } catch (e) { console.error(e); }
}
initDB();

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_final_safe_key_2025',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (FIX CANNOT GET /REGISTER) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur' }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));

// --- ROUTES UTILISATEURS ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], message: req.query.msg || null, userName: req.session.userName });
});

// --- DASHBOARDS ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query(`SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0, showWelcome: false });
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { 
        missions: missions.rows, userName: req.session.userName, showWelcome: false,
        stats: { forfait: user.rows[0].forfait || 'Freemium', canPublish: true }
    });
});

// --- GÉNÉRATION PDF (FIX CANNOT GET /entreprise/telecharger-rapport/:id) ---
app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send("Mission non trouvée");
        
        const mission = result.rows[0];
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rapport_Audit_${mission.id}.pdf`);
        
        doc.pipe(res);
        doc.fontSize(20).text('RAPPORT D\'AUDIT - FORFEO LAB', { align: 'center' });
        doc.moveDown().fontSize(12).text(`Titre: ${mission.titre}`);
        doc.text(`Statut: ${mission.statut}`);
        doc.text(`Rémunération: ${mission.recompense}`);
        doc.moveDown().text('Commentaires: Mission validée avec succès par l\'expert Forfeo.');
        doc.end();
    } catch (err) { res.status(500).send("Erreur lors de la génération du PDF"); }
});

// --- ACTIONS POST ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
    res.redirect('/login?msg=Compte créé avec succès !');
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
    res.redirect('/login?msg=Erreur identifiants');
});

app.post('/postuler-mission', async (req, res) => {
    const { id_mission } = req.body;
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, id_mission]);
    res.redirect('/ambassadeur/mes-missions');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB opérationnel sur port ${port}`));
