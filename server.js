require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Stripe = require('stripe');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');

// --- INITIALISATION DES SERVICES ---
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

// Connexion à la base de données Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION EXPRESS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

// --- FIX : ROUTES POUR LES BOUTONS DU DASHBOARD ---
// Ces routes affichent le formulaire de rapport d'audit pour chaque bouton
app.get('/survey-qualite', (req, res) => res.render('rapport-audit'));
app.get('/survey-experience', (req, res) => res.render('rapport-audit'));
app.get('/survey-satisfaction', (req, res) => res.render('rapport-audit'));

// --- RECRUTEMENT AMBASSADEURS (FIX) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body; 
    try {
        // Utilise les colonnes ville et statut que nous avons créées
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom: nom });
    } catch (err) {
        console.error("Erreur Recrutement:", err);
        res.status(500).send("Erreur lors de la candidature. Vérifiez que la colonne 'ville' existe sur Railway.");
    }
});

// --- DASHBOARD CLIENT ---
app.get('/dashboard', async (req, res) => {
    // Affiche par défaut les missions de l'entreprise ID 4
    const userId = req.query.id || 4; 
    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        // Récupère les missions existantes (Audit Qualité, Consultation, etc.)
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY date_creation DESC', [userId]);
        
        res.render('dashboard', { 
            user: userResult.rows[0] || { nom: "Partenaire Forfeo", plan: "Découverte" }, 
            missions: missionsResult.rows 
        });
    } catch (err) {
        console.error("Erreur Dashboard:", err);
        res.status(500).send("Erreur de chargement des missions.");
    }
});

// --- SOUMISSION DE RAPPORT ---
app.post('/submit-audit', async (req, res) => {
    const { etablissement, score_accueil, commentaires } = req.body;
    try {
        await pool.query(
            'INSERT INTO missions (type_mission, statut, entreprise_id, details) VALUES ($1, $2, $3, $4)',
            [`Audit ${etablissement}`, 'En Analyse IA', 4, commentaires]
        );
        res.redirect('/dashboard?status=submitted');
    } catch (err) {
        res.status(500).send("Erreur lors de la transmission du rapport.");
    }
});

// --- ADMINISTRATION ---
app.get('/admin', async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs')).rows;
        const entreprises = (await pool.query('SELECT * FROM entreprises')).rows;
        const missions = (await pool.query('SELECT * FROM missions')).rows;
        res.render('admin', { ambassadeurs, entreprises, missions });
    } catch (err) {
        res.status(500).send("Accès Administration restreint.");
    }
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab 2025 opérationnel sur le port ${PORT}`);
});
