const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration Base de Données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'forfeo_secret_key',
    resave: false,
    saveUninitialized: false
}));
app.set('view engine', 'ejs');

// --- ROUTES IA FORFY ---
app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "Tu es Forfy, le petit chien mascotte de FORFEO LAB. Tu es amical, serviable et tu réponds en français." },
                { role: "user", content: message }
            ],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.json({ answer: "Désolé, j'ai une petite panne de cerveau. Réessaie !" });
    }
});

// --- DASHBOARD ENTREPRISE (DESIGN RESTAURÉ) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: user.rows[0].nom,
            isPremium: true // On force le statut premium pour le design
        });
    } catch (err) {
        res.send("Erreur de chargement du dashboard.");
    }
});

// --- CRÉATION DE MISSION ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense } = req.body;
    try {
        await pool.query(
            "INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')",
            [req.session.userId, titre, description, recompense]
        );
        res.redirect('/entreprise/dashboard');
    } catch (err) {
        res.send("Erreur lors de la création.");
    }
});

// --- ADMIN : SUPPRESSION (Fix erreur Cannot POST) ---
app.post('/admin/supprimer-rapport', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const { id_mission } = req.body;
    try {
        await pool.query("DELETE FROM missions WHERE id = $1", [id_mission]);
        res.redirect('/admin/dashboard');
    } catch (err) {
        res.send("Erreur de suppression.");
    }
});

app.listen(port, () => console.log(`🚀 Forfeo App tourne sur le port ${port}`));
