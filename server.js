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

// INITIALISATION
async function initDb() {
    try {
        await pool.query('SELECT NOW()'); 
        await pool.query(`CREATE TABLE IF NOT EXISTS entreprises (id SERIAL PRIMARY KEY, nom VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(100) NOT NULL, plan VARCHAR(50) DEFAULT 'Gratuit', score DECIMAL(3,1) DEFAULT 0.0, missions_dispo INTEGER DEFAULT 0, initiales VARCHAR(5))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, entreprise_id INTEGER REFERENCES entreprises(id), type_mission VARCHAR(100), details TEXT, date_souhaitee VARCHAR(100), statut VARCHAR(50) DEFAULT 'En attente', date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log("✅ DB prête.");
    } catch (err) { console.error("❌ Erreur DB:", err); }
}
initDb();

// CONFIG
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
        // --- BACKDOOR ADMIN (SIMPLE) ---
        // Si c'est toi qui te connectes avec "admin" / "admin123", on t'envoie sur la page admin
        if (businessId === 'admin' && password === 'admin123') {
            return res.redirect('/admin');
        }

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

// --- GESTION MISSIONS CLIENT ---
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
    } catch (err) { res.send("Erreur commande"); }
});

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

// --- NOUVEAU : ESPACE ADMIN 👮‍♂️ ---

// 1. Voir toutes les missions
app.get('/admin', async (req, res) => {
    try {
        // On fait une JOINTURE pour récupérer le nom de l'entreprise à côté de la mission
        const query = `
            SELECT missions.id, missions.type_mission, missions.details, missions.date_souhaitee, missions.statut, entreprises.nom AS client_nom
            FROM missions
            JOIN entreprises ON missions.entreprise_id = entreprises.id
            ORDER BY missions.id DESC
        `;
        const result = await pool.query(query);
        res.render('admin', { missions: result.rows });
    } catch (err) {
        console.error(err);
        res.send("Erreur Admin : " + err.message);
    }
});

// 2. Mettre à jour un statut
app.post('/admin/update', async (req, res) => {
    const { missionId, newStatus } = req.body;
    try {
        await pool.query('UPDATE missions SET statut = $1 WHERE id = $2', [newStatus, missionId]);
        console.log(`Mission ${missionId} passée à : ${newStatus}`);
        res.redirect('/admin'); // On recharge la page pour voir le changement
    } catch (err) {
        res.send("Erreur Update");
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
