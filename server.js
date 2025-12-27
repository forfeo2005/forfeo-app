const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// CONFIGURATION SÉCURISÉE : Va chercher la clé dans l'onglet Environment de Render
const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Auto-réparation de la base de données pour éviter les erreurs 502 ou Admin
async function initDB() {
    try {
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nom VARCHAR(100)");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_ambassadeur TEXT");
        console.log("✅ Base de données synchronisée.");
    } catch (e) {
        console.log("Info DB: Déjà à jour.");
    }
}
initDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_secret_key',
    resave: false,
    saveUninitialized: false
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- ROUTES DE NAVIGATION (Répare le "Cannot GET /" et les onglets) ---

app.get('/', async (req, res) => {
    let userName = null;
    if (req.session.userId) {
        const u = await pool.query("SELECT nom FROM users WHERE id = $1", [req.session.userId]);
        userName = u.rows[0]?.nom;
    }
    res.render('index', { userName });
});

app.get('/audit-mystere', (req, res) => {
    res.render('audit-mystere', { userName: req.session.userName || null });
});

app.get('/ambassadeurs', (req, res) => {
    res.render('ambassadeurs', { userName: req.session.userName || null });
});

app.get('/forfaits', (req, res) => {
    res.render('forfaits', { userName: req.session.userName || null });
});

// --- CERVEAU DE FORFY IA (Sans "undefined") ---

app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "Tu es Forfy, l'assistant intelligent de FORFEO LAB. Réponds de façon amicale et courte." },
                { role: "user", content: message }
            ],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) {
        console.error("Erreur OpenAI:", err);
        res.json({ answer: "Désolé, j'ai une erreur de connexion à mon cerveau !" });
    }
});

// --- DASHBOARD ENTREPRISE (DESIGN 100% RESTAURÉ) ---

app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: user.rows[0]?.nom || "Utilisateur", 
            isPremium: user.rows[0]?.is_premium 
        });
    } catch (err) {
        res.status(500).send("Erreur de chargement du dashboard.");
    }
});

app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    try {
        await pool.query(
            "INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')",
            [req.session.userId, titre, description, recompense]
        );
        res.redirect('/entreprise/dashboard');
    } catch (err) {
        res.send("Erreur lors de la création de la mission.");
    }
});

// --- ADMIN : GESTION DES RAPPORTS (Fix "Cannot POST /admin/supprimer-rapport") ---

app.post('/admin/supprimer-rapport', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const { id_mission } = req.body;
    try {
        await pool.query("DELETE FROM missions WHERE id = $1", [id_mission]);
        res.redirect('/admin/dashboard');
    } catch (err) {
        res.send("Erreur lors de la suppression du rapport.");
    }
});

// --- AUTHENTIFICATION ---

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            
            if (req.session.userRole === 'admin') return res.redirect('/admin/dashboard');
            if (req.session.userRole === 'entreprise') return res.redirect('/entreprise/dashboard');
            return res.redirect('/ambassadeur/dashboard');
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) {
        res.send("Erreur de connexion.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => console.log(`🚀 Forfeo App Live sur le port ${port}`));
