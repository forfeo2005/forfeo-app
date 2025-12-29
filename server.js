const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // Stockage persistant
const path = require('path');
const { OpenAI } = require("openai");
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- CONFIGURATION NODEMAILER ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB (AVEC TABLE SESSION) ---
async function initialiserDB() {
    try {
        // Création de la table session pour connect-pg-simple
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
              "sid" varchar NOT NULL COLLATE "default",
              "sess" json NOT NULL,
              "expire" timestamp(6) NOT NULL
            ) WITH (OIDS=FALSE);
            ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";
            ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);
        
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS note_audit INTEGER DEFAULT 0");
        console.log("✅ Base de données et Sessions synchronisées.");
    } catch (e) { console.error("Erreur Initialisation DB:", e); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION SESSION PERSISTANTE ---
app.use(session({
    store: new pgSession({
        pool: pool,                // Utilise notre connexion existante
        tableName: 'session'       // Nom de la table en DB
    }),
    secret: 'forfeo_secret_2025_qc', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // Session valide 30 jours
}));

app.set('view engine', 'ejs');

// --- ROUTES (Toutes préservées et fonctionnelles) ---

app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
        const rapports = await pool.query(`
            SELECT m.*, u.nom as entreprise_nom 
            FROM missions m 
            JOIN users u ON m.entreprise_id = u.id 
            ORDER BY m.id DESC`);
        
        const revenusData = await pool.query(`
            SELECT TO_CHAR(date_approbation, 'Mon YYYY') as mois, 
                   SUM(recompense::numeric) as total 
            FROM missions WHERE statut = 'approuve' 
            GROUP BY mois, date_approbation ORDER BY date_approbation ASC LIMIT 6`);

        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, rapports: rapports.rows, 
            userName: req.session.userName, chartData: revenusData.rows
        });
    } catch (err) { res.status(500).send("Erreur Admin"); }
});

// --- APPROBATION ---
app.post('/admin/approuver-audit', async (req, res) => {
    const { id_mission, note_audit } = req.body;
    try {
        const missionResult = await pool.query(`
            SELECT m.*, u.email, u.nom FROM missions m 
            JOIN users u ON m.ambassadeur_id = u.id WHERE m.id = $1`, [id_mission]);
        
        if (missionResult.rows.length > 0) {
            const mission = missionResult.rows[0];
            await pool.query("UPDATE missions SET statut = 'approuve', date_approbation = NOW(), note_audit = $1 WHERE id = $2", [note_audit, id_mission]);
            
            await transporter.sendMail({
                from: `"FORFEO LAB" <${process.env.EMAIL_USER}>`,
                to: mission.email,
                subject: 'Mission Approuvée ! 💰',
                text: `Félicitations ${mission.nom}, votre audit "${mission.titre}" a été validé avec une note de ${note_audit}/5.`
            });
        }
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send("Erreur"); }
});

// --- DASHBOARDS RÔLES ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, stats: {forfait: 'Premium'} });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query("SELECT SUM(recompense::numeric) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0 });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur port ${port}`));
