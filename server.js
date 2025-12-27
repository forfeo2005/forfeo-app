const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const stripe = require('stripe')('VOTRE_CLE_SECRETE_STRIPE'); // À remplir avec votre clé Stripe
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Connexion Base de données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// CONFIGURATION EMAIL AUTOMATIQUE (Avec votre code généré)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'forfeo2005@gmail.com',
        pass: 'ibrrfercecmnzbbi' // Votre mot de passe d'application 100% fonctionnel
    }
});

// INITIALISATION DB (Conserve toutes les tables existantes)
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, nom TEXT, email TEXT UNIQUE,
                ville TEXT, password TEXT, role TEXT, is_premium BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES users(id),
                titre TEXT, description TEXT, recompense TEXT, statut TEXT DEFAULT 'disponible'
            );
            CREATE TABLE IF NOT EXISTS candidatures (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), statut TEXT DEFAULT 'en_attente'
            );
            CREATE TABLE IF NOT EXISTS rapports (
                id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id),
                ambassadeur_id INTEGER REFERENCES users(id), contenu TEXT, note INTEGER
            );
        `);
    } catch (err) { console.error(err); }
};
initDb();

// --- WEBHOOK STRIPE : ACTIVATION AUTO + EMAIL BIENVENUE ---
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, 'VOTRE_SECRET_WEBHOOK_STRIPE');
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;

        try {
            // Activation automatique du statut Premium
            await pool.query("UPDATE users SET is_premium = TRUE WHERE email = $1", [customerEmail]);
            const userRes = await pool.query("SELECT nom FROM users WHERE email = $1", [customerEmail]);
            const nomEntreprise = userRes.rows[0]?.nom || "Cher Partenaire";

            // Envoi de l'email de bienvenue automatisé
            const mailOptions = {
                from: 'forfeo2005@gmail.com',
                to: customerEmail,
                subject: 'Bienvenue dans l\'Élite Forfeo Lab 💎 - Accès Premium Activé',
                text: `Bonjour ${nomEntreprise},\n\nNous avons le plaisir de vous informer que votre statut Premium a été activé avec succès sur votre compte FORFEO LAB.\n\nL'équipe de direction,\nFORFEO LAB`
            };
            await transporter.sendMail(mailOptions);
        } catch (err) { console.error("Erreur post-paiement:", err); }
    }
    res.json({received: true});
});

// CONFIGURATION SERVEUR & DESIGN
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'forfeo_secret', resave: false, saveUninitialized: false }));
app.set('view engine', 'ejs');

// --- ROUTES DE NAVIGATION (Conserve 100% des onglets) ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));
app.get('/entreprise/inscription', (req, res) => res.render('inscription-entreprise'));

// --- FORMULAIRE DE CONTACT AMBASSADEUR ---
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

// --- DASHBOARD ENTREPRISE : LOGIQUE FREEMIUM & DESIGN ---
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
    
    // Blocage si mission gratuite déjà utilisée
    if (!user.rows[0].is_premium && parseInt(countRes.rows[0].count) >= 1) {
        return res.send("Limite de mission gratuite atteinte. Veuillez passer au Premium.");
    }
    const { titre, description, recompense } = req.body;
    await pool.query("INSERT INTO missions (entreprise_id, titre, description, recompense) VALUES ($1, $2, $3, $4)", 
        [req.session.userId, titre, description, recompense]);
    res.redirect('/entreprise/dashboard');
});

// --- ADMIN DASHBOARD : GESTION MANUELLE & AUTO ---
app.get('/admin/dashboard', async (req, res) => {
    if (req.session.userRole !== 'admin') return res.redirect('/login');
    const entreprises = await pool.query("SELECT id, nom, email, is_premium FROM users WHERE role = 'entreprise'");
    const cand = await pool.query("SELECT c.*, m.titre, u.nom as ambassadeur FROM candidatures c JOIN missions m ON c.mission_id = m.id JOIN users u ON c.ambassadeur_id = u.id WHERE c.statut = 'en_attente'");
    res.render('admin-dashboard', { candidatures: cand.rows, entreprises: entreprises.rows });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(port, () => console.log(`🚀 Forfeo Server actif sur port ${port}`));
