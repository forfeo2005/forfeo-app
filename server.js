const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
// Clé Stripe avec guillemets pour éviter l'erreur de référence
const stripe = require('stripe')('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'); 
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Connexion Base de données PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// CONFIGURATION EMAIL (GMAIL)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'forfeo2005@gmail.com',
        pass: 'ibrrfercecmnzbbi' // Votre mot de passe d'application Google
    }
});

// --- ROUTE WEBHOOK STRIPE (ACTIVATION PREMIUM AUTO) ---
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            'whsec_Cror80dwMbS4zKHiJPKjMpNCj6IBYBCJ' // Votre clé secrète de webhook
        );
    } catch (err) {
        console.error(`❌ Erreur Webhook : ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;
        try {
            // Activation Premium dans la base de données
            await pool.query("UPDATE users SET is_premium = TRUE WHERE email = $1", [customerEmail]);
            
            // Envoi de l'email de bienvenue
            await transporter.sendMail({
                from: 'forfeo2005@gmail.com',
                to: customerEmail,
                subject: '💎 Bienvenue dans l\'Élite Forfeo Lab - Accès Premium Activé',
                text: `Félicitations ! Votre établissement a rejoint le cercle premium. Votre accès est désormais illimité.\n\nL'équipe FORFEO LAB`
            });
            console.log(`✅ Succès : Premium activé pour ${customerEmail}`);
        } catch (err) { console.error("Erreur post-paiement:", err); }
    }
    res.json({received: true});
});

// MIDDLEWARES (Placés après le webhook pour la compatibilité raw body)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'forfeo_secret', 
    resave: false, 
    saveUninitialized: false,
    cookie: { secure: false } // Mettre à true si vous passez en HTTPS strict
}));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION PRINCIPALES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/ambassadeur/details', (req, res) => res.render('ambassadeur-details'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/success', (req, res) => res.render('success')); // Page de succès après paiement

// --- LOGIQUE DE CONNEXION (Correction Erreur Cannot POST /login) ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (await bcrypt.compare(password, user.password)) {
                req.session.userId = user.id;
                req.session.userRole = user.role;
                // Redirection selon le rôle
                return res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/entreprise/dashboard');
            }
        }
        res.send("<script>alert('Identifiants invalides'); window.location.href='/login';</script>");
    } catch (err) { res.status(500).send("Erreur serveur lors de la connexion."); }
});

// --- LOGIQUE D'INSCRIPTION ---
app.post('/register', async (req, res) => {
    const { nom, email, password, role, ville } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query("INSERT INTO users (nom, email, password, role, ville) VALUES ($1, $2, $3, $4, $5)", [nom, email, hashed, role, ville]);
        res.redirect('/login');
    } catch (err) { res.send("Erreur : Cet email est déjà utilisé."); }
});

// --- FORMULAIRE DE CONTACT (VERS GMAIL) ---
app.post('/envoyer-contact', async (req, res) => {
    const { nom, sujet, message } = req.body;
    try {
        await transporter.sendMail({
            from: 'forfeo2005@gmail.com',
            to: 'forfeo2005@gmail.com',
            subject: `[SUPPORT SITE] ${sujet} - ${nom}`,
            text: message
        });
        res.send("<script>alert('Votre message a été envoyé avec succès !'); window.location.href='/';</script>");
    } catch (err) { res.status(500).send("Erreur lors de l'envoi du message."); }
});

// --- DASHBOARD ENTREPRISE (AVEC LIMITES) ---
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

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT id, nom, email, is_premium FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { entreprises: entreprises.rows, candidatures: [] });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// DÉMARRAGE DU SERVEUR
app.listen(port, () => {
    console.log(`🚀 Serveur FORFEO opérationnel sur le port ${port}`);
});
