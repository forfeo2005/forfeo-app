const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration OpenAI avec votre clé fournie
const openai = new OpenAI({ 
    apiKey: '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' 
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Auto-réparation DB pour éviter les colonnes manquantes
async function initDB() {
    try {
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nom VARCHAR(100)");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        console.log("DB Synchronisée");
    } catch (e) { console.log("DB déjà à jour"); }
}
initDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- CERVEAU DE FORFY ---
app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "Tu es Forfy, l'assistant intelligent de FORFEO LAB. Réponds de façon amicale." },
                { role: "user", content: message }
            ],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) {
        res.json({ answer: "Désolé, j'ai une erreur de connexion à mon cerveau !" });
    }
});

// --- NAVIGATION & DASHBOARD (DESIGN RESTAURÉ) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { 
        missions: missions.rows, 
        userName: user.rows[0]?.nom || "Utilisateur", 
        isPremium: true 
    });
});

// Suppression des rapports
app.post('/admin/supprimer-rapport', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    await pool.query("DELETE FROM missions WHERE id = $1", [req.body.id_mission]);
    res.redirect('/admin/dashboard');
});

app.listen(port, () => console.log(`Serveur Live sur ${port}`));
