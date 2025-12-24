require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const app = express();

// --- CONFIGURATION BASE DE DONNÉES ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION EXPRESS ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration de la session (Indispensable pour la sécurité Admin)
app.use(session({
    secret: 'forfeo-corporate-key-2025',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Mettre à true si vous passez en HTTPS
}));

// --- MIDDLEWARE DE PROTECTION ---
const isAdmin = (req, res, next) => {
    if (req.session.adminLoggedIn) return next();
    res.redirect('/login');
};

// --- ROUTES PUBLIQUES & WOW EFFECT ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/ambassadeur/inscription', (req, res) => res.render('espace-ambassadeur'));

// Route dynamique pour la bulle Forfy
app.get('/api/forfy-message', (req, res) => {
    const page = req.query.page || '';
    const name = req.query.name || 'Ami';
    
    let message = "Besoin d'aide ?";
    if (page.includes('confirmation')) message = `Félicitations ${name} ! Prépare-toi pour tes expériences gratuites. 🎁`;
    if (page.includes('admin')) message = "Prêt pour les approbations de profil ?";
    if (page.includes('dashboard')) message = "Analyse tes scores de performance !";
    if (page.includes('inscription')) message = "On crée ton profil d'ambassadeur ?";
    
    res.json({ message });
});

// --- AUTHENTIFICATION ADMIN ---
app.post('/auth', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'forfeo2025') {
        req.session.adminLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.send("Identifiants incorrects. <a href='/login'>Réessayer</a>");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- PORTAIL AMBASSADEUR ---
app.post('/signup-ambassadeur', async (req, res) => {
    const { nom, email, ville, password } = req.body;
    try {
        // Ajout des colonnes ville et statut par défaut
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );
        res.render('confirmation-ambassadeur', { nom });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors de l'inscription.");
    }
});

// --- PORTAIL ADMIN SÉCURISÉ ---
app.get('/admin', isAdmin, async (req, res) => {
    try {
        const ambassadeurs = (await pool.query('SELECT * FROM ambassadeurs ORDER BY id DESC')).rows;
        const missions = (await pool.query('SELECT * FROM missions ORDER BY id DESC')).rows;
        res.render('admin', { ambassadeurs, missions });
    } catch (err) {
        res.status(500).send("Erreur serveur Admin.");
    }
});

// Action valider un ambassadeur (Ibrahim, Hamed, etc.)
app.get('/admin/approuver/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE ambassadeurs SET statut = 'Validé' WHERE id = $1", [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        res.status(500).send("Erreur validation.");
    }
});

// --- DASHBOARD ENTREPRISE (GRAPHIQUES) ---
app.get('/entreprise/dashboard', async (req, res) => {
    try {
        // Récupère les missions de l'entreprise #4
        const missions = (await pool.query('SELECT * FROM missions WHERE entreprise_id = 4')).rows;
        
        // Récupère les scores pour Chart.js (Table feedback_metrics créée manuellement)
        const stats = (await pool.query('SELECT * FROM feedback_metrics WHERE entreprise_id = 4 ORDER BY date_evaluation ASC')).rows;
        
        res.render('dashboard', { missions, stats });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur Dashboard.");
    }
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Forfeo Lab Corporate opérationnel sur le port ${PORT}`);
});
