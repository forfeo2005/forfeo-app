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

// Middleware indispensable pour lire les données des formulaires
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

// --- AUTHENTIFICATION ENTREPRISE (Correction des erreurs Cannot POST) ---

// Inscription d'une nouvelle entreprise
app.post('/signup-entreprise', async (req, res) => {
    const { nom, email, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO entreprises (nom, email, password) VALUES ($1, $2, $3) RETURNING id',
            [nom, email, password]
        );
        // Redirige vers le dashboard avec l'ID de la nouvelle entreprise
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) {
        res.status(500).send("Erreur : l'email est déjà utilisé pour une entreprise.");
    }
});

// Connexion d'une entreprise existante
app.post('/login-entreprise', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM entreprises WHERE email = $1 AND password = $2',
            [email, password]
        );
        if (result.rows.length > 0) {
            res.redirect(`/dashboard?id=${result.rows[0].id}`);
        } else {
            res.send("Email ou mot de passe incorrect.");
        }
    } catch (err) {
        res.status(500).send("Erreur lors de la connexion.");
    }
});

// --- INSCRIPTION AMBASSADEUR ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4)',
            [nom, email, ville, password]
        );
        res.render('confirmation-ambassadeur', { nom: nom });
    } catch (err) {
        res.status(500).send("Erreur : l'email est déjà utilisé.");
    }
});

// --- ROUTE ADMIN ---
app.get('/admin', async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const entreprises = (await pool.query('SELECT * FROM entreprises ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY id DESC')).rows;
        res.render('admin', { ambassadeurs, entreprises, missions });
    } catch (err) {
        res.status(500).send("Erreur lors du chargement de la console admin.");
    }
});

// --- DASHBOARD ENTREPRISE ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1', [userId])).rows;
        res.render('dashboard', { user, missions });
    } catch (err) {
        res.redirect('/');
    }
});

// --- ACHAT MISSION STRIPE ---
app.post('/create-checkout-session', async (req, res) => {
    const { userId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'Audit Qualité Forfeo' },
                    unit_amount: 15000,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/dashboard?id=${userId}`,
            cancel_url: `${req.headers.origin}/dashboard?id=${userId}`,
        });
        res.json({ id: session.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
