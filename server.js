require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const path = require('path');
const app = express();

// --- 1. CONNEXION BASE DE DONNÉES ---
// On vérifie si on est en ligne (Railway) ou en local
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// --- 2. FONCTION MAGIQUE : CRÉATION AUTOMATIQUE DES TABLES ---
async function initDb() {
    try {
        if (!connectionString) {
            console.log("⚠️ Pas de base de données détectée (Mode Local sans DB).");
            return;
        }

        console.log("🔧 Vérification des tables...");
        
        // Création table Entreprises
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

        // Création table Missions
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

        // Création d'un utilisateur TEST si il n'existe pas déjà
        const checkUser = await pool.query("SELECT * FROM entreprises WHERE email = 'test'");
        if (checkUser.rows.length === 0) {
            await pool.query(`
                INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo, initiales)
                VALUES ('Hôtel Le Prestige', 'test', '1234', 'Forfait Pro', 8.4, 5, 'HP')
            `);
            console.log("✅ Utilisateur test créé (test / 1234)");
        }
        
        console.log("✅ Base de données prête !");
    } catch (err) {
        console.error("Erreur initialisation DB:", err);
    }
}

// On lance l'initialisation
initDb();

// --- 3. CONFIGURATION DU SITE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- 4. LES ROUTES (PAGES) ---

app.get('/', (req, res) => res.render('index'));

// Page de Connexion
app.get('/login', (req, res) => res.render('login'));

// TRAITEMENT DE LA CONNEXION (Le vrai Videur)
app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;

    try {
        // On cherche l'entreprise dans la VRAIE base de données
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (password === user.password) {
                // Succès : On redirige avec l'ID
                res.redirect(`/dashboard?id=${user.id}`);
            } else {
                res.send('<script>alert("Mot de passe incorrect"); window.location.href="/login";</script>');
            }
        } else {
            res.send('<script>alert("Compte inconnu. Essayez : test / 1234"); window.location.href="/login";</script>');
        }
    } catch (err) {
        console.error(err);
        res.send("Erreur de connexion à la base de données");
    }
});

// Tableau de bord (Connecté à la Vraie DB)
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id; 

    if (!userId) return res.redirect('/login');

    try {
        // On récupère les vraies infos
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        // Si l'utilisateur n'existe pas, retour au login
        if (!user) return res.redirect('/login');

        res.render('dashboard', { user: user });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// Autres pages
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// --- 5. DÉMARRAGE ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`);
});
