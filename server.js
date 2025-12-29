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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL);`);
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT;");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS note_audit INTEGER DEFAULT 0;");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium';");
        console.log("✅ Système Stable");
    } catch (e) { console.log("DB Init Error:", e); }
}
initialiserDB();

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

// --- ROUTES DE NAVIGATION (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DASHBOARD ADMIN (Fix Erreur Admin) ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
        const rapports = await pool.query(`
            SELECT m.*, u.nom as entreprise_nom 
            FROM missions m 
            LEFT JOIN users u ON m.entreprise_id = u.id 
            ORDER BY m.id DESC`);
        
        const revenusData = await pool.query(`
            SELECT TO_CHAR(COALESCE(date_approbation, NOW()), 'Mon YYYY') as mois, 
            SUM(COALESCE(recompense::numeric, 0)) as total FROM missions WHERE statut = 'approuve' 
            GROUP BY mois LIMIT 6`);

        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, rapports: rapports.rows, 
            userName: req.session.userName, chartData: revenusData.rows 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).send("Erreur Admin"); 
    }
});

// --- DASHBOARD AMBASSADEUR (Fix Erreur Ambassadeur) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    try {
        const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
        const gains = await pool.query(`
            SELECT SUM(COALESCE(recompense::numeric, 0)) as total 
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

// --- DASHBOARD ENTREPRISE (Restaure le bouton Créer) ---
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

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id; req.session.userName = result.rows[0].nom; req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur"); }
});

app.listen(port, () => console.log(`🚀 Port ${port}`));
