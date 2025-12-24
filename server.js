require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// ==========================================
// 1. CONFIGURATION DE LA BASE DE DONNÉES 🗄️
// ==========================================

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("⚠️ ATTENTION : Pas de variable DATABASE_URL détectée.");
}

const pool = new Pool({
    connectionString: connectionString,
    // IMPORTANT pour Railway : On force le SSL
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000 // 5 secondes max pour se connecter
});

// ==========================================
// 2. INITIALISATION AUTOMATIQUE (TABLES) 🛠️
// ==========================================

async function initDb() {
    try {
        console.log("🔧 Vérification de la connexion DB...");
        // Test de connexion
        await pool.query('SELECT NOW()');
        console.log("✅ Connexion DB établie avec succès !");

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

        // Création Utilisateur Test (si absent)
        const checkUser = await pool.query("SELECT * FROM entreprises WHERE email = 'test'");
        if (checkUser.rows.length === 0) {
            await pool.query(`
                INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo, initiales)
                VALUES ('Hôtel Le Prestige', 'test', '1234', 'Forfait Pro', 8.4, 5, 'HP')
            `);
            console.log("👤 Utilisateur test créé (test / 1234).");
        }
    } catch (err) {
        console.error("❌ Erreur au démarrage de la DB :", err);
    }
}

// On lance l'initialisation au démarrage
initDb();

// ==========================================
// 3. CONFIGURATION DU SERVEUR ⚙️
// ==========================================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Pour lire les formulaires

// ==========================================
// 4. LES ROUTES (PAGES DU SITE) 🗺️
// ==========================================

// --- Page d'accueil ---
app.get('/', (req, res) => res.render('index'));

// --- Page de Login ---
app.get('/login', (req, res) => res.render('login'));

// --- Traitement du Login (Le Videur) ---
app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;
    
    console.log(`📥 Tentative de connexion pour : ${businessId}`);

    try {
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (password === user.password) {
                console.log("✅ Mot de passe OK. Redirection vers Dashboard...");
                // On redirige avec l'ID de l'utilisateur
                res.redirect(`/dashboard?id=${user.id}`);
            } else {
                console.log("❌ Mauvais mot de passe.");
                res.send('<script>alert("Mot de passe incorrect"); window.location.href="/login";</script>');
            }
        } else {
            console.log("❌ Utilisateur inconnu.");
            res.send('<script>alert("Compte inconnu"); window.location.href="/login";</script>');
        }
    } catch (err) {
        console.error("💥 ERREUR LOGIN :", err);
        res.status(500).send("Erreur serveur : " + err.message);
    }
});

// --- Dashboard (AVEC DIAGNOSTIC D'ERREUR) ---
app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;

    if (!userId) {
        return res.send("⛔ ERREUR : Pas d'ID utilisateur dans l'URL (ex: ?id=1).");
    }

    try {
        // Récupération des infos
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        if (!user) {
            return res.send("⛔ ERREUR : Utilisateur introuvable dans la base de données.");
        }

        console.log("📊 Chargement Dashboard pour :", user.nom);

        // Tentative d'affichage
        res.render('dashboard', { user: user });

    } catch (err) {
        // C'est ICI que ça va nous aider : Affichage de l'erreur au lieu de planter
        console.error("💥 CRASH DASHBOARD :", err);
        res.status(500).send(`
            <div style="font-family:sans-serif; padding:40px; text-align:center;">
                <h1 style="color:red;">💥 Erreur d'affichage du Dashboard</h1>
                <p>Le serveur a réussi à se connecter, mais le fichier <strong>dashboard.ejs</strong> contient une erreur.</p>
                <div style="background:#eee; padding:20px; text-align:left; border-radius:10px; margin:20px auto; max-width:800px;">
                    <strong>Détail technique :</strong><br>
                    <code style="color:crimson;">${err.message}</code>
                </div>
                <p>Prends une capture d'écran de ce message pour qu'on puisse corriger !</p>
                <a href="/login">Retour connexion</a>
            </div>
        `);
    }
});

// --- Autres Pages ---
app.get('/business-plans', (req, res) => res.render('business-plans'));
app.get('/partenaires', (req, res) => res.render('partenaires'));
app.get('/candidature', (req, res) => res.render('candidature'));
app.get('/confirmation', (req, res) => res.render('confirmation'));
app.get('/survey-qualite', (req, res) => res.render('survey-qualite'));
app.get('/survey-experience', (req, res) => res.render('survey-experience'));
app.get('/survey-satisfaction', (req, res) => res.render('survey-satisfaction'));

// ==========================================
// 5. LANCEMENT DU SERVEUR 🚀
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé sur le port ${PORT}`);
});
