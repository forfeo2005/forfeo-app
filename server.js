// PORTAIL AMBASSADEUR : Voir toutes les missions disponibles
app.get('/ambassadeur/dashboard', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'ambassadeur') {
        return res.redirect('/login');
    }
    try {
        // On récupère toutes les missions avec le statut 'disponible'
        const result = await pool.query("SELECT * FROM missions WHERE statut = 'disponible' ORDER BY created_at DESC");
        res.render('ambassadeur-dashboard', { missions: result.rows });
    } catch (err) {
        res.status(500).send("Erreur de chargement des missions.");
    }
});

// ACTION : Postuler à une mission
app.post('/postuler-mission', async (req, res) => {
    if (!req.session.userId || req.session.userRole !== 'ambassadeur') {
        return res.status(403).send("Non autorisé");
    }
    const { missionId } = req.body;
    try {
        // Ici, on pourrait ajouter une table 'candidatures', 
        // mais pour simplifier on va marquer la mission comme 'en_attente'
        await pool.query("UPDATE missions SET statut = 'en_attente' WHERE id = $1", [missionId]);
        res.redirect('/ambassadeur/dashboard?success=postulation_envoyee');
    } catch (err) {
        res.status(500).send("Erreur lors de la postulation.");
    }
});
