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
        // Table Entreprises
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

        // Table Missions
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
                { role: "system", content: "Tu es Forfy, l'IA de Forfeo. Tu es un expert en expérience client." },
                { role: "user", content: message }
            ],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { 
        res.json({ reply: "Forfy est à votre écoute pour optimiser votre service client." }); 
    }
});

// ==========================================
// 4. NAVIGATION & PAGES (CORRECTIFS "CANNOT GET")
// ==========================================
app.get('/', (req, res) => res.render('index'));

// Bouton "Devenir Ambassadeur"
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));

// Onglet "Offre Entreprise"
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));

// Onglet "Partenaires"
app.get('/partenaires', (req, res) => res.render('partenaires'));

// Routes Questionnaires (Boutons Dashboard)
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// Envoi des rapports
app.post('/submit-survey', (req, res) => {
    res.send('<script>alert("Rapport transmis !"); window.location.href="/dashboard";</script>');
});

// ==========================================
// 5. PAIEMENT STRIPE (NOUVELLE MISSION)
// ==========================================
app.post('/create-checkout-session', async (req, res) => {
    const { userId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'Audit Qualité Forfeo', description: 'Mission d\'audit par client mystère certifié' },
                    unit_amount: 15000, // 150.00 $
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
        await pool.query('UPDATE entreprises SET missions_dispo = missions_dispo + 1 WHERE id = $1', [userId]);
        await pool.query('INSERT INTO missions (entreprise_id, type_mission, statut) VALUES ($1, $2, $3)', [userId, 'Audit Qualité (Payé)', 'En attente']);
        res.redirect(`/dashboard?id=${userId}`);
    } catch (err) { res.send("Erreur lors de la validation du paiement."); }
});

// ==========================================
// 6. DASHBOARDS & PROFILS
// ==========================================

// Dashboard Entreprise
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
        if (!user) return res.redirect('/');
        res.render('dashboard', { user, missions });
    } catch (err) { res.send("Erreur Dashboard."); }
});

// Profil Ambassadeur
app.get('/profil-ambassadeur', async (req, res) => {
    const ambassadeurId = req.query.id || 1;
    try {
        const ambassadeur = (await pool.query('SELECT * FROM ambassadeurs WHERE id = $1', [ambassadeurId])).rows[0];
        if (!ambassadeur) return res.redirect('/candidature');
        res.render('profil-ambassadeur', { ambassadeur });
    } catch (err) { res.redirect('/candidature'); }
});

// Portail Ambassadeur (Missions)
app.get('/portail-ambassadeur', async (req, res) => {
    const ambassadeurId = req.query.id || 1;
    try {
        const ambassadeur = (await pool.query('SELECT * FROM ambassadeurs WHERE id = $1', [ambassadeurId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE ambassadeur_id = $1', [ambassadeurId])).rows;
        res.render('portail-ambassadeur', { ambassadeur, missions });
    } catch (err) { res.redirect('/candidature'); }
});

// ==========================================
// 7. ADMINISTRATION 🛠️
// ==========================================
app.get('/admin', async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const entreprises = (await pool.query('SELECT * FROM entreprises ORDER BY id DESC')).rows;
        const missions = (await pool.query(`
            SELECT m.*, e.nom as entreprise_nom, a.nom as ambassadeur_nom 
            FROM missions m 
            LEFT JOIN entreprises e ON m.entreprise_id = e.id 
            LEFT JOIN ambassadeurs a ON m.ambassadeur_id = a.id 
            ORDER BY m.id DESC
        `)).rows;
        res.render('admin', { ambassadeurs, entreprises, missions });
    } catch (err) { res.send("Erreur Admin."); }
});

app.post('/admin/assign-mission', async (req, res) => {
    const { entreprise_id, ambassadeur_id, type_mission, details } = req.body;
    await pool.query('INSERT INTO missions (entreprise_id, ambassadeur_id, type_mission, details, statut) VALUES ($1, $2, $3, $4, $5)', [entreprise_id, ambassadeur_id, type_mission, details, 'Assignée']);
    res.redirect('/admin');
});

app.post('/admin/valider-ambassadeur', async (req, res) => {
    await pool.query("UPDATE ambassadeurs SET statut = 'Actif' WHERE id = $1", [req.body.id]);
    res.redirect('/admin');
});

// ==========================================
// 8. LANCEMENT
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab en ligne sur le port ${PORT}`);
});
