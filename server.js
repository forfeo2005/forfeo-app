require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { Resend } = require('resend');
const Stripe = require('stripe');

// On initialise Stripe avec la clé secrète (définie dans Railway)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

// ==========================================
// 1. CONFIGURATIONS
// ==========================================

// Base de Données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000 
});

// Email (Resend)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ==========================================
// 2. INITIALISATION (TABLES)
// ==========================================
async function initDb() {
    try {
        await pool.query('SELECT NOW()'); 
        
        // Table Entreprises
        await pool.query(`
            CREATE TABLE IF NOT EXISTS entreprises (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(100) NOT NULL,
                plan VARCHAR(50) DEFAULT 'Gratuit',
                score DECIMAL(3,1) DEFAULT 0.0,
                missions_dispo INTEGER DEFAULT 0,
                initiales VARCHAR(5)
            )
        `);
        // Table Missions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY,
                entreprise_id INTEGER REFERENCES entreprises(id),
                type_mission VARCHAR(100),
                details TEXT,
                date_souhaitee VARCHAR(100),
                statut VARCHAR(50) DEFAULT 'En attente',
                date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ DB prête.");
    } catch (err) {
        console.error("❌ Erreur DB:", err);
    }
}
initDb();

// ==========================================
// 3. CONFIGURATION SERVEUR
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 4. ROUTES (PAGES)
// ==========================================

app.get('/', (req, res) => res.render('index'));

// --- LOGIN ---
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;
    try {
        // --- ADMIN BACKDOOR ---
        if (businessId === 'admin' && password === 'admin123') {
            return res.redirect('/admin');
        }

        // --- CLIENT NORMAL ---
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        if (result.rows.length > 0 && result.rows[0].password === password) {
            res.redirect(`/dashboard?id=${result.rows[0].id}`);
        } else {
            res.send('<script>alert("Identifiant ou mot de passe incorrect"); window.location.href="/login";</script>');
        }
    } catch (err) { res.send("Erreur technique login"); }
});

// --- INSCRIPTION ---
app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', async (req, res) => {
    const { companyName, email, password } = req.body;
    try {
        const check = await pool.query('SELECT * FROM entreprises WHERE email = $1', [email]);
        if (check.rows.length > 0) return res.send('<script>alert("Cet email est déjà utilisé !"); window.location.href="/signup";</script>');
        
        await pool.query(`INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo) VALUES ($1, $2, $3, 'Découverte', 0.0, 1)`, [companyName, email, password]);
        res.send('<script>alert("Compte créé avec succès ! Connectez-vous."); window.location.href="/login";</script>');
    } catch (err) { res.send("Erreur lors de l'inscription."); }
});

// --- COMMANDES & PAIEMENT STRIPE 💳 ---
app.get('/new-mission', (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    res.render('new-mission', { userId: userId });
});

app.post('/new-mission', async (req, res) => {
    const { userId, type, details, date } = req.body;
    try {
        // 1. On enregistre la mission (Statut: Non payé)
        const insertResult = await pool.query(`
            INSERT INTO missions (entreprise_id, type_mission, details, date_souhaitee, statut) 
            VALUES ($1, $2, $3, $4, 'Non payé')
            RETURNING id
        `, [userId, type, details, date]);
        
        const missionId = insertResult.rows[0].id;

        // 2. On crée la Session de Paiement Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: {
                        name: `Audit Forfeo : ${type}`,
                        description: 'Audit professionnel complet et rapport détaillé',
                    },
                    // --- PRIX RÉEL ICI ---
                    unit_amount: 15000, // 15000 centimes = 150.00 $ CAD
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://${req.get('host')}/payment-success?mission_id=${missionId}&user_id=${userId}`,
            cancel_url: `https://${req.get('host')}/dashboard?id=${userId}`,
        });

        // 3. Redirection vers Stripe
        res.redirect(session.url);

    } catch (err) { 
        console.error("Erreur Stripe:", err);
        // Message d'aide pour l'utilisateur si le compte Stripe n'est pas validé
        res.send("Erreur paiement. Vérifiez que votre compte Stripe est bien activé pour la production."); 
    }
});

// --- RETOUR PAIEMENT RÉUSSI ---
app.get('/payment-success', async (req, res) => {
    const { missionId, user_id } = req.query;

    try {
        // Validation de la commande
        await pool.query("UPDATE missions SET statut = 'En attente' WHERE id = $1", [missionId]);
        
        res.send(`
            <script>
                alert("Paiement réussi ! Votre mission est validée."); 
                window.location.href="/dashboard?id=${user_id}";
            </script>
        `);
    } catch (err) {
        res.send("Erreur lors de la validation du paiement.");
    }
});

// --- DASHBOARD ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId]);
        const user = userResult.rows[0];
        if (!user) return res.redirect('/login');
        
        res.render('dashboard', { user: user, missions: missionsResult.rows });
    } catch (err) { res.send("Erreur Dashboard"); }
});

// ==========================================
// 5. ESPACE ADMIN & EMAILS 📧
// ==========================================

// Voir toutes les missions
app.get('/admin', async (req, res) => {
    try {
        const query = `
            SELECT missions.id, missions.type_mission, missions.details, missions.date_souhaitee, missions.statut, entreprises.nom AS client_nom, entreprises.email AS client_email
            FROM missions
            JOIN entreprises ON missions.entreprise_id = entreprises.id
            ORDER BY missions.id DESC
        `;
        const result = await pool.query(query);
        res.render('admin', { missions: result.rows });
    } catch (err) {
        res.send("Erreur Admin : " + err.message);
    }
});

// Mettre à jour le statut (+ ENVOI EMAIL)
app.post('/admin/update', async (req, res) => {
    const { missionId, newStatus } = req.body;
    
    try {
        // 1. Mise à jour DB
        await pool.query('UPDATE missions SET statut = $1 WHERE id = $2', [newStatus, missionId]);

        // 2. Envoi Email via Resend
        if (newStatus === 'Terminée' && resend) {
            
            const missionInfo = await pool.query(`
                SELECT entreprises.email, entreprises.nom, missions.type_mission 
                FROM missions 
                JOIN entreprises ON missions.entreprise_id = entreprises.id 
                WHERE missions.id = $1
            `, [missionId]);
            
            const client = missionInfo.rows[0];

            if (client) {
                console.log(`📧 Envoi email à ${client.email}...`);
                
                const data = await resend.emails.send({
                    from: 'onboarding@resend.dev',
                    to: [client.email], 
                    subject: '🎉 Votre mission est terminée !',
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2>Bonjour ${client.nom},</h2>
                            <p>Votre mission <strong>${client.type_mission}</strong> est terminée.</p>
                            <p>Connectez-vous pour voir les résultats.</p>
                        </div>
                    `
                });

                if (data.error) {
                    console.error("❌ ERREUR RESEND :", data.error);
                } else {
                    console.log("✅ SUCCÈS RESEND :", data.data);
                }
            }
        }

        res.redirect('/admin');
    } catch (err) {
        console.error("Erreur Admin Update:", err);
        res.redirect('/admin');
    }
});


// Autres pages statiques
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// ==========================================
// 6. LANCEMENT
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`);
});
