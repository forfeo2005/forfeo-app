const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const stripe = require('stripe')('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'); 
const { OpenAI } = require("openai");
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Configuration OpenAI pour le cerveau de Forfy
const openai = new OpenAI({ apiKey: 'sk-proj-vjR466_G3q6X3iU2p_m2Tz1Xm9N1T3P5...' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// SCRIPT D'AUTO-RÉPARATION DE LA BASE DE DONNÉES
async function checkDatabase() {
    try {
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nom VARCHAR(100)");
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS rapport_ambassadeur TEXT");
        await pool.query("ALTER TABLE missions ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'");
        console.log("✅ Base de données synchronisée.");
    } catch (err) { console.log("Info DB: Déjà à jour."); }
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

// --- ROUTES IA FORFY (CERVEAU OMNIPRÉSENT) ---
app.post('/forfy/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "Tu es Forfy, l'IA de FORFEO LAB. Tu connais le site : audits mystères, forfaits (Freemium, Croissance 49$, Excellence 99$). Réponds avec courtoisie." },
                { role: "user", content: message }
            ],
        });
        res.json({ answer: response.choices[0].message.content });
    } catch (err) { res.status(500).json({ error: "Erreur Forfy" }); }
});

app.post('/forfy/generer-mission', async (req, res) => {
    const { typeEtablissement } = req.body;
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: "Rédige une mission d'audit qualité courte." }, { role: "user", content: `Mission pour: ${typeEtablissement}` }],
        });
        res.json({ description: response.choices[0].message.content });
    } catch (err) { res.status(500).json({ error: "Erreur" }); }
});

// --- PAIEMENT STRIPE RÉEL ---
app.post('/create-checkout-session', async (req, res) => {
    const { priceId } = req.body;
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${req.headers.origin}/entreprise/dashboard?success=true`,
        cancel_url: `${req.headers.origin}/entreprise/dashboard`,
    });
    res.redirect(303, session.url);
});

// --- NAVIGATION ---
app.get('/', async (req, res) => {
    let userName = null;
    if (req.session.userId) {
        const result = await pool.query("SELECT nom FROM users WHERE id = $1", [req.session.userId]);
        userName = result.rows[0]?.nom;
    }
    res.render('index', { userName });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.userId = result.rows[0].id;
        req.session.userRole = result.rows[0].role;
        return res.redirect(result.rows[0].role === 'admin' ? '/admin/dashboard' : result.rows[0].role === 'ambassadeur' ? '/ambassadeur/dashboard' : '/entreprise/dashboard');
    }
    res.send("<script>alert('Identifiants invalides'); window.location.href='/login';</script>");
});

app.get('/entreprise/dashboard', async (req, res) => {
    if (req.session.userRole !== 'entreprise') return res.redirect('/login');
    const missions = await pool.query("SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC", [req.session.userId]);
    const user = await pool.query("SELECT is_premium, nom FROM users WHERE id = $1", [req.session.userId]);
    res.render('entreprise-dashboard', { missions: missions.rows, isPremium: user.rows[0].is_premium, userName: user.rows[0].nom });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(port, () => console.log(`🚀 Serveur actif sur port ${port}`));
