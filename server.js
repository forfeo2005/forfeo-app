const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const stripe = require('stripe')('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'); 
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CORRECTIF : CRÉATION DES COLONNES MANQUANTES ---
async function checkDatabase() {
    try {
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_ambassadeur TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        console.log("🚀 Colonnes vérifiées et prêtes.");
    } catch (err) { console.log("Info: Les colonnes existent déjà ou erreur mineure."); }
}
checkDatabase();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'forfeo2005@gmail.com', pass: 'ibrrfercecmnzbbi' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/ambassadeur/details', (req, res) => res.render('ambassadeur-details'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

app.post('/envoyer-contact', async (req, res) => {
    const { nom, sujet, message } = req.body;
    try {
        await transporter.sendMail({
            from: 'forfeo2005@gmail.com',
            to: 'forfeo2005@gmail.com',
            subject: `[SUPPORT] ${sujet} - de ${nom}`,
            text: `Message : ${message}`
        });
        res.send("<script>alert('Message envoyé !'); window.location.href='/';</script>");
    } catch (err) { res.status(500).send("Erreur d'envoi"); }
});

app.post('/register', async (req, res) => {
    const { nom, email, password, role, ville } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    let finalRole = role;
    if (nom.includes("ADMIN_FORFEO")) { finalRole = 'admin'; }
    try {
        await pool.query("INSERT INTO users (nom, email, password, role, ville, is_premium) VALUES ($1, $2, $3, $4, $5, $6)", 
            [nom.replace("ADMIN_FORFEO", ""), email, hashed, finalRole, ville, (finalRole === 'admin')]);
        res.redirect('/login');
    } catch (err) { res.send("Erreur inscription"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.userRole = user.role;
            if (user.role === 'admin') return res.redirect('/admin/dashboard');
            if (user.role === 'ambassadeur') return res.redirect('/ambassadeur/dashboard');
            return res.redirect('/entreprise/dashboard');
        }
    }
    res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
});

app.post('/creer-mission', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense, statut) VALUES ($1, $2, $3, $4, 'actif')",
        [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

app.post('/valider-mission', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const { mission_id, rapport } = req.body;
    await pool.query("UPDATE missions SET rapport_ambassadeur = $1, statut = 'termine' WHERE id = $2", [rapport, mission_id]);
    res.redirect('/ambassadeur/dashboard');
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: user.rows[0].is_premium });
});

app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE statut = 'actif' ORDER BY id DESC");
    res.render('ambassadeur-dashboard', { missions: missions.rows });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    try {
        const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise' ORDER BY id DESC");
        const rapports = await pool.query("SELECT m.id, m.titre, m.rapport_ambassadeur, u.nom as entreprise_nom FROM missions m JOIN users u ON m.entreprise_id = u.id WHERE m.statut = 'termine' ORDER BY m.id DESC");
        res.render('admin-dashboard', { entreprises: entreprises.rows, rapports: rapports.rows });
    } catch (err) { res.status(500).send("Erreur base de données admin"); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
