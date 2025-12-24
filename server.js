require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// --- 1. CONNEXION ROBUSTE (SSL FORCÉ) ---
const connectionString = process.env.DATABASE_URL;

// Si on n'a pas de DB URL (en local sans .env), on prévient
if (!connectionString) {
    console.error("⚠️ ERREUR CRITIQUE : Pas de DATABASE_URL trouvée.");
}

const pool = new Pool({
    connectionString: connectionString,
    // ICI : On force le SSL pour Railway, sinon la requête attend à l'infini et plante
    ssl: { rejectUnauthorized: false },
    // On ajoute un timeout : si la DB ne répond pas en 5 secondes, on annule
    connectionTimeoutMillis: 5000 
});

// --- 2. INITIALISATION ---
async function initDb() {
    try {
        console.log("🔧 Vérification de la connexion DB...");
        // Test simple
        await pool.query('SELECT NOW()');
        console.log("✅ Connexion DB établie avec succès !");

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

        // Check utilisateur test
        const checkUser = await pool.query("SELECT * FROM entreprises WHERE email = 'test'");
        if (checkUser.rows.length === 0) {
            await pool.query(`
                INSERT INTO entreprises (nom, email, password, plan, score, missions_dispo, initiales)
                VALUES ('Hôtel Le Prestige', 'test', '1234', 'Forfait Pro', 8.4, 5, 'HP')
            `);
            console.log("👤 Utilisateur test créé.");
        }
    } catch (err) {
        console.error("❌ Erreur au démarrage de la DB :", err);
    }
}
initDb();

// --- 3. CONFIGURATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- 4. ROUTES ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

// LA ROUTE DE CONNEXION (Avec Espions 🕵️‍♂️)
app.post('/login', async (req, res) => {
    const { businessId, password } = req.body;
    
    console.log(`📥 Tentative de connexion reçue pour : ${businessId}`);

    try {
        console.log("⏳ Envoi de la requête à la Base de Données...");
        
        const result = await pool.query('SELECT * FROM entreprises WHERE email = $1', [businessId]);
        
        console.log(`🔙 Réponse DB reçue. Utilisateurs trouvés : ${result.rows.length}`);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (password === user.password) {
                console.log("✅ Mot de passe correct. Redirection...");
                res.redirect(`/dashboard?id=${user.id}`);
            } else {
                console.log("❌ Mot de passe incorrect.");
                res.send('<script>alert("Mot de passe incorrect"); window.location.href="/login";</script>');
            }
        } else {
            console.log("❌ Utilisateur inconnu.");
            res.send('<script>alert("Compte inconnu"); window.location.href="/login";</script>');
        }
    } catch (err) {
        console.error("💥 ERREUR PENDANT LE LOGIN :", err);
        res.status(500).send("Erreur serveur : " + err.message);
    }
});

app.get('/dashboard', async (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.redirect('/login');

    try {
        const userResult = await pool.query('SELECT * FROM entreprises WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) return res.redirect('/login');
        res.render('dashboard', { user: userResult.rows[0] });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo prêt sur le port ${PORT}`);
});
