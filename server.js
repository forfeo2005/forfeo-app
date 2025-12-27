const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
// AJOUT DES GUILLEMETS AUTOUR DE LA CLÉ STRIPE
const stripe = require('stripe')('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'); 
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Connexion Base de données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// CONFIGURATION EMAIL AVEC VOTRE CODE GOOGLE
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'forfeo2005@gmail.com',
        pass: 'ibrrfercecmnzbbi' 
    }
});

// --- ROUTE WEBHOOK STRIPE (AVEC VOTRE CLÉ WHSEC) ---
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            'whsec_Cror80dwMbS4zKHiJPKjMpNCj6IBYBCJ'
        );
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;
        try {
            await pool.query("UPDATE users SET is_premium = TRUE WHERE email = $1", [customerEmail]);
            const userRes = await pool.query("SELECT nom FROM users WHERE email = $1", [customerEmail]);
            const nomEntreprise = userRes.rows[0]?.nom || "Partenaire";

            await transporter.sendMail({
                from: 'forfeo2005@gmail.com',
                to: customerEmail,
                subject: 'Bienvenue dans l\'Élite Forfeo Lab 💎 - Accès Premium Activé',
                text: `Bonjour ${nomEntreprise},\n\nVotre statut Premium est désormais actif.\n\nL'équipe FORFEO LAB`
            });
        } catch (err) { console.error(err); }
    }
    res.json({received: true});
});

// MIDDLEWARES ET DESIGN
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));

app.post('/envoyer-contact', async (req, res) => {
    const { nom, sujet, message } = req.body;
    try {
        await transporter.sendMail({
            from: 'forfeo2005@gmail.com',
            to: 'forfeo2005@gmail.com',
            subject: `[SUPPORT] ${sujet} - ${nom}`,
            text: message
        });
        res.send("<script>alert('Message envoyé !'); window.location.href='/';</script>");
    } catch (err) { res.status(500).send("Erreur d'envoi"); }
});

// --- DASHBOARDS ---
app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    const user = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { 
        missions: missions.rows, 
        isPremium: user.rows[0].is_premium, 
        rapports: [] 
    });
});

app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT id, nom, email, is_premium FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { entreprises: entreprises.rows, candidatures: [] });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Serveur Forfeo prêt sur le port ${port}`));
