require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

// --- CONFIGURATION BASE DE DONNÉES ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION EXPRESS ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration de la session pour l'espace Admin
app.use(session({
    secret: 'forfeo-secret-key-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- ROUTES PUBLIQUES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// --- INSCRIPTION AMBASSADEUR (CORRIGÉE) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        // Enregistrement dans Railway
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        
        // IMPORTANT : On transmet nom ET ville pour éviter l'erreur EJS
        res.render('confirmation-ambassadeur', { nom, ville });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors de l'inscription.");
    }
});

// --- DASHBOARD ENTREPRISE (AVEC SÉCURITÉ) ---
app.get('/entreprise/dashboard', async (req, res) => {
    try {
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
        
        // Gestion de la table feedback_metrics
        let stats = [];
        try {
            const resStats = await pool.query('SELECT * FROM feedback_metrics WHERE entreprise_id = 4 ORDER BY id ASC');
            stats = resStats.rows;
        } catch (dbErr) {
            console.warn("Table feedback_metrics incomplète :", dbErr.message);
        }
        
        res.render('dashboard', { missions, stats });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur Dashboard.");
    }
});

// --- API FORFY ---
app.get('/api/forfy-message', (req, res) => {
    const page = req.query.page || '';
    let message = "Besoin d'aide ?";
    if (page.includes('confirmation')) message = "Ton profil est entre de bonnes mains ! 🚀";
    if (page.includes('dashboard')) message = "Analyse tes derniers scores de qualité.";
    res.json({ message });
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab Corporate opérationnel sur le port ${PORT}`);
});
