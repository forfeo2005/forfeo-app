const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- RÉPARATION AUTO DE LA BASE DE DONNÉES ---
async function patchDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        console.log("✅ Base de données vérifiée et mise à jour.");
    } catch (e) {
        console.log("DB déjà à jour ou erreur mineure de structure.");
    }
}
patchDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Correction des erreurs Cannot GET) ---
// Ces routes permettent d'afficher les pages correspondantes
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
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
        res.send("<script>alert('Erreur de connexion'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARDS ET MISSIONS ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut IS NULL");
        res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur dashboard"); }
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
        res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur lors de la récupération de vos missions."); }
});

app.post('/postuler-mission', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET statut = 'reserve', ambassadeur_id = $1 WHERE id = $2", [req.session.userId, id_mission]);
        res.send("<script>alert('Mission réservée avec succès !'); window.location.href='/ambassadeur/mes-missions';</script>");
    } catch (err) { res.status(500).send("Erreur lors de la réservation."); }
});

app.post('/envoyer-rapport', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission, rapport } = req.body;
    try {
        await pool.query("UPDATE missions SET rapport_final = $1, statut = 'termine' WHERE id = $2 AND ambassadeur_id = $3", [rapport, id_mission, req.session.userId]);
        res.send("<script>alert('Rapport envoyé ! Merci pour votre audit.'); window.location.href='/ambassadeur/mes-missions';</script>");
    } catch (err) { res.status(500).send("Erreur d'envoi du rapport."); }
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
    } catch (err) { res.status(500).json({ answer: "Erreur Forfy." }); }
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur le port ${port}`));
