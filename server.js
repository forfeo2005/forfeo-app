const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const stripe = require('stripe')('VOTRE_CLE_SECRETE_STRIPE_SK_LIVE'); // Remplacez par votre sk_live...
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Connexion Base de données
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

// --- ROUTE WEBHOOK STRIPE (ACTIVATION AUTO + EMAIL) ---
// Note: Cette route utilise express.raw() pour la vérification de la signature Stripe
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // UTILISATION DE VOTRE CLÉ WHSEC FOURNIE
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            'whsec_Cror80dwMbS4zKHiJPKjMpNCj6IBYBCJ'
        );
    } catch (err) {
        console.error(`❌ Erreur Webhook : ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Si le paiement est réussi
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;

        try {
            // 1. Activation automatique en base de données
            await pool.query("UPDATE users SET is_premium = TRUE WHERE email = $1", [customerEmail]);

            // 2. Récupération du nom de l'entreprise
            const userRes = await pool.query("SELECT nom FROM users WHERE email = $1", [customerEmail]);
            const nomEntreprise = userRes.rows[0]?.nom || "Cher Partenaire";

            // 3. Envoi de l'Email de Bienvenue automatique
            const mailOptions = {
                from: 'forfeo2005@gmail.com',
                to: customerEmail,
                subject: 'Bienvenue dans l\'Élite Forfeo Lab 💎 - Accès Premium Activé',
                text: `Bonjour ${nomEntreprise},\n\nNous avons le plaisir de vous informer que votre statut Premium a été activé avec succès sur votre compte FORFEO LAB.\n\nVotre établissement rejoint désormais notre cercle restreint de partenaires privilégiés engagés dans la quête de l'excellence opérationnelle.\n\nL'équipe de direction,\nFORFEO LAB`
            };
            
            await transporter.sendMail(mailOptions);
            console.log(`✅ Succès : Premium activé et email envoyé à ${customerEmail}`);
        } catch (err) {
            console.error("Erreur lors de l'activation post-paiement:", err);
        }
    }

    res.json({received: true});
});

// MIDDLEWARES (Placés APRÈS le webhook pour ne pas interférer avec express.raw)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));

// Logique du formulaire de contact
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

// --- DASHBOARD & MISSIONS ---
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

app.post('/creer-mission', async (req, res) => {
    const user = await pool.query("SELECT is_premium FROM users WHERE id = $1", [req.session.userId]);
    const countRes = await pool.query("SELECT COUNT(*) FROM missions WHERE entreprise_id = $1", [req.session.userId]);
    
    if (!user.rows[0].is_premium && parseInt(countRes.rows[0].count) >= 1) {
        return res.send("Limite de mission gratuite atteinte. Veuillez passer au Premium.");
    }
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", 
        [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

// --- ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT id, nom, email, is_premium FROM users WHERE role = 'entreprise'");
    res.render('admin-dashboard', { entreprises: entreprises.rows, candidatures: [] });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Serveur Forfeo opérationnel sur le port ${port}`));
