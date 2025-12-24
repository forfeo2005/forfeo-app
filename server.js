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

// INITIALISATION DB AVEC MOTS DE PASSE
async function initDb() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (
            id SERIAL PRIMARY KEY, 
            nom VARCHAR(100), 
            email VARCHAR(100) UNIQUE, 
            password VARCHAR(255), 
            plan VARCHAR(50) DEFAULT 'Découverte', 
            score DECIMAL(3,1) DEFAULT 0.0, 
            missions_dispo INTEGER DEFAULT 1
        )`);
        console.log("✅ DB Forfeo Lab Prête.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// AUTHENTIFICATION ENTREPRISE (Inscription & Connexion)
app.post('/signup-entreprise', async (req, res) => {
    const { nom, email, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO entreprises (nom, email, password) VALUES ($1, $2, $3) RETURNING id', 
            [nom, email, password]
        );
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) { res.send("Erreur : cet email est déjà utilisé."); }
});

app.post('/login-entreprise', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [email]);
        if (result.rows.length > 0 && result.rows[0].password === password) {
            res.redirect(`/dashboard?id=${result.rows[0].id}`);
        } else {
            res.send("Email ou mot de passe incorrect.");
        }
    } catch (err) { res.send("Erreur de connexion."); }
});

// STRIPE : ACHAT DE MISSION (150$)
app.post('/create-checkout-session', async (req, res) => {
    const { userId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { 
                        name: 'Audit Qualité Forfeo', 
                        description: 'Mission d\'audit par client mystère certifié' 
                    },
                    unit_amount: 15000, // 150.00$
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/payment-success?id=${userId}`,
            cancel_url: `${req.headers.origin}/dashboard?id=${userId}`,
        });
        res.json({ id: session.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/payment-success', async (req, res) => {
    const userId = req.query.id;
    await pool.query('UPDATE entreprises SET missions_dispo = missions_dispo + 1 WHERE id = $1', [userId]);
    res.redirect(`/dashboard?id=${userId}`);
});

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
    const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
    res.render('dashboard', { user, missions });
});

// AUTRES ROUTES (INDEX, AMBASSADEUR, OFFRES)
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
