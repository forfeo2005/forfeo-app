require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// CONFIGURATION DB
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000 
});

// INITIALISATION TABLES
async function initDb() {
    try {
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

// CONFIGURATION SERVEUR
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ROUTES
app.get('/', (req, res) => res.render('index'));

// Login & Inscription
app.get('/login', (req, res) => res.render('login'));
app.get('/signup', (req, res) => res.render('signup'));

app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;
    try {
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

// --- NOUVEAU : GESTION DES MISSIONS --- 🆕

// 1. Afficher le formulaire de commande
app.get('/new-mission', (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');
    res.render('new-mission', { userId: userId });
});

// 2. Enregistrer la commande
app.post('/new-mission', async (req, res) => {
    const { userId, type, details, date } = req.body;
    try {
        await pool.query(`
            INSERT INTO missions (entreprise_id, type_mission, details, date_souhaitee, statut)
            VALUES ($1, $2, $3, $4, 'En attente')
        `, [userId, type, details, date]);
        
        // On redirige vers le dashboard pour voir la nouvelle mission
        res.redirect(`/dashboard?id=${userId}`);
    } catch (err) {
        console.error(err);
        res.send("Erreur lors de la commande.");
    }
});

// 3. DASHBOARD MIS À JOUR (Pour lire les missions) 🔄
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');

    try {
        // Info Entreprise
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const user = userResult.rows[0];
        
        // Info Missions (On va chercher la liste dans la DB)
        const missionsResult = await pool.query('SELECT * FROM missions WHERE entreprise_id = $1 ORDER BY id DESC', [userId]);
        const missions = missionsResult.rows;

        if (!user) return res.redirect('/login');
        
        // On envoie les DEUX informations à la page (user + missions)
        res.render('dashboard', { user: user, missions: missions });
    } catch (err) {
        console.error(err);
        res.send("Erreur Dashboard");
    }
});

// Autres pages
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`);
});
