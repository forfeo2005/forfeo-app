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
    secret: 'forfeo_2025_final_prod_key',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Fix "Cannot GET") ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register', { role: req.query.role || 'ambassadeur' }));
app.get('/login', (req, res) => res.render('login', { error: req.query.error || null, msg: req.query.msg || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- TRAITEMENT AUTH (Fix "Cannot POST") ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login?msg=Compte créé avec succès');
    } catch (err) { res.redirect('/register?error=Email déjà utilisé'); }
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
    res.redirect('/login?error=Identifiants invalides');
});

// --- DASHBOARD ADMIN (Approbation & Gestion) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    res.render('admin-dashboard', { users: users.rows, missions: missions.rows, userName: req.session.userName });
});

app.post('/admin/approuver-mission', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.status(403).send("Refusé");
    await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

// --- DASHBOARD ENTREPRISE (PDF & Stats) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

app.get('/entreprise/telecharger-rapport/:id', async (req, res) => {
    const result = await pool.query("SELECT * FROM missions WHERE id = $1", [req.params.id]);
    const mission = result.rows[0];
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Rapport_${mission.id}.pdf`);
    doc.pipe(res);
    doc.fontSize(20).text('RAPPORT D\'AUDIT - FORFEO LAB', { align: 'center' });
    doc.moveDown().text(`Mission: ${mission.titre} | Statut: ${mission.statut}`);
    doc.end();
});

// --- DASHBOARD AMBASSADEUR (Gains & Réservation) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    const gains = await pool.query("SELECT SUM(CAST(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g') AS NUMERIC)) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: missions.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0 });
});

app.post('/postuler-mission', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB Live sur port ${port}`));
