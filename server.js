require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { Resend } = require('resend');
const Stripe = require('stripe');
const OpenAI = require('openai');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ==========================================
// 1. INITIALISATION DE LA BASE DE DONNÉES
// ==========================================
async function initDb() {
    try {
        // Table Entreprises (Clients)
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (
            id SERIAL PRIMARY KEY, 
            nom VARCHAR(100), 
            email VARCHAR(100) UNIQUE, 
            password VARCHAR(100), 
            plan VARCHAR(50) DEFAULT 'Découverte', 
            score DECIMAL(3,1) DEFAULT 0.0, 
            missions_dispo INTEGER DEFAULT 1
        )`);
        
        // Table Ambassadeurs
        await pool.query(`CREATE TABLE IF NOT EXISTS ambassadeurs (
            id SERIAL PRIMARY KEY, 
            nom VARCHAR(100), 
            email VARCHAR(100) UNIQUE, 
            password VARCHAR(100), 
            ville VARCHAR(100),
            statut VARCHAR(50) DEFAULT 'En attente de validation',
            missions_completees INTEGER DEFAULT 0
        )`);

        // Table Missions (Lien entre Client et Ambassadeur)
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (
            id SERIAL PRIMARY KEY, 
            entreprise_id INTEGER REFERENCES entreprises(id), 
            ambassadeur_id INTEGER REFERENCES ambassadeurs(id),
            type_mission VARCHAR(100), 
            details TEXT, 
            statut VARCHAR(50) DEFAULT 'En attente',
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log("✅ DB Forfeo Lab Prête.");
    } catch (err) { 
        console.error("❌ Erreur Initialisation DB:", err); 
    }
}
initDb();

// ==========================================
// 2. CONFIGURATIONS MIDDLEWARE
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 3. ROUTE FORFY IA 🤖
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "Tu es Forfy, l'IA de Forfeo. Tu aides les entreprises à optimiser leur expérience client. Tu es pro, encourageant et expert en qualité de service." },
                { role: "user", content: message }
            ],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { 
        res.json({ reply: "Je suis prêt à vous aider ! Posez-moi une question sur vos audits ou votre expérience client." }); 
    }
});

// ==========================================
// 4. ROUTES DE NAVIGATION & PAGES
// ==========================================
app.get('/', (req, res) => res.render('index'));
app.get('/offre-entreprise', (req, res) => res.render('offre-entreprise'));
app.get('/espace-ambassadeur', (req, res) => res.render('espace-ambassadeur'));

// Routes Questionnaires (Correction des erreurs "Cannot GET")
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// Traitement des questionnaires
app.post('/submit-survey', (req, res) => {
    console.log("Données du formulaire reçues:", req.body);
    res.send('<script>alert("Rapport transmis avec succès !"); window.location.href="/dashboard";</script>');
});

// ==========================================
// 5. AUTHENTIFICATION & DASHBOARDS
// ==========================================

// Dashboard Client
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4; // Par défaut id=4 comme vu en test
    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId]);
        
        if (userResult.rows.length === 0) return res.redirect('/');
        
        res.render('dashboard', { 
            user: userResult.rows[0], 
            missions: missionsResult.rows 
        });
    } catch (err) { res.send("Erreur de chargement du dashboard."); }
});

// Inscription Ambassadeur
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4)',
            [nom, email, ville, password]
        );
        res.send('<script>alert("Demande envoyée ! Votre compte est en cours de validation."); window.location.href="/";</script>');
    } catch (err) {
        res.send('<script>alert("Cet email est déjà enregistré."); window.location.href="/espace-ambassadeur";</script>');
    }
});

// Portail Ambassadeur (Visualisation des missions assignées)
app.get('/portail-ambassadeur', async (req, res) => {
    const ambassadeurId = req.query.id || 1; 
    try {
        const ambassResult = await pool.query('SELECT * FROM ambassadeurs WHERE id = $1', [ambassadeurId]);
        const missionsResult = await pool.query('SELECT * FROM missions WHERE ambassadeur_id = $1', [ambassadeurId]);
        
        if (ambassResult.rows.length === 0) return res.redirect('/espace-ambassadeur');
        
        res.render('portail-ambassadeur', { 
            ambassadeur: ambassResult.rows[0], 
            missions: missionsResult.rows 
        });
    } catch (err) { res.redirect('/espace-ambassadeur'); }
});

// ==========================================
// 6. LANCEMENT DU SERVEUR
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo en ligne sur le port ${PORT}`);
});
