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

// INITIALISATION ET AUTO-PROMOTION ADMIN
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, nom TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
                ville TEXT, password TEXT NOT NULL, role TEXT DEFAULT 'ambassadeur'
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES users(id),
                titre TEXT NOT NULL, description TEXT, recompense TEXT, statut TEXT DEFAULT 'disponible'
            );
            CREATE TABLE IF NOT EXISTS candidatures (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), statut TEXT DEFAULT 'en_attente'
            );
        `);
        await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", ['forfeo2005@gmail.com']);
    } catch (err) { console.error(err); }
};
initDb();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));

// --- ROUTES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- LOGIQUE INSCRIPTIONS (CORRIGÉES) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom, email, ville, hash, 'ambassadeur']);
        res.redirect('/login');
    } catch (err) { res.send("Erreur inscription ambassadeur"); }
});

app.post('/signup-entreprise', async (req, res) => {
    const { nom_entreprise, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom_entreprise, email, ville, hash, 'entreprise']);
        res.redirect('/login');
    } catch (err) { res.send("Erreur inscription entreprise"); }
});

// --- DASHBOARDS ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const cand = await pool.query(`
        SELECT c.id, m.titre, u.nom as ambassadeur, c.statut 
        FROM candidatures c 
        JOIN missions m ON c.mission_id = m.id 
        JOIN users u ON c.ambassadeur_id = u.id 
        WHERE c.statut = 'en_attente'`);
    const ent = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { candidatures: cand.rows, entreprises: ent.rows });
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const result = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: result.rows });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const result = await pool.query("SELECT * FROM missions WHERE statut = 'disponible'");
    res.render('ambassadeur-dashboard', { missions: result.rows });
});

// --- ACTIONS MISSIONS ---
app.post('/postuler-mission', async (req, res) => {
    await pool.query("INSERT INTO candidatures (mission_id, ambassadeur_id) VALUES ($1, $2)", [req.body.missionId, req.session.userId]);
    res.redirect('/ambassadeur/dashboard');
});

app.post('/admin/approuver', async (req, res) => {
    const { id } = req.body;
    await pool.query("UPDATE candidatures SET statut = 'approuvée' WHERE id = $1", [id]);
    res.redirect('/admin/dashboard');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userRole = result.rows[0].role;
        if (result.rows[0].role === 'admin') return res.redirect('/admin/dashboard');
        if (result.rows[0].role === 'entreprise') return res.redirect('/entreprise/dashboard');
        return res.redirect('/ambassadeur/dashboard');
    }
    res.send("Identifiants incorrects");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Forfeo actif sur port ${port}`));
