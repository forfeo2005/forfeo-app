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

// Configuration de la connexion PostgreSQL Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION DE L'APPLICATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

// --- ROUTES DU DASHBOARD (FIX "CANNOT GET") ---
// Ces routes redirigent les boutons "Évaluer", "Documenter" et "Améliorer"
app.get('/survey-qualite', (req, res) => res.render('rapport-audit'));
app.get('/survey-experience', (req, res) => res.render('rapport-audit'));
app.get('/survey-satisfaction', (req, res) => res.render('rapport-audit'));

// --- RECRUTEMENT AMBASSADEURS (VERSION ROBUSTE) ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    
    // Log pour vérifier ce qui arrive du formulaire
    console.log(`📡 Tentative d'inscription : Nom=${nom}, Email=${email}, Ville=${ville}`);

    try {
        // Insertion utilisant les colonnes que vous avez ajoutées
        const query = {
            text: 'INSERT INTO ambassadeurs(nom, email, ville, password, statut) VALUES($1, $2, $3, $4, $5)',
            values: [nom, email, ville, password, 'En attente'],
        };
        await pool.query(query);
        
        console.log("✅ Inscription réussie dans la base de données.");
        res.render('confirmation-ambassadeur', { nom: nom });
    } catch (err) {
        // Log ultra-détaillé pour voir si c'est la colonne 'ville' ou l'email UNIQUE qui bloque
        console.error("❌ ERREUR CRITIQUE DB :", err.message);
        console.error("Détails de l'erreur :", err.detail);
        
        res.status(500).send(`Erreur Technique : ${err.message}. Détail : ${err.detail || 'Aucun'}`);
    }
});

// --- DASHBOARD CLIENT ---
app.get('/dashboard', async (req, res) => {
    // Utilise l'ID 4 par défaut pour charger vos données existantes
    const userId = req.query.id || 4; 
    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        // Récupère les missions de l'entreprise (Audit, Consultation, etc.)
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY date_creation DESC', [userId]);
        
        res.render('dashboard', { 
            user: userResult.rows[0] || { nom: "Client Forfeo", plan: "Découverte" }, 
            missions: missionsResult.rows 
        });
    } catch (err) {
        console.error("Erreur chargement Dashboard:", err.message);
        res.status(500).send("Erreur de récupération des données du dashboard.");
    }
});

// --- RAPPORTS D'AUDIT ---
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
        res.status(500).send("Accès Admin indisponible.");
    }
});

// --- LANCEMENT ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab 2025 opérationnel sur le port ${PORT}`);
});
