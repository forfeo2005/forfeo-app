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
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS date_approbation TIMESTAMP");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS photo_preuve TEXT");
        console.log("✅ Base de données synchronisée pour l'analyse.");
    } catch (e) { console.log("DB déjà à jour."); }
}
initialiserDB();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- RÉPARATION DES ROUTES (Fix Cannot GET) ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/audit-mystere', (req, res) => res.render('audit-mystere', { userName: req.session.userName || null }));
app.get('/forfaits', (req, res) => res.render('forfaits', { userName: req.session.userName || null }));
app.get('/ambassadeurs', (req, res) => res.render('ambassadeurs', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));

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
        
        // Données pour le graphique de revenus (6 derniers mois)
        const revenusData = await pool.query(`
            SELECT TO_CHAR(date_approbation, 'Mon YYYY') as mois, 
                   SUM(recompense::numeric) as total 
            FROM missions 
            WHERE statut = 'approuve' 
            GROUP BY mois 
            ORDER BY MIN(date_approbation) ASC 
            LIMIT 6`);

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
            SELECT m.*, u.email, u.nom 
            FROM missions m 
            JOIN users u ON m.ambassadeur_id = u.id 
            WHERE m.id = $1`, [id_mission]);
        
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
    } catch (err) { res.status(500).send("Erreur d'approbation"); }
});

// --- RÉPARATION DASHBOARD ENTREPRISE ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT forfait FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { 
        missions: missions.rows, 
        userName: req.session.userName,
        stats: { forfait: user.rows[0]?.forfait || 'Freemium' } 
    });
});

app.listen(port, () => console.log(`🚀 FORFEO LAB sur port ${port}`));
