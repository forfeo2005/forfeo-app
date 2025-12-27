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

// --- AUTO-RÉPARATION DB (Fix Erreur lors de la réservation) ---
async function fixDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        console.log("✅ Base de données réparée.");
    } catch (e) { console.log("DB déjà à jour."); }
}
fixDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES NAVIGATION & AUTH (Identiques) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' AND (ambassadeur_id IS NULL)");
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName });
});

// --- POSTULER (Fixé) ---
app.post('/postuler-mission', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.status(403).send("Non autorisé");
    const { id_mission } = req.body;
    try {
        await pool.query("UPDATE missions SET statut = 'reserve', ambassadeur_id = $1 WHERE id = $2", 
        [req.session.userId, id_mission]);
        res.send("<script>alert('Mission réservée !'); window.location.href='/ambassadeur/mes-missions';</script>");
    } catch (err) { res.status(500).send("Erreur lors de la réservation."); }
});

// --- ENVOYER LE RAPPORT ---
app.post('/envoyer-rapport', async (req, res) => {
    const { id_mission, rapport } = req.body;
    try {
        await pool.query("UPDATE missions SET rapport_final = $1, statut = 'termine' WHERE id = $2", [rapport, id_mission]);
        res.redirect('/ambassadeur/mes-missions');
    } catch (err) { res.status(500).send("Erreur d'envoi."); }
});

app.listen(port, () => console.log(`🚀 Serveur actif sur ${port}`));
