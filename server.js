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

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES AUTHENTIFICATION ---

app.post('/signup-entreprise', async (req, res) => {
    const { nom, email, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO entreprises (nom, email, password, plan) VALUES ($1, $2, $3, $4) RETURNING id',
            [nom, email, password, 'Découverte']
        );
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) {
        res.status(500).send("Erreur : cet email est déjà utilisé.");
    }
});

app.post('/login-entreprise', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1 AND password = $2', [email, password]);
        if (result.rows.length > 0) res.redirect(`/dashboard?id=${result.rows[0].id}`);
        else res.send("Identifiants incorrects.");
    } catch (err) { res.status(500).send("Erreur de connexion."); }
});

app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query('INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4)', [nom, email, ville, password]);
        res.render('confirmation-ambassadeur', { nom: nom });
    } catch (err) { res.status(500).send("Erreur inscription."); }
});

// --- NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));
app.get('/partenaires', (req, res) => res.render('partenaires'));

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1', [userId])).rows;
        res.render('dashboard', { user, missions });
    } catch (err) { res.redirect('/'); }
});

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Tu es Forfy, expert client." }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.json({ reply: "Forfy est à votre écoute." }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Forfeo 2025 actif sur le port ${PORT}`));
