const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
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
    secret: 'forfeo_2025_final_fix',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Correction des "Cannot GET") ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));

app.get('/register', (req, res) => {
    res.render('register', { role: req.query.role || 'ambassadeur', error: null });
});

app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error || null, msg: req.query.msg || null });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/politique-confidentialite', (req, res) => res.render('politique-confidentialite', { userName: req.session.userName || null }));
app.get('/conditions-utilisation', (req, res) => res.render('conditions-utilisation', { userName: req.session.userName || null }));

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login?error=Acces refuse');
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    res.render('admin-dashboard', { users: users.rows, userName: req.session.userName });
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

// --- DASHBOARD AMBASSADEUR (Correction crash Numeric) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    
    // Nettoyage SQL pour permettre le calcul même avec le symbole "$"
    const gainsQuery = `
        SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total 
        FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`;
    
    const gainsResult = await pool.query(gainsQuery, [req.session.userId]);
    res.render('ambassadeur-dashboard', { 
        missions: missions.rows, 
        userName: req.session.userName, 
        totalGains: gainsResult.rows[0].total || 0 
    });
});

app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], message: req.query.msg || null, userName: req.session.userName });
});

// --- TRAITEMENTS POST ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login?msg=Compte cree');
    } catch (err) { res.redirect('/register?error=Erreur'); }
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
    res.redirect('/login?error=Invalide');
});

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
