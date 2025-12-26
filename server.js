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

// Initialisation et Promotion Admin (forfeo2005@gmail.com)
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nom TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
                ville TEXT, password TEXT NOT NULL,
                role TEXT DEFAULT 'ambassadeur',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER REFERENCES users(id),
                titre TEXT NOT NULL, description TEXT,
                recompense TEXT, statut TEXT DEFAULT 'disponible',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", ['forfeo2005@gmail.com']);
        console.log("✅ Système initialisé.");
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
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// PORTAIL ENTREPRISE : Voir ses missions
app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY created_at DESC", [req.session.userId]);
        res.render('entreprise-dashboard', { missions: result.rows });
    } catch (err) { res.status(500).send("Erreur Dashboard"); }
});

// ACTION : Créer une mission
app.post('/creer-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.status(403).send("Non autorisé");
    const { titre, description, recompense } = req.body;
    try {
        await pool.query(
            "INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)",
            [req.session.userId, titre, description, recompense]
        );
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur création mission"); }
});

// LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (await bcrypt.compare(password, user.password)) {
                req.session.userId = user.id;
                req.session.userRole = user.role;
                if (user.role === 'admin') res.redirect('/admin/dashboard');
                else if (user.role === 'entreprise') res.redirect('/entreprise/dashboard');
                else res.redirect('/ambassadeur/dashboard');
            } else res.send("Erreur");
        } else res.send("Non trouvé");
    } catch (err) { res.send("Erreur"); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Port ${port}`));
