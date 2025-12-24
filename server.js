require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

// 1. Configuration du Moteur (EJS)
app.set('view engine', 'ejs'); 
app.set('views', path.join(__dirname, 'views'));

// 2. Fichiers Statiques (CSS, JS, Images)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Pour lire les formulaires

// --- ROUTES (LES PAGES DE TON SITE) ---

// Page d'accueil
app.get('/', (req, res) => {
    res.render('index'); // Cherchera views/index.ejs
});

// Page de Connexion
app.get('/login', (req, res) => {
    res.render('login'); // Cherchera views/login.ejs
});

// Page Tableau de Bord (DYNAMIQUE)
app.get('/dashboard', (req, res) => {
    // C'est ici que la magie 2025 opère !
    // Au lieu d'avoir un fichier statique, le serveur injecte les données.
    // Plus tard, ces données viendront de la Base de Données Railway.
    
    const utilisateurConnecte = {
        nom: "Hôtel Le Prestige",
        initiales: "HP",
        plan: "Forfait Pro",
        score: 8.4,
        missions_dispo: 1,
        notifications: 2
    };

    // On envoie la page 'dashboard.ejs' AVEC les données de l'utilisateur
    res.render('dashboard', { user: utilisateurConnecte });
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur Forfeo lancé : http://localhost:${PORT}`);
});