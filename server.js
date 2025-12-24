require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { Resend } = require('resend'); // On importe le facteur numérique

const app = express();

// ==========================================
// 1. CONFIGURATIONS
// ==========================================

// Base de Données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Indispensable pour Railway
    connectionTimeoutMillis: 5000 
});

// Configuration Email (Resend)
// Si la clé n'est pas encore dans Railway, on met 'null' pour éviter que le site plante
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ==========================================
// 2. INITIALISATION (TABLES)
// ==========================================
async function initDb() {
    try {
        console.log("🔧 Vérification de la Base de Données...");
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
        console.log("✅ DB prête et tables vérifiées.");
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

// --- COMMANDES (CLIENT) ---
app.get('/new-mission', (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    res.render('new-mission', { userId: userId });
});

app.post('/new-mission', async (req, res) => {
    const { userId, type, details, date } = req.body;
    try {
        await pool.query(`INSERT INTO missions (entreprise_id, type_mission, details, date_souhaitee, statut) VALUES ($1, $2, $3, $4, 'En attente')`, [userId, type, details, date]);
        res.redirect(`/dashboard?id=${userId}`);
    } catch (err) { res.send("Erreur lors de la commande."); }
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
        // 1. Mise à jour dans la DB
        await pool.query('UPDATE missions SET statut = $1 WHERE id = $2', [newStatus, missionId]);
        console.log(`Mission ${missionId} passée à : ${newStatus}`);

        // 2. Envoi de l'email SI la mission est terminée
        if (newStatus === 'Terminée' && resend) {
            
            // On cherche l'email du client concerné
            const missionInfo = await pool.query(`
                SELECT entreprises.email, entreprises.nom, missions.type_mission 
                FROM missions 
                JOIN entreprises ON missions.entreprise_id = entreprises.id 
                WHERE missions.id = $1
            `, [missionId]);
            
            const client = missionInfo.rows[0];

            if (client) {
                console.log(`📧 Envoi email à ${client.email}...`);
                
                await resend.emails.send({
                    from: 'Forfeo <onboarding@resend.dev>', // Email par défaut Resend
                    to: [client.email], // Le vrai email du client
                    subject: '🎉 Votre mission est terminée !',
                    html: `
                        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                            <h2 style="color: #2c3e50;">Bonjour ${client.nom},</h2>
                            <p>Nous avons une excellente nouvelle !</p>
                            <p>Votre mission <strong>${client.type_mission}</strong> a été validée et terminée par notre équipe.</p>
                            <p style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #28a745;">
                                Connectez-vous à votre espace pour consulter les résultats.
                            </p>
                            <br>
                            <a href="https://forfeo-app-production.up.railway.app/login" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Accéder à mon espace</a>
                        </div>
                    `
                });
                console.log("✅ Email envoyé avec succès !");
            }
        }

        res.redirect('/admin');
    } catch (err) {
        console.error("Erreur Update/Email :", err);
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
