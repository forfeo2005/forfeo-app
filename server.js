// --- ROUTE D'INSCRIPTION AMBASSADEUR ---
app.post('/signup-ambassadeur', async (req, res) => {
    // Récupération des données du formulaire
    const { nom, email, ville, password } = req.body;

    try {
        // Insertion dans la table ambassadeurs de Railway
        // Note : le statut est mis à 'En attente' par défaut pour validation admin
        await pool.query(
            'INSERT INTO ambassadeurs (nom, email, ville, password, statut) VALUES ($1, $2, $3, $4, $5)',
            [nom, email, ville, password, 'En attente']
        );

        // Succès : On affiche la vue de confirmation avec les données personnalisées
        // On envoie bien 'nom' ET 'ville' pour éviter l'erreur "ville is not defined"
        res.render('confirmation-ambassadeur', { 
            nom: nom, 
            ville: ville 
        });

    } catch (err) {
        // GESTION DES ERREURS SPÉCIFIQUES
        
        // Code 23505 = Erreur de contrainte d'unicité (Doublon d'email)
        if (err.code === '23505') {
            console.warn(`Tentative d'inscription avec un email déjà existant : ${email}`);
            return res.status(400).send(`
                <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2 style="color: #e74c3c;">Oups ! Cet email est déjà utilisé.</h2>
                    <p>L'adresse <strong>${email}</strong> possède déjà un compte ambassadeur.</p>
                    <a href="/ambassadeur/inscription" style="color: #0052cc;">Réessayer avec un autre email</a>
                </div>
            `);
        }

        // Autres erreurs serveur (Base de données déconnectée, colonne manquante, etc.)
        console.error("Erreur critique lors de l'inscription :", err);
        res.status(500).send("Désolé, une erreur technique est survenue. Veuillez réessayer plus tard.");
    }
});
