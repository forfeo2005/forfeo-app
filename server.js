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
// Cela ajoute les colonnes nécessaires si elles manquent pour éviter l'erreur de réservation.
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

// --- ROUTES AUTHENTIFICATION ---
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

// --- ROUTES AMBASSADEUR ---

// 1. Dashboard : Missions publiques disponibles
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' OR statut IS NULL");
        res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur dashboard"); }
});

// 2. Profil : Ses missions réservées (LA NOUVELLE ROUTE)
app.get('/ambassadeur/mes-missions', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const result = await pool.query(
            "SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", 
            [req.session.userId]
        );
        res.render('ambassadeur-missions', { missions: result.rows, userName: req.session.userName });
    } catch (err) { res.status(500).send("Erreur lors de la récupération de vos missions."); }
});

// 3. Action : Postuler (Réserver la mission)
app.post('/postuler-mission', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query(
            "UPDATE missions SET statut = 'reserve', ambassadeur_id = $1 WHERE id = $2", 
            [req.session.userId, id_mission]
        );
        res.send("<script>alert('Mission réservée avec succès !'); window.location.href='/ambassadeur/mes-missions';</script>");
    } catch (err) { res.status(500).send("Erreur lors de la réservation."); }
});

// 4. Action : Envoyer le rapport final
app.post('/envoyer-rapport', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission, rapport } = req.body;
    try {
        await pool.query(
            "UPDATE missions SET rapport_final = $1, statut = 'termine' WHERE id = $2 AND ambassadeur_id = $3", 
            [rapport, id_mission, req.session.userId]
        );
        res.send("<script>alert('Rapport envoyé ! Merci pour votre audit.'); window.location.href='/ambassadeur/mes-missions';</script>");
    } catch (err) { res.status(500).send("Erreur d'envoi du rapport."); }
});

// --- AUTRES ROUTES ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur le port ${port}`));
