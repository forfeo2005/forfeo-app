require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Stripe = require('stripe');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');

// --- CONFIGURATION DES SERVICES ---
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION NODEMAILER (ALERTES) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Fonction d'envoi d'email simplifiée
const sendAlert = (to, subject, text) => {
    const mailOptions = {
        from: `"Forfeo System" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text
    };
    transporter.sendMail(mailOptions, (err) => {
        if (err) console.error("❌ Erreur Email:", err);
    });
};

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES DE NAVIGATION ---
app.get('/', (req, res) => res.render('index'));
app.get('/candidature', (req, res) => res.render('espace-ambassadeur'));
app.get('/business-plans', (req, res) => res.render('offre-entreprise'));
app.get('/partenaires', (req, res) => res.render('partenaires'));

// --- AUTHENTIFICATION ENTREPRISE (FIX INSCRIPTION) ---
app.post('/signup-entreprise', async (req, res) => {
    const { nom, email, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO entreprises (nom, email, password, plan) VALUES ($1, $2, $3, $4) RETURNING id',
            [nom, email, password, 'Découverte']
        );

        // Notification Admin
        sendAlert(process.env.ADMIN_EMAIL, "🚀 Nouveau Lab Business", `L'entreprise ${nom} (${email}) vient de s'inscrire.`);
        
        res.redirect(`/dashboard?id=${result.rows[0].id}`);
    } catch (err) {
        res.status(500).send("Erreur : cet email est déjà utilisé par une entreprise.");
    }
});

app.post('/login-entreprise', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1 AND password = $2', [email, password]);
        if (result.rows.length > 0) {
            res.redirect(`/dashboard?id=${result.rows[0].id}`);
        } else {
            res.send("Email ou mot de passe incorrect.");
        }
    } catch (err) { res.status(500).send("Erreur de connexion."); }
});

// --- INSCRIPTION AMBASSADEUR ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password) VALUES ($1, $2, $3, $4)',
            [nom, email, ville, password]
        );
        
        // Notification Admin
        sendAlert(process.env.ADMIN_EMAIL, "👤 Nouveau Candidat", `Candidature de ${nom} (${ville}).`);
        
        res.render('confirmation-ambassadeur', { nom: nom });
    } catch (err) { res.status(500).send("Erreur lors de la candidature."); }
});

// --- DASHBOARD & ADMINISTRATION ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id || 4; // Par défaut vers admin si ID manquant
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY date_creation DESC', [userId])).rows;
        if (!user) return res.redirect('/');
        res.render('dashboard', { user, missions });
    } catch (err) { res.redirect('/'); }
});

app.get('/admin', async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const entreprises = (await pool.query('SELECT * FROM entreprises ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT m.*, e.nom as entreprise_nom FROM missions m JOIN entreprises e ON m.entreprise_id = e.id ORDER BY m.id DESC')).rows;
        res.render('admin', { ambassadeurs, entreprises, missions });
    } catch (err) { res.status(500).send("Accès refusé."); }
});

// --- IA FORFY ASSISTANT ---
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Tu es Forfy, l'IA experte de Forfeo Lab." }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.json({ reply: "Forfy est momentanément hors-ligne." }); }
});

// --- STRIPE : ACHAT DE MISSION ---
app.post('/create-checkout-session', async (req, res) => {
    const { userId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: { name: 'Audit Expérience Client Forfeo' },
                    unit_amount: 15000,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/dashboard?id=${userId}&payment=success`,
            cancel_url: `${req.headers.origin}/dashboard?id=${userId}`,
        });
        res.json({ id: session.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur Forfeo Lab 2025 actif sur le port ${PORT}`));
