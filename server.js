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
    secret: 'forfeo_ultra_secure_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
}));

app.set('view engine', 'ejs');

// --- MIDDLEWARE DE PROTECTION ---
const checkAuth = (role) => (req, res, next) => {
    if (req.session.userId && req.session.userRole === role) return next();
    res.redirect('/login?error=Accès refusé');
};

// --- ROUTES PUBLIQUES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', checkAuth('admin'), async (req, res) => {
    const users = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const missions = await pool.query("SELECT * FROM missions ORDER BY id DESC");
    res.render('admin-dashboard', { 
        users: users.rows, 
        missions: missions.rows, 
        userName: req.session.userName 
    });
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', checkAuth('entreprise'), async (req, res) => {
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { 
        missions: missions.rows, 
        userName: req.session.userName 
    });
});

// --- DASHBOARD AMBASSADEUR (CORRECTIF CRASH NUMERIC) ---
app.get('/ambassadeur/dashboard', checkAuth('ambassadeur'), async (req, res) => {
    const missionsDispo = await pool.query("SELECT * FROM missions WHERE statut = 'actif'");
    
    // Nettoyage SQL : On enlève tout ce qui n'est pas un chiffre avant de sommer
    const gainsQuery = `
        SELECT SUM(CAST(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g') AS NUMERIC)) as total 
        FROM missions 
        WHERE ambassadeur_id = $1 AND statut = 'approuve'`;
    
    const gainsResult = await pool.query(gainsQuery, [req.session.userId]);
    
    res.render('ambassadeur-dashboard', { 
        missions: missionsDispo.rows, 
        userName: req.session.userName, 
        totalGains: gainsResult.rows[0].total || 0 
    });
});

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
