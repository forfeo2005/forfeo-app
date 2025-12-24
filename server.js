require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'forfeo-safe-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ROUTES
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// INSCRIPTION (Avec correction ville et email unique)
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom, ville });
    } catch (err) {
        if (err.code === '23505') return res.status(400).send("Email déjà utilisé.");
        res.status(500).send("Erreur serveur.");
    }
});

// DASHBOARD (Avec correction colonne date)
app.get('/entreprise/dashboard', async (req, res) => {
    try {
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
        let stats = [];
        try {
            const resStats = await pool.query('SELECT * FROM feedback_metrics WHERE entreprise_id = 4 ORDER BY id ASC');
            stats = resStats.rows;
        } catch (e) { console.log("Table feedback_metrics incomplète"); }
        res.render('dashboard', { missions, stats });
    } catch (err) { res.status(500).send("Erreur Dashboard."); }
});

app.get('/api/forfy-message', (req, res) => {
    res.json({ message: "Je suis Forfy, comment puis-je vous aider ?" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur ${PORT}`));
