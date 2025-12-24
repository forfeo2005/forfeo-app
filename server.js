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
    secret: 'forfeo-secret-key-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ROUTES PRINCIPALES
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// INSCRIPTION AMBASSADEUR (Correction ville et doublon d'email)
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom, ville });
    } catch (err) {
        if (err.code === '23505') return res.status(400).send("Cet email est déjà utilisé.");
        res.status(500).send("Erreur serveur.");
    }
});

// DASHBOARD ENTREPRISE (Correctif erreur Dashboard)
app.get('/entreprise/dashboard', async (req, res) => {
    try {
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
        const resStats = await pool.query('SELECT * FROM feedback_metrics WHERE entreprise_id = 4 ORDER BY id ASC');
        res.render('dashboard', { missions, stats: resStats.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur Dashboard : Vérifiez que la colonne date_evaluation existe.");
    }
});

app.get('/api/forfy-message', (req, res) => {
    res.json({ message: "Je suis Forfy ! Prêt à propulser votre établissement ?" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur ${PORT}`));
