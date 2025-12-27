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

// CONFIGURATION GMAIL
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'forfeo2005@gmail.com',
        pass: 'ibrrfercecmnzbbi' 
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Règle les erreurs "Cannot GET") ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/ambassadeur/details', (req, res) => res.render('ambassadeur-details'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// --- SUPPORT : RÉCEPTION DES DEMANDES (Règle l'erreur image_2be8a2.png) ---
app.post('/envoyer-contact', async (req, res) => {
    const { nom, sujet, message } = req.body;
    try {
        await transporter.sendMail({
            from: 'forfeo2005@gmail.com',
            to: 'forfeo2005@gmail.com',
            subject: `[SUPPORT FORFEO] ${sujet} - de ${nom}`,
            text: `Message de ${nom} :\n\n${message}`
        });
        res.send("<script>alert('Demande reçue ! Nous vous répondrons sous 24h.'); window.location.href='/';</script>");
    } catch (err) {
        res.status(500).send("Erreur d'envoi");
    }
});

// --- INSCRIPTION FACILE (Admin/Ambassadeur/Entreprise) ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role, ville } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    
    // Code secret pour devenir Admin : mettre ADMIN_FORFEO dans le nom
    let finalRole = role;
    if (nom.includes("ADMIN_FORFEO")) { finalRole = 'admin'; }

    try {
        await pool.query(
            "INSERT INTO users (nom, email, password, role, ville, is_premium) VALUES ($1, $2, $3, $4, $5, $6)", 
            [nom.replace("ADMIN_FORFEO", ""), email, hashed, finalRole, ville, (finalRole === 'admin')]
        );
        res.redirect('/login');
    } catch (err) { res.send("Erreur d'inscription"); }
});

// --- CONNEXION (Règle l'erreur image_207cb7.png) ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.userRole = user.role;
            if (user.role === 'admin') return res.redirect('/admin/dashboard');
            return res.redirect('/entreprise/dashboard');
        }
    }
    res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
});

// --- MISSIONS (Règle l'erreur image_2af846.png) ---
app.post('/creer-mission', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)",
        [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

// --- DASHBOARDS ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    const user = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: user.rows[0].is_premium });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT * FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { entreprises: entreprises.rows });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
