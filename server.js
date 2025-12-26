const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_final_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// --- ROUTES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        const user = result.rows[0];
        req.session.userId = user.id;
        req.session.userRole = user.role;
        if (user.role === 'admin') return res.redirect('/admin/dashboard');
        if (user.role === 'entreprise') return res.redirect('/entreprise/dashboard');
        return res.redirect('/ambassadeur/dashboard');
    }
    res.send("Email ou mot de passe incorrect.");
});

app.post('/signup-entreprise', async (req, res) => {
    const { nom_entreprise, email, ville, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom_entreprise, email, ville, hash, 'entreprise']);
    res.redirect('/login');
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    const rapports = await pool.query(`SELECT r.*, m.titre, u.nom as ambassadeur FROM rapports r JOIN missions m ON r.mission_id = m.id JOIN users u ON r.ambassadeur_id = u.id WHERE m.entreprise_id = $1`, [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, rapports: rapports.rows });
});

app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const cand = await pool.query(`SELECT c.id, m.titre, u.nom as ambassadeur, c.statut FROM candidatures c JOIN missions m ON c.mission_id = m.id JOIN users u ON c.ambassadeur_id = u.id WHERE c.statut = 'en_attente'`);
    res.render('admin-dashboard', { candidatures: cand.rows });
});

app.post('/admin/approuver', async (req, res) => {
    await pool.query("UPDATE candidatures SET statut = 'approuvée' WHERE id = $1", [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Forfeo actif sur port ${port}`));
