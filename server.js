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

// --- CONFIGURATION COURRIEL ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- INITIALISATION DB ---
async function initialiserDB() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS ambassadeur_id INTEGER");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_final TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
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

// --- ROUTES AUTH & NAV ---
app.get('/', (req, res) => res.render('index', { userName: req.session.userName || null }));
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userName = result.rows[0].nom;
        req.session.userRole = result.rows[0].role;
        return res.redirect(`/${req.session.userRole}/dashboard`);
    }
    res.redirect('/login');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- DASHBOARD AMBASSADEUR ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const disponibles = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    const gains = await pool.query("SELECT SUM(recompense::numeric) as total FROM missions WHERE ambassadeur_id = $1 AND statut = 'approuve'", [req.session.userId]);
    res.render('ambassadeur-dashboard', { missions: disponibles.rows, userName: req.session.userName, totalGains: gains.rows[0].total || 0 });
});

app.get('/ambassadeur/mes-missions', async (req, res) => {
    const missions = await pool.query("SELECT * FROM missions WHERE ambassadeur_id = $1 ORDER BY id DESC", [req.session.userId]);
    res.render('ambassadeur-missions', { missions: missions.rows, userName: req.session.userName });
});

app.post('/envoyer-rapport', async (req, res) => {
    const { id_mission, feedback_general, photo_url, ...reponses } = req.body;
    let rapport = "RÉSULTATS :\n";
    for (const [k, v] of Object.entries(reponses)) { if(k!=='id_mission' && k!=='feedback_general' && k!=='photo_url') rapport += `- ${k} : ${v}\n`; }
    rapport += `\nOBSERVATIONS :\n${feedback_general}`;
    await pool.query("UPDATE missions SET rapport_final = $1, photo_preuve = $2, statut = 'termine' WHERE id = $3", [rapport, photo_url, id_mission]);
    res.redirect('/ambassadeur/mes-missions');
});

// --- DASHBOARD ADMIN & APPROBATION + EMAIL ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    const rapports = await pool.query("SELECT m.*, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id ORDER BY m.id DESC");
    res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows, userName: req.session.userName });
});

app.post('/admin/approuver-audit', async (req, res) => {
    const { id_mission } = req.body;
    const mission = await pool.query("SELECT m.*, u.email, u.nom FROM missions m JOIN users u ON m.ambassadeur_id = u.id WHERE m.id = $1", [id_mission]);
    
    if (mission.rows.length > 0) {
        await pool.query("UPDATE missions SET statut = 'approuve' WHERE id = $1", [id_mission]);
        
        // Envoi automatique du courriel
        const mailOptions = {
            from: '"FORFEO LAB" <votre-email@gmail.com>',
            to: mission.rows[0].email,
            subject: 'Félicitations ! Votre audit a été approuvé 💰',
            text: `Bonjour ${mission.rows[0].nom}, votre rapport pour la mission "${mission.rows[0].titre}" a été validé. Votre récompense de ${mission.rows[0].recompense}$ a été ajoutée à vos gains.`
        };
        transporter.sendMail(mailOptions).catch(err => console.log("Erreur Email:", err));
    }
    res.redirect('/admin/dashboard');
});

app.listen(port, () => console.log(`🚀 FORFEO LAB sur port ${port}`));
