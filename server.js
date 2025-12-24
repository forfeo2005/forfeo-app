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

// INITIALISATION DB
async function initDb() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(100), plan VARCHAR(50) DEFAULT 'Découverte', score DECIMAL(3,1) DEFAULT 0.0, missions_dispo INTEGER DEFAULT 1)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER, type_mission VARCHAR(100), details TEXT, statut VARCHAR(50) DEFAULT 'En attente')`);
        // Table pour les Ambassadeurs
        await pool.query(`CREATE TABLE IF NOT EXISTS ambassadeurs (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(100), missions_assignees INTEGER DEFAULT 0)`);
        console.log("✅ DB Forfeo Lab Prête.");
    } catch (err) { console.error(err); }
}
initDb();

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTE FORFY IA ---
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
    } catch (error) { res.json({ reply: "Je suis en train d'apprendre vos nouveaux protocoles. Posez-moi une question sur vos audits !" }); }
});

// --- ROUTES NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/offre-entreprise', (req, res) => res.render('offre-entreprise'));
app.get('/espace-ambassadeur', (req, res) => res.render('espace-ambassadeur'));

// --- ROUTES QUESTIONNAIRES (Fixes Cannot GET) ---
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// --- AUTH & DASHBOARD (Simplifié pour l'exemple) ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4; // Par défaut id=4 comme sur ta capture
    const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
    const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
    res.render('dashboard', { user, missions });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Forfeo en ligne sur ${PORT}`));
