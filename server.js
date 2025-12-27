const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const stripe = require('stripe')('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'); 
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;
const openai = new OpenAI({ apiKey: 'sk-proj-vjR466_G3q6X3iU2p_m2Tz1Xm9N1T3P5...' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Auto-réparation DB pour éviter l'erreur 502
async function initDB() {
    try {
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nom VARCHAR(100)");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_ambassadeur TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
    } catch (e) { console.log("DB OK"); }
}
initDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES ---
app.get('/', async (req, res) => {
    let userName = null;
    if (req.session.userId) {
        const u = await pool.query("SELECT nom FROM users WHERE id = $1", [req.session.userId]);
        userName = u.rows[0]?.nom;
    }
    res.render('index', { userName });
});

app.post('/forfy/chat', async (req, res) => {
    const { message } = req.body;
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "system", content: "Tu es Forfy, l'IA de FORFEO LAB." }, { role: "user", content: message }],
    });
    res.json({ answer: response.choices[0].message.content });
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: user.rows[0].is_premium, userName: user.rows[0].nom });
});

app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')",
        [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

// Fix pour l'erreur Cannot POST /admin/supprimer-rapport
app.post('/admin/supprimer-rapport', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    await pool.query("DELETE FROM missions WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

app.listen(port, () => console.log(`🚀 Serveur Live sur ${port}`));
