const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration OpenAI sécurisée
const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ROUTE ACCUEIL (Répare le "Cannot GET /")
app.get('/', async (req, res) => {
    try {
        let userName = null;
        if (req.session.userId) {
            const u = await pool.query("SELECT nom FROM users WHERE id = $1", [req.session.userId]);
            userName = u.rows[0]?.nom;
        }
        res.render('index', { userName });
    } catch (err) {
        res.status(500).send("Erreur de rendu de la page d'accueil");
    }
});

// ROUTE FORFY CHAT
app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: "Tu es Forfy, l'IA de FORFEO LAB." }, { role: "user", content: message }],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) {
        res.json({ answer: "Désolé, j'ai une erreur de connexion à mon cerveau !" });
    }
});

// Dashboard Entreprise
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: true, userName: user.rows[0].nom });
});

app.listen(port, () => console.log(`🚀 Serveur Live sur ${port}`));
