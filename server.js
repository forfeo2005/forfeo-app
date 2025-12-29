const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const { OpenAI } = require("openai");
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- CONFIGURATION NODEMAILER ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS forfait VARCHAR(50) DEFAULT 'Freemium'");
        console.log("✅ Base de données synchronisée.");
    } catch (e) { console.log("DB à jour."); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Fix Cannot GET /register etc.) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// --- AUTHENTIFICATION (Fix Cannot POST /login) ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (nom, email, password, role) VALUES ($1, $2, $3, $4)", [nom, email, hash, role]);
        res.redirect('/login');
    } catch (err) { res.status(500).send("Erreur d'inscription"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.userId = result.rows[0].id;
            req.session.userName = result.rows[0].nom;
            req.session.userRole = result.rows[0].role;
            // Redirection dynamique selon le rôle
            return res.redirect(`/${req.session.userRole}/dashboard`);
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- DASHBOARD ADMIN FUTURISTE ---
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
            FROM missions 
            WHERE statut = 'approuve' 
            GROUP BY mois 
            ORDER BY MIN(date_approbation) ASC LIMIT 6`);

        res.render('admin-dashboard', { 
            entreprises: entreprises.rows, 
            rapports: rapports.rows, 
            userName: req.session.userName,
            chartData: revenusData.rows
        });
    } catch (err) { res.status(500).send("Erreur Admin"); }
});

// --- APPROBATION ET ENVOI EMAIL ---
app.post('/admin/approuver-audit', async (req, res) => {
    const { id_mission } = req.body;
    try {
        const missionResult = await pool.query(`
            SELECT m.*, u.email, u.nom FROM missions m 
            JOIN users u ON m.ambassadeur_id = u.id WHERE m.id = $1`, [id_mission]);
        
        if (missionResult.rows.length > 0) {
            const mission = missionResult.rows[0];
            await pool.query("UPDATE missions SET statut = 'approuve', date_approbation = NOW() WHERE id = $1", [id_mission]);
            
            await transporter.sendMail({
                from: `"FORFEO LAB" <${process.env.EMAIL_USER}>`,
                to: mission.email,
                subject: 'Mission Approuvée ! 💰',
                text: `Félicitations ${mission.nom}, votre audit "${mission.titre}" a été validé. Récompense : ${mission.recompense}$.`
            });
        }
        res.redirect('/admin/dashboard');
    } catch (err) { res.status(500).send("Erreur"); }
});

// --- DASHBOARDS AUTRES RÔLES ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    
    const stats = {
        totale: missions.rows.length,
        enCours: missions.rows.filter(m => m.statut === 'actif' || m.statut === 'reserve').length,
        termine: missions.rows.filter(m => m.statut === 'termine' || m.statut === 'approuve').length,
        totalInvesti: missions.rows.reduce((acc, m) => acc + (parseFloat(m.recompense) || 0), 0),
        forfait: user.rows[0]?.forfait || 'Freemium'
    };
    res.render('entreprise-dashboard', { missions: missions.rows, userName: req.session.userName, stats: stats });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query("SELECT SUM(recompense::numeric) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0 });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB actif sur port ${port}`));
