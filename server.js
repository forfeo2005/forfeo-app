require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Stripe = require('stripe');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');

// --- INITIALISATION ---
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION EMAIL (Optionnel pour l'instant) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

// --- DASHBOARD CLIENT & BOUTONS ---
// Règle l'erreur "Cannot GET"
app.get('/survey-qualite', (req, res) => res.render('rapport-audit'));
app.get('/survey-experience', (req, res) => res.render('rapport-audit'));
app.get('/survey-satisfaction', (req, res) => res.render('rapport-audit'));

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4; // Utilise l'ID 4 vu dans votre base
    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY date_creation DESC', [userId]);
        
        const userData = userResult.rows.length > 0 ? userResult.rows[0] : { nom: "Client Forfeo", plan: "Découverte" };
        
        res.render('dashboard', { 
            user: userData, 
            missions: missionsResult.rows 
        });
    } catch (err) {
        res.status(500).send("Erreur de chargement du dashboard.");
    }
});

// --- RECRUTEMENT AMBASSADEUR ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body; // Récupère "quebec"
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom: nom, ville: ville }); // Affiche la vue stylisée
    } catch (err) {
        console.error("Erreur Recrutement:", err.message);
        res.status(500).send("Erreur lors de l'inscription. L'email existe peut-être déjà.");
    }
});

// --- CONSOLE ADMINISTRATION ---
app.get('/admin', async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const entreprises = (await pool.query('SELECT * FROM entreprises')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY date_creation DESC')).rows;
        res.render('admin', { ambassadeurs, entreprises, missions });
    } catch (err) {
        res.status(500).send("Erreur d'accès à la console admin.");
    }
});

// --- ACTION : APPROUVER UN AMBASSADEUR ---
app.get('/admin/approuver/:id', async (req, res) => {
    const ambId = req.params.id;
    try {
        await pool.query("UPDATE ambassadeurs SET statut = 'Validé' WHERE id = $1", [ambId]);
        console.log(`✅ Ambassadeur ${ambId} approuvé`);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Erreur lors de la validation.");
    }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab 2025 opérationnel sur le port ${PORT}`);
});
