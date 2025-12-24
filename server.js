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
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 2. AUTHENTIFICATION ENTREPRISE (RESTORE)
// ==========================================
app.post('/signup-entreprise', async (req, res) => {
    const { nom, email } = req.body;
    try {
        const result = await pool.query('INSERT INTO entreprises (nom, email) VALUES ($1, $2) RETURNING id', [nom, email]);
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) { res.send("Email déjà utilisé."); }
});

app.post('/login-entreprise', async (req, res) => {
    const { email } = req.body;
    const result = await pool.query('SELECT id FROM entreprises WHERE email = $1', [email]);
    if (result.rows.length > 0) res.redirect(`/dashboard?id=${result.rows[0].id}`);
    else res.send("Compte non trouvé.");
});

// ==========================================
// 3. INSCRIPTION AMBASSADEUR (FIX)
// ==========================================
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        const result = await pool.query('INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4) RETURNING id', [nom, email, ville, password]);
        res.send('<script>alert("Inscription réussie ! En attente de validation."); window.location.href="/candidature";</script>');
    } catch (err) { res.send("Erreur inscription ambassadeur."); }
});

// ==========================================
// 4. NAVIGATION & IA
// ==========================================
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Tu es Forfy." }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.json({ reply: "Forfy est là." }); }
});

// ==========================================
// 5. DASHBOARD & ADMIN
// ==========================================
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4;
    const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
    const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
    res.render('dashboard', { user, missions });
});

app.get('/admin', async (req, res) => {
    const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
    const entreprises = (await pool.query('SELECT * FROM entreprises ORDER BY id DESC')).rows;
    const missions = (await pool.query('SELECT m.*, e.nom as entreprise_nom, a.nom as ambassadeur_nom FROM missions m LEFT JOIN entreprises e ON m.entreprise_id = e.id LEFT JOIN ambassadeurs a ON m.ambassadeur_id = a.id ORDER BY m.id DESC')).rows;
    res.render('admin', { ambassadeurs, entreprises, missions });
});

app.post('/admin/valider-ambassadeur', async (req, res) => {
    await pool.query("UPDATE ambassadeurs SET statut = 'Actif' WHERE id = $1", [req.body.id]);
    res.redirect('/admin');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Forfeo Lab en ligne sur le port ${PORT}`));
