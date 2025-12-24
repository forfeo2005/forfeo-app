require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Stripe = require('stripe');
const OpenAI = require('openai');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// INITIALISATION DE LA BASE DE DONNÉES
async function initDb() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, plan VARCHAR(50) DEFAULT 'Découverte', score DECIMAL(3,1) DEFAULT 0.0, missions_dispo INTEGER DEFAULT 1)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ambassadeurs (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(100), ville VARCHAR(100), statut VARCHAR(50) DEFAULT 'En attente de validation', missions_completees INTEGER DEFAULT 0)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES entreprises(id), ambassadeur_id INTEGER REFERENCES ambassadeurs(id), type_mission VARCHAR(100), statut VARCHAR(50) DEFAULT 'En attente', date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log("✅ DB Forfeo Lab Prête.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// AUTHENTIFICATION ET INSCRIPTIONS
app.post('/signup-entreprise', async (req, res) => {
    const { nom, email } = req.body;
    try {
        const result = await pool.query('INSERT INTO entreprises (nom, email) VALUES ($1, $2) RETURNING id', [nom, email]);
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) { res.send("Email entreprise déjà utilisé."); }
});

app.post('/login-entreprise', async (req, res) => {
    const { email } = req.body;
    const result = await pool.query('SELECT id FROM entreprises WHERE email = $1', [email]);
    if (result.rows.length > 0) res.redirect(`/dashboard?id=${result.rows[0].id}`);
    else res.send("Compte entreprise non trouvé.");
});

app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query('INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4)', [nom, email, ville, password]);
        res.send('<script>alert("Inscription réussie ! Votre profil est en cours de validation."); window.location.href="/candidature";</script>');
    } catch (err) { res.send("Erreur lors de l'inscription ambassadeur."); }
});

// NAVIGATION
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));
app.get('/partenaires', (req, res) => res.render('partenaires'));

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
        res.render('dashboard', { user, missions });
    } catch (err) { res.send("Erreur de chargement du dashboard."); }
});

// IA FORFY
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Tu es Forfy, l'IA de Forfeo." }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.json({ reply: "Je suis Forfy, comment puis-je vous aider ?" }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Forfeo Lab en ligne sur le port ${PORT}`));
