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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/contact', (req, res) => res.render('contact', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// --- AUTHENTIFICATION ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur lors de l'inscription"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur de connexion"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARDS (Fix Cannot GET /admin/dashboard et /ambassadeur/dashboard) ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut IS NULL");
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    const rapports = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id");
    res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows });
});

// --- MISSIONS (Fix Cannot POST /creer-mission) ---
app.post('/creer-mission', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.status(403).send("Non autorisé");
    const { titre, description, recompense } = req.body;
    try {
        await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')", 
        [req.session.userId, titre, description, recompense]);
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur de création de mission"); }
});

// --- FORFY CHAT ---
app.post('/forfy/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: "Tu es Forfy, l'IA de FORFEO LAB au Québec." }, { role: "user", content: message }],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) { res.status(500).json({ answer: "Désolé, Forfy a un problème technique." }); }
});

app.listen(port, () => console.log(`🚀 Serveur actif sur ${port}`));
