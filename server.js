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

// ==========================================
// 1. INITIALISATION DE LA BASE DE DONNÉES
// ==========================================
async function initDb() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(100), plan VARCHAR(50) DEFAULT 'Découverte', score DECIMAL(3,1) DEFAULT 0.0, missions_dispo INTEGER DEFAULT 1)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ambassadeurs (id SERIAL PRIMARY KEY, nom VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(100), ville VARCHAR(100), statut VARCHAR(50) DEFAULT 'En attente de validation', missions_completees INTEGER DEFAULT 0)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES entreprises(id), ambassadeur_id INTEGER REFERENCES ambassadeurs(id), type_mission VARCHAR(100), details TEXT, statut VARCHAR(50) DEFAULT 'En attente', date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log("✅ DB Forfeo Lab Prête.");
    } catch (err) { console.error("❌ Erreur Initialisation DB:", err); }
}
initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 2. ROUTES DE NAVIGATION & PAGES
// ==========================================
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));
app.get('/partenaires', (req, res) => res.render('index'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// ==========================================
// 3. PAIEMENT STRIPE (Nouvelle Mission)
// ==========================================
app.post('/create-checkout-session', async (req, res) => {
    const { userId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'Audit Qualité (Client Mystère)', description: 'Mission d\'audit complète par un ambassadeur Forfeo' },
                    unit_amount: 15000, // 150.00 $ CAD
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
    try {
        // Ajouter une mission disponible au client
        await pool.query('UPDATE entreprises SET missions_dispo = missions_dispo + 1 WHERE id = $1', [userId]);
        // Créer l'entrée dans la liste des missions
        await pool.query('INSERT INTO missions (entreprise_id, type_mission, statut) VALUES ($1, $2, $3)', [userId, 'Audit Qualité (Client Mystère)', 'En attente']);
        res.redirect(`/dashboard?id=${userId}`);
    } catch (err) { res.send("Erreur lors de la mise à jour de la mission."); }
});

// ==========================================
// 4. IA & DASHBOARDS
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Tu es Forfy, l'IA de Forfeo." }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.json({ reply: "Forfy est là pour vous !" }); }
});

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
        res.render('dashboard', { user, missions });
    } catch (err) { res.send("Erreur dashboard."); }
});

// Admin routes... (Gardez votre code précédent ici)

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Forfeo Lab en ligne sur le port ${PORT}`));
