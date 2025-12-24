require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// ==========================================
// 1. CONFIGURATION BASE DE DONNÉES
// ==========================================
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }, // Indispensable pour Railway
    connectionTimeoutMillis: 5000 
});

// ==========================================
// 2. INITIALISATION (TABLES)
// ==========================================
async function initDb() {
    try {
        console.log("🔧 Vérification DB...");
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
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (password === user.password) {
                res.redirect(`/dashboard?id=${user.id}`);
            } else {
                res.send('<script>alert("Mot de passe incorrect"); window.location.href="/login";</script>');
            }
        } else {
            res.send('<script>alert("Compte inconnu"); window.location.href="/login";</script>');
        }
    } catch (err) {
        console.error(err);
        res.send("Erreur technique login");
    }
});

// --- NOUVEAU : INSCRIPTION (C'est ce qui te manquait !) --- 🆕
app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', async (req, res) => {
    // On récupère les infos du formulaire
    const { companyName, email, password } = req.body;

    try {
        // 1. On vérifie si l'email existe déjà
        const check = await pool.query('SELECT * FROM entreprises WHERE email = $1', [email]);
        if (check.rows.length > 0) {
            return res.send('<script>alert("Cet email est déjà utilisé !"); window.location.href="/signup";</script>');
        }

        // 2. On CRÉE le nouveau client
        const newUser = await pool.query(`
            INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo)
            VALUES ($1, $2, $3, 'Découverte', 0.0, 1)
            RETURNING id
        `, [companyName, email, password]);

        // 3. Succès ! On redirige vers le login
        console.log(`🆕 Nouvel inscrit : ${companyName}`);
        res.send('<script>alert("Compte créé avec succès ! Connectez-vous."); window.location.href="/login";</script>');

    } catch (err) {
        console.error("Erreur Inscription:", err);
        res.send("Erreur lors de l'inscription.");
    }
});

// --- DASHBOARD ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');

    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const user = userResult.rows[0];
        if (!user) return res.redirect('/login');
        
        res.render('dashboard', { user: user });
    } catch (err) {
        console.error(err);
        res.send("Erreur Dashboard");
    }
});

// Autres pages statiques
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`);
});
