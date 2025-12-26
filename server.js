const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Connexion à la base de données Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialisation automatique des tables
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
            CREATE TABLE IF NOT EXISTS rapports (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), contenu TEXT, note INTEGER, 
                date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Promotion de votre compte admin
        await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", ['forfeo2005@gmail.com']);
        console.log("✅ Système initialisé.");
    } catch (err) { console.error(err); }
};
initDb();

// Configuration Middleware
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_secure_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- LOGIQUE D'INSCRIPTION ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom, email, ville, hash, 'ambassadeur']);
        res.redirect('/login');
    } catch (err) { res.send("Erreur d'inscription."); }
});

app.post('/signup-entreprise', async (req, res) => {
    const { nom_entreprise, email, ville, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (nom, email, ville, password, role) VALUES ($1, $2, $3, $4, $5)', [nom_entreprise, email, ville, hash, 'entreprise']);
        res.redirect('/login');
    } catch (err) { res.send("Erreur d'inscription entreprise."); }
});

// --- CONNEXION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
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
    } catch (err) { res.status(500).send("Erreur serveur."); }
});

// --- DASHBOARDS ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const cand = await pool.query(`SELECT c.id, m.titre, u.nom as ambassadeur, c.statut FROM candidatures c JOIN missions m ON c.mission_id = m.id JOIN users u ON c.ambassadeur_id = u.id WHERE c.statut = 'en_attente'`);
    const ent = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { candidatures: cand.rows, entreprises: ent.rows });
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        const rapports = await pool.query(`SELECT r.*, m.titre, u.nom as ambassadeur FROM rapports r JOIN missions m ON r.mission_id = m.id JOIN users u ON r.ambassadeur_id = u.id WHERE m.entreprise_id = $1`, [req.session.userId]);
        res.render('entreprise-dashboard', { missions: missions.rows, rapports: rapports.rows });
    } catch (err) { res.status(500).send("Erreur Dashboard Entreprise"); }
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const dispos = await pool.query("SELECT * FROM missions WHERE statut = 'disponible'");
    const mes_missions = await pool.query(`SELECT m.*, c.statut as etat_cand FROM missions m JOIN candidatures c ON m.id = c.mission_id WHERE c.ambassadeur_id = $1`, [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: dispos.rows, mes_missions: mes_missions.rows });
});

// --- ACTIONS ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

app.post('/postuler-mission', async (req, res) => {
    await pool.query("INSERT INTO candidatures (mission_id, ambassadeur_id) VALUES ($1, $2)", [req.body.missionId, req.session.userId]);
    res.redirect('/ambassadeur/dashboard');
});

app.post('/soumettre-rapport', async (req, res) => {
    const { mission_id, contenu, note } = req.body;
    await pool.query("INSERT INTO rapports (mission_id, ambassadeur_id, contenu, note) VALUES ($1, $2, $3, $4)", [mission_id, req.session.userId, contenu, note]);
    res.redirect('/ambassadeur/dashboard');
});

app.post('/admin/approuver', async (req, res) => {
    await pool.query("UPDATE candidatures SET statut = 'approuvée' WHERE id = $1", [req.body.id]);
    res.redirect('/admin/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Port ${port} actif`));
