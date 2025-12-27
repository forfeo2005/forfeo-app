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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/details', (req, res) => res.render('ambassadeur-details'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- CONNEXION SÉCURISÉE ET REDIRECTION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (await bcrypt.compare(password, user.password)) {
                req.session.userId = user.id;
                req.session.userRole = user.role;

                // REDIRECTION SELON LE RÔLE
                if (user.role === 'admin') return res.redirect('/admin/dashboard');
                if (user.role === 'ambassadeur') return res.redirect('/ambassadeur/dashboard');
                return res.redirect('/entreprise/dashboard');
            }
        }
        res.send("<script>alert('Identifiants incorrects'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur"); }
});

// --- PORTAIL AMBASSADEUR (L'ONGLET QUI NE CHARGEAIT PAS) ---
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (req.session.userRole !== 'ambassadeur') return res.redirect('/login');
    
    // Récupération des missions disponibles pour les ambassadeurs
    const missions = await pool.query("SELECT * FROM missions ORDER BY id DESC");
    res.render('ambassadeur-dashboard', { missions: missions.rows });
});

// --- INSCRIPTION AVEC CODE ADMIN ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role, ville } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    let finalRole = role;
    if (nom.includes("ADMIN_FORFEO")) { finalRole = 'admin'; }

    try {
        await pool.query(
            "INSERT INTO users (nom, email, password, role, ville) VALUES ($1, $2, $3, $4, $5)", 
            [nom.replace("ADMIN_FORFEO", ""), email, hashed, finalRole, ville]
        );
        res.redirect('/login');
    } catch (err) { res.send("Erreur : Email déjà utilisé."); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
