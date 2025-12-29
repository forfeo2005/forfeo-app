const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- CONFIGURATION NODEMAILER ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP;");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        // Colonne pour traquer la première connexion
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS premiere_connexion BOOLEAN DEFAULT TRUE;");
        console.log("✅ FORFEO LAB : Système Stable");
    } catch (e) { console.log("Init Error:", e); }
}
initialiserDB();

// --- WEBHOOK STRIPE ---
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await pool.query("UPDATE users SET forfait = 'Premium' WHERE email = $1", [session.customer_details.email]);
        console.log(`💰 Forfait Premium activé pour ${session.customer_details.email} via Webhook`);
    }
    res.json({received: true});
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: 'forfeo_secret_2025',
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES DE BASE ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login', { msg: req.query.msg || null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/aide', (req, res) => res.render('aide', { userName: req.session.userName || null }));

// --- PROFIL ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query("SELECT nom, email FROM users WHERE id = $1", [req.session.userId]);
    res.render('profil', { user: result.rows[0], message: req.query.msg || null });
});

// --- DASHBOARDS ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
        const rapports = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m LEFT JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
        const revenusData = await pool.query(`
            SELECT TO_CHAR(COALESCE(date_approbation, NOW()), 'Mon YYYY') as mois, 
            SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total 
            FROM missions WHERE statut = 'approuve' 
            GROUP BY mois, date_approbation ORDER BY date_approbation ASC LIMIT 6`);
        res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows, userName: req.session.userName, chartData: revenusData.rows });
    } catch (err) { res.status(500).send("Erreur Admin"); }
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
        const showWelcome = result.rows[0].premiere_connexion;
        
        // On désactive le flag après la première lecture
        if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);

        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query(`
            SELECT SUM(COALESCE(CAST(NULLIF(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g'), '') AS NUMERIC), 0)) as total 
            FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
        
        res.render('ambassadeur-dashboard', { 
            missions: disponibles.rows, 
            userName: req.session.userName, 
            totalGains: gains.rows[0].total || 0,
            showWelcome: showWelcome 
        });
    } catch (err) { res.status(500).send("Erreur Ambassadeur"); }
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const result = await pool.query("SELECT premiere_connexion FROM users WHERE id = $1", [req.session.userId]);
        const showWelcome = result.rows[0].premiere_connexion;
        if (showWelcome) await pool.query("UPDATE users SET premiere_connexion = FALSE WHERE id = $1", [req.session.userId]);

        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
        const forfait = user.rows[0]?.forfait || 'Freemium';

        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: req.session.userName,
            showWelcome: showWelcome,
            stats: { totale: missions.rows.length, forfait: forfait, canPublish: (forfait === 'Premium' || missions.rows.length < 1) }
        });
    } catch (err) { res.status(500).send("Erreur Entreprise"); }
});

// --- AUTH & ACTIONS ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id; req.session.userName = result.rows[0].nom; req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login');
});

app.post('/postuler-mission', async (req, res) => {
    await pool.query("UPDATE missions SET ambassadeur_id = $1, statut = 'reserve' WHERE id = $2", [req.session.userId, req.body.id_mission]);
    res.redirect('/ambassadeur/dashboard');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB sur port ${port}`));
