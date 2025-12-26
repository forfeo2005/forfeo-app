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

// INITIALISATION AVEC SYSTÈME DE QUOTA
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, nom TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
                ville TEXT, password TEXT NOT NULL, role TEXT DEFAULT 'ambassadeur',
                is_premium BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                titre TEXT NOT NULL, description TEXT, recompense TEXT,
                statut TEXT DEFAULT 'disponible', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS candidatures (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE,
                ambassadeur_id INTEGER REFERENCES users(id) ON DELETE CASCADE, statut TEXT DEFAULT 'en_attente'
            );
            CREATE TABLE IF NOT EXISTS rapports (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE,
                ambassadeur_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                contenu TEXT, note INTEGER, date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Correction : Ajout de is_premium si la table users existait déjà sans
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE");
        // Forcer votre compte en Admin
        await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", ['forfeo2005@gmail.com']);
        console.log("✅ Base Forfeo synchronisée avec système Premium.");
    } catch (err) { console.error(err); }
};
initDb();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_freemium_2025',
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

// CRÉATION DE MISSION AVEC GESTION DE LA MISSION GRATUITE
app.post('/creer-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.status(403).send("Accès refusé");
    
    try {
        const userCheck = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
        const missionCount = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
        
        const count = parseInt(missionCount.rows[0].count);
        const isPremium = userCheck.rows[0].is_premium;

        // Si l'utilisateur n'est pas premium et a déjà utilisé sa mission gratuite
        if (!isPremium && count >= 1) {
            return res.send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px; color:#1e293b;">
                    <h2 style="color:#2563eb;">Mission gratuite terminée !</h2>
                    <p>Vous avez utilisé votre audit de bienvenue. Abonnez-vous pour débloquer des audits illimités.</p>
                    <br>
                    <a href="/#forfaits" style="background:#2563eb; color:white; padding:12px 25px; text-decoration:none; border-radius:50px; font-weight:bold;">Voir les abonnements</a>
                    <p style="margin-top:20px;"><a href="/entreprise/dashboard" style="color:#64748b;">Retour au tableau de bord</a></p>
                </div>
            `);
        }

        const { titre, description, recompense } = req.body;
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", [req.session.userId, titre, description, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

// DASHBOARDS
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    const user = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: user.rows[0].is_premium, rapports: [] });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const cand = await pool.query(`SELECT c.id, m.titre, u.nom as ambassadeur, c.statut FROM candidatures c JOIN missions m ON c.mission_id = m.id JOIN users u ON c.ambassadeur_id = u.id WHERE c.statut = 'en_attente'`);
    const entreprises = await pool.query("SELECT id, nom, email, is_premium FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { candidatures: cand.rows, entreprises: entreprises.rows });
});

app.post('/admin/set-premium', async (req, res) => {
    await pool.query("UPDATE users SET is_premium = $1 WHERE id = $2", [req.body.status === 'true', req.body.userId]);
    res.redirect('/admin/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Forfeo actif sur port ${port}`));
