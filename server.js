require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { Resend } = require('resend');
const Stripe = require('stripe');

// On initialise Stripe avec la clé secrète (Live ou Test selon ce qu'il y a dans Railway)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

// CONFIGURATION DB
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000 
});

// CONFIG EMAIL
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// INITIALISATION TABLES
async function initDb() {
    try {
        await pool.query('SELECT NOW()'); 
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (id SERIAL PRIMARY KEY, nom VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(100) NOT NULL, plan VARCHAR(50) DEFAULT 'Gratuit', score DECIMAL(3,1) DEFAULT 0.0, missions_dispo INTEGER DEFAULT 0, initiales VARCHAR(5))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES entreprises(id), type_mission VARCHAR(100), details TEXT, date_souhaitee VARCHAR(100), statut VARCHAR(50) DEFAULT 'En attente', date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log("✅ DB prête.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDb();

// CONFIG SERVEUR
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ROUTES
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/signup', (req, res) => res.render('signup'));

app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;
    try {
        if (businessId === 'admin' && password === 'admin123') return res.redirect('/admin');
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        if (result.rows.length > 0 && result.rows[0].password === password) {
            res.redirect(`/dashboard?id=${result.rows[0].id}`);
        } else {
            res.send('<script>alert("Erreur identifiants"); window.location.href="/login";</script>');
        }
    } catch (err) { res.send("Erreur login"); }
});

app.post('/signup', async (req, res) => {
    const { companyName, email, password } = req.body;
    try {
        const check = await pool.query('SELECT * FROM entreprises WHERE email = $1', [email]);
        if (check.rows.length > 0) return res.send('<script>alert("Email déjà pris"); window.location.href="/signup";</script>');
        await pool.query(`INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo) VALUES ($1, $2, $3, 'Découverte', 0.0, 1)`, [companyName, email, password]);
        res.send('<script>alert("Compte créé !"); window.location.href="/login";</script>');
    } catch (err) { res.send("Erreur inscription"); }
});

// --- PAIEMENT STRIPE (LIVE) 💳 ---
app.get('/new-mission', (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    res.render('new-mission', { userId: userId });
});

app.post('/new-mission', async (req, res) => {
    const { userId, type, details, date } = req.body;
    try {
        // 1. Créer la mission en "Non payé"
        const insertResult = await pool.query(`INSERT INTO missions (entreprise_id, type_mission, details, date_souhaitee, statut) VALUES ($1, $2, $3, $4, 'Non payé') RETURNING id`, [userId, type, details, date]);
        const missionId = insertResult.rows[0].id;

        // 2. Créer la session Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: {
                        name: `Audit Forfeo : ${type}`,
                        description: 'Audit professionnel complet',
                    },
                    // PRIX ICI (en centimes) : 100 = 1.00$
                    // Mettre 15000 pour 150.00$
                    unit_amount: 100, 
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://${req.get('host')}/payment-success?mission_id=${missionId}&user_id=${userId}`,
            cancel_url: `https://${req.get('host')}/dashboard?id=${userId}`,
        });

        res.redirect(session.url);
    } catch (err) { 
        console.error("Erreur Stripe:", err);
        res.send("Erreur paiement. Vérifiez que votre compte Stripe est bien activé."); 
    }
});

app.get('/payment-success', async (req, res) => {
    const { missionId, user_id } = req.query;
    try {
        await pool.query("UPDATE missions SET statut = 'En attente' WHERE id = $1", [missionId]);
        res.send(`<script>alert("Paiement réussi ! Mission validée."); window.location.href="/dashboard?id=${user_id}";</script>`);
    } catch (err) { res.send("Erreur validation paiement."); }
});

// DASHBOARD & ADMIN
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    try {
        const user = (await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId])).rows[0];
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId])).rows;
        res.render('dashboard', { user, missions });
    } catch (err) { res.redirect('/login'); }
});

app.get('/admin', async (req, res) => {
    try {
        const result = await pool.query(`SELECT missions.id, missions.type_mission, missions.details, missions.date_souhaitee, missions.statut, entreprises.nom AS client_nom, entreprises.email AS client_email FROM missions JOIN entreprises ON missions.entreprise_id = entreprises.id ORDER BY missions.id DESC`);
        res.render('admin', { missions: result.rows });
    } catch (err) { res.send("Erreur Admin"); }
});

app.post('/admin/update', async (req, res) => {
    const { missionId, newStatus } = req.body;
    try {
        await pool.query('UPDATE missions SET statut = $1 WHERE id = $2', [newStatus, missionId]);
        
        // EMAIL DE DIAGNOSTIC
        if (newStatus === 'Terminée' && resend) {
            const client = (await pool.query(`SELECT entreprises.email, entreprises.nom, missions.type_mission FROM missions JOIN entreprises ON missions.entreprise_id = entreprises.id WHERE missions.id = $1`, [missionId])).rows[0];
            if (client) {
                console.log(`📧 Envoi email à ${client.email}...`);
                const data = await resend.emails.send({
                    from: 'onboarding@resend.dev',
                    to: [client.email],
                    subject: '🎉 Votre mission est terminée !',
                    html: `<p>Bonjour ${client.nom}, votre mission <strong>${client.type_mission}</strong> est terminée.</p>`
                });
                if (data.error) console.error("❌ ERREUR RESEND:", data.error);
                else console.log("✅ SUCCÈS RESEND:", data.data);
            }
        }
        res.redirect('/admin');
    } catch (err) { res.redirect('/admin'); }
});

// PAGES STATIQUES
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`); });
