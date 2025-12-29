const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// --- CONFIGURATION BASE DE DONNÉES ---
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- INITIALISATION DE LA STRUCTURE DB ---
async function initialiserDB() {
    try {
        // Table pour les sessions (évite la déconnexion lors des redémarrages sur Render)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
              "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
              "sess" json NOT NULL,
              "expire" timestamp(6) NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);
        
        // Mise à jour des colonnes nécessaires
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS note_audit INTEGER DEFAULT 0;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS type_mission VARCHAR(100);");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        
        console.log("✅ FORFEO LAB : Système Stable & DB Synchronisée");
    } catch (e) { 
        console.error("Erreur Initialisation DB:", e); 
    }
}
initialiserDB();

// --- MIDDLEWARES ---
// Note: Le webhook Stripe doit être placé AVANT express.json() si vous utilisez express.raw()
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION SESSION PERSISTANTE ---
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: 'forfeo_secret_qc_2025', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
}));

app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- AUTHENTIFICATION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            req.session.userEmail = result.rows[0].email;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur Login"); }
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
        const rapports = await pool.query(`
            SELECT m.*, u.nom as entreprise_nom 
            FROM missions m 
            LEFT JOIN users u ON m.entreprise_id = u.id 
            ORDER BY m.id DESC`);
        
        // Nettoyage des données numériques pour éviter l'erreur "invalid input syntax"
        const revenusData = await pool.query(`
            SELECT TO_CHAR(COALESCE(date_approbation, NOW()), 'Mon YYYY') as mois, 
            SUM(CAST(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g') AS NUMERIC)) as total 
            FROM missions WHERE statut = 'approuve' 
            GROUP BY mois, date_approbation ORDER BY date_approbation ASC LIMIT 6`);

        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, 
            rapports: rapports.rows, 
            userName: req.session.userName,
            chartData: revenusData.rows
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send("Erreur Admin"); 
    }
});

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query(`
            SELECT SUM(CAST(REGEXP_REPLACE(recompense, '[^0-9.]', '', 'g') AS NUMERIC)) as total 
            FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'`, [req.session.userId]);
        
        res.render('ambassadeur-dashboard', { 
            missions: disponibles.rows, 
            userName: req.session.userName, 
            totalGains: gains.rows[0].total || 0 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send("Erreur Ambassadeur"); 
    }
});

// --- DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    try {
        const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
        const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
        const forfait = user.rows[0]?.forfait || 'Freemium';

        res.render('entreprise-dashboard', { 
            missions: missions.rows, 
            userName: req.session.userName,
            stats: { 
                totale: missions.rows.length, 
                forfait: forfait,
                canPublish: (forfait !== 'Freemium' || missions.rows.length < 1)
            }
        });
    } catch (err) { res.status(500).send("Erreur Entreprise"); }
});

// --- ACTIONS MISSIONS ---
app.post('/creer-mission', async (req, res) => {
    const { titre, description, recompense, type_mission } = req.body;
    try {
        await pool.query(
            "INSERT INTO missions (entreprise_id, titre, description, recompense, type_mission, statut) VALUES ($1, $2, $3, $4, $5, 'actif')",
            [req.session.userId, titre, description, recompense, type_mission]
        );
        res.redirect('/entreprise/dashboard');
    } catch (err) { res.status(500).send("Erreur Création"); }
});

// --- STRIPE : PAIEMENT & WEBHOOK ---
app.post('/create-checkout-session', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'FORFEO LAB - Premium' },
                    unit_amount: 14900,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}/entreprise/dashboard?success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/forfaits`,
            customer_email: req.session.userEmail,
        });
        res.redirect(303, session.url);
    } catch (err) { res.status(500).send("Erreur Paiement"); }
});

// Webhook pour activer le forfait automatiquement
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await pool.query("UPDATE users SET forfait = 'Premium' WHERE email = $1", [session.customer_details.email]);
        console.log(`✅ Forfait Premium activé pour : ${session.customer_details.email}`);
    }
    res.json({received: true});
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur port ${port}`));
